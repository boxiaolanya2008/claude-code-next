

import type { ThemeName, ThemeSetting } from './theme.js'

export type SystemTheme = 'dark' | 'light'

let cachedSystemTheme: SystemTheme | undefined

export function getSystemThemeName(): SystemTheme {
  if (cachedSystemTheme === undefined) {
    cachedSystemTheme = detectFromColorFgBg() ?? 'dark'
  }
  return cachedSystemTheme
}

export function setCachedSystemTheme(theme: SystemTheme): void {
  cachedSystemTheme = theme
}

export function resolveThemeSetting(setting: ThemeSetting): ThemeName {
  if (setting === 'auto') {
    return getSystemThemeName()
  }
  return setting
}

export function themeFromOscColor(data: string): SystemTheme | undefined {
  const rgb = parseOscRgb(data)
  if (!rgb) return undefined
  
  const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b
  return luminance > 0.5 ? 'light' : 'dark'
}

type Rgb = { r: number; g: number; b: number }

function parseOscRgb(data: string): Rgb | undefined {
  
  
  const rgbMatch =
    /^rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(data)
  if (rgbMatch) {
    return {
      r: hexComponent(rgbMatch[1]!),
      g: hexComponent(rgbMatch[2]!),
      b: hexComponent(rgbMatch[3]!),
    }
  }
  
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

function hexComponent(hex: string): number {
  const max = 16 ** hex.length - 1
  return parseInt(hex, 16) / max
}

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
