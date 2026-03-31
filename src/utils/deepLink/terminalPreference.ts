

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

/**
 * Capture the current terminal from TERM_PROGRAM and store it for the deep
 * link handler to use later. The handler runs headless (LaunchServices/xdg)
 * where TERM_PROGRAM is unset, so without this it falls back to a static
 * priority list that picks whatever is installed first — often not the
 * terminal the user actually uses.
 *
 * Called fire-and-forget from interactive startup, same as
 * updateGithubRepoPathMapping.
 */
export function updateDeepLinkTerminalPreference(): void {
  // Only detectMacosTerminal reads the stored value — skip the write on
  
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
