

export {
  createTeammateContext,
  getTeammateContext,
  isInProcessTeammate,
  runWithTeammateContext,
  type TeammateContext,
} from './teammateContext.js'

import type { AppState } from '../state/AppState.js'
import { isEnvTruthy } from './envUtils.js'
import { getTeammateContext } from './teammateContext.js'

export function getParentSessionId(): string | undefined {
  const inProcessCtx = getTeammateContext()
  if (inProcessCtx) return inProcessCtx.parentSessionId
  return dynamicTeamContext?.parentSessionId
}

let dynamicTeamContext: {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId?: string
} | null = null

export function setDynamicTeamContext(
  context: {
    agentId: string
    agentName: string
    teamName: string
    color?: string
    planModeRequired: boolean
    parentSessionId?: string
  } | null,
): void {
  dynamicTeamContext = context
}

export function clearDynamicTeamContext(): void {
  dynamicTeamContext = null
}

export function getDynamicTeamContext(): typeof dynamicTeamContext {
  return dynamicTeamContext
}

export function getAgentId(): string | undefined {
  const inProcessCtx = getTeammateContext()
  if (inProcessCtx) return inProcessCtx.agentId
  return dynamicTeamContext?.agentId
}

export function getAgentName(): string | undefined {
  const inProcessCtx = getTeammateContext()
  if (inProcessCtx) return inProcessCtx.agentName
  return dynamicTeamContext?.agentName
}

export function getTeamName(teamContext?: {
  teamName: string
}): string | undefined {
  const inProcessCtx = getTeammateContext()
  if (inProcessCtx) return inProcessCtx.teamName
  if (dynamicTeamContext?.teamName) return dynamicTeamContext.teamName
  return teamContext?.teamName
}

export function isTeammate(): boolean {
  
  const inProcessCtx = getTeammateContext()
  if (inProcessCtx) return true
  
  return !!(dynamicTeamContext?.agentId && dynamicTeamContext?.teamName)
}

export function getTeammateColor(): string | undefined {
  const inProcessCtx = getTeammateContext()
  if (inProcessCtx) return inProcessCtx.color
  return dynamicTeamContext?.color
}

export function isPlanModeRequired(): boolean {
  const inProcessCtx = getTeammateContext()
  if (inProcessCtx) return inProcessCtx.planModeRequired
  if (dynamicTeamContext !== null) {
    return dynamicTeamContext.planModeRequired
  }
  return isEnvTruthy(process.env.CLAUDE_CODE_NEXT_PLAN_MODE_REQUIRED)
}

export function isTeamLead(
  teamContext:
    | {
        leadAgentId: string
      }
    | undefined,
): boolean {
  if (!teamContext?.leadAgentId) {
    return false
  }

  
  const myAgentId = getAgentId()
  const leadAgentId = teamContext.leadAgentId

  
  if (myAgentId === leadAgentId) {
    return true
  }

  
  
  if (!myAgentId) {
    return true
  }

  return false
}

export function hasActiveInProcessTeammates(appState: AppState): boolean {
  
  for (const task of Object.values(appState.tasks)) {
    if (task.type === 'in_process_teammate' && task.status === 'running') {
      return true
    }
  }
  return false
}

export function hasWorkingInProcessTeammates(appState: AppState): boolean {
  for (const task of Object.values(appState.tasks)) {
    if (
      task.type === 'in_process_teammate' &&
      task.status === 'running' &&
      !task.isIdle
    ) {
      return true
    }
  }
  return false
}

export function waitForTeammatesToBecomeIdle(
  setAppState: (f: (prev: AppState) => AppState) => void,
  appState: AppState,
): Promise<void> {
  const workingTaskIds: string[] = []

  for (const [taskId, task] of Object.entries(appState.tasks)) {
    if (
      task.type === 'in_process_teammate' &&
      task.status === 'running' &&
      !task.isIdle
    ) {
      workingTaskIds.push(taskId)
    }
  }

  if (workingTaskIds.length === 0) {
    return Promise.resolve()
  }

  
  return new Promise<void>(resolve => {
    let remaining = workingTaskIds.length

    const onIdle = (): void => {
      remaining--
      if (remaining === 0) {
        
        resolve()
      }
    }

    
    
    
    setAppState(prev => {
      const newTasks = { ...prev.tasks }
      for (const taskId of workingTaskIds) {
        const task = newTasks[taskId]
        if (task && task.type === 'in_process_teammate') {
          
          if (task.isIdle) {
            onIdle()
          } else {
            newTasks[taskId] = {
              ...task,
              onIdleCallbacks: [...(task.onIdleCallbacks ?? []), onIdle],
            }
          }
        }
      }
      return { ...prev, tasks: newTasks }
    })
  })
}
