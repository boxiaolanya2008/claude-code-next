

import figures from 'figures';
import type { TaskStatus } from 'src/Task.js';
import type { InProcessTeammateTaskState } from 'src/tasks/InProcessTeammateTask/types.js';
import { isPanelAgentTask } from 'src/tasks/LocalAgentTask/LocalAgentTask.js';
import { isBackgroundTask, type TaskState } from 'src/tasks/types.js';
import type { DeepImmutable } from 'src/types/utils.js';
import { summarizeRecentActivities } from 'src/utils/collapseReadSearch.js';

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed';
}

export function getTaskStatusIcon(status: TaskStatus, options?: {
  isIdle?: boolean;
  awaitingApproval?: boolean;
  hasError?: boolean;
  shutdownRequested?: boolean;
}): string {
  const {
    isIdle,
    awaitingApproval,
    hasError,
    shutdownRequested
  } = options ?? {};
  if (hasError) return figures.cross;
  if (awaitingApproval) return figures.questionMarkPrefix;
  if (shutdownRequested) return figures.warning;
  if (status === 'running') {
    if (isIdle) return figures.ellipsis;
    return figures.play;
  }
  if (status === 'completed') return figures.tick;
  if (status === 'failed' || status === 'killed') return figures.cross;
  return figures.bullet;
}

export function getTaskStatusColor(status: TaskStatus, options?: {
  isIdle?: boolean;
  awaitingApproval?: boolean;
  hasError?: boolean;
  shutdownRequested?: boolean;
}): 'success' | 'error' | 'warning' | 'background' {
  const {
    isIdle,
    awaitingApproval,
    hasError,
    shutdownRequested
  } = options ?? {};
  if (hasError) return 'error';
  if (awaitingApproval) return 'warning';
  if (shutdownRequested) return 'warning';
  if (isIdle) return 'background';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'killed') return 'warning';
  return 'background';
}

export function describeTeammateActivity(t: DeepImmutable<InProcessTeammateTaskState>): string {
  if (t.shutdownRequested) return 'stopping';
  if (t.awaitingPlanApproval) return 'awaiting approval';
  if (t.isIdle) return 'idle';
  return (t.progress?.recentActivities && summarizeRecentActivities(t.progress.recentActivities)) ?? t.progress?.lastActivity?.activityDescription ?? 'working';
}

export function shouldHideTasksFooter(tasks: {
  [taskId: string]: TaskState;
}, showSpinnerTree: boolean): boolean {
  if (!showSpinnerTree) return false;
  let hasVisibleTask = false;
  for (const t of Object.values(tasks) as TaskState[]) {
    if (!isBackgroundTask(t) || "external" === 'ant' && isPanelAgentTask(t)) {
      continue;
    }
    hasVisibleTask = true;
    if (t.type !== 'in_process_teammate') return false;
  }
  return hasVisibleTask;
}
