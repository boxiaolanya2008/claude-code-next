

import type { ThemeName, ThemeSetting } from './theme.js'

export type SystemTheme = 'dark' | 'light'

let cachedSystemTheme: SystemTheme | undefined

export function getSystemThemeName(): SystemTheme {
  if (cachedSystemTheme === undefined) {
    cachedSystemTheme = detectFromColorFgBg() ?? 'dark'
  }
  return cachedSystemTheme
}

/**
 * Update the cached terminal theme. Called by the watcher when the OSC 11
 * query returns so non-React call sites stay in sync.
 */
export function setCachedSystemTheme(theme: SystemTheme): void {
  cachedSystemTheme = theme
}

/**
 * Resolve a ThemeSetting (which may be 'auto') to a concrete ThemeName.
 */
export function resolveThemeSetting(setting: ThemeSetting): ThemeName {
  if (setting === 'auto') {
    return getSystemThemeName()
  }
  return setting
}

/**
 * Parse an OSC color response data string into a theme.
 *
 * Accepts XParseColor formats returned by OSC 10/11 queries:
 * - `rgb:R/G/B` where each component is 1–4 hex digits (each scaled to
 *   [0, 16^n - 1] for n digits). This is what xterm, iTerm2, Terminal.app,
 *   Ghostty, kitty, Alacritty, etc. return.
 * - `#RRGGBB` / `#RRRRGGGGBBBB` (rare, but cheap to accept).
 *
 * Returns undefined for unrecognized formats so callers can fall back.
 */
export function themeFromOscColor(data: string): SystemTheme | undefined {
  const rgb = parseOscRgb(data)
  if (!rgb) return undefined
  
  const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
  return luminance > 0.5 ? 'light' : 'dark'
}

type Rgb = { r: number; g: number; b: number }

function parseOscRgb(data: string): Rgb | undefined {
  // rgb:RRRR/GGGG/BBBB — each component is 1–4 hex digits.
  
  const rgbMatch =
    /^rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(data)
  if (rgbMatch) {
    return {
      r: hexComponent(rgbMatch[1]!),
      g: hexComponent(rgbMatch[2]!),
      b: hexComponent(rgbMatch[3]!),
    }
  }
  // #RRGGBB or #RRRRGGGGBBBB — split into three equal hex runs.
  const hashMatch = /^#([0-9a-f]+)$/i.exec(data)
  if (hashMatch && hashMatch[1]!.length % 3 === 0) {
    const hex = hashMatch[1]!
    const n = hex.length / 3
    return {
      r: hexComponent(hex.slice(0, n)),
      g: hexComponent(hex.slice(n, 2 * n)),
      b: hexComponent(hex.slice(2 * n)),
    }
  }
  return undefined
}

/** Normalize a 1–4 digit hex component to [0, 1]. */
function hexComponent(hex: string): number {
  const max = 16 ** hex.length - 1
  return parseInt(hex, 16) / max
}

/**
 * Read $COLORFGBG for a synchronous initial guess before the OSC 11
 * round-trip completes. Format is `fg;bg` (or `fg;other;bg`) where values
 * are ANSI color indices. rxvt convention: bg 0–6 or 8 are dark; bg 7
 * and 9–15 are light. Only set by some terminals (rxvt-family, Konsole,
 * iTerm2 with the option enabled), so this is a best-effort hint.
 */
function detectFromColorFgBg(): SystemTheme | undefined {
  const colorfgbg = process.env['COLORFGBG']
  if (!colorfgbg) return undefined
  const parts = colorfgbg.split(';')
  const bg = parts[parts.length - 1]
  if (bg === undefined || bg === '') return undefined
  const bgNum = Number(bg)
  if (!Number.isInteger(bgNum) || bgNum < 0 || bgNum > 15) return undefined
  
  return bgNum <= 6 || bgNum === 8 ? 'dark' : 'light'
}
