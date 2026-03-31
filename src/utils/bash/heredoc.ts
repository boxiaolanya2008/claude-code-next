

import { randomBytes } from 'crypto'

const HEREDOC_PLACEHOLDER_PREFIX = '__HEREDOC_'
const HEREDOC_PLACEHOLDER_SUFFIX = '__'

function generatePlaceholderSalt(): string {
  
  return randomBytes(8).toString('hex')
}

const HEREDOC_START_PATTERN =
  
  /(?<!<)<<(?!<)(-)?[ \t]*(?:(['"])(\\?\w+)\2|\\?(\w+))/

export type HeredocInfo = {
  
  fullText: string
  
  delimiter: string
  
  operatorStartIndex: number
  
  operatorEndIndex: number
  
  contentStartIndex: number
  
  contentEndIndex: number
}

export type HeredocExtractionResult = {
  
  processedCommand: string
  
  heredocs: Map<string, HeredocInfo>
}

export function extractHeredocs(
  command: string,
  options?: { quotedOnly?: boolean },
): HeredocExtractionResult {
  const heredocs = new Map<string, HeredocInfo>()

  
  if (!command.includes('<<')) {
    return { processedCommand: command, heredocs }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (/\$['"]/.test(command)) {
    return { processedCommand: command, heredocs }
  }
  
  
  
  
  
  const firstHeredocPos = command.indexOf('<<')
  if (firstHeredocPos > 0 && command.slice(0, firstHeredocPos).includes('`')) {
    return { processedCommand: command, heredocs }
  }

  
  
  
  
  
  
  
  
  if (firstHeredocPos > 0) {
    const beforeHeredoc = command.slice(0, firstHeredocPos)
    
    const openArith = (beforeHeredoc.match(/\(\(/g) || []).length
    const closeArith = (beforeHeredoc.match(/\)\)/g) || []).length
    if (openArith > closeArith) {
      return { processedCommand: command, heredocs }
    }
  }

  
  const heredocStartPattern = new RegExp(HEREDOC_START_PATTERN.source, 'g')

  const heredocMatches: HeredocInfo[] = []
  
  
  
  
  
  
  const skippedHeredocRanges: Array<{
    contentStartIndex: number
    contentEndIndex: number
  }> = []
  let match: RegExpExecArray | null

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  let scanPos = 0
  let scanInSingleQuote = false
  let scanInDoubleQuote = false
  let scanInComment = false
  
  
  
  let scanDqEscapeNext = false
  
  
  let scanPendingBackslashes = 0

  const advanceScan = (target: number): void => {
    for (let i = scanPos; i < target; i++) {
      const ch = command[i]!

      
      
      
      
      if (ch === '\n') scanInComment = false

      if (scanInSingleQuote) {
        if (ch === "'") scanInSingleQuote = false
        continue
      }

      if (scanInDoubleQuote) {
        if (scanDqEscapeNext) {
          scanDqEscapeNext = false
          continue
        }
        if (ch === '\\') {
          scanDqEscapeNext = true
          continue
        }
        if (ch === '"') scanInDoubleQuote = false
        continue
      }

      
      
      
      if (ch === '\\') {
        scanPendingBackslashes++
        continue
      }
      const escaped = scanPendingBackslashes % 2 === 1
      scanPendingBackslashes = 0
      if (escaped) continue

      if (ch === "'") scanInSingleQuote = true
      else if (ch === '"') scanInDoubleQuote = true
      else if (!scanInComment && ch === '#') scanInComment = true
    }
    scanPos = target
  }

  while ((match = heredocStartPattern.exec(command)) !== null) {
    const startIndex = match.index

    
    
    
    
    advanceScan(startIndex)

    
    if (scanInSingleQuote || scanInDoubleQuote) {
      continue
    }

    
    
    
    if (scanInComment) {
      continue
    }

    
    
    
    
    
    if (scanPendingBackslashes % 2 === 1) {
      continue
    }

    
    
    
    
    let insideSkipped = false
    for (const skipped of skippedHeredocRanges) {
      if (
        startIndex > skipped.contentStartIndex &&
        startIndex < skipped.contentEndIndex
      ) {
        insideSkipped = true
        break
      }
    }
    if (insideSkipped) {
      continue
    }

    const fullMatch = match[0]
    const isDash = match[1] === '-'
    
    const delimiter = (match[3] || match[4])!
    const operatorEndIndex = startIndex + fullMatch.length

    
    
    

    
    
    
    
    
    
    
    const quoteChar = match[2]
    if (quoteChar && command[operatorEndIndex - 1] !== quoteChar) {
      continue
    }

    
    
    
    
    
    
    
    const isEscapedDelimiter = fullMatch.includes('\\')
    const isQuotedOrEscaped = !!quoteChar || isEscapedDelimiter
    
    
    
    
    

    
    
    
    
    
    
    
    
    if (operatorEndIndex < command.length) {
      const nextChar = command[operatorEndIndex]!
      if (!/^[ \t\n|&;()<>]$/.test(nextChar)) {
        continue
      }
    }

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let firstNewlineOffset = -1
    {
      let inSingleQuote = false
      let inDoubleQuote = false
      
      
      for (let k = operatorEndIndex; k < command.length; k++) {
        const ch = command[k]
        if (inSingleQuote) {
          if (ch === "'") inSingleQuote = false
          continue
        }
        if (inDoubleQuote) {
          if (ch === '\\') {
            k++ 
            continue
          }
          if (ch === '"') inDoubleQuote = false
          continue
        }
        
        if (ch === '\n') {
          firstNewlineOffset = k - operatorEndIndex
          break
        }
        
        let backslashCount = 0
        for (let j = k - 1; j >= operatorEndIndex && command[j] === '\\'; j--) {
          backslashCount++
        }
        if (backslashCount % 2 === 1) continue 
        if (ch === "'") inSingleQuote = true
        else if (ch === '"') inDoubleQuote = true
      }
      
      
    }

    
    if (firstNewlineOffset === -1) {
      continue
    }

    
    
    
    
    
    
    
    
    
    
    
    
    const sameLineContent = command.slice(
      operatorEndIndex,
      operatorEndIndex + firstNewlineOffset,
    )
    let trailingBackslashes = 0
    for (let j = sameLineContent.length - 1; j >= 0; j--) {
      if (sameLineContent[j] === '\\') {
        trailingBackslashes++
      } else {
        break
      }
    }
    if (trailingBackslashes % 2 === 1) {
      
      
      
      continue
    }

    const contentStartIndex = operatorEndIndex + firstNewlineOffset
    const afterNewline = command.slice(contentStartIndex + 1) 
    const contentLines = afterNewline.split('\n')

    
    
    
    let closingLineIndex = -1
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i]!

      if (isDash) {
        
        
        const stripped = line.replace(/^\t*/, '')
        if (stripped === delimiter) {
          closingLineIndex = i
          break
        }
      } else {
        
        
        if (line === delimiter) {
          closingLineIndex = i
          break
        }
      }

      
      
      
      
      
      
      
      
      
      
      
      const eofCheckLine = isDash ? line.replace(/^\t*/, '') : line
      if (
        eofCheckLine.length > delimiter.length &&
        eofCheckLine.startsWith(delimiter)
      ) {
        const charAfterDelimiter = eofCheckLine[delimiter.length]!
        if (/^[)}`|&;(<>]$/.test(charAfterDelimiter)) {
          
          
          closingLineIndex = -1
          break
        }
      }
    }

    
    
    
    
    
    
    
    
    
    
    if (options?.quotedOnly && !isQuotedOrEscaped) {
      let skipContentEndIndex: number
      if (closingLineIndex === -1) {
        
        
        skipContentEndIndex = command.length
      } else {
        const skipLinesUpToClosing = contentLines.slice(0, closingLineIndex + 1)
        const skipContentLength = skipLinesUpToClosing.join('\n').length
        skipContentEndIndex = contentStartIndex + 1 + skipContentLength
      }
      skippedHeredocRanges.push({
        contentStartIndex,
        contentEndIndex: skipContentEndIndex,
      })
      continue
    }

    
    if (closingLineIndex === -1) {
      continue
    }

    
    const linesUpToClosing = contentLines.slice(0, closingLineIndex + 1)
    const contentLength = linesUpToClosing.join('\n').length
    const contentEndIndex = contentStartIndex + 1 + contentLength

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let overlapsSkipped = false
    for (const skipped of skippedHeredocRanges) {
      
      if (
        contentStartIndex < skipped.contentEndIndex &&
        skipped.contentStartIndex < contentEndIndex
      ) {
        overlapsSkipped = true
        break
      }
    }
    if (overlapsSkipped) {
      continue
    }

    
    
    const operatorText = command.slice(startIndex, operatorEndIndex)
    const contentText = command.slice(contentStartIndex, contentEndIndex)
    const fullText = operatorText + contentText

    heredocMatches.push({
      fullText,
      delimiter,
      operatorStartIndex: startIndex,
      operatorEndIndex,
      contentStartIndex,
      contentEndIndex,
    })
  }

  
  if (heredocMatches.length === 0) {
    return { processedCommand: command, heredocs }
  }

  
  
  
  const topLevelHeredocs = heredocMatches.filter((candidate, _i, all) => {
    
    for (const other of all) {
      if (candidate === other) continue
      
      if (
        candidate.operatorStartIndex > other.contentStartIndex &&
        candidate.operatorStartIndex < other.contentEndIndex
      ) {
        
        return false
      }
    }
    return true
  })

  
  if (topLevelHeredocs.length === 0) {
    return { processedCommand: command, heredocs }
  }

  
  
  
  
  
  const contentStartPositions = new Set(
    topLevelHeredocs.map(h => h.contentStartIndex),
  )
  if (contentStartPositions.size < topLevelHeredocs.length) {
    return { processedCommand: command, heredocs }
  }

  
  
  topLevelHeredocs.sort((a, b) => b.contentEndIndex - a.contentEndIndex)

  
  
  const salt = generatePlaceholderSalt()

  let processedCommand = command
  topLevelHeredocs.forEach((info, index) => {
    
    const placeholderIndex = topLevelHeredocs.length - 1 - index
    const placeholder = `${HEREDOC_PLACEHOLDER_PREFIX}${placeholderIndex}_${salt}${HEREDOC_PLACEHOLDER_SUFFIX}`

    heredocs.set(placeholder, info)

    
    
    
    
    
    
    processedCommand =
      processedCommand.slice(0, info.operatorStartIndex) +
      placeholder +
      processedCommand.slice(info.operatorEndIndex, info.contentStartIndex) +
      processedCommand.slice(info.contentEndIndex)
  })

  return { processedCommand, heredocs }
}

function restoreHeredocsInString(
  text: string,
  heredocs: Map<string, HeredocInfo>,
): string {
  let result = text
  for (const [placeholder, info] of heredocs) {
    result = result.replaceAll(placeholder, info.fullText)
  }
  return result
}

export function restoreHeredocs(
  parts: string[],
  heredocs: Map<string, HeredocInfo>,
): string[] {
  if (heredocs.size === 0) {
    return parts
  }

  return parts.map(part => restoreHeredocsInString(part, heredocs))
}

export function containsHeredoc(command: string): boolean {
  return HEREDOC_START_PATTERN.test(command)
}
... STR61856 t handle the $ prefix, would misparse the quotes)
  
  
  
  
  if (/\$[ STR61857 << STR61858  STR61859 << STR61860 cat <<EOF\n<< STR61861 \n$(evil)\nSAFE\nEOF STR61862 \n STR61863 \n STR61864 << STR61865 << STR61866 << STR61867 << STR61868 \<newline> STR61869 cat << STR61870  && rm -rf / STR61871 content STR61872 rm -rf / STR61873 |&;(<>]$/.test(charAfterDelimiter)) {
          
          
          closingLineIndex = -1
          break
        }
      }
    }

    
    
    
    
    
    
    
    
    
    
    if (options?.quotedOnly && !isQuotedOrEscaped) {
      let skipContentEndIndex: number
      if (closingLineIndex === -1) {
        
        
        skipContentEndIndex = command.length
      } else {
        const skipLinesUpToClosing = contentLines.slice(0, closingLineIndex + 1)
        const skipContentLength = skipLinesUpToClosing.join( STR61874 ).length
        skipContentEndIndex = contentStartIndex + 1 + skipContentLength
      }
      skippedHeredocRanges.push({
        contentStartIndex,
        contentEndIndex: skipContentEndIndex,
      })
      continue
    }

    
    if (closingLineIndex === -1) {
      continue
    }

    
    const linesUpToClosing = contentLines.slice(0, closingLineIndex + 1)
    const contentLength = linesUpToClosing.join( STR61875 ).length
    const contentEndIndex = contentStartIndex + 1 + contentLength

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let overlapsSkipped = false
    for (const skipped of skippedHeredocRanges) {
      
      if (
        contentStartIndex < skipped.contentEndIndex &&
        skipped.contentStartIndex < contentEndIndex
      ) {
        overlapsSkipped = true
        break
      }
    }
    if (overlapsSkipped) {
      continue
    }

    
    
    const operatorText = command.slice(startIndex, operatorEndIndex)
    const contentText = command.slice(contentStartIndex, contentEndIndex)
    const fullText = operatorText + contentText

    heredocMatches.push({
      fullText,
      delimiter,
      operatorStartIndex: startIndex,
      operatorEndIndex,
      contentStartIndex,
      contentEndIndex,
    })
  }

  
  if (heredocMatches.length === 0) {
    return { processedCommand: command, heredocs }
  }

  
  
  
  const topLevelHeredocs = heredocMatches.filter((candidate, _i, all) => {
    
    for (const other of all) {
      if (candidate === other) continue
      
      if (
        candidate.operatorStartIndex > other.contentStartIndex &&
        candidate.operatorStartIndex < other.contentEndIndex
      ) {
        
        return false
      }
    }
    return true
  })

  
  if (topLevelHeredocs.length === 0) {
    return { processedCommand: command, heredocs }
  }

  
  
  
  
  
  const contentStartPositions = new Set(
    topLevelHeredocs.map(h => h.contentStartIndex),
  )
  if (contentStartPositions.size < topLevelHeredocs.length) {
    return { processedCommand: command, heredocs }
  }

  
  
  topLevelHeredocs.sort((a, b) => b.contentEndIndex - a.contentEndIndex)

  
  
  const salt = generatePlaceholderSalt()

  let processedCommand = command
  topLevelHeredocs.forEach((info, index) => {
    
    const placeholderIndex = topLevelHeredocs.length - 1 - index
    const placeholder =  STR61876 

    heredocs.set(placeholder, info)

    
    
    
    
    
    
    processedCommand =
      processedCommand.slice(0, info.operatorStartIndex) +
      placeholder +
      processedCommand.slice(info.operatorEndIndex, info.contentStartIndex) +
      processedCommand.slice(info.contentEndIndex)
  })

  return { processedCommand, heredocs }
}

function restoreHeredocsInString(
  text: string,
  heredocs: Map<string, HeredocInfo>,
): string {
  let result = text
  for (const [placeholder, info] of heredocs) {
    result = result.replaceAll(placeholder, info.fullText)
  }
  return result
}

export function restoreHeredocs(
  parts: string[],
  heredocs: Map<string, HeredocInfo>,
): string[] {
  if (heredocs.size === 0) {
    return parts
  }

  return parts.map(part => restoreHeredocsInString(part, heredocs))
}

export function containsHeredoc(command: string): boolean {
  return HEREDOC_START_PATTERN.test(command)
}
