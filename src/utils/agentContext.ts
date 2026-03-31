

import { AsyncLocalStorage } from 'async_hooks'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { isAgentSwarmsEnabled } from './agentSwarmsEnabled.js'

export type SubagentContext = {
  /** The subagent's UUID (from createAgentId()) */
  agentId: string
  
  parentSessionId?: string
  
  agentType: 'subagent'
  
  subagentName?: string
  
  isBuiltIn?: boolean
  

  invokingRequestId?: string
  

  invocationKind?: 'spawn' | 'resume'
  

  invocationEmitted?: boolean
}

/**
 * Context for in-process teammates.
 * Teammates are part of a swarm and have team coordination.
 */
export type TeammateAgentContext = {
  /** Full agent ID, e.g., "researcher@my-team" */
  agentId: string
  
  agentName: string
  
  teamName: string
  
  agentColor?: string
  
  planModeRequired: boolean
  
  parentSessionId: string
  
  isTeamLead: boolean
  
  agentType: 'teammate'
  

  invokingRequestId?: string
  
  invocationKind?: 'spawn' | 'resume'
  
  invocationEmitted?: boolean
}

/**
 * Discriminated union for agent context.
 * Use agentType to distinguish between subagent and teammate contexts.
 */
export type AgentContext = SubagentContext | TeammateAgentContext

const agentContextStorage = new AsyncLocalStorage<AgentContext>()

export function getAgentContext(): AgentContext | undefined {
  return agentContextStorage.getStore()
}

/**
 * Run an async function with the given agent context.
 * All async operations within the function will have access to this context.
 */
export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return agentContextStorage.run(context, fn)
}

/**
 * Type guard to check if context is a SubagentContext.
 */
export function isSubagentContext(
  context: AgentContext | undefined,
): context is SubagentContext {
  return context?.agentType === 'subagent'
}

/**
 * Type guard to check if context is a TeammateAgentContext.
 */
export function isTeammateAgentContext(
  context: AgentContext | undefined,
): context is TeammateAgentContext {
  if (isAgentSwarmsEnabled()) {
    return context?.agentType === 'teammate'
  }
  return false
}

/**
 * Get the subagent name suitable for analytics logging.
 * Returns the agent type name for built-in agents, "user-defined" for custom agents,
 * or undefined if not running within a subagent context.
 *
 * Safe for analytics metadata: built-in agent names are code constants,
 * and custom agents are always mapped to the literal "user-defined".
 */
export function getSubagentLogName():
  | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  | undefined {
  const context = getAgentContext()
  if (!isSubagentContext(context) || !context.subagentName) {
    return undefined
  }
  return (
    context.isBuiltIn ? context.subagentName : 'user-defined'
  ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Get the invoking request_id for the current agent context — once per
 * invocation. Returns the id on the first call after a spawn/resume, then
 * undefined until the next boundary. Also undefined on the main thread or
 * when the spawn path had no request_id.
 *
 * Sparse edge semantics: invokingRequestId appears on exactly one
 * tengu_api_success/error per invocation, so a non-NULL value downstream
 * marks a spawn/resume boundary.
 */
export function consumeInvokingRequestId():
  | {
      invokingRequestId: string
      invocationKind: 'spawn' | 'resume' | undefined
    }
  | undefined {
  const context = getAgentContext()
  if (!context?.invokingRequestId || context.invocationEmitted) {
    return undefined
  }
  context.invocationEmitted = true
  return {
    invokingRequestId: context.invokingRequestId,
    invocationKind: context.invocationKind,
  }
}
