import { HOOK_EVENTS } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import { logForDebugging } from '../debug.js'
import type { HooksSettings } from '../settings/types.js'
import { addSessionHook, removeSessionHook } from './sessionHooks.js'

export function registerSkillHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  hooks: HooksSettings,
  skillName: string,
  skillRoot?: string,
): void {
  let registeredCount = 0

  for (const eventName of HOOK_EVENTS) {
    const matchers = hooks[eventName]
    if (!matchers) continue

    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        // For once: true hooks, use onHookSuccess callback to remove after execution
        const onHookSuccess = hook.once
          ? () => {
              logForDebugging(
                `Removing one-shot hook for event ${eventName} in skill '${skillName}'`,
              )
              removeSessionHook(setAppState, sessionId, eventName, hook)
            }
          : undefined

        addSessionHook(
          setAppState,
          sessionId,
          eventName,
          matcher.matcher || '',
          hook,
          onHookSuccess,
          skillRoot,
        )
        registeredCount++
      }
    }
  }

  if (registeredCount > 0) {
    logForDebugging(
      `Registered ${registeredCount} hooks from skill '${skillName}'`,
    )
  }
}
