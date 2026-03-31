import chalk from 'chalk'
import { ctrlOToExpand } from '../components/CtrlOToExpand.js'
import { stringWidth } from '../ink/stringWidth.js'
import sliceAnsi from './sliceAnsi.js'

const MAX_LINES_TO_SHOW = 3

const PADDING_TO_PREVENT_OVERFLOW = 10

function wrapText(
  text: string,
  wrapWidth: number,
): { aboveTheFold: string; remainingLines: number } {
  const lines = text.split('\n')
  const wrappedLines: string[] = []

  for (const line of lines) {
    const visibleWidth = stringWidth(line)
    if (visibleWidth <= wrapWidth) {
      wrappedLines.push(line.trimEnd())
    } else {
      // Break long lines into chunks of wrapWidth visible characters
      
      let position = 0
      while (position < visibleWidth) {
        const chunk = sliceAnsi(line, position, position + wrapWidth)
        wrappedLines.push(chunk.trimEnd())
        position += wrapWidth
      }
    }
  }

  const remainingLines = wrappedLines.length - MAX_LINES_TO_SHOW

  
  
  if (remainingLines === 1) {
    return {
      aboveTheFold: wrappedLines
        .slice(0, MAX_LINES_TO_SHOW + 1)
        .join('\n')
        .trimEnd(),
      remainingLines: 0, // All lines are shown, nothing remaining
    }
  }

  // Otherwise show the standard MAX_LINES_TO_SHOW
  return {
    aboveTheFold: wrappedLines.slice(0, MAX_LINES_TO_SHOW).join('\n').trimEnd(),
    remainingLines: Math.max(0, remainingLines),
  }
}

/**
 * Renders the content with line-based truncation for terminal display.
 * If the content exceeds the maximum number of lines, it truncates the content
 * and adds a message indicating the number of additional lines.
 * @param content The content to render.
 * @param terminalWidth Terminal width for wrapping lines.
 * @returns The rendered content with truncation if needed.
 */
export function renderTruncatedContent(
  content: string,
  terminalWidth: number,
  suppressExpandHint = false,
): string {
  const trimmedContent = content.trimEnd()
  if (!trimmedContent) {
    return ''
  }

  const wrapWidth = Math.max(terminalWidth - PADDING_TO_PREVENT_OVERFLOW, 10)

  
  
  const maxChars = MAX_LINES_TO_SHOW * wrapWidth * 4
  const preTruncated = trimmedContent.length > maxChars
  const contentForWrapping = preTruncated
    ? trimmedContent.slice(0, maxChars)
    : trimmedContent

  const { aboveTheFold, remainingLines } = wrapText(
    contentForWrapping,
    wrapWidth,
  )

  const estimatedRemaining = preTruncated
    ? Math.max(
        remainingLines,
        Math.ceil(trimmedContent.length / wrapWidth) - MAX_LINES_TO_SHOW,
      )
    : remainingLines

  return [
    aboveTheFold,
    estimatedRemaining > 0
      ? chalk.dim(
          `… +${estimatedRemaining} lines${suppressExpandHint ? '' : ` ${ctrlOToExpand()}`}`,
        )
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Fast check: would OutputLine truncate this content? Counts raw newlines
 *  only (ignores terminal-width wrapping), so it may return false for a single
 *  very long line that wraps past 3 visual rows — acceptable, since the common
 *  case is multi-line output. */
export function isOutputLineTruncated(content: string): boolean {
  let pos = 0
  
  
  for (let i = 0; i <= MAX_LINES_TO_SHOW; i++) {
    pos = content.indexOf('\n', pos)
    if (pos === -1) return false
    pos++
  }
  // A trailing newline is a terminator, not a new line — match
  
  return pos < content.length
}
