

import { isTerminalTaskStatus, type SetAppState, type Task, type TaskStateBase } from '../../Task.js';
import type { Message } from '../../types/message.js';
import { logForDebugging } from '../../utils/debug.js';
import { createUserMessage } from '../../utils/messages.js';
import { killInProcessTeammate } from '../../utils/swarm/spawnInProcess.js';
import { updateTaskState } from '../../utils/task/framework.js';
import type { InProcessTeammateTaskState } from './types.js';
import { appendCappedMessage, isInProcessTeammateTask } from './types.js';

export const InProcessTeammateTask: Task = {
  name: 'InProcessTeammateTask',
  type: 'in_process_teammate',
  async kill(taskId, setAppState) {
    killInProcessTeammate(taskId, setAppState);
  }
};

export function requestTeammateShutdown(taskId: string, setAppState: SetAppState): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running' || task.shutdownRequested) {
      return task;
    }
    return {
      ...task,
      shutdownRequested: true
    };
  });
}

export function appendTeammateMessage(taskId: string, message: Message, setAppState: SetAppState): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task;
    }
    return {
      ...task,
      messages: appendCappedMessage(task.messages, message)
    };
  });
}

export function injectUserMessageToTeammate(taskId: string, message: string, setAppState: SetAppState): void {
  updateTaskState<InProcessTeammateTaskState>(taskId, setAppState, task => {
    
    
    if (isTerminalTaskStatus(task.status)) {
      logForDebugging(`Dropping message for teammate task ${taskId}: task status is "${task.status}"`);
      return task;
    }
    return {
      ...task,
      pendingUserMessages: [...task.pendingUserMessages, message],
      messages: appendCappedMessage(task.messages, createUserMessage({
        content: message
      }))
    };
  });
}

export function findTeammateTaskByAgentId(agentId: string, tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState | undefined {
  let fallback: InProcessTeammateTaskState | undefined;
  for (const task of Object.values(tasks)) {
    if (isInProcessTeammateTask(task) && task.identity.agentId === agentId) {
      
      
      if (task.status === 'running') {
        return task;
      }
      
      if (!fallback) {
        fallback = task;
      }
    }
  }
  return fallback;
}

export function getAllInProcessTeammateTasks(tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState[] {
  return Object.values(tasks).filter(isInProcessTeammateTask);
}

export function getRunningTeammatesSorted(tasks: Record<string, TaskStateBase>): InProcessTeammateTaskState[] {
  return getAllInProcessTeammateTasks(tasks).filter(t => t.status === 'running').sort((a, b) => a.identity.agentName.localeCompare(b.identity.agentName));
}
