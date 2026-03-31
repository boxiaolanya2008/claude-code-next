

import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'

const TERM_PROGRAM_TO_APP: Record<string, string> = {
  iterm: 'iTerm',
  'iterm.app': 'iTerm',
  ghostty: 'Ghostty',
  kitty: 'kitty',
  alacritty: 'Alacritty',
  wezterm: 'WezTerm',
  apple_terminal: 'Terminal',
}

export function updateDeepLinkTerminalPreference(): void {
  
  
  if (process.platform !== 'darwin') return

  const termProgram = process.env.TERM_PROGRAM
  if (!termProgram) return

  const app = TERM_PROGRAM_TO_APP[termProgram.toLowerCase()]
  if (!app) return

  const config = getGlobalConfig()
  if (config.deepLinkTerminal === app) return

  saveGlobalConfig(current => ({ ...current, deepLinkTerminal: app }))
  logForDebugging(`Stored deep link terminal preference: ${app}`)
}
