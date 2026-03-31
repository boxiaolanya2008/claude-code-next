import chalk from 'chalk'
import type { Color, TextStyles } from './styles.js'

function boostChalkLevelForXtermJs(): boolean {
  if (process.env.TERM_PROGRAM === 'vscode' && chalk.level === 2) {
    chalk.level = 3
    return true
  }
  return false
}

function clampChalkLevelForTmux(): boolean {
  
  
  
  if (process.env.CLAUDE_CODE_NEXT_TMUX_TRUECOLOR) return false
  if (process.env.TMUX && chalk.level > 2) {
    chalk.level = 2
    return true
  }
  return false
}

export const CHALK_BOOSTED_FOR_XTERMJS = boostChalkLevelForXtermJs()
export const CHALK_CLAMPED_FOR_TMUX = clampChalkLevelForTmux()

export type ColorType = 'foreground' | 'background'

const RGB_REGEX = /^rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)$/
const ANSI_REGEX = /^ansi256\(\s?(\d+)\s?\)$/

export const colorize = (
  str: string,
  color: string | undefined,
  type: ColorType,
): string => {
  if (!color) {
    return str
  }

  if (color.startsWith('ansi:')) {
    const value = color.substring('ansi:'.length)
    switch (value) {
      case 'black':
        return type === 'foreground' ? chalk.black(str) : chalk.bgBlack(str)
      case 'red':
        return type === 'foreground' ? chalk.red(str) : chalk.bgRed(str)
      case 'green':
        return type === 'foreground' ? chalk.green(str) : chalk.bgGreen(str)
      case 'yellow':
        return type === 'foreground' ? chalk.yellow(str) : chalk.bgYellow(str)
      case 'blue':
        return type === 'foreground' ? chalk.blue(str) : chalk.bgBlue(str)
      case 'magenta':
        return type === 'foreground' ? chalk.magenta(str) : chalk.bgMagenta(str)
      case 'cyan':
        return type === 'foreground' ? chalk.cyan(str) : chalk.bgCyan(str)
      case 'white':
        return type === 'foreground' ? chalk.white(str) : chalk.bgWhite(str)
      case 'blackBright':
        return type === 'foreground'
          ? chalk.blackBright(str)
          : chalk.bgBlackBright(str)
      case 'redBright':
        return type === 'foreground'
          ? chalk.redBright(str)
          : chalk.bgRedBright(str)
      case 'greenBright':
        return type === 'foreground'
          ? chalk.greenBright(str)
          : chalk.bgGreenBright(str)
      case 'yellowBright':
        return type === 'foreground'
          ? chalk.yellowBright(str)
          : chalk.bgYellowBright(str)
      case 'blueBright':
        return type === 'foreground'
          ? chalk.blueBright(str)
          : chalk.bgBlueBright(str)
      case 'magentaBright':
        return type === 'foreground'
          ? chalk.magentaBright(str)
          : chalk.bgMagentaBright(str)
      case 'cyanBright':
        return type === 'foreground'
          ? chalk.cyanBright(str)
          : chalk.bgCyanBright(str)
      case 'whiteBright':
        return type === 'foreground'
          ? chalk.whiteBright(str)
          : chalk.bgWhiteBright(str)
    }
  }

  if (color.startsWith('#')) {
    return type === 'foreground'
      ? chalk.hex(color)(str)
      : chalk.bgHex(color)(str)
  }

  if (color.startsWith('ansi256')) {
    const matches = ANSI_REGEX.exec(color)

    if (!matches) {
      return str
    }

    const value = Number(matches[1])

    return type === 'foreground'
      ? chalk.ansi256(value)(str)
      : chalk.bgAnsi256(value)(str)
  }

  if (color.startsWith('rgb')) {
    const matches = RGB_REGEX.exec(color)

    if (!matches) {
      return str
    }

    const firstValue = Number(matches[1])
    const secondValue = Number(matches[2])
    const thirdValue = Number(matches[3])

    return type === 'foreground'
      ? chalk.rgb(firstValue, secondValue, thirdValue)(str)
      : chalk.bgRgb(firstValue, secondValue, thirdValue)(str)
  }

  return str
}

export function applyTextStyles(text: string, styles: TextStyles): string {
  let result = text

  
  
  
  
  

  if (styles.inverse) {
    result = chalk.inverse(result)
  }

  if (styles.strikethrough) {
    result = chalk.strikethrough(result)
  }

  if (styles.underline) {
    result = chalk.underline(result)
  }

  if (styles.italic) {
    result = chalk.italic(result)
  }

  if (styles.bold) {
    result = chalk.bold(result)
  }

  if (styles.dim) {
    result = chalk.dim(result)
  }

  if (styles.color) {
    
    result = colorize(result, styles.color, 'foreground')
  }

  if (styles.backgroundColor) {
    
    result = colorize(result, styles.backgroundColor, 'background')
  }

  return result
}

export function applyColor(text: string, color: Color | undefined): string {
  if (!color) {
    return text
  }
  return colorize(text, color, 'foreground')
}
