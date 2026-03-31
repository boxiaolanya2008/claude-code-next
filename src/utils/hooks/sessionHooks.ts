import { HOOK_EVENTS, type HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import type { Message } from 'src/types/message.js'
import { logForDebugging } from '../debug.js'
import type { AggregatedHookResult } from '../hooks.js'
import type { HookCommand } from '../settings/types.js'
import { isHookEqual } from './hooksSettings.js'

type OnHookSuccess = (
  hook: HookCommand | FunctionHook,
  result: AggregatedHookResult,
) => void

export type FunctionHookCallback = (
  messages: Message[],
  signal?: AbortSignal,
) => boolean | Promise<boolean>

export type FunctionHook = {
  type: 'function'
  id?: string 
  timeout?: number
  callback: FunctionHookCallback
  errorMessage: string
  statusMessage?: string
}

type SessionHookMatcher = {
  matcher: string
  skillRoot?: string
  hooks: Array<{
    hook: HookCommand | FunctionHook
    onHookSuccess?: OnHookSuccess
  }>
}

export type SessionStore = {
  hooks: {
    [event in HookEvent]?: SessionHookMatcher[]
  }
}

export type SessionHooksState = Map<string, SessionStore>

export function addSessionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand,
  onHookSuccess?: OnHookSuccess,
  skillRoot?: string,
): void {
  addHookToSession(
    setAppState,
    sessionId,
    event,
    matcher,
    hook,
    onHookSuccess,
    skillRoot,
  )
}

export function addFunctionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  callback: FunctionHookCallback,
  errorMessage: string,
  options?: {
    timeout?: number
    id?: string
  },
): string {
  const id = options?.id || `function-hook-${Date.now()}-${Math.random()}`
  const hook: FunctionHook = {
    type: 'function',
    id,
    timeout: options?.timeout || 5000,
    callback,
    errorMessage,
  }
  addHookToSession(setAppState, sessionId, event, matcher, hook)
  return id
}

export function removeFunctionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  hookId: string,
): void {
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId)
    if (!store) {
      return prev
    }

    const eventMatchers = store.hooks[event] || []

    
    const updatedMatchers = eventMatchers
      .map(matcher => {
        const updatedHooks = matcher.hooks.filter(h => {
          if (h.hook.type !== 'function') return true
          return h.hook.id !== hookId
        })

        return updatedHooks.length > 0
          ? { ...matcher, hooks: updatedHooks }
          : null
      })
      .filter((m): m is SessionHookMatcher => m !== null)

    const newHooks =
      updatedMatchers.length > 0
        ? { ...store.hooks, [event]: updatedMatchers }
        : Object.fromEntries(
            Object.entries(store.hooks).filter(([e]) => e !== event),
          )

    prev.sessionHooks.set(sessionId, { hooks: newHooks })
    return prev
  })

  logForDebugging(
    `Removed function hook ${hookId} for event ${event} in session ${sessionId}`,
  )
}

function addHookToSession(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
  onHookSuccess?: OnHookSuccess,
  skillRoot?: string,
): void {
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId) ?? { hooks: {} }
    const eventMatchers = store.hooks[event] || []

    
    const existingMatcherIndex = eventMatchers.findIndex(
      m => m.matcher === matcher && m.skillRoot === skillRoot,
    )

    let updatedMatchers: SessionHookMatcher[]
    if (existingMatcherIndex >= 0) {
      
      updatedMatchers = [...eventMatchers]
      const existingMatcher = updatedMatchers[existingMatcherIndex]!
      updatedMatchers[existingMatcherIndex] = {
        matcher: existingMatcher.matcher,
        skillRoot: existingMatcher.skillRoot,
        hooks: [...existingMatcher.hooks, { hook, onHookSuccess }],
      }
    } else {
      
      updatedMatchers = [
        ...eventMatchers,
        {
          matcher,
          skillRoot,
          hooks: [{ hook, onHookSuccess }],
        },
      ]
    }

    const newHooks = { ...store.hooks, [event]: updatedMatchers }

    prev.sessionHooks.set(sessionId, { hooks: newHooks })
    return prev
  })

  logForDebugging(
    `Added session hook for event ${event} in session ${sessionId}`,
  )
}

export function removeSessionHook(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  event: HookEvent,
  hook: HookCommand,
): void {
  setAppState(prev => {
    const store = prev.sessionHooks.get(sessionId)
    if (!store) {
      return prev
    }

    const eventMatchers = store.hooks[event] || []

    
    const updatedMatchers = eventMatchers
      .map(matcher => {
        const updatedHooks = matcher.hooks.filter(
          h => !isHookEqual(h.hook, hook),
        )

        return updatedHooks.length > 0
          ? { ...matcher, hooks: updatedHooks }
          : null
      })
      .filter((m): m is SessionHookMatcher => m !== null)

    const newHooks =
      updatedMatchers.length > 0
        ? { ...store.hooks, [event]: updatedMatchers }
        : { ...store.hooks }

    if (updatedMatchers.length === 0) {
      delete newHooks[event]
    }

    prev.sessionHooks.set(sessionId, { ...store, hooks: newHooks })
    return prev
  })

  logForDebugging(
    `Removed session hook for event ${event} in session ${sessionId}`,
  )
}

export type SessionDerivedHookMatcher = {
  matcher: string
  hooks: HookCommand[]
  skillRoot?: string
}

function convertToHookMatchers(
  sessionMatchers: SessionHookMatcher[],
): SessionDerivedHookMatcher[] {
  return sessionMatchers.map(sm => ({
    matcher: sm.matcher,
    skillRoot: sm.skillRoot,
    
    hooks: sm.hooks
      .map(h => h.hook)
      .filter((h): h is HookCommand => h.type !== 'function'),
  }))
}

export function getSessionHooks(
  appState: AppState,
  sessionId: string,
  event?: HookEvent,
): Map<HookEvent, SessionDerivedHookMatcher[]> {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) {
    return new Map()
  }

  const result = new Map<HookEvent, SessionDerivedHookMatcher[]>()

  if (event) {
    const sessionMatchers = store.hooks[event]
    if (sessionMatchers) {
      result.set(event, convertToHookMatchers(sessionMatchers))
    }
    return result
  }

  for (const evt of HOOK_EVENTS) {
    const sessionMatchers = store.hooks[evt]
    if (sessionMatchers) {
      result.set(evt, convertToHookMatchers(sessionMatchers))
    }
  }

  return result
}

type FunctionHookMatcher = {
  matcher: string
  hooks: FunctionHook[]
}

export function getSessionFunctionHooks(
  appState: AppState,
  sessionId: string,
  event?: HookEvent,
): Map<HookEvent, FunctionHookMatcher[]> {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) {
    return new Map()
  }

  const result = new Map<HookEvent, FunctionHookMatcher[]>()

  const extractFunctionHooks = (
    sessionMatchers: SessionHookMatcher[],
  ): FunctionHookMatcher[] => {
    return sessionMatchers
      .map(sm => ({
        matcher: sm.matcher,
        hooks: sm.hooks
          .map(h => h.hook)
          .filter((h): h is FunctionHook => h.type === 'function'),
      }))
      .filter(m => m.hooks.length > 0)
  }

  if (event) {
    const sessionMatchers = store.hooks[event]
    if (sessionMatchers) {
      const functionMatchers = extractFunctionHooks(sessionMatchers)
      if (functionMatchers.length > 0) {
        result.set(event, functionMatchers)
      }
    }
    return result
  }

  for (const evt of HOOK_EVENTS) {
    const sessionMatchers = store.hooks[evt]
    if (sessionMatchers) {
      const functionMatchers = extractFunctionHooks(sessionMatchers)
      if (functionMatchers.length > 0) {
        result.set(evt, functionMatchers)
      }
    }
  }

  return result
}

export function getSessionHookCallback(
  appState: AppState,
  sessionId: string,
  event: HookEvent,
  matcher: string,
  hook: HookCommand | FunctionHook,
):
  | {
      hook: HookCommand | FunctionHook
      onHookSuccess?: OnHookSuccess
    }
  | undefined {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) {
    return undefined
  }

  const eventMatchers = store.hooks[event]
  if (!eventMatchers) {
    return undefined
  }

  
  for (const matcherEntry of eventMatchers) {
    if (matcherEntry.matcher === matcher || matcher === '') {
      const hookEntry = matcherEntry.hooks.find(h => isHookEqual(h.hook, hook))
      if (hookEntry) {
        return hookEntry
      }
    }
  }

  return undefined
}

export function clearSessionHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
): void {
  setAppState(prev => {
    prev.sessionHooks.delete(sessionId)
    return prev
  })

  logForDebugging(`Cleared all session hooks for session ${sessionId}`)
}
