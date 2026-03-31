

import { AsyncLocalStorage } from 'async_hooks'

export type TeammateContext = {
  
  agentId: string
  
  agentName: string
  
  teamName: string
  
  color?: string
  
  planModeRequired: boolean
  
  parentSessionId: string
  
  isInProcess: true
  
  abortController: AbortController
}

const teammateContextStorage = new AsyncLocalStorage<TeammateContext>()

export function getTeammateContext(): TeammateContext | undefined {
  return teammateContextStorage.getStore()
}

export function runWithTeammateContext<T>(
  context: TeammateContext,
  fn: () => T,
): T {
  return teammateContextStorage.run(context, fn)
}

export function isInProcessTeammate(): boolean {
  return teammateContextStorage.getStore() !== undefined
}

export function createTeammateContext(config: {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId: string
  abortController: AbortController
}): TeammateContext {
  return {
    ...config,
    isInProcess: true,
  }
}
