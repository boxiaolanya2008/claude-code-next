

import { AsyncLocalStorage } from 'async_hooks'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { isAgentSwarmsEnabled } from './agentSwarmsEnabled.js'

export type SubagentContext = {
  
  agentId: string
  
  parentSessionId?: string
  
  agentType: 'subagent'
  
  subagentName?: string
  
  isBuiltIn?: boolean
  

  invokingRequestId?: string
  

  invocationKind?: 'spawn' | 'resume'
  

  invocationEmitted?: boolean
}

export type TeammateAgentContext = {
  
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

export type AgentContext = SubagentContext | TeammateAgentContext

const agentContextStorage = new AsyncLocalStorage<AgentContext>()

export function getAgentContext(): AgentContext | undefined {
  return agentContextStorage.getStore()
}

export function runWithAgentContext<T>(context: AgentContext, fn: () => T): T {
  return agentContextStorage.run(context, fn)
}

export function isSubagentContext(
  context: AgentContext | undefined,
): context is SubagentContext {
  return context?.agentType === 'subagent'
}

export function isTeammateAgentContext(
  context: AgentContext | undefined,
): context is TeammateAgentContext {
  if (isAgentSwarmsEnabled()) {
    return context?.agentType === 'teammate'
  }
  return false
}

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
