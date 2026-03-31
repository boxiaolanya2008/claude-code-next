import { env } from '../../../utils/env.js'
import { execFileNoThrow } from '../../../utils/execFileNoThrow.js'
import { TMUX_COMMAND } from '../constants.js'

const ORIGINAL_USER_TMUX = process.env.TMUX

const ORIGINAL_TMUX_PANE = process.env.TMUX_PANE

let isInsideTmuxCached: boolean | null = null

let isInITerm2Cached: boolean | null = null

export function isInsideTmuxSync(): boolean {
  return !!ORIGINAL_USER_TMUX
}

export async function isInsideTmux(): Promise<boolean> {
  if (isInsideTmuxCached !== null) {
    return isInsideTmuxCached
  }

  
  
  
  isInsideTmuxCached = !!ORIGINAL_USER_TMUX
  return isInsideTmuxCached
}

export function getLeaderPaneId(): string | null {
  return ORIGINAL_TMUX_PANE || null
}

export async function isTmuxAvailable(): Promise<boolean> {
  const result = await execFileNoThrow(TMUX_COMMAND, ['-V'])
  return result.code === 0
}

export function isInITerm2(): boolean {
  if (isInITerm2Cached !== null) {
    return isInITerm2Cached
  }

  
  const termProgram = process.env.TERM_PROGRAM
  const hasItermSessionId = !!process.env.ITERM_SESSION_ID
  const terminalIsITerm = env.terminal === 'iTerm.app'

  isInITerm2Cached =
    termProgram === 'iTerm.app' || hasItermSessionId || terminalIsITerm

  return isInITerm2Cached
}

export const IT2_COMMAND = 'it2'

export async function isIt2CliAvailable(): Promise<boolean> {
  const result = await execFileNoThrow(IT2_COMMAND, ['session', 'list'])
  return result.code === 0
}

export function resetDetectionCache(): void {
  isInsideTmuxCached = null
  isInITerm2Cached = null
}
