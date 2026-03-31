import { HOOK_EVENTS, type HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppState.js'
import { logForDebugging } from '../debug.js'
import type { HooksSettings } from '../settings/types.js'
import { addSessionHook } from './sessionHooks.js'

export function registerFrontmatterHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  sessionId: string,
  hooks: HooksSettings,
  sourceName: string,
  isAgent: boolean = false,
): void {
  if (!hooks || Object.keys(hooks).length === 0) {
    return
  }

  let hookCount = 0

  for (const event of HOOK_EVENTS) {
    const matchers = hooks[event]
    if (!matchers || matchers.length === 0) {
      continue
    }

    // For agents, convert Stop hooks to SubagentStop since that's what fires when an agent completes
    // (executeStopHooks uses SubagentStop when called with an agentId)
    let targetEvent: HookEvent = event
    if (isAgent && event === 'Stop') {
      targetEvent = 'SubagentStop'
      logForDebugging(
        `Converting Stop hook to SubagentStop for ${sourceName} (subagents trigger SubagentStop)`,
      )
    }

    for (const matcherConfig of matchers) {
      const matcher = matcherConfig.matcher ?? ''
      const hooksArray = matcherConfig.hooks

      if (!hooksArray || hooksArray.length === 0) {
        continue
      }

      for (const hook of hooksArray) {
        addSessionHook(setAppState, sessionId, targetEvent, matcher, hook)
        hookCount++
      }
    }
  }

  if (hookCount > 0) {
    logForDebugging(
      `Registered ${hookCount} frontmatter hook(s) from ${sourceName} for session ${sessionId}`,
    )
  }
}
