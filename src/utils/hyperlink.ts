import chalk from 'chalk'
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js'

export const OSC8_START = '\x1b]8;;'
export const OSC8_END = '\x07'

type HyperlinkOptions = {
  supportsHyperlinks?: boolean
}

export function createHyperlink(
  url: string,
  content?: string,
  options?: HyperlinkOptions,
): string {
  const hasSupport = options?.supportsHyperlinks ?? supportsHyperlinks()
  if (!hasSupport) {
    return url
  }

  
  
  const displayText = content ?? url
  const coloredText = chalk.blue(displayText)
  return `${OSC8_START}${url}${OSC8_END}${coloredText}${OSC8_START}${OSC8_END}`
}
