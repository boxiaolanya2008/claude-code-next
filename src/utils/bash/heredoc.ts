

import { randomBytes } from 'crypto'

const HEREDOC_PLACEHOLDER_PREFIX = '__HEREDOC_'
const HEREDOC_PLACEHOLDER_SUFFIX = '__'

function generatePlaceholderSalt(): string {
  // Generate 8 random bytes as hex (16 characters)
  return randomBytes(8).toString('hex')
}

/**
 * Regex pattern for matching heredoc start syntax.
 *
 * Two alternatives handle quoted vs unquoted delimiters differently:
 *
 * Alternative 1 (quoted): (['"]) (\\?\w+) \2
 *   Captures the opening quote, then the delimiter word (which MAY include a
 *   leading backslash since it's literal inside quotes), then the closing quote.
 *   In bash, single quotes make EVERYTHING literal including backslashes:
 *     <<'\EOF' → delimiter is \EOF (with backslash)
 *     <<'EOF'  → delimiter is EOF
 *   Double quotes also preserve backslashes before non-special chars:
 *     <<"\EOF" → delimiter is \EOF
 *
 * Alternative 2 (unquoted): \\?(\w+)
 *   Optionally consumes a leading backslash (escape), then captures the word.
 *   In bash, an unquoted backslash escapes the next character:
 *     <<\EOF → delimiter is EOF (backslash consumed as escape)
 *     <<EOF  → delimiter is EOF (plain)
 *
 * SECURITY: The backslash MUST be inside the capture group for quoted
 * delimiters but OUTSIDE for unquoted ones. The old regex had \\? outside
 * the capture group unconditionally, causing <<'\EOF' to extract delimiter
 * "EOF" while bash uses "\EOF", allowing command smuggling.
 *
 * Note: Uses [ \t]* (not \s*) to avoid matching across newlines, which would be
 * a security issue (could hide commands between << and the delimiter).
 */
const HEREDOC_START_PATTERN =
  // eslint-disable-next-line custom-rules/no-lookbehind-regex -- gated by command.includes('<<') at extractHeredocs() entry
  /(?<!<)<<(?!<)(-)?[ \t]*(?:(['"])(\\?\w+)\2|\\?(\w+))/

export type HeredocInfo = {
  /** The full heredoc text including << operator, delimiter, content, and closing delimiter */
  fullText: string
  /** The delimiter word (without quotes) */
  delimiter: string
  /** Start position of the << operator in the original command */
  operatorStartIndex: number
  /** End position of the << operator (exclusive) - content on same line after this is preserved */
  operatorEndIndex: number
  /** Start position of heredoc content (the newline before content) */
  contentStartIndex: number
  /** End position of heredoc content including closing delimiter (exclusive) */
  contentEndIndex: number
}

export type HeredocExtractionResult = {
  /** The command with heredocs replaced by placeholders */
  processedCommand: string
  /** Map of placeholder string to original heredoc info */
  heredocs: Map<string, HeredocInfo>
}

/**
 * Extracts heredocs from a command string and replaces them with placeholders.
 *
 * This allows shell-quote to parse the command without mangling heredoc syntax.
 * After parsing, use `restoreHeredocs` to replace placeholders with original content.
 *
 * @param command - The shell command string potentially containing heredocs
 * @returns Object containing the processed command and a map of placeholders to heredoc info
 *
 * @example
 * ```ts
 * const result = extractHeredocs(`cat <<EOF
 * hello world
 * EOF`);
 * // result.processedCommand === "cat __HEREDOC_0_a1b2c3d4__" (salt varies)
 * // result.heredocs has the mapping to restore later
 * ```
 */
export function extractHeredocs(
  command: string,
  options?: { quotedOnly?: boolean },
): HeredocExtractionResult {
  const heredocs = new Map<string, HeredocInfo>()

  // Quick check: if no << present, skip processing
  if (!command.includes('<<')) {
    return { processedCommand: command, heredocs }
  }

  // Security: Paranoid pre-validation. Our incremental quote/comment scanner
  // (see advanceScan below) does simplified parsing that cannot handle all
  // bash quoting constructs. If the command contains
  // constructs that could desync our quote tracking, bail out entirely
  // rather than risk extracting a heredoc with incorrect boundaries.
  // This is defense-in-depth: each construct below has caused or could
  // cause a security bypass if we attempt extraction.
  //
  // Specifically, we bail if the command contains:
  // 1. $'...' or $"..." (ANSI-C / locale quoting — our quote tracker
  //    doesn't handle the $ prefix, would misparse the quotes)
  
  
  //    make_cmd.c:606, enabling early heredoc closure that our parser
  
  if (/\$['"]/.test(command)) {
    return { processedCommand: command, heredocs }
  }
  // Check for backticks in the command text before the first <<.
  
  
  
  
  const firstHeredocPos = command.indexOf('<<')
  if (firstHeredocPos > 0 && command.slice(0, firstHeredocPos).includes('`')) {
    return { processedCommand: command, heredocs }
  }

  // Security: Check for arithmetic evaluation context before the first `<<`.
  
  
  
  
  
  
  
  if (firstHeredocPos > 0) {
    const beforeHeredoc = command.slice(0, firstHeredocPos)
    
    const openArith = (beforeHeredoc.match(/\(\(/g) || []).length
    const closeArith = (beforeHeredoc.match(/\)\)/g) || []).length
    if (openArith > closeArith) {
      return { processedCommand: command, heredocs }
    }
  }

  // Create a global version of the pattern for iteration
  const heredocStartPattern = new RegExp(HEREDOC_START_PATTERN.source, 'g')

  const heredocMatches: HeredocInfo[] = []
  
  
  
  // `cat <<EOF\n<<'SAFE'\n$(evil)\nSAFE\nEOF` would extract <<'SAFE' as a
  
  // $(evil) IS executed (unquoted <<EOF expands its body).
  const skippedHeredocRanges: Array<{
    contentStartIndex: number
    contentEndIndex: number
  }> = []
  let match: RegExpExecArray | null

  
  
  
  
  
  
  
  
  
  
  
  //
  
  
  
  
  
  
  
  
  
  //   equivalently, any physical `\n` clears comment state — including `\n`
  
  
  
  
  
  
  
  
  
  
  
  let scanPos = 0
  let scanInSingleQuote = false
  let scanInDoubleQuote = false
  let scanInComment = false
  
  
  
  let scanDqEscapeNext = false
  
  
  let scanPendingBackslashes = 0

  const advanceScan = (target: number): void => {
    for (let i = scanPos; i < target; i++) {
      const ch = command[i]!

      // Any physical newline clears comment state. The old isInsideComment
      
      
      
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

      // Unquoted context. Quote tracking is COMMENT-BLIND (same as the old
      
      
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

    
    // scanInSingleQuote/scanInDoubleQuote/scanInComment reflect the parser
    
    
    advanceScan(startIndex)

    
    if (scanInSingleQuote || scanInDoubleQuote) {
      continue
    }

    // Security: Skip if this << is inside a comment (after unquoted #).
    
    
    if (scanInComment) {
      continue
    }

    // Security: Skip if this << is preceded by an odd number of backslashes.
    
    
    
    
    if (scanPendingBackslashes % 2 === 1) {
      continue
    }

    // Security: Bail if this `<<` falls inside the body of a previously
    
    // `<<` inside a heredoc body is just text — it's not a nested heredoc
    // operator. Extracting it would hide content that bash actually expands.
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
    // Group 3 = quoted delimiter (may include backslash), group 4 = unquoted
    const delimiter = (match[3] || match[4])!
    const operatorEndIndex = startIndex + fullMatch.length

    // Security: Two checks to verify our regex captured the full delimiter word.
    // Any mismatch between our parsed delimiter and bash's actual delimiter
    

    
    
    
    
    
    
    
    const quoteChar = match[2]
    if (quoteChar && command[operatorEndIndex - 1] !== quoteChar) {
      continue
    }

    // Security: Determine if the delimiter is quoted ('EOF', "EOF") or
    
    
    
    // and ${} in the body ARE executed. When quotedOnly is set, skip
    
    
    const isEscapedDelimiter = fullMatch.includes('\\')
    const isQuotedOrEscaped = !!quoteChar || isEscapedDelimiter
    
    
    
    
    

    
    
    // quotes, $, \ mean the bash word extends beyond our match
    
    
    // tab (0x09), newline (0x0A), |, &, ;, (, ), <, >. Do NOT use \s which
    
    
    if (operatorEndIndex < command.length) {
      const nextChar = command[operatorEndIndex]!
      if (!/^[ \t\n|&;()<>]$/.test(nextChar)) {
        continue
      }
    }

    // In bash, heredoc content starts on the NEXT LINE after the operator.
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    // finding the first newline that's NOT inside a quoted string. Same
    // quote-tracking semantics as advanceScan (already used to validate
    // the `<<` operator position above).
    let firstNewlineOffset = -1
    {
      let inSingleQuote = false
      let inDoubleQuote = false
      // We start with clean quote state — advanceScan already rejected the
      // case where the `<<` operator itself is inside a quote.
      for (let k = operatorEndIndex; k < command.length; k++) {
        const ch = command[k]
        if (inSingleQuote) {
          if (ch === "'") inSingleQuote = false
          continue
        }
        if (inDoubleQuote) {
          if (ch === '\\') {
            k++ // skip escaped char inside double quotes
            continue
          }
          if (ch === '"') inDoubleQuote = false
          continue
        }
        // Unquoted context
        if (ch === '\n') {
          firstNewlineOffset = k - operatorEndIndex
          break
        }
        // Count backslashes for escape detection in unquoted context
        let backslashCount = 0
        for (let j = k - 1; j >= operatorEndIndex && command[j] === '\\'; j--) {
          backslashCount++
        }
        if (backslashCount % 2 === 1) continue // escaped char
        if (ch === "'") inSingleQuote = true
        else if (ch === '"') inDoubleQuote = true
      }
      // If we ended while still inside a quote, the logical line never ends —
      // there is no heredoc body. Leave firstNewlineOffset as -1 (handled below).
    }

    // If no unquoted newline found, this heredoc has no content - skip it
    if (firstNewlineOffset === -1) {
      continue
    }

    // Security: Check for backslash-newline continuation at the end of the
    // same-line content (text between the operator and the newline). In bash,
    // `\<newline>` joins lines BEFORE heredoc parsing — so:
    //   cat <<'EOF' && \
    //   rm -rf /
    //   content
    //   EOF
    // bash joins to `cat <<'EOF' && rm -rf /` (rm is part of the command line),
    // then heredoc body = `content`. Our extractor runs BEFORE continuation
    // joining (commands.ts:82), so it would put `rm -rf /` in the heredoc body,
    // hiding it from all validators. Bail if same-line content ends with an
    // odd number of backslashes.
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
      // Odd number of trailing backslashes → last one escapes the newline
      // → this is a line continuation. Our heredoc-before-continuation order
      // would misparse this. Bail out.
      continue
    }

    const contentStartIndex = operatorEndIndex + firstNewlineOffset
    const afterNewline = command.slice(contentStartIndex + 1) // +1 to skip the newline itself
    const contentLines = afterNewline.split('\n')

    // Find the closing delimiter - must be on its own line
    // Security: Must match bash's exact behavior to prevent parsing discrepancies
    
    let closingLineIndex = -1
    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i]!

      if (isDash) {
        // <<- strips leading TABS only (not spaces), per POSIX/bash spec.
        
        const stripped = line.replace(/^\t*/, '')
        if (stripped === delimiter) {
          closingLineIndex = i
          break
        }
      } else {
        // << requires the closing delimiter to be exactly alone on the line
        
        if (line === delimiter) {
          closingLineIndex = i
          break
        }
      }

      // Security: Check for PST_EOFTOKEN-like early closure (make_cmd.c:606).
      
      
      
      
      
      
      // >) after the delimiter, which could indicate command syntax from a
      
      
      
      const eofCheckLine = isDash ? line.replace(/^\t*/, '') : line
      if (
        eofCheckLine.length > delimiter.length &&
        eofCheckLine.startsWith(delimiter)
      ) {
        const charAfterDelimiter = eofCheckLine[delimiter.length]!
        if (/^[)}`|&;(<>]$/.test(charAfterDelimiter)) {
          // Shell metacharacter or substitution closer after delimiter —
          
          closingLineIndex = -1
          break
        }
      }
    }

    // Security: If quotedOnly mode is set and this is an unquoted heredoc,
    // record its content range for nesting checks but do NOT add it to
    
    
    
    
    
    
    
    
    if (options?.quotedOnly && !isQuotedOrEscaped) {
      let skipContentEndIndex: number
      if (closingLineIndex === -1) {
        // No closing delimiter — in bash, heredoc body extends to end of
        
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

    // If no closing delimiter found, this is malformed - skip it
    if (closingLineIndex === -1) {
      continue
    }

    // Calculate end position: contentStartIndex + 1 (newline) + length of lines up to and including closing delimiter
    const linesUpToClosing = contentLines.slice(0, closingLineIndex + 1)
    const contentLength = linesUpToClosing.join('\n').length
    const contentEndIndex = contentStartIndex + 1 + contentLength

    
    
    
    
    
    
    
    //   cat <<EOF <<'SAFE'
    
    
    
    
    
    // swallowing `$(evil_command)` (which bash EXECUTES via the unquoted
    
    
    
    
    
    
    let overlapsSkipped = false
    for (const skipped of skippedHeredocRanges) {
      // Ranges [a,b) and [c,d) overlap iff a < d && c < b
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

    // Build fullText: operator + newline + content (normalized form for restoration)
    
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

  // If no valid heredocs found, return original
  if (heredocMatches.length === 0) {
    return { processedCommand: command, heredocs }
  }

  // Filter out nested heredocs - any heredoc whose operator starts inside
  
  
  const topLevelHeredocs = heredocMatches.filter((candidate, _i, all) => {
    // Check if this candidate's operator is inside any other heredoc's content
    for (const other of all) {
      if (candidate === other) continue
      
      if (
        candidate.operatorStartIndex > other.contentStartIndex &&
        candidate.operatorStartIndex < other.contentEndIndex
      ) {
        // This heredoc is nested inside another - filter it out
        return false
      }
    }
    return true
  })

  
  if (topLevelHeredocs.length === 0) {
    return { processedCommand: command, heredocs }
  }

  // Check for multiple heredocs sharing the same content start position
  
  
  
  
  const contentStartPositions = new Set(
    topLevelHeredocs.map(h => h.contentStartIndex),
  )
  if (contentStartPositions.size < topLevelHeredocs.length) {
    return { processedCommand: command, heredocs }
  }

  // Sort by content end position descending so we can replace from end to start
  
  topLevelHeredocs.sort((a, b) => b.contentEndIndex - a.contentEndIndex)

  
  
  const salt = generatePlaceholderSalt()

  let processedCommand = command
  topLevelHeredocs.forEach((info, index) => {
    // Use reverse index since we sorted descending
    const placeholderIndex = topLevelHeredocs.length - 1 - index
    const placeholder = `${HEREDOC_PLACEHOLDER_PREFIX}${placeholderIndex}_${salt}${HEREDOC_PLACEHOLDER_SUFFIX}`

    heredocs.set(placeholder, info)

    
    // - Keep everything before the operator
    
    
    
    
    processedCommand =
      processedCommand.slice(0, info.operatorStartIndex) +
      placeholder +
      processedCommand.slice(info.operatorEndIndex, info.contentStartIndex) +
      processedCommand.slice(info.contentEndIndex)
  })

  return { processedCommand, heredocs }
}

/**
 * Restores heredoc placeholders back to their original content in a single string.
 * Internal helper used by restoreHeredocs.
 */
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

/**
 * Restores heredoc placeholders in an array of strings.
 *
 * @param parts - Array of strings that may contain heredoc placeholders
 * @param heredocs - The map of placeholders from `extractHeredocs`
 * @returns New array with placeholders replaced by original heredoc content
 */
export function restoreHeredocs(
  parts: string[],
  heredocs: Map<string, HeredocInfo>,
): string[] {
  if (heredocs.size === 0) {
    return parts
  }

  return parts.map(part => restoreHeredocsInString(part, heredocs))
}

/**
 * Checks if a command contains heredoc syntax.
 *
 * This is a quick check that doesn't validate the heredoc is well-formed,
 * just that the pattern exists.
 *
 * @param command - The shell command string
 * @returns true if the command appears to contain heredoc syntax
 */
export function containsHeredoc(command: string): boolean {
  return HEREDOC_START_PATTERN.test(command)
}
