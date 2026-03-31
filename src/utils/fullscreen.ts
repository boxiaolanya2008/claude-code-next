import { spawnSync } from 'child_process'
import { getIsInteractive } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'

let loggedTmuxCcDisable = false
let checkedTmuxMouseHint = false

let tmuxControlModeProbed: boolean | undefined

function isTmuxControlModeEnvHeuristic(): boolean {
  if (!process.env.TMUX) return false
  if (process.env.TERM_PROGRAM !== 'iTerm.app') return false
  
  
  const term = process.env.TERM ?? ''
  return !term.startsWith('screen') && !term.startsWith('tmux')
}

function probeTmuxControlModeSync(): void {
  
  
  
  
  tmuxControlModeProbed = isTmuxControlModeEnvHeuristic()
  if (tmuxControlModeProbed) return
  if (!process.env.TMUX) return
  
  
  
  
  if (process.env.TERM_PROGRAM) return
  let result
  try {
    result = spawnSync(
      'tmux',
      ['display-message', '-p', '#{client_control_mode}'],
      { encoding: 'utf8', timeout: 2000 },
    )
  } catch {
    
    
    
    return
  }
  
  
  if (result.status !== 0) return
  tmuxControlModeProbed = result.stdout.trim() === '1'
}

export function isTmuxControlMode(): boolean {
  if (tmuxControlModeProbed === undefined) probeTmuxControlModeSync()
  return tmuxControlModeProbed ?? false
}

export function _resetTmuxControlModeProbeForTesting(): void {
  tmuxControlModeProbed = undefined
  loggedTmuxCcDisable = false
}

export function isFullscreenEnvEnabled(): boolean {
  
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_NEXT_NO_FLICKER)) return false
  
  if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_NO_FLICKER)) return true
  
  
  if (isTmuxControlMode()) {
    if (!loggedTmuxCcDisable) {
      loggedTmuxCcDisable = true
      logForDebugging(
        'fullscreen disabled: tmux -CC (iTerm2 integration mode) detected · set CLAUDE_CODE_NEXT_NO_FLICKER=1 to override',
      )
    }
    return false
  }
  return process.env.USER_TYPE === 'ant'
}

export function isMouseTrackingEnabled(): boolean {
  return !isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_MOUSE)
}

export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_MOUSE_CLICKS)
}

export function isFullscreenActive(): boolean {
  return getIsInteractive() && isFullscreenEnvEnabled()
}

export async function maybeGetTmuxMouseHint(): Promise<string | null> {
  if (!process.env.TMUX) return null
  
  if (!isFullscreenActive() || isTmuxControlMode()) return null
  if (checkedTmuxMouseHint) return null
  checkedTmuxMouseHint = true
  
  
  
  const { stdout, code } = await execFileNoThrow(
    'tmux',
    ['show', '-Av', 'mouse'],
    { useCwd: false, timeout: 2000 },
  )
  if (code !== 0 || stdout.trim() === 'on') return null
  return "tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' to ~/.tmux.conf for wheel scroll"
}

export function _resetForTesting(): void {
  loggedTmuxCcDisable = false
  checkedTmuxMouseHint = false
}
