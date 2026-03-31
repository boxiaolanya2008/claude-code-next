import { type ColorType, colorize } from '../../ink/colorize.js'
import type { Color } from '../../ink/styles.js'
import { getTheme, type Theme, type ThemeName } from '../../utils/theme.js'

export function color(
  c: keyof Theme | Color | undefined,
  theme: ThemeName,
  type: ColorType = 'foreground',
): (text: string) => string {
  return text => {
    if (!c) {
      return text
    }
    
    if (
      c.startsWith('rgb(') ||
      c.startsWith('#') ||
      c.startsWith('ansi256(') ||
      c.startsWith('ansi:')
    ) {
      return colorize(text, c, type)
    }
    
    return colorize(text, getTheme(theme)[c as keyof Theme], type)
  }
}
