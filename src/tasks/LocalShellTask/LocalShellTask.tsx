import { feature } from "../utils/bundle-mock.ts";
import { stat } from 'fs/promises';
import { OUTPUT_FILE_TAG, STATUS_TAG, SUMMARY_TAG, TASK_ID_TAG, TASK_NOTIFICATION_TAG, TOOL_USE_ID_TAG } from '../../constants/xml.js';
import { abortSpeculation } from '../../services/PromptSuggestion/speculation.js';
import type { AppState } from '../../state/AppState.js';
import type { LocalShellSpawnInput, SetAppState, Task, TaskContext, TaskHandle } from '../../Task.js';
import { createTaskStateBase } from '../../Task.js';
import type { AgentId } from '../../types/ids.js';
import { registerCleanup } from '../../utils/cleanupRegistry.js';
import { tailFile } from '../../utils/fsOperations.js';
import { logError } from '../../utils/log.js';
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js';
import type { ShellCommand } from '../../utils/ShellCommand.js';
import { evictTaskOutput, getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { registerTask, updateTaskState } from '../../utils/task/framework.js';
import { escapeXml } from '../../utils/xml.js';
import { backgroundAgentTask, isLocalAgentTask } from '../LocalAgentTask/LocalAgentTask.js';
import { isMainSessionTask } from '../LocalMainSessionTask.js';
import { type BashTaskKind, isLocalShellTask, type LocalShellTaskState } from './guards.js';
import { killTask } from './killShellTasks.js';

export const BACKGROUND_BASH_SUMMARY_PREFIX = 'Background command ';
const STALL_CHECK_INTERVAL_MS = 5_000;
const STALL_THRESHOLD_MS = 45_000;
const STALL_TAIL_BYTES = 1024;

const PROMPT_PATTERNS = [/\(y\/n\)/i,

/\[y\/n\]/i,

/\(yes\/no\)/i, /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\? *$/i,

/Press (any key|Enter)/i, /Continue\?/i, /Overwrite\?/i];
export function looksLikePrompt(tail: string): boolean {
  const lastLine = tail.trimEnd().split('\n').pop() ?? '';
  return PROMPT_PATTERNS.some(p => p.test(lastLine));
}

function startStallWatchdog(taskId: string, description: string, kind: BashTaskKind | undefined, toolUseId?: string, agentId?: AgentId): () => void {
  if (kind === 'monitor') return () => {};
  const outputPath = getTaskOutputPath(taskId);
  let lastSize = 0;
  let lastGrowth = Date.now();
  let cancelled = false;
  const timer = setInterval(() => {
    void stat(outputPath).then(s => {
      if (s.size > lastSize) {
        lastSize = s.size;
        lastGrowth = Date.now();
        return;
      }
      if (Date.now() - lastGrowth < STALL_THRESHOLD_MS) return;
      void tailFile(outputPath, STALL_TAIL_BYTES).then(({
        content
      }) => {
        if (cancelled) return;
        if (!looksLikePrompt(content)) {
          
          
          lastGrowth = Date.now();
          return;
        }
        
        
        cancelled = true;
        clearInterval(timer);
        const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
        const summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" appears to be waiting for interactive input`;
        
        
        
        
        const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>
Last output:
${content.trimEnd()}

The command is likely blocked on an interactive prompt. Kill this task and re-run with piped input (e.g., \`echo y | command\`) or a non-interactive flag if one exists.`;
        enqueuePendingNotification({
          value: message,
          mode: 'task-notification',
          priority: 'next',
          agentId
        });
      }, () => {});
    }, () => {} 
    );
  }, STALL_CHECK_INTERVAL_MS);
  timer.unref();
  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}
function enqueueShellNotification(taskId: string, description: string, status: 'completed' | 'failed' | 'killed', exitCode: number | undefined, setAppState: SetAppState, toolUseId?: string, kind: BashTaskKind = 'bash', agentId?: AgentId): void {
  
  
  
  let shouldEnqueue = false;
  updateTaskState(taskId, setAppState, task => {
    if (task.notified) {
      return task;
    }
    shouldEnqueue = true;
    return {
      ...task,
      notified: true
    };
  });
  if (!shouldEnqueue) {
    return;
  }

  
  
  
  abortSpeculation(setAppState);
  let summary: string;
  if (feature('MONITOR_TOOL') && kind === 'monitor') {
    
    
    
    
    switch (status) {
      case 'completed':
        summary = `Monitor "${description}" stream ended`;
        break;
      case 'failed':
        summary = `Monitor "${description}" script failed${exitCode !== undefined ? ` (exit ${exitCode})` : ''}`;
        break;
      case 'killed':
        summary = `Monitor "${description}" stopped`;
        break;
    }
  } else {
    switch (status) {
      case 'completed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" completed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}`;
        break;
      case 'failed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" failed${exitCode !== undefined ? ` with exit code ${exitCode}` : ''}`;
        break;
      case 'killed':
        summary = `${BACKGROUND_BASH_SUMMARY_PREFIX}"${description}" was stopped`;
        break;
    }
  }
  const outputPath = getTaskOutputPath(taskId);
  const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${escapeXml(summary)}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification',
    priority: feature('MONITOR_TOOL') ? 'next' : 'later',
    agentId
  });
}
export const LocalShellTask: Task = {
  name: 'LocalShellTask',
  type: 'local_bash',
  async kill(taskId, setAppState) {
    killTask(taskId, setAppState);
  }
};
export async function spawnShellTask(input: LocalShellSpawnInput & {
  shellCommand: ShellCommand;
}, context: TaskContext): Promise<TaskHandle> {
  const {
    command,
    description,
    shellCommand,
    toolUseId,
    agentId,
    kind
  } = input;
  const {
    setAppState
  } = context;

  
  const {
    taskOutput
  } = shellCommand;
  const taskId = taskOutput.taskId;
  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState);
  });
  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: true,
    agentId,
    kind
  };
  registerTask(taskState, setAppState);

  
  
  shellCommand.background(taskId);
  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
    updateTaskState<LocalShellTaskState>(taskId, setAppState, task => {
      if (task.status === 'killed') {
        wasKilled = true;
        return task;
      }
      return {
        ...task,
        status: result.code === 0 ? 'completed' : 'failed',
        result: {
          code: result.code,
          interrupted: result.interrupted
        },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now()
      };
    });
    enqueueShellNotification(taskId, description, wasKilled ? 'killed' : result.code === 0 ? 'completed' : 'failed', result.code, setAppState, toolUseId, kind, agentId);
    void evictTaskOutput(taskId);
  });
  return {
    taskId,
    cleanup: () => {
      unregisterCleanup();
    }
  };
}

export function registerForeground(input: LocalShellSpawnInput & {
  shellCommand: ShellCommand;
}, setAppState: SetAppState, toolUseId?: string): string {
  const {
    command,
    description,
    shellCommand,
    agentId
  } = input;
  const taskId = shellCommand.taskOutput.taskId;
  const unregisterCleanup = registerCleanup(async () => {
    killTask(taskId, setAppState);
  });
  const taskState: LocalShellTaskState = {
    ...createTaskStateBase(taskId, 'local_bash', description, toolUseId),
    type: 'local_bash',
    status: 'running',
    command,
    completionStatusSentInAttachment: false,
    shellCommand,
    unregisterCleanup,
    lastReportedTotalLines: 0,
    isBackgrounded: false,
    
    agentId
  };
  registerTask(taskState, setAppState);
  return taskId;
}

function backgroundTask(taskId: string, getAppState: () => AppState, setAppState: SetAppState): boolean {
  
  const state = getAppState();
  const task = state.tasks[taskId];
  if (!isLocalShellTask(task) || task.isBackgrounded || !task.shellCommand) {
    return false;
  }
  const shellCommand = task.shellCommand;
  const description = task.description;
  const {
    toolUseId,
    kind,
    agentId
  } = task;

  
  if (!shellCommand.background(taskId)) {
    return false;
  }
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
      return prev;
    }
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...prevTask,
          isBackgrounded: true
        }
      }
    };
  });
  const cancelStallWatchdog = startStallWatchdog(taskId, description, kind, toolUseId, agentId);

  
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
    let cleanupFn: (() => void) | undefined;
    updateTaskState<LocalShellTaskState>(taskId, setAppState, t => {
      if (t.status === 'killed') {
        wasKilled = true;
        return t;
      }

      
      cleanupFn = t.unregisterCleanup;
      return {
        ...t,
        status: result.code === 0 ? 'completed' : 'failed',
        result: {
          code: result.code,
          interrupted: result.interrupted
        },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now()
      };
    });

    
    cleanupFn?.();
    if (wasKilled) {
      enqueueShellNotification(taskId, description, 'killed', result.code, setAppState, toolUseId, kind, agentId);
    } else {
      const finalStatus = result.code === 0 ? 'completed' : 'failed';
      enqueueShellNotification(taskId, description, finalStatus, result.code, setAppState, toolUseId, kind, agentId);
    }
    void evictTaskOutput(taskId);
  });
  return true;
}

export function hasForegroundTasks(state: AppState): boolean {
  return Object.values(state.tasks).some(task => {
    if (isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand) {
      return true;
    }
    
    if (isLocalAgentTask(task) && !task.isBackgrounded && !isMainSessionTask(task)) {
      return true;
    }
    return false;
  });
}
export function backgroundAll(getAppState: () => AppState, setAppState: SetAppState): void {
  const state = getAppState();

  
  const foregroundBashTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalShellTask(task) && !task.isBackgrounded && task.shellCommand;
  });
  for (const taskId of foregroundBashTaskIds) {
    backgroundTask(taskId, getAppState, setAppState);
  }

  
  const foregroundAgentTaskIds = Object.keys(state.tasks).filter(id => {
    const task = state.tasks[id];
    return isLocalAgentTask(task) && !task.isBackgrounded;
  });
  for (const taskId of foregroundAgentTaskIds) {
    backgroundAgentTask(taskId, getAppState, setAppState);
  }
}

export function backgroundExistingForegroundTask(taskId: string, shellCommand: ShellCommand, description: string, setAppState: SetAppState, toolUseId?: string): boolean {
  if (!shellCommand.background(taskId)) {
    return false;
  }
  let agentId: AgentId | undefined;
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalShellTask(prevTask) || prevTask.isBackgrounded) {
      return prev;
    }
    agentId = prevTask.agentId;
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: {
          ...prevTask,
          isBackgrounded: true
        }
      }
    };
  });
  const cancelStallWatchdog = startStallWatchdog(taskId, description, undefined, toolUseId, agentId);

  
  void shellCommand.result.then(async result => {
    cancelStallWatchdog();
    await flushAndCleanup(shellCommand);
    let wasKilled = false;
    let cleanupFn: (() => void) | undefined;
    updateTaskState<LocalShellTaskState>(taskId, setAppState, t => {
      if (t.status === 'killed') {
        wasKilled = true;
        return t;
      }
      cleanupFn = t.unregisterCleanup;
      return {
        ...t,
        status: result.code === 0 ? 'completed' : 'failed',
        result: {
          code: result.code,
          interrupted: result.interrupted
        },
        shellCommand: null,
        unregisterCleanup: undefined,
        endTime: Date.now()
      };
    });
    cleanupFn?.();
    const finalStatus = wasKilled ? 'killed' : result.code === 0 ? 'completed' : 'failed';
    enqueueShellNotification(taskId, description, finalStatus, result.code, setAppState, toolUseId, undefined, agentId);
    void evictTaskOutput(taskId);
  });
  return true;
}

export function markTaskNotified(taskId: string, setAppState: SetAppState): void {
  updateTaskState(taskId, setAppState, t => t.notified ? t : {
    ...t,
    notified: true
  });
}

export function unregisterForeground(taskId: string, setAppState: SetAppState): void {
  let cleanupFn: (() => void) | undefined;
  setAppState(prev => {
    const task = prev.tasks[taskId];
    
    if (!isLocalShellTask(task) || task.isBackgrounded) {
      return prev;
    }

    
    cleanupFn = task.unregisterCleanup;
    const {
      [taskId]: removed,
      ...rest
    } = prev.tasks;
    return {
      ...prev,
      tasks: rest
    };
  });

  
  cleanupFn?.();
}
async function flushAndCleanup(shellCommand: ShellCommand): Promise<void> {
  try {
    await shellCommand.taskOutput.flush();
    shellCommand.cleanup();
  } catch (error) {
    logError(error);
  }
}
