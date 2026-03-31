

import { getGlobalConfig } from '../../../utils/config.js'
import { logForDebugging } from '../../../utils/debug.js'
import { logError } from '../../../utils/log.js'

export type TeammateMode = 'auto' | 'tmux' | 'in-process'

let initialTeammateMode: TeammateMode | null = null

let cliTeammateModeOverride: TeammateMode | null = null

export function setCliTeammateModeOverride(mode: TeammateMode): void {
  cliTeammateModeOverride = mode
}

export function getCliTeammateModeOverride(): TeammateMode | null {
  return cliTeammateModeOverride
}

export function clearCliTeammateModeOverride(newMode: TeammateMode): void {
  cliTeammateModeOverride = null
  initialTeammateMode = newMode
  logForDebugging(
    `[TeammateModeSnapshot] CLI override cleared, new mode: ${newMode}`,
  )
}

export function captureTeammateModeSnapshot(): void {
  if (cliTeammateModeOverride) {
    initialTeammateMode = cliTeammateModeOverride
    logForDebugging(
      `[TeammateModeSnapshot] Captured from CLI override: ${initialTeammateMode}`,
    )
  } else {
    const config = getGlobalConfig()
    initialTeammateMode = config.teammateMode ?? 'auto'
    logForDebugging(
      `[TeammateModeSnapshot] Captured from config: ${initialTeammateMode}`,
    )
  }
}

export function getTeammateModeFromSnapshot(): TeammateMode {
  if (initialTeammateMode === null) {
    
    logError(
      new Error(
        'getTeammateModeFromSnapshot called before capture - this indicates an initialization bug',
      ),
    )
    captureTeammateModeSnapshot()
  }
  
  return initialTeammateMode ?? 'auto'
}
