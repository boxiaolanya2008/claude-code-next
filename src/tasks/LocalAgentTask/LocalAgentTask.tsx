import { getSdkAgentProgressSummariesEnabled } from '../../bootstrap/state.js';
import { OUTPUT_FILE_TAG, STATUS_TAG, SUMMARY_TAG, TASK_ID_TAG, TASK_NOTIFICATION_TAG, TOOL_USE_ID_TAG, WORKTREE_BRANCH_TAG, WORKTREE_PATH_TAG, WORKTREE_TAG } from '../../constants/xml.js';
import { abortSpeculation } from '../../services/PromptSuggestion/speculation.js';
import type { AppState } from '../../state/AppState.js';
import type { SetAppState, Task, TaskStateBase } from '../../Task.js';
import { createTaskStateBase } from '../../Task.js';
import type { Tools } from '../../Tool.js';
import { findToolByName } from '../../Tool.js';
import type { AgentToolResult } from '../../tools/AgentTool/agentToolUtils.js';
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js';
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../../tools/SyntheticOutputTool/SyntheticOutputTool.js';
import { asAgentId } from '../../types/ids.js';
import type { Message } from '../../types/message.js';
import { createAbortController, createChildAbortController } from '../../utils/abortController.js';
import { registerCleanup } from '../../utils/cleanupRegistry.js';
import { getToolSearchOrReadInfo } from '../../utils/collapseReadSearch.js';
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js';
import { getAgentTranscriptPath } from '../../utils/sessionStorage.js';
import { evictTaskOutput, getTaskOutputPath, initTaskOutputAsSymlink } from '../../utils/task/diskOutput.js';
import { PANEL_GRACE_MS, registerTask, updateTaskState } from '../../utils/task/framework.js';
import { emitTaskProgress } from '../../utils/task/sdkProgress.js';
import type { TaskState } from '../types.js';
export type ToolActivity = {
  toolName: string;
  input: Record<string, unknown>;
  
  activityDescription?: string;
  
  isSearch?: boolean;
  
  isRead?: boolean;
};
export type AgentProgress = {
  toolUseCount: number;
  tokenCount: number;
  lastActivity?: ToolActivity;
  recentActivities?: ToolActivity[];
  summary?: string;
};
const MAX_RECENT_ACTIVITIES = 5;
export type ProgressTracker = {
  toolUseCount: number;
  
  
  
  latestInputTokens: number;
  cumulativeOutputTokens: number;
  recentActivities: ToolActivity[];
};
export function createProgressTracker(): ProgressTracker {
  return {
    toolUseCount: 0,
    latestInputTokens: 0,
    cumulativeOutputTokens: 0,
    recentActivities: []
  };
}
export function getTokenCountFromTracker(tracker: ProgressTracker): number {
  return tracker.latestInputTokens + tracker.cumulativeOutputTokens;
}

export type ActivityDescriptionResolver = (toolName: string, input: Record<string, unknown>) => string | undefined;
export function updateProgressFromMessage(tracker: ProgressTracker, message: Message, resolveActivityDescription?: ActivityDescriptionResolver, tools?: Tools): void {
  if (message.type !== 'assistant') {
    return;
  }
  const usage = message.message.usage;
  
  tracker.latestInputTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  tracker.cumulativeOutputTokens += usage.output_tokens;
  for (const content of message.message.content) {
    if (content.type === 'tool_use') {
      tracker.toolUseCount++;
      
      if (content.name !== SYNTHETIC_OUTPUT_TOOL_NAME) {
        const input = content.input as Record<string, unknown>;
        const classification = tools ? getToolSearchOrReadInfo(content.name, input, tools) : undefined;
        tracker.recentActivities.push({
          toolName: content.name,
          input,
          activityDescription: resolveActivityDescription?.(content.name, input),
          isSearch: classification?.isSearch,
          isRead: classification?.isRead
        });
      }
    }
  }
  while (tracker.recentActivities.length > MAX_RECENT_ACTIVITIES) {
    tracker.recentActivities.shift();
  }
}
export function getProgressUpdate(tracker: ProgressTracker): AgentProgress {
  return {
    toolUseCount: tracker.toolUseCount,
    tokenCount: getTokenCountFromTracker(tracker),
    lastActivity: tracker.recentActivities.length > 0 ? tracker.recentActivities[tracker.recentActivities.length - 1] : undefined,
    recentActivities: [...tracker.recentActivities]
  };
}

export function createActivityDescriptionResolver(tools: Tools): ActivityDescriptionResolver {
  return (toolName, input) => {
    const tool = findToolByName(tools, toolName);
    return tool?.getActivityDescription?.(input) ?? undefined;
  };
}
export type LocalAgentTaskState = TaskStateBase & {
  type: 'local_agent';
  agentId: string;
  prompt: string;
  selectedAgent?: AgentDefinition;
  agentType: string;
  model?: string;
  abortController?: AbortController;
  unregisterCleanup?: () => void;
  error?: string;
  result?: AgentToolResult;
  progress?: AgentProgress;
  retrieved: boolean;
  messages?: Message[];
  
  lastReportedToolCount: number;
  lastReportedTokenCount: number;
  
  isBackgrounded: boolean;
  
  pendingMessages: string[];
  
  
  
  retain: boolean;
  
  
  diskLoaded: boolean;
  
  
  
  evictAfter?: number;
};
export function isLocalAgentTask(task: unknown): task is LocalAgentTaskState {
  return typeof task === 'object' && task !== null && 'type' in task && task.type === 'local_agent';
}

export function isPanelAgentTask(t: unknown): t is LocalAgentTaskState {
  return isLocalAgentTask(t) && t.agentType !== 'main-session';
}
export function queuePendingMessage(taskId: string, msg: string, setAppState: (f: (prev: AppState) => AppState) => void): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => ({
    ...task,
    pendingMessages: [...task.pendingMessages, msg]
  }));
}

export function appendMessageToLocalAgent(taskId: string, message: Message, setAppState: (f: (prev: AppState) => AppState) => void): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => ({
    ...task,
    messages: [...(task.messages ?? []), message]
  }));
}
export function drainPendingMessages(taskId: string, getAppState: () => AppState, setAppState: (f: (prev: AppState) => AppState) => void): string[] {
  const task = getAppState().tasks[taskId];
  if (!isLocalAgentTask(task) || task.pendingMessages.length === 0) {
    return [];
  }
  const drained = task.pendingMessages;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, t => ({
    ...t,
    pendingMessages: []
  }));
  return drained;
}

export function enqueueAgentNotification({
  taskId,
  description,
  status,
  error,
  setAppState,
  finalMessage,
  usage,
  toolUseId,
  worktreePath,
  worktreeBranch
}: {
  taskId: string;
  description: string;
  status: 'completed' | 'failed' | 'killed';
  error?: string;
  setAppState: SetAppState;
  finalMessage?: string;
  usage?: {
    totalTokens: number;
    toolUses: number;
    durationMs: number;
  };
  toolUseId?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}): void {
  
  
  
  let shouldEnqueue = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
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
  const summary = status === 'completed' ? `Agent "${description}" completed` : status === 'failed' ? `Agent "${description}" failed: ${error || 'Unknown error'}` : `Agent "${description}" was stopped`;
  const outputPath = getTaskOutputPath(taskId);
  const toolUseIdLine = toolUseId ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>` : '';
  const resultSection = finalMessage ? `\n<result>${finalMessage}</result>` : '';
  const usageSection = usage ? `\n<usage><total_tokens>${usage.totalTokens}</total_tokens><tool_uses>${usage.toolUses}</tool_uses><duration_ms>${usage.durationMs}</duration_ms></usage>` : '';
  const worktreeSection = worktreePath ? `\n<${WORKTREE_TAG}><${WORKTREE_PATH_TAG}>${worktreePath}</${WORKTREE_PATH_TAG}>${worktreeBranch ? `<${WORKTREE_BRANCH_TAG}>${worktreeBranch}</${WORKTREE_BRANCH_TAG}>` : ''}</${WORKTREE_TAG}>` : '';
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>${resultSection}${usageSection}${worktreeSection}
</${TASK_NOTIFICATION_TAG}>`;
  enqueuePendingNotification({
    value: message,
    mode: 'task-notification'
  });
}

export const LocalAgentTask: Task = {
  name: 'LocalAgentTask',
  type: 'local_agent',
  async kill(taskId, setAppState) {
    killAsyncAgent(taskId, setAppState);
  }
};

export function killAsyncAgent(taskId: string, setAppState: SetAppState): void {
  let killed = false;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    killed = true;
    task.abortController?.abort();
    task.unregisterCleanup?.();
    return {
      ...task,
      status: 'killed',
      endTime: Date.now(),
      evictAfter: task.retain ? undefined : Date.now() + PANEL_GRACE_MS,
      abortController: undefined,
      unregisterCleanup: undefined,
      selectedAgent: undefined
    };
  });
  if (killed) {
    void evictTaskOutput(taskId);
  }
}

export function killAllRunningAgentTasks(tasks: Record<string, TaskState>, setAppState: SetAppState): void {
  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.type === 'local_agent' && task.status === 'running') {
      killAsyncAgent(taskId, setAppState);
    }
  }
}

export function markAgentsNotified(taskId: string, setAppState: SetAppState): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.notified) {
      return task;
    }
    return {
      ...task,
      notified: true
    };
  });
}

export function updateAgentProgress(taskId: string, progress: AgentProgress, setAppState: SetAppState): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    const existingSummary = task.progress?.summary;
    return {
      ...task,
      progress: existingSummary ? {
        ...progress,
        summary: existingSummary
      } : progress
    };
  });
}

export function updateAgentSummary(taskId: string, summary: string, setAppState: SetAppState): void {
  let captured: {
    tokenCount: number;
    toolUseCount: number;
    startTime: number;
    toolUseId: string | undefined;
  } | null = null;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    captured = {
      tokenCount: task.progress?.tokenCount ?? 0,
      toolUseCount: task.progress?.toolUseCount ?? 0,
      startTime: task.startTime,
      toolUseId: task.toolUseId
    };
    return {
      ...task,
      progress: {
        ...task.progress,
        toolUseCount: task.progress?.toolUseCount ?? 0,
        tokenCount: task.progress?.tokenCount ?? 0,
        summary
      }
    };
  });

  
  
  
  if (captured && getSdkAgentProgressSummariesEnabled()) {
    const {
      tokenCount,
      toolUseCount,
      startTime,
      toolUseId
    } = captured;
    emitTaskProgress({
      taskId,
      toolUseId,
      description: summary,
      startTime,
      totalTokens: tokenCount,
      toolUses: toolUseCount,
      summary
    });
  }
}

export function completeAgentTask(result: AgentToolResult, setAppState: SetAppState): void {
  const taskId = result.agentId;
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    task.unregisterCleanup?.();
    return {
      ...task,
      status: 'completed',
      result,
      endTime: Date.now(),
      evictAfter: task.retain ? undefined : Date.now() + PANEL_GRACE_MS,
      abortController: undefined,
      unregisterCleanup: undefined,
      selectedAgent: undefined
    };
  });
  void evictTaskOutput(taskId);
  
}

export function failAgentTask(taskId: string, error: string, setAppState: SetAppState): void {
  updateTaskState<LocalAgentTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    task.unregisterCleanup?.();
    return {
      ...task,
      status: 'failed',
      error,
      endTime: Date.now(),
      evictAfter: task.retain ? undefined : Date.now() + PANEL_GRACE_MS,
      abortController: undefined,
      unregisterCleanup: undefined,
      selectedAgent: undefined
    };
  });
  void evictTaskOutput(taskId);
  
}

export function registerAsyncAgent({
  agentId,
  description,
  prompt,
  selectedAgent,
  setAppState,
  parentAbortController,
  toolUseId
}: {
  agentId: string;
  description: string;
  prompt: string;
  selectedAgent: AgentDefinition;
  setAppState: SetAppState;
  parentAbortController?: AbortController;
  toolUseId?: string;
}): LocalAgentTaskState {
  void initTaskOutputAsSymlink(agentId, getAgentTranscriptPath(asAgentId(agentId)));

  
  const abortController = parentAbortController ? createChildAbortController(parentAbortController) : createAbortController();
  const taskState: LocalAgentTaskState = {
    ...createTaskStateBase(agentId, 'local_agent', description, toolUseId),
    type: 'local_agent',
    status: 'running',
    agentId,
    prompt,
    selectedAgent,
    agentType: selectedAgent.agentType ?? 'general-purpose',
    abortController,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    
    pendingMessages: [],
    retain: false,
    diskLoaded: false
  };

  
  const unregisterCleanup = registerCleanup(async () => {
    killAsyncAgent(agentId, setAppState);
  });
  taskState.unregisterCleanup = unregisterCleanup;

  
  registerTask(taskState, setAppState);
  return taskState;
}

const backgroundSignalResolvers = new Map<string, () => void>();

export function registerAgentForeground({
  agentId,
  description,
  prompt,
  selectedAgent,
  setAppState,
  autoBackgroundMs,
  toolUseId
}: {
  agentId: string;
  description: string;
  prompt: string;
  selectedAgent: AgentDefinition;
  setAppState: SetAppState;
  autoBackgroundMs?: number;
  toolUseId?: string;
}): {
  taskId: string;
  backgroundSignal: Promise<void>;
  cancelAutoBackground?: () => void;
} {
  void initTaskOutputAsSymlink(agentId, getAgentTranscriptPath(asAgentId(agentId)));
  const abortController = createAbortController();
  const unregisterCleanup = registerCleanup(async () => {
    killAsyncAgent(agentId, setAppState);
  });
  const taskState: LocalAgentTaskState = {
    ...createTaskStateBase(agentId, 'local_agent', description, toolUseId),
    type: 'local_agent',
    status: 'running',
    agentId,
    prompt,
    selectedAgent,
    agentType: selectedAgent.agentType ?? 'general-purpose',
    abortController,
    unregisterCleanup,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: false,
    
    pendingMessages: [],
    retain: false,
    diskLoaded: false
  };

  
  let resolveBackgroundSignal: () => void;
  const backgroundSignal = new Promise<void>(resolve => {
    resolveBackgroundSignal = resolve;
  });
  backgroundSignalResolvers.set(agentId, resolveBackgroundSignal!);
  registerTask(taskState, setAppState);

  
  let cancelAutoBackground: (() => void) | undefined;
  if (autoBackgroundMs !== undefined && autoBackgroundMs > 0) {
    const timer = setTimeout((setAppState, agentId) => {
      
      setAppState(prev => {
        const prevTask = prev.tasks[agentId];
        if (!isLocalAgentTask(prevTask) || prevTask.isBackgrounded) {
          return prev;
        }
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [agentId]: {
              ...prevTask,
              isBackgrounded: true
            }
          }
        };
      });
      const resolver = backgroundSignalResolvers.get(agentId);
      if (resolver) {
        resolver();
        backgroundSignalResolvers.delete(agentId);
      }
    }, autoBackgroundMs, setAppState, agentId);
    cancelAutoBackground = () => clearTimeout(timer);
  }
  return {
    taskId: agentId,
    backgroundSignal,
    cancelAutoBackground
  };
}

export function backgroundAgentTask(taskId: string, getAppState: () => AppState, setAppState: SetAppState): boolean {
  const state = getAppState();
  const task = state.tasks[taskId];
  if (!isLocalAgentTask(task) || task.isBackgrounded) {
    return false;
  }

  
  setAppState(prev => {
    const prevTask = prev.tasks[taskId];
    if (!isLocalAgentTask(prevTask)) {
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

  
  const resolver = backgroundSignalResolvers.get(taskId);
  if (resolver) {
    resolver();
    backgroundSignalResolvers.delete(taskId);
  }
  return true;
}

export function unregisterAgentForeground(taskId: string, setAppState: SetAppState): void {
  
  backgroundSignalResolvers.delete(taskId);
  let cleanupFn: (() => void) | undefined;
  setAppState(prev => {
    const task = prev.tasks[taskId];
    
    if (!isLocalAgentTask(task) || task.isBackgrounded) {
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
