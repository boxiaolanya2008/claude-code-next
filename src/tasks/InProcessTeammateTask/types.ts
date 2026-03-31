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
  unregisterCleanup?: () => void 

  
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
