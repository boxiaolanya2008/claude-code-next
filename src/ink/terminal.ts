import { coerce } from 'semver'
import type { Writable } from 'stream'
import { env } from '../utils/env.js'
import { gte } from '../utils/semver.js'
import { getClearTerminalSequence } from './clearTerminal.js'
import type { Diff } from './frame.js'
import { cursorMove, cursorTo, eraseLines } from './termio/csi.js'
import { BSU, ESU, HIDE_CURSOR, SHOW_CURSOR } from './termio/dec.js'
import { link } from './termio/osc.js'

export type Progress = {
  state: 'running' | 'completed' | 'error' | 'indeterminate'
  percentage?: number
}

export function isProgressReportingAvailable(): boolean {
  
  if (!process.stdout.isTTY) {
    return false
  }

  
  
  if (process.env.WT_SESSION) {
    return false
  }

  
  if (
    process.env.ConEmuANSI ||
    process.env.ConEmuPID ||
    process.env.ConEmuTask
  ) {
    return true
  }

  const version = coerce(process.env.TERM_PROGRAM_VERSION)
  if (!version) {
    return false
  }

  
  
  if (process.env.TERM_PROGRAM === 'ghostty') {
    return gte(version.version, '1.2.0')
  }

  
  
  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return gte(version.version, '3.6.6')
  }

  return false
}

export function isSynchronizedOutputSupported(): boolean {
  
  
  
  if (process.env.TMUX) return false

  const termProgram = process.env.TERM_PROGRAM
  const term = process.env.TERM

  
  if (
    termProgram === 'iTerm.app' ||
    termProgram === 'WezTerm' ||
    termProgram === 'WarpTerminal' ||
    termProgram === 'ghostty' ||
    termProgram === 'contour' ||
    termProgram === 'vscode' ||
    termProgram === 'alacritty'
  ) {
    return true
  }

  
  if (term?.includes('kitty') || process.env.KITTY_WINDOW_ID) return true

  
  if (term === 'xterm-ghostty') return true

  
  if (term?.startsWith('foot')) return true

  
  if (term?.includes('alacritty')) return true

  
  if (process.env.ZED_TERM) return true

  
  if (process.env.WT_SESSION) return true

  
  const vteVersion = process.env.VTE_VERSION
  if (vteVersion) {
    const version = parseInt(vteVersion, 10)
    if (version >= 6800) return true
  }

  return false
}

let xtversionName: string | undefined

export function setXtversionName(name: string): void {
  if (xtversionName === undefined) xtversionName = name
}

export function isXtermJs(): boolean {
  if (process.env.TERM_PROGRAM === 'vscode') return true
  return xtversionName?.startsWith('xterm.js') ?? false
}

const EXTENDED_KEYS_TERMINALS = [
  'iTerm.app',
  'kitty',
  'WezTerm',
  'ghostty',
  'tmux',
  'windows-terminal',
]

export function supportsExtendedKeys(): boolean {
  return EXTENDED_KEYS_TERMINALS.includes(env.terminal ?? '')
}

export function hasCursorUpViewportYankBug(): boolean {
  return process.platform === 'win32' || !!process.env.WT_SESSION
}

export const SYNC_OUTPUT_SUPPORTED = isSynchronizedOutputSupported()

export type Terminal = {
  stdout: Writable
  stderr: Writable
}

export function writeDiffToTerminal(
  terminal: Terminal,
  diff: Diff,
  skipSyncMarkers = false,
): void {
  
  if (diff.length === 0) {
    return
  }

  
  
  
  const useSync = !skipSyncMarkers

  
  let buffer = useSync ? BSU : ''

  for (const patch of diff) {
    switch (patch.type) {
      case 'stdout':
        buffer += patch.content
        break
      case 'clear':
        if (patch.count > 0) {
          buffer += eraseLines(patch.count)
        }
        break
      case 'clearTerminal':
        buffer += getClearTerminalSequence()
        break
      case 'cursorHide':
        buffer += HIDE_CURSOR
        break
      case 'cursorShow':
        buffer += SHOW_CURSOR
        break
      case 'cursorMove':
        buffer += cursorMove(patch.x, patch.y)
        break
      case 'cursorTo':
        buffer += cursorTo(patch.col)
        break
      case 'carriageReturn':
        buffer += '\r'
        break
      case 'hyperlink':
        buffer += link(patch.uri)
        break
      case 'styleStr':
        buffer += patch.str
        break
    }
  }

  
  if (useSync) buffer += ESU
  terminal.stdout.write(buffer)
}
