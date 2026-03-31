import type { TaskStateBase } from '../../Task.js'
import type { AgentToolResult } from '../../tools/AgentTool/agentToolUtils.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type { Message } from '../../types/message.js'
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js'
import type { AgentProgress } from '../LocalAgentTask/LocalAgentTask.js'

export type TeammateIdentity = {
  agentId: string 
  agentName: string 
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId: string 
}

export type InProcessTeammateTaskState = TaskStateBase & {
  type: 'in_process_teammate'

  
  
  identity: TeammateIdentity

  
  prompt: string
  
  model?: string
  
  
  selectedAgent?: AgentDefinition
  abortController?: AbortController 
  currentWorkAbortController?: AbortController 
  unregisterCleanup?: () => void // Runtime only

  
  awaitingPlanApproval: boolean

  
  permissionMode: PermissionMode

  
  error?: string
  result?: AgentToolResult 
  progress?: AgentProgress

  
  
  messages?: Message[]

  
  inProgressToolUseIDs?: Set<string>

  
  pendingUserMessages: string[]

  
  spinnerVerb?: string
  pastTenseVerb?: string

  
  isIdle: boolean
  shutdownRequested: boolean

  
  
  onIdleCallbacks?: Array<() => void>

  
  lastReportedToolCount: number
  lastReportedTokenCount: number
}

export function isInProcessTeammateTask(
  task: unknown,
): task is InProcessTeammateTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'in_process_teammate'
  )
}

/**
 * Cap on the number of messages kept in task.messages (the AppState UI mirror).
 *
 * task.messages exists purely for the zoomed transcript dialog, which only
 * needs recent context. The full conversation lives in the local allMessages
 * array (inProcessRunner) and on disk at the agent transcript path.
 *
 * BQ analysis (round 9, 2026-03-20) showed ~20MB RSS per agent at 500+ turn
 * sessions and ~125MB per concurrent agent in swarm bursts. Whale session
 * 9a990de8 launched 292 agents in 2 minutes and reached 36.8GB. The dominant
 * cost is this array holding a second full copy of every message.
 */
export const TEAMMATE_MESSAGES_UI_CAP = 50

export function appendCappedMessage<T>(
  prev: readonly T[] | undefined,
  item: T,
): T[] {
  if (prev === undefined || prev.length === 0) {
    return [item]
  }
  if (prev.length >= TEAMMATE_MESSAGES_UI_CAP) {
    const next = prev.slice(-(TEAMMATE_MESSAGES_UI_CAP - 1))
    next.push(item)
    return next
  }
  return [...prev, item]
}
