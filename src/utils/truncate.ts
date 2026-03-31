

import { stringWidth } from '../ink/stringWidth.js'
import { getGraphemeSegmenter } from './intl.js'

export function truncatePathMiddle(path: string, maxLength: number): string {
  // No truncation needed
  if (stringWidth(path) <= maxLength) {
    return path
  }

  // Handle edge case of very small or non-positive maxLength
  if (maxLength <= 0) {
    return '…'
  }

  // Need at least room for "…" + something meaningful
  if (maxLength < 5) {
    return truncateToWidth(path, maxLength)
  }

  // Find the filename (last path segment)
  const lastSlash = path.lastIndexOf('/')
  
  const filename = lastSlash >= 0 ? path.slice(lastSlash) : path
  const directory = lastSlash >= 0 ? path.slice(0, lastSlash) : ''
  const filenameWidth = stringWidth(filename)

  
  if (filenameWidth >= maxLength - 1) {
    return truncateStartToWidth(path, maxLength)
  }

  // Calculate space available for directory prefix
  
  const availableForDir = maxLength - 1 - filenameWidth 

  if (availableForDir <= 0) {
    // No room for directory, just show filename (truncated if needed)
    return truncateStartToWidth(filename, maxLength)
  }

  // Truncate directory and combine
  const truncatedDir = truncateToWidthNoEllipsis(directory, availableForDir)
  return truncatedDir + '…' + filename
}

/**
 * Truncates a string to fit within a maximum display width, measured in terminal columns.
 * Splits on grapheme boundaries to avoid breaking emoji or surrogate pairs.
 * Appends '…' when truncation occurs.
 */
export function truncateToWidth(text: string, maxWidth: number): string {
  if (stringWidth(text) <= maxWidth) return text
  if (maxWidth <= 1) return '…'
  let width = 0
  let result = ''
  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    const segWidth = stringWidth(segment)
    if (width + segWidth > maxWidth - 1) break
    result += segment
    width += segWidth
  }
  return result + '…'
}

/**
 * Truncates from the start of a string, keeping the tail end.
 * Prepends '…' when truncation occurs.
 * Width-aware and grapheme-safe.
 */
export function truncateStartToWidth(text: string, maxWidth: number): string {
  if (stringWidth(text) <= maxWidth) return text
  if (maxWidth <= 1) return '…'
  const segments = [...getGraphemeSegmenter().segment(text)]
  let width = 0
  let startIdx = segments.length
  for (let i = segments.length - 1; i >= 0; i--) {
    const segWidth = stringWidth(segments[i]!.segment)
    if (width + segWidth > maxWidth - 1) break 
    width += segWidth
    startIdx = i
  }
  return (
    '…' +
    segments
      .slice(startIdx)
      .map(s => s.segment)
      .join('')
  )
}

/**
 * Truncates a string to fit within a maximum display width, without appending an ellipsis.
 * Useful when the caller adds its own separator (e.g. middle-truncation with '…' between parts).
 * Width-aware and grapheme-safe.
 */
export function truncateToWidthNoEllipsis(
  text: string,
  maxWidth: number,
): string {
  if (stringWidth(text) <= maxWidth) return text
  if (maxWidth <= 0) return ''
  let width = 0
  let result = ''
  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    const segWidth = stringWidth(segment)
    if (width + segWidth > maxWidth) break
    result += segment
    width += segWidth
  }
  return result
}

/**
 * Truncates a string to fit within a maximum display width (terminal columns),
 * splitting on grapheme boundaries to avoid breaking emoji, CJK, or surrogate pairs.
 * Appends '…' when truncation occurs.
 * @param str The string to truncate
 * @param maxWidth Maximum display width in terminal columns
 * @param singleLine If true, also truncates at the first newline
 * @returns The truncated string with ellipsis if needed
 */
export function truncate(
  str: string,
  maxWidth: number,
  singleLine: boolean = false,
): string {
  let result = str

  
  if (singleLine) {
    const firstNewline = str.indexOf('\n')
    if (firstNewline !== -1) {
      result = str.substring(0, firstNewline)
      
      if (stringWidth(result) + 1 > maxWidth) {
        return truncateToWidth(result, maxWidth)
      }
      return `${result}…`
    }
  }

  if (stringWidth(result) <= maxWidth) {
    return result
  }
  return truncateToWidth(result, maxWidth)
}

export function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let currentLine = ''
  let currentWidth = 0

  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    const segWidth = stringWidth(segment)
    if (currentWidth + segWidth <= width) {
      currentLine += segment
      currentWidth += segWidth
    } else {
      if (currentLine) lines.push(currentLine)
      currentLine = segment
      currentWidth = segWidth
    }
  }

  if (currentLine) lines.push(currentLine)
  return lines
}
