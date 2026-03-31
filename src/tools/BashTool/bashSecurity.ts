import { logEvent } from 'src/services/analytics/index.js'
import { extractHeredocs } from '../../utils/bash/heredoc.js'
import { ParsedCommand } from '../../utils/bash/ParsedCommand.js'
import {
  hasMalformedTokens,
  hasShellQuoteSingleQuoteBug,
  tryParseShellCommand,
} from '../../utils/bash/shellQuote.js'
import type { TreeSitterAnalysis } from '../../utils/bash/treeSitterAnalysis.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'

const HEREDOC_IN_SUBSTITUTION = /\$\(.*<</

const COMMAND_SUBSTITUTION_PATTERNS = [
  { pattern: /<\(/, message: 'process substitution <()' },
  { pattern: />\(/, message: 'process substitution >()' },
  { pattern: /=\(/, message: 'Zsh process substitution =()' },
  // Zsh EQUALS expansion: =cmd at word start expands to $(which cmd).
  
  
  
  {
    pattern: /(?:^|[\s;&|])=[a-zA-Z_]/,
    message: 'Zsh equals expansion (=cmd)',
  },
  { pattern: /\$\(/, message: '$() command substitution' },
  { pattern: /\$\{/, message: '${} parameter substitution' },
  { pattern: /\$\[/, message: '$[] legacy arithmetic expansion' },
  { pattern: /~\[/, message: 'Zsh-style parameter expansion' },
  { pattern: /\(e:/, message: 'Zsh-style glob qualifiers' },
  { pattern: /\(\+/, message: 'Zsh glob qualifier with command execution' },
  {
    pattern: /\}\s*always\s*\{/,
    message: 'Zsh always block (try/always construct)',
  },
  // Defense in depth: Block PowerShell comment syntax even though we don't execute in PowerShell
  // Added as protection against future changes that might introduce PowerShell execution
  { pattern: /<#/, message: 'PowerShell comment syntax' },
]

// Zsh-specific dangerous commands that can bypass security checks.
// These are checked against the base command (first word) of each command segment.
const ZSH_DANGEROUS_COMMANDS = new Set([
  // zmodload is the gateway to many dangerous module-based attacks:
  // zsh/mapfile (invisible file I/O via array assignment),
  // zsh/system (sysopen/syswrite two-step file access),
  // zsh/zpty (pseudo-terminal command execution),
  // zsh/net/tcp (network exfiltration via ztcp),
  // zsh/files (builtin rm/mv/ln/chmod that bypass binary checks)
  'zmodload',
  // emulate with -c flag is an eval-equivalent that executes arbitrary code
  'emulate',
  // Zsh module builtins that enable dangerous operations.
  // These require zmodload first, but we block them as defense-in-depth
  // in case zmodload is somehow bypassed or the module is pre-loaded.
  'sysopen', // Opens files with fine-grained control (zsh/system)
  'sysread', // Reads from file descriptors (zsh/system)
  'syswrite', // Writes to file descriptors (zsh/system)
  'sysseek', // Seeks on file descriptors (zsh/system)
  'zpty', // Executes commands on pseudo-terminals (zsh/zpty)
  'ztcp', // Creates TCP connections for exfiltration (zsh/net/tcp)
  'zsocket', // Creates Unix/TCP sockets (zsh/net/socket)
  'mapfile', // Not actually a command, but the associative array is set via zmodload
  'zf_rm', // Builtin rm from zsh/files
  'zf_mv', // Builtin mv from zsh/files
  'zf_ln', // Builtin ln from zsh/files
  'zf_chmod', // Builtin chmod from zsh/files
  'zf_chown', // Builtin chown from zsh/files
  'zf_mkdir', // Builtin mkdir from zsh/files
  'zf_rmdir', // Builtin rmdir from zsh/files
  'zf_chgrp', // Builtin chgrp from zsh/files
])

// Numeric identifiers for bash security checks (to avoid logging strings)
const BASH_SECURITY_CHECK_IDS = {
  INCOMPLETE_COMMANDS: 1,
  JQ_SYSTEM_FUNCTION: 2,
  JQ_FILE_ARGUMENTS: 3,
  OBFUSCATED_FLAGS: 4,
  SHELL_METACHARACTERS: 5,
  DANGEROUS_VARIABLES: 6,
  NEWLINES: 7,
  DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION: 8,
  DANGEROUS_PATTERNS_INPUT_REDIRECTION: 9,
  DANGEROUS_PATTERNS_OUTPUT_REDIRECTION: 10,
  IFS_INJECTION: 11,
  GIT_COMMIT_SUBSTITUTION: 12,
  PROC_ENVIRON_ACCESS: 13,
  MALFORMED_TOKEN_INJECTION: 14,
  BACKSLASH_ESCAPED_WHITESPACE: 15,
  BRACE_EXPANSION: 16,
  CONTROL_CHARACTERS: 17,
  UNICODE_WHITESPACE: 18,
  MID_WORD_HASH: 19,
  ZSH_DANGEROUS_COMMANDS: 20,
  BACKSLASH_ESCAPED_OPERATORS: 21,
  COMMENT_QUOTE_DESYNC: 22,
  QUOTED_NEWLINE: 23,
} as const

type ValidationContext = {
  originalCommand: string
  baseCommand: string
  unquotedContent: string
  fullyUnquotedContent: string
  /** fullyUnquoted before stripSafeRedirections — used by validateBraceExpansion
   * to avoid false negatives from redirection stripping creating backslash adjacencies */
  fullyUnquotedPreStrip: string
  /** Like fullyUnquotedPreStrip but preserves quote characters ('/"): e.g.,
   * echo 'x'# → echo ''# (the quote chars remain, revealing adjacency to #) */
  unquotedKeepQuoteChars: string
  /** Tree-sitter analysis data, if available. Validators can use this for
   * more accurate analysis when present, falling back to regex otherwise. */
  treeSitter?: TreeSitterAnalysis | null
}

type QuoteExtraction = {
  withDoubleQuotes: string
  fullyUnquoted: string
  /** Like fullyUnquoted but preserves quote characters ('/"): strips quoted
   * content while keeping the delimiters. Used by validateMidWordHash to detect
   * quote-adjacent # (e.g., 'x'# where quote stripping would hide adjacency). */
  unquotedKeepQuoteChars: string
}

function extractQuotedContent(command: string, isJq = false): QuoteExtraction {
  let withDoubleQuotes = ''
  let fullyUnquoted = ''
  let unquotedKeepQuoteChars = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escaped) {
      escaped = false
      if (!inSingleQuote) withDoubleQuotes += char
      if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char
      if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char
      continue
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true
      if (!inSingleQuote) withDoubleQuotes += char
      if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char
      if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      unquotedKeepQuoteChars += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      unquotedKeepQuoteChars += char
      
      if (!isJq) continue
    }

    if (!inSingleQuote) withDoubleQuotes += char
    if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char
    if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char
  }

  return { withDoubleQuotes, fullyUnquoted, unquotedKeepQuoteChars }
}

function stripSafeRedirections(content: string): string {
  // SECURITY: All three patterns MUST have a trailing boundary (?=\s|$).
  
  
  
  
  
  
  return content
    .replace(/\s+2\s*>&\s*1(?=\s|$)/g, '')
    .replace(/[012]?\s*>\s*\/dev\/null(?=\s|$)/g, '')
    .replace(/\s*<\s*\/dev\/null(?=\s|$)/g, '')
}

/**
 * Checks if content contains an unescaped occurrence of a single character.
 * Handles bash escape sequences correctly where a backslash escapes the following character.
 *
 * IMPORTANT: This function only handles single characters, not strings. If you need to extend
 * this to handle multi-character strings, be EXTREMELY CAREFUL about shell ANSI-C quoting
 * (e.g., $'\n', $'\x41', $'\u0041') which can encode arbitrary characters and strings in ways
 * that are very difficult to parse correctly. Incorrect handling could introduce security
 * vulnerabilities by allowing attackers to bypass security checks.
 *
 * @param content - The string to search (typically from extractQuotedContent)
 * @param char - Single character to search for (e.g., '`')
 * @returns true if unescaped occurrence found, false otherwise
 *
 * Examples:
 *   hasUnescapedChar("test \`safe\`", '`') → false (escaped backticks)
 *   hasUnescapedChar("test `dangerous`", '`') → true (unescaped backticks)
 *   hasUnescapedChar("test\\`date`", '`') → true (escaped backslash + unescaped backtick)
 */
function hasUnescapedChar(content: string, char: string): boolean {
  if (char.length !== 1) {
    throw new Error('hasUnescapedChar only works with single characters')
  }

  let i = 0
  while (i < content.length) {
    // If we see a backslash, skip it and the next character (they form an escape sequence)
    if (content[i] === '\\' && i + 1 < content.length) {
      i += 2 
      continue
    }

    // Check if current character matches
    if (content[i] === char) {
      return true 
    }

    i++
  }

  return false 
}

function validateEmpty(context: ValidationContext): PermissionResult {
  if (!context.originalCommand.trim()) {
    return {
      behavior: 'allow',
      updatedInput: { command: context.originalCommand },
      decisionReason: { type: 'other', reason: 'Empty command is safe' },
    }
  }
  return { behavior: 'passthrough', message: 'Command is not empty' }
}

function validateIncompleteCommands(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context
  const trimmed = originalCommand.trim()

  if (/^\s*\t/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message: 'Command appears to be an incomplete fragment (starts with tab)',
    }
  }

  if (trimmed.startsWith('-')) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 2,
    })
    return {
      behavior: 'ask',
      message:
        'Command appears to be an incomplete fragment (starts with flags)',
    }
  }

  if (/^\s*(&&|\|\||;|>>?|<)/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 3,
    })
    return {
      behavior: 'ask',
      message:
        'Command appears to be a continuation line (starts with operator)',
    }
  }

  return { behavior: 'passthrough', message: 'Command appears complete' }
}

/**
 * Checks if a command is a "safe" heredoc-in-substitution pattern that can
 * bypass the generic $() validator.
 *
 * This is an EARLY-ALLOW path: returning `true` causes bashCommandIsSafe to
 * return `passthrough`, bypassing ALL subsequent validators. Given this
 * authority, the check must be PROVABLY safe, not "probably safe".
 *
 * The only pattern we allow is:
 *   [prefix] $(cat <<'DELIM'\n
 *   [body lines]\n
 *   DELIM\n
 *   ) [suffix]
 *
 * Where:
 * - The delimiter must be single-quoted ('DELIM') or escaped (\DELIM) so the
 *   body is literal text with no expansion
 * - The closing delimiter must be on a line BY ITSELF (or with only trailing
 *   whitespace + `)` for the $(cat <<'EOF'\n...\nEOF)` inline form)
 * - The closing delimiter must be the FIRST such line — matching bash's
 *   behavior exactly (no skipping past early delimiters to find EOF))
 * - There must be non-whitespace text BEFORE the $( (i.e., the substitution
 *   is used in argument position, not as a command name). Otherwise the
 *   heredoc body becomes an arbitrary command name with [suffix] as args.
 * - The remaining text (with the heredoc stripped) must pass all validators
 *
 * This implementation uses LINE-BASED matching, not regex [\s\S]*?, to
 * precisely replicate bash's heredoc-closing behavior.
 */
function isSafeHeredoc(command: string): boolean {
  if (!HEREDOC_IN_SUBSTITUTION.test(command)) return false

  
  
  
  
  const heredocPattern =
    /\$\(cat[ \t]*<<(-?)[ \t]*(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/g
  let match
  type HeredocMatch = {
    start: number
    operatorEnd: number
    delimiter: string
    isDash: boolean
  }
  const safeHeredocs: HeredocMatch[] = []

  while ((match = heredocPattern.exec(command)) !== null) {
    const delimiter = match[2] || match[3]
    if (delimiter) {
      safeHeredocs.push({
        start: match.index,
        operatorEnd: match.index + match[0].length,
        delimiter,
        isDash: match[1] === '-',
      })
    }
  }

  // If no safe heredoc patterns found, it's not safe
  if (safeHeredocs.length === 0) return false

  // SECURITY: For each heredoc, find the closing delimiter using LINE-BASED
  // matching that exactly replicates bash's behavior. Bash closes a heredoc
  
  
  
  
  type VerifiedHeredoc = { start: number; end: number }
  const verified: VerifiedHeredoc[] = []

  for (const { start, operatorEnd, delimiter, isDash } of safeHeredocs) {
    // The opening line must end immediately after the delimiter (only
    
    
    const afterOperator = command.slice(operatorEnd)
    const openLineEnd = afterOperator.indexOf('\n')
    if (openLineEnd === -1) return false 
    const openLineTail = afterOperator.slice(0, openLineEnd)
    if (!/^[ \t]*$/.test(openLineTail)) return false 

    
    const bodyStart = operatorEnd + openLineEnd + 1
    const body = command.slice(bodyStart)
    const bodyLines = body.split('\n')

    
    //   1. `DELIM` alone on a line (bash-standard), followed by `)` on the
    
    
    //      where bash's PST_EOFTOKEN closes both heredoc and substitution)
    // For <<-, leading tabs are stripped before matching.
    let closingLineIdx = -1
    let closeParenLineIdx = -1 // Line index where `)` appears
    let closeParenColIdx = -1 // Column index of `)` on that line

    for (let i = 0; i < bodyLines.length; i++) {
      const rawLine = bodyLines[i]!
      const line = isDash ? rawLine.replace(/^\t*/, '') : rawLine

      // Form 1: delimiter alone on a line
      if (line === delimiter) {
        closingLineIdx = i
        // The `)` must be on the NEXT line with only whitespace before it
        const nextLine = bodyLines[i + 1]
        if (nextLine === undefined) return false // No closing `)`
        const parenMatch = nextLine.match(/^([ \t]*)\)/)
        if (!parenMatch) return false // `)` not at start of next line
        closeParenLineIdx = i + 1
        closeParenColIdx = parenMatch[1]!.length // Position of `)`
        break
      }

      // Form 2: delimiter immediately followed by `)` (PST_EOFTOKEN form)
      // Only whitespace allowed between delimiter and `)`.
      if (line.startsWith(delimiter)) {
        const afterDelim = line.slice(delimiter.length)
        const parenMatch = afterDelim.match(/^([ \t]*)\)/)
        if (parenMatch) {
          closingLineIdx = i
          closeParenLineIdx = i
          // Column is in rawLine (pre-tab-strip), so recompute
          const tabPrefix = isDash ? (rawLine.match(/^\t*/)?.[0] ?? '') : ''
          closeParenColIdx =
            tabPrefix.length + delimiter.length + parenMatch[1]!.length
          break
        }
        // Line starts with delimiter but has other trailing content —
        // this is NOT the closing line (bash requires exact match or EOF`)`).
        // But it's also a red flag: if this were inside $(), bash might
        
        
        
        if (/^[)}`|&;(<>]/.test(afterDelim)) {
          return false 
        }
      }
    }

    if (closingLineIdx === -1) return false 

    
    let endPos = bodyStart
    for (let i = 0; i < closeParenLineIdx; i++) {
      endPos += bodyLines[i]!.length + 1 
    }
    endPos += closeParenColIdx + 1 

    verified.push({ start, end: endPos })
  }

  // SECURITY: Reject nested matches. The regex finds $(cat <<'X' patterns
  
  
  
  
  
  
  
  
  
  
  for (const outer of verified) {
    for (const inner of verified) {
      if (inner === outer) continue
      if (inner.start > outer.start && inner.start < outer.end) {
        return false
      }
    }
  }

  // Strip all verified heredocs from the command, building `remaining`.
  
  const sortedVerified = [...verified].sort((a, b) => b.start - a.start)
  let remaining = command
  for (const { start, end } of sortedVerified) {
    remaining = remaining.slice(0, start) + remaining.slice(end)
  }

  // SECURITY: The remaining text must NOT start with only whitespace before
  
  
  
  //   $(cat <<'EOF'\nchmod\nEOF\n) 777 /etc/shadow
  
  
  
  
  
  
  const trimmedRemaining = remaining.trim()
  if (trimmedRemaining.length > 0) {
    // There's a prefix command — good. But verify the original command
    // also had a non-whitespace prefix before the FIRST $( (the heredoc
    // could be one of several; we need the first one's prefix).
    const firstHeredocStart = Math.min(...verified.map(v => v.start))
    const prefix = command.slice(0, firstHeredocStart)
    if (prefix.trim().length === 0) {
      // $() is in command-name position but there's trailing text — UNSAFE.
      // The heredoc body becomes the command name, trailing text becomes args.
      return false
    }
  }

  // Check that remaining text contains only safe characters.
  // After stripping safe heredocs, the remaining text should only be command
  // names, arguments, quotes, and whitespace. Reject ANY shell metacharacter
  // to prevent operators (|, &, &&, ||, ;) or expansions ($, `, {, <, >) from
  // being used to chain dangerous commands after a safe heredoc.
  // SECURITY: Use explicit ASCII space/tab only — \s matches unicode whitespace
  // like \u00A0 which can be used to hide content. Newlines are also blocked
  // (they would indicate multi-line commands outside the heredoc body).
  if (!/^[a-zA-Z0-9 \t"'.\-/_@=,:+~]*$/.test(remaining)) return false

  
  
  
  
  
  
  
  
  if (bashCommandIsSafe_DEPRECATED(remaining).behavior !== 'passthrough')
    return false

  return true
}

/**
 * Detects well-formed $(cat <<'DELIM'...DELIM) heredoc substitution patterns.
 * Returns the command with matched heredocs stripped, or null if none found.
 * Used by the pre-split gate to strip safe heredocs and re-check the remainder.
 */
export function stripSafeHeredocSubstitutions(command: string): string | null {
  if (!HEREDOC_IN_SUBSTITUTION.test(command)) return null

  const heredocPattern =
    /\$\(cat[ \t]*<<(-?)[ \t]*(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/g
  let result = command
  let found = false
  let match
  const ranges: Array<{ start: number; end: number }> = []
  while ((match = heredocPattern.exec(command)) !== null) {
    if (match.index > 0 && command[match.index - 1] === '\\') continue
    const delimiter = match[2] || match[3]
    if (!delimiter) continue
    const isDash = match[1] === '-'
    const operatorEnd = match.index + match[0].length

    const afterOperator = command.slice(operatorEnd)
    const openLineEnd = afterOperator.indexOf('\n')
    if (openLineEnd === -1) continue
    if (!/^[ \t]*$/.test(afterOperator.slice(0, openLineEnd))) continue

    const bodyStart = operatorEnd + openLineEnd + 1
    const bodyLines = command.slice(bodyStart).split('\n')
    for (let i = 0; i < bodyLines.length; i++) {
      const rawLine = bodyLines[i]!
      const line = isDash ? rawLine.replace(/^\t*/, '') : rawLine
      if (line.startsWith(delimiter)) {
        const after = line.slice(delimiter.length)
        let closePos = -1
        if (/^[ \t]*\)/.test(after)) {
          const lineStart =
            bodyStart +
            bodyLines.slice(0, i).join('\n').length +
            (i > 0 ? 1 : 0)
          closePos = command.indexOf(')', lineStart)
        } else if (after === '') {
          const nextLine = bodyLines[i + 1]
          if (nextLine !== undefined && /^[ \t]*\)/.test(nextLine)) {
            const nextLineStart =
              bodyStart + bodyLines.slice(0, i + 1).join('\n').length + 1
            closePos = command.indexOf(')', nextLineStart)
          }
        }
        if (closePos !== -1) {
          ranges.push({ start: match.index, end: closePos + 1 })
          found = true
        }
        break
      }
    }
  }
  if (!found) return null
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!
    result = result.slice(0, r.start) + result.slice(r.end)
  }
  return result
}

/** Detection-only check: does the command contain a safe heredoc substitution? */
export function hasSafeHeredocSubstitution(command: string): boolean {
  return stripSafeHeredocSubstitutions(command) !== null
}

function validateSafeCommandSubstitution(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context

  if (!HEREDOC_IN_SUBSTITUTION.test(originalCommand)) {
    return { behavior: 'passthrough', message: 'No heredoc in substitution' }
  }

  if (isSafeHeredoc(originalCommand)) {
    return {
      behavior: 'allow',
      updatedInput: { command: originalCommand },
      decisionReason: {
        type: 'other',
        reason:
          'Safe command substitution: cat with quoted/escaped heredoc delimiter',
      },
    }
  }

  return {
    behavior: 'passthrough',
    message: 'Command substitution needs validation',
  }
}

function validateGitCommit(context: ValidationContext): PermissionResult {
  const { originalCommand, baseCommand } = context

  if (baseCommand !== 'git' || !/^git\s+commit\s+/.test(originalCommand)) {
    return { behavior: 'passthrough', message: 'Not a git commit' }
  }

  // SECURITY: Backslashes can cause our regex to mis-identify quote boundaries
  
  
  if (originalCommand.includes('\\')) {
    return {
      behavior: 'passthrough',
      message: 'Git commit contains backslash, needs full validation',
    }
  }

  // SECURITY: The `.*?` before `-m` must NOT match shell operators. Previously
  
  
  
  
  // nullifying validateQuotedNewline, validateBackslashEscapedOperators, etc.
  
  
  
  
  
  
  
  
  
  const messageMatch = originalCommand.match(
    /^git[ \t]+commit[ \t]+[^;&|`$<>()\n\r]*?-m[ \t]+(["'])([\s\S]*?)\1(.*)$/,
  )

  if (messageMatch) {
    const [, quote, messageContent, remainder] = messageMatch

    if (quote === '"' && messageContent && /\$\(|`|\$\{/.test(messageContent)) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
        subId: 1,
      })
      return {
        behavior: 'ask',
        message: 'Git commit message contains command substitution patterns',
      }
    }

    // SECURITY: Check remainder for shell operators that could chain commands
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    if (remainder && /[;|&()`]|\$\(|\$\{/.test(remainder)) {
      return {
        behavior: 'passthrough',
        message: 'Git commit remainder contains shell metacharacters',
      }
    }
    if (remainder) {
      // Strip quoted content, then check for `<` or `>`. Quoted `<>` (email
      
      
      
      
      // so we never reach here with backslashes. For backslash-free input,
      // simple quote toggling is correct (no way to escape quotes without \\).
      let unquoted = ''
      let inSQ = false
      let inDQ = false
      for (let i = 0; i < remainder.length; i++) {
        const c = remainder[i]
        if (c === "'" && !inDQ) {
          inSQ = !inSQ
          continue
        }
        if (c === '"' && !inSQ) {
          inDQ = !inDQ
          continue
        }
        if (!inSQ && !inDQ) unquoted += c
      }
      if (/[<>]/.test(unquoted)) {
        return {
          behavior: 'passthrough',
          message: 'Git commit remainder contains unquoted redirect operator',
        }
      }
    }

    // Security hardening: block messages starting with dash
    
    if (messageContent && messageContent.startsWith('-')) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
        subId: 5,
      })
      return {
        behavior: 'ask',
        message: 'Command contains quoted characters in flag names',
      }
    }

    return {
      behavior: 'allow',
      updatedInput: { command: originalCommand },
      decisionReason: {
        type: 'other',
        reason: 'Git commit with simple quoted message is allowed',
      },
    }
  }

  return { behavior: 'passthrough', message: 'Git commit needs validation' }
}

function validateJqCommand(context: ValidationContext): PermissionResult {
  const { originalCommand, baseCommand } = context

  if (baseCommand !== 'jq') {
    return { behavior: 'passthrough', message: 'Not jq' }
  }

  if (/\bsystem\s*\(/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.JQ_SYSTEM_FUNCTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'jq command contains system() function which executes arbitrary commands',
    }
  }

  // File arguments are now allowed - they will be validated by path validation in readOnlyValidation.ts
  
  const afterJq = originalCommand.substring(3).trim()
  if (
    /(?:^|\s)(?:-f\b|--from-file|--rawfile|--slurpfile|-L\b|--library-path)/.test(
      afterJq,
    )
  ) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.JQ_FILE_ARGUMENTS,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'jq command contains dangerous flags that could execute code or read arbitrary files',
    }
  }

  return { behavior: 'passthrough', message: 'jq command is safe' }
}

function validateShellMetacharacters(
  context: ValidationContext,
): PermissionResult {
  const { unquotedContent } = context
  const message =
    'Command contains shell metacharacters (;, |, or &) in arguments'

  if (/(?:^|\s)["'][^"']*[;&][^"']*["'](?:\s|$)/.test(unquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS,
      subId: 1,
    })
    return { behavior: 'ask', message }
  }

  const globPatterns = [
    /-name\s+["'][^"']*[;|&][^"']*["']/,
    /-path\s+["'][^"']*[;|&][^"']*["']/,
    /-iname\s+["'][^"']*[;|&][^"']*["']/,
  ]

  if (globPatterns.some(p => p.test(unquotedContent))) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS,
      subId: 2,
    })
    return { behavior: 'ask', message }
  }

  if (/-regex\s+["'][^"']*[;&][^"']*["']/.test(unquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS,
      subId: 3,
    })
    return { behavior: 'ask', message }
  }

  return { behavior: 'passthrough', message: 'No metacharacters' }
}

function validateDangerousVariables(
  context: ValidationContext,
): PermissionResult {
  const { fullyUnquotedContent } = context

  if (
    /[<>|]\s*\$[A-Za-z_]/.test(fullyUnquotedContent) ||
    /\$[A-Za-z_][A-Za-z0-9_]*\s*[|<>]/.test(fullyUnquotedContent)
  ) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.DANGEROUS_VARIABLES,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains variables in dangerous contexts (redirections or pipes)',
    }
  }

  return { behavior: 'passthrough', message: 'No dangerous variables' }
}

function validateDangerousPatterns(
  context: ValidationContext,
): PermissionResult {
  const { unquotedContent } = context

  
  
  if (hasUnescapedChar(unquotedContent, '`')) {
    return {
      behavior: 'ask',
      message: 'Command contains backticks (`) for command substitution',
    }
  }

  // Other command substitution checks (include double-quoted content)
  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (pattern.test(unquotedContent)) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId:
          BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION,
        subId: 1,
      })
      return { behavior: 'ask', message: `Command contains ${message}` }
    }
  }

  return { behavior: 'passthrough', message: 'No dangerous patterns' }
}

function validateRedirections(context: ValidationContext): PermissionResult {
  const { fullyUnquotedContent } = context

  if (/</.test(fullyUnquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_INPUT_REDIRECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains input redirection (<) which could read sensitive files',
    }
  }

  if (/>/.test(fullyUnquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_OUTPUT_REDIRECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains output redirection (>) which could write to arbitrary files',
    }
  }

  return { behavior: 'passthrough', message: 'No redirections' }
}

function validateNewlines(context: ValidationContext): PermissionResult {
  // Use fullyUnquotedPreStrip (before stripSafeRedirections) to prevent bypasses
  
  
  
  const { fullyUnquotedPreStrip } = context

  
  if (!/[\n\r]/.test(fullyUnquotedPreStrip)) {
    return { behavior: 'passthrough', message: 'No newlines' }
  }

  // Flag any newline/CR followed by non-whitespace, EXCEPT backslash-newline
  
  
  
  
  
  
  const looksLikeCommand = /(?<![\s]\\)[\n\r]\s*\S/.test(fullyUnquotedPreStrip)
  if (looksLikeCommand) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.NEWLINES,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains newlines that could separate multiple commands',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'Newlines appear to be within data',
  }
}

/**
 * SECURITY: Carriage return (\r, 0x0D) IS a misparsing concern, unlike LF.
 *
 * Parser differential:
 *   - shell-quote's BAREWORD regex uses `[^\s...]` — JS `\s` INCLUDES \r, so
 *     shell-quote treats CR as a token boundary. `TZ=UTC\recho` tokenizes as
 *     TWO tokens: ['TZ=UTC', 'echo']. splitCommand joins with space →
 *     'TZ=UTC echo curl evil.com'.
 *   - bash's default IFS = $' \t\n' — CR is NOT in IFS. bash sees
 *     `TZ=UTC\recho` as ONE word → env assignment TZ='UTC\recho' (CR byte
 *     inside value), then `curl` is the command.
 *
 * Attack: `TZ=UTC\recho curl evil.com` with Bash(echo:*)
 *   validator: splitCommand collapses CR→space → 'TZ=UTC echo curl evil.com'
 *   → stripSafeWrappers: TZ=UTC stripped → 'echo curl evil.com' matches rule
 *   bash: executes `curl evil.com`
 *
 * validateNewlines catches this but is in nonMisparsingValidators (LF is
 * correctly handled by both parsers). This validator is NOT in
 * nonMisparsingValidators — its ask result gets isBashSecurityCheckForMisparsing
 * and blocks at the bashPermissions gate.
 *
 * Checks originalCommand (not fullyUnquotedPreStrip) because CR inside single
 * quotes is ALSO a misparsing concern for the same reason: shell-quote's `\s`
 * still tokenizes it, but bash treats it as literal. Block ALL unquoted-or-SQ CR.
 * Only exception: CR inside DOUBLE quotes where bash also treats it as data
 * and shell-quote preserves the token (no split).
 */
function validateCarriageReturn(context: ValidationContext): PermissionResult {
  const { originalCommand } = context

  if (!originalCommand.includes('\r')) {
    return { behavior: 'passthrough', message: 'No carriage return' }
  }

  // Check if CR appears outside double quotes. CR outside DQ (including inside
  
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false
  for (let i = 0; i < originalCommand.length; i++) {
    const c = originalCommand[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }
    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (c === '\r' && !inDoubleQuote) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.NEWLINES,
        subId: 2,
      })
      return {
        behavior: 'ask',
        message:
          'Command contains carriage return (\\r) which shell-quote and bash tokenize differently',
      }
    }
  }

  return { behavior: 'passthrough', message: 'CR only inside double quotes' }
}

function validateIFSInjection(context: ValidationContext): PermissionResult {
  const { originalCommand } = context

  
  
  
  if (/\$IFS|\$\{[^}]*IFS/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.IFS_INJECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains IFS variable usage which could bypass security validation',
    }
  }

  return { behavior: 'passthrough', message: 'No IFS injection detected' }
}

// Additional hardening against reading environment variables via /proc filesystem.

function validateProcEnvironAccess(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context

  
  
  // - /proc/self/environ
  
  
  if (/\/proc\/.*\/environ/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.PROC_ENVIRON_ACCESS,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command accesses /proc/*/environ which could expose sensitive environment variables',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No /proc/environ access detected',
  }
}

/**
 * Detects commands with malformed tokens (unbalanced delimiters) combined with
 * command separators. This catches potential injection patterns where ambiguous
 * shell syntax could be exploited.
 *
 * Security: This check catches the eval bypass discovered in HackerOne review.
 * When shell-quote parses ambiguous patterns like `echo {"hi":"hi;evil"}`,
 * it may produce unbalanced tokens (e.g., `{hi:"hi`). Combined with command
 * separators, this can lead to unintended command execution via eval re-parsing.
 *
 * By forcing user approval for these patterns, we ensure the user sees exactly
 * what will be executed before approving.
 */
function validateMalformedTokenInjection(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context

  const parseResult = tryParseShellCommand(originalCommand)
  if (!parseResult.success) {
    // Parse failed - this is handled elsewhere (bashToolHasPermission checks this)
    return {
      behavior: 'passthrough',
      message: 'Parse failed, handled elsewhere',
    }
  }

  const parsed = parseResult.tokens

  
  const hasCommandSeparator = parsed.some(
    entry =>
      typeof entry === 'object' &&
      entry !== null &&
      'op' in entry &&
      (entry.op === ';' || entry.op === '&&' || entry.op === '||'),
  )

  if (!hasCommandSeparator) {
    return { behavior: 'passthrough', message: 'No command separators' }
  }

  // Check for malformed tokens (unbalanced delimiters)
  if (hasMalformedTokens(originalCommand, parsed)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.MALFORMED_TOKEN_INJECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains ambiguous syntax with command separators that could be misinterpreted',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No malformed token injection detected',
  }
}

function validateObfuscatedFlags(context: ValidationContext): PermissionResult {
  // Block shell quoting bypass patterns used to circumvent negative lookaheads we use in our regexes to block known dangerous flags

  const { originalCommand, baseCommand } = context

  
  
  
  const hasShellOperators = /[|&;]/.test(originalCommand)
  if (baseCommand === 'echo' && !hasShellOperators) {
    return {
      behavior: 'passthrough',
      message: 'echo command is safe and has no dangerous flags',
    }
  }

  // COMPREHENSIVE OBFUSCATION DETECTION
  

  
  
  // - grep '$' file => no match ($ is regex anchor inside quotes, no $'...' structure)
  
  
  
  if (/\$'[^']*'/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 5,
    })
    return {
      behavior: 'ask',
      message: 'Command contains ANSI-C quoting which can hide characters',
    }
  }

  // 2. Block locale quoting ($"...")  - can also use escape sequences
  
  if (/\$"[^"]*"/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 6,
    })
    return {
      behavior: 'ask',
      message: 'Command contains locale quoting which can hide characters',
    }
  }

  // 3. Block empty ANSI-C or locale quotes followed by dash
  
  if (/\$['"]{2}\s*-/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 9,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains empty special quotes before dash (potential bypass)',
    }
  }

  // 4. Block ANY sequence of empty quotes followed by dash
  
  
  if (/(?:^|\s)(?:''|"")+\s*-/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 7,
    })
    return {
      behavior: 'ask',
      message: 'Command contains empty quotes before dash (potential bypass)',
    }
  }

  // 4b. SECURITY: Block homogeneous empty quote pair(s) immediately adjacent
  
  
  //   - Regex (4) above: `(?:''|"")+\s*-` matches `""` pair, then expects
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  //   - One or more HOMOGENEOUS empty pairs (`""` or `''`) — the concatenation
  
  
  
  
  
  
  
  
  
  
  
  if (/(?:""|'')+['"]-/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 10,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains empty quote pair adjacent to quoted dash (potential flag obfuscation)',
    }
  }

  // 4c. SECURITY: Also block 3+ consecutive quotes at word start even without
  
  
  
  if (/(?:^|\s)['"]{3,}/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 11,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains consecutive quote characters at word start (potential obfuscation)',
    }
  }

  // Track quote state to avoid false positives for flags inside quoted strings
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < originalCommand.length - 1; i++) {
    const currentChar = originalCommand[i]
    const nextChar = originalCommand[i + 1]

    
    if (escaped) {
      escaped = false
      continue
    }

    // SECURITY: Only treat backslash as escape OUTSIDE single quotes. In bash,
    // `\` inside `'...'` is LITERAL. Without this guard, `'\'` desyncs the
    // quote tracker: `\` sets escaped=true, closing `'` is consumed by the
    // escaped-skip above instead of toggling inSingleQuote. Parser stays in
    // single-quote mode, and the `if (inSingleQuote || inDoubleQuote) continue`
    // at line ~1121 skips ALL subsequent flag detection for the rest of the
    // command. Example: `jq '\' "-f" evil` — bash gets `-f` arg, but desynced
    // parser thinks ` "-f" evil` is inside quotes → flag detection bypassed.
    // Defense-in-depth: hasShellQuoteSingleQuoteBug catches `'\'` patterns at
    // line ~1856 before this runs. But we fix the tracker for consistency with
    // the CORRECT implementations elsewhere in this file (hasBackslashEscaped*,
    // extractQuotedContent) which all guard with `!inSingleQuote`.
    if (currentChar === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    if (currentChar === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (currentChar === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    // Only look for flags when not inside quoted strings
    // This prevents false positives like: make test TEST="file.py -v"
    if (inSingleQuote || inDoubleQuote) {
      continue
    }

    // Look for whitespace followed by quote that contains a dash (potential flag obfuscation)
    // SECURITY: Block ANY quoted content starting with dash - err on side of safety
    // Catches: "-"exec, "-file", "--flag", '-'output, etc.
    // Users can approve manually if legitimate (e.g., find . -name "-file")
    if (
      currentChar &&
      nextChar &&
      /\s/.test(currentChar) &&
      /['"`]/.test(nextChar)
    ) {
      const quoteChar = nextChar
      let j = i + 2 // Start after the opening quote
      let insideQuote = ''

      // Collect content inside the quote
      while (j < originalCommand.length && originalCommand[j] !== quoteChar) {
        insideQuote += originalCommand[j]!
        j++
      }

      // If we found a closing quote and the content looks like an obfuscated flag, block it.
      // Three attack patterns to catch:
      //   1. Flag name inside quotes: "--flag", "-exec", "-X" (dashes + letters inside)
      //   2. Split-quote flag: "-"exec, "--"output (dashes inside, letters continue after quote)
      //   3. Chained quotes: "-""exec" (dashes in first quote, second quote contains letters)
      // Pure-dash strings like "---" or "--" followed by whitespace/separator are separators,
      // not flags, and should not trigger this check.
      const charAfterQuote = originalCommand[j + 1]
      // Inside double quotes, $VAR and `cmd` expand at runtime, so "-$VAR" can
      // become -exec. Blocking $ and ` here over-blocks single-quoted literals
      // like grep '-$' (where $ is literal), but main's startsWith('-') already
      // blocked those — this restores status quo, not a new false positive.
      // Brace expansion ({) does NOT happen inside quotes, so { is not needed here.
      const hasFlagCharsInside = /^-+[a-zA-Z0-9$`]/.test(insideQuote)
      // Characters that can continue a flag after a closing quote. This catches:
      //   a-zA-Z0-9: "-"exec → -exec (direct concatenation)
      //   \\:        "-"\exec → -exec (backslash escape is stripped)
      //   -:         "-"-output → --output (extra dashes)
      //   {:         "-"{exec,delete} → -exec -delete (brace expansion)
      //   $:         "-"$VAR → -exec when VAR=exec (variable expansion)
      //   `:         "-"`echo exec` → -exec (command substitution)
      // Note: glob chars (*?[) are omitted — they require attacker-controlled
      // filenames in CWD to exploit, and blocking them would break patterns
      // like `ls -- "-"*` for listing files that start with dash.
      const FLAG_CONTINUATION_CHARS = /[a-zA-Z0-9\\${`-]/
      const hasFlagCharsContinuing =
        /^-+$/.test(insideQuote) &&
        charAfterQuote !== undefined &&
        FLAG_CONTINUATION_CHARS.test(charAfterQuote)
      // Handle adjacent quote chaining: "-""exec" or "-""-"exec or """-"exec concatenates
      // to -exec in shell. Follow the chain of adjacent quoted segments until
      // we find one containing an alphanumeric char or hit a non-quote boundary.
      // Also handles empty prefix quotes: """-"exec where "" is followed by "-"exec
      // The combined segments form a flag if they contain dash(es) followed by alphanumerics.
      const hasFlagCharsInNextQuote =
        // Trigger when: first segment is only dashes OR empty (could be prefix for flag)
        (insideQuote === '' || /^-+$/.test(insideQuote)) &&
        charAfterQuote !== undefined &&
        /['"`]/.test(charAfterQuote) &&
        (() => {
          let pos = j + 1 // Start at charAfterQuote (an opening quote)
          let combinedContent = insideQuote // Track what the shell will see
          while (
            pos < originalCommand.length &&
            /['"`]/.test(originalCommand[pos]!)
          ) {
            const segQuote = originalCommand[pos]!
            let end = pos + 1
            while (
              end < originalCommand.length &&
              originalCommand[end] !== segQuote
            ) {
              end++
            }
            const segment = originalCommand.slice(pos + 1, end)
            combinedContent += segment

            
            
            if (/^-+[a-zA-Z0-9$`]/.test(combinedContent)) return true

            
            // it's a flag. Catches "-""$*" where segment='$*' has no alnum but
            // expands to positional params at runtime.
            // Guard against segment.length === 0: slice(0, -0) → slice(0, 0) → ''.
            const priorContent =
              segment.length > 0
                ? combinedContent.slice(0, -segment.length)
                : combinedContent
            if (/^-+$/.test(priorContent)) {
              if (/[a-zA-Z0-9$`]/.test(segment)) return true
            }

            if (end >= originalCommand.length) break // Unclosed quote
            pos = end + 1 // Move past closing quote to check next segment
          }
          // Also check the unquoted char at the end of the chain
          if (
            pos < originalCommand.length &&
            FLAG_CONTINUATION_CHARS.test(originalCommand[pos]!)
          ) {
            // If we have dashes in combined content, the trailing char completes a flag
            if (/^-+$/.test(combinedContent) || combinedContent === '') {
              // Check if we're about to form a flag with the following content
              const nextChar = originalCommand[pos]!
              if (nextChar === '-') {
                // More dashes, could still form a flag
                return true
              }
              if (/[a-zA-Z0-9\\${`]/.test(nextChar) && combinedContent !== '') {
                // We have dashes and now alphanumeric/expansion follows
                return true
              }
            }
            // Original check for dashes followed by alphanumeric
            if (/^-/.test(combinedContent)) {
              return true
            }
          }
          return false
        })()
      if (
        j < originalCommand.length &&
        originalCommand[j] === quoteChar &&
        (hasFlagCharsInside ||
          hasFlagCharsContinuing ||
          hasFlagCharsInNextQuote)
      ) {
        logEvent('tengu_bash_security_check_triggered', {
          checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
          subId: 4,
        })
        return {
          behavior: 'ask',
          message: 'Command contains quoted characters in flag names',
        }
      }
    }

    // Look for whitespace followed by dash - this starts a flag
    if (currentChar && nextChar && /\s/.test(currentChar) && nextChar === '-') {
      let j = i + 1 
      let flagContent = ''

      
      while (j < originalCommand.length) {
        const flagChar = originalCommand[j]
        if (!flagChar) break

        
        if (/[\s=]/.test(flagChar)) {
          break
        }
        // End flag collection if we hit quote followed by non-flag character. This is needed to handle cases like -d"," which should be parsed as just -d
        if (/['"`]/.test(flagChar)) {
          // Special case for cut -d flag: the delimiter value can be quoted
          
          
          
          
          // we allow the legitimate use case while preventing obfuscation attacks on other
          
          if (
            baseCommand === 'cut' &&
            flagContent === '-d' &&
            /['"`]/.test(flagChar)
          ) {
            // This is cut -d followed by a quoted delimiter - flagContent is already '-d'
            break
          }

          // Look ahead to see what follows the quote
          if (j + 1 < originalCommand.length) {
            const nextFlagChar = originalCommand[j + 1]
            if (nextFlagChar && !/[a-zA-Z0-9_'"-]/.test(nextFlagChar)) {
              // Quote followed by something that is clearly not part of a flag, end the parsing
              break
            }
          }
        }
        flagContent += flagChar
        j++
      }

      if (flagContent.includes('"') || flagContent.includes("'")) {
        logEvent('tengu_bash_security_check_triggered', {
          checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
          subId: 1,
        })
        return {
          behavior: 'ask',
          message: 'Command contains quoted characters in flag names',
        }
      }
    }
  }

  // Also handle flags that start with quotes: "--"output, '-'-output, etc.
  
  if (/\s['"`]-/.test(context.fullyUnquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 2,
    })
    return {
      behavior: 'ask',
      message: 'Command contains quoted characters in flag names',
    }
  }

  // Also handles cases like ""--output
  
  if (/['"`]{2}-/.test(context.fullyUnquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 3,
    })
    return {
      behavior: 'ask',
      message: 'Command contains quoted characters in flag names',
    }
  }

  return { behavior: 'passthrough', message: 'No obfuscated flags detected' }
}

/**
 * Detects backslash-escaped whitespace characters (space, tab) outside of quotes.
 *
 * In bash, `echo\ test` is a single token (command named "echo test"), but
 * shell-quote decodes the escape and produces `echo test` (two separate tokens).
 * This discrepancy allows path traversal attacks like:
 *   echo\ test/../../../usr/bin/touch /tmp/file
 * which the parser sees as `echo test/.../touch /tmp/file` (an echo command)
 * but bash resolves as `/usr/bin/touch /tmp/file` (via directory "echo test").
 */
function hasBackslashEscapedWhitespace(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (char === '\\' && !inSingleQuote) {
      if (!inDoubleQuote) {
        const nextChar = command[i + 1]
        if (nextChar === ' ' || nextChar === '\t') {
          return true
        }
      }
      // Skip the escaped character (both outside quotes and inside double quotes,
      // where \\, \", \$, \` are valid escape sequences)
      i++
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
  }

  return false
}

function validateBackslashEscapedWhitespace(
  context: ValidationContext,
): PermissionResult {
  if (hasBackslashEscapedWhitespace(context.originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains backslash-escaped whitespace that could alter command parsing',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No backslash-escaped whitespace',
  }
}

/**
 * Detects a backslash immediately preceding a shell operator outside of quotes.
 *
 * SECURITY: splitCommand normalizes `\;` to a bare `;` in its output string.
 * When downstream code (checkReadOnlyConstraints, checkPathConstraints, etc.)
 * re-parses that normalized string, the bare `;` is seen as an operator and
 * causes a false split. This enables arbitrary file read bypassing path checks:
 *
 *   cat safe.txt \; echo ~/.ssh/id_rsa
 *
 * In bash: ONE cat command reading safe.txt, ;, echo, ~/.ssh/id_rsa as files.
 * After splitCommand normalizes: "cat safe.txt ; echo ~/.ssh/id_rsa"
 * Nested re-parse: ["cat safe.txt", "echo ~/.ssh/id_rsa"] — both segments
 * pass isCommandReadOnly, sensitive path hidden in echo segment is never
 * validated by path constraints. Auto-allowed. Private key leaked.
 *
 * This check flags any \<operator> regardless of backslash parity. Even counts
 * (\\;) are dangerous in bash (\\ → \, ; separates). Odd counts (\;) are safe
 * in bash but trigger the double-parse bug above. Both must be flagged.
 *
 * Known false positive: `find . -exec cmd {} \;` — users will be prompted once.
 *
 * Note: `(` and `)` are NOT in this set — splitCommand preserves `\(` and `\)`
 * in its output (round-trip safe), so they don't trigger the double-parse bug.
 * This allows `find . \( -name x -o -name y \)` to pass without false positives.
 */
const SHELL_OPERATORS = new Set([';', '|', '&', '<', '>'])

function hasBackslashEscapedOperator(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    // SECURITY: Handle backslash FIRST, before quote toggles. In bash, inside
    // double quotes, `\"` is an escape sequence producing a literal `"` — it
    // does NOT close the quote. If we process quote toggles first, `\"` inside
    // `"..."` desyncs the tracker:
    //   - `\` is ignored (gated by !inDoubleQuote)
    //   - `"` toggles inDoubleQuote to FALSE (wrong — bash says still inside)
    //   - next `"` (the real closing quote) toggles BACK to TRUE — locked desync
    //   - subsequent `\;` is missed because !inDoubleQuote is false
    // Exploit: `tac "x\"y" \; echo ~/.ssh/id_rsa` — bash runs ONE tac reading
    // all args as files (leaking id_rsa), but desynced tracker misses `\;` and
    // splitCommand's double-parse normalization "sees" two safe commands.
    //
    // Fix structure matches hasBackslashEscapedWhitespace (which was correctly
    // fixed for this in commit prior to d000dfe84e): backslash check first,
    // gated only by !inSingleQuote (since backslash IS literal inside '...'),
    // unconditional i++ to skip the escaped char even inside double quotes.
    if (char === '\\' && !inSingleQuote) {
      // Only flag \<operator> when OUTSIDE double quotes (inside double quotes,
      // operators like ;|&<> are already not special, so \; is harmless there).
      if (!inDoubleQuote) {
        const nextChar = command[i + 1]
        if (nextChar && SHELL_OPERATORS.has(nextChar)) {
          return true
        }
      }
      // Skip the escaped character unconditionally. Inside double quotes, this
      // correctly consumes backslash pairs: `"x\\"` → pos 6 (`\`) skips pos 7
      // (`\`), then pos 8 (`"`) toggles inDoubleQuote off correctly. Without
      // unconditional skip, pos 7 would see `\`, see pos 8 (`"`) as nextChar,
      // skip it, and the closing quote would NEVER toggle inDoubleQuote —
      // permanently desyncing and missing subsequent `\;` outside quotes.
      // Exploit: `cat "x\\" \; echo /etc/passwd` — bash reads /etc/passwd.
      //
      // This correctly handles backslash parity: odd-count `\;` (1, 3, 5...)
      // is flagged (the unpaired `\` before `;` is detected). Even-count `\\;`
      // (2, 4...) is NOT flagged, which is CORRECT — bash treats `\\` as
      // literal `\` and `;` as a separator, so splitCommand handles it
      // normally (no double-parse bug). This matches
      // hasBackslashEscapedWhitespace line ~1340.
      i++
      continue
    }

    // Quote toggles come AFTER backslash handling (backslash already skipped
    // any escaped quote char, so these toggles only fire on unescaped quotes).
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
  }

  return false
}

function validateBackslashEscapedOperators(
  context: ValidationContext,
): PermissionResult {
  // Tree-sitter path: if tree-sitter confirms no actual operator nodes exist
  // in the AST, then any \; is just an escaped character in a word argument
  // (e.g., `find . -exec cmd {} \;`). Skip the expensive regex check.
  if (context.treeSitter && !context.treeSitter.hasActualOperatorNodes) {
    return { behavior: 'passthrough', message: 'No operator nodes in AST' }
  }

  if (hasBackslashEscapedOperator(context.originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains a backslash before a shell operator (;, |, &, <, >) which can hide command structure',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No backslash-escaped operators',
  }
}

/**
 * Checks if a character at position `pos` in `content` is escaped by counting
 * consecutive backslashes before it. An odd number means it's escaped.
 */
function isEscapedAtPosition(content: string, pos: number): boolean {
  let backslashCount = 0
  let i = pos - 1
  while (i >= 0 && content[i] === '\\') {
    backslashCount++
    i--
  }
  return backslashCount % 2 === 1
}

/**
 * Detects unquoted brace expansion syntax that Bash expands but shell-quote/tree-sitter
 * treat as literal strings. This parsing discrepancy allows permission bypass:
 *   git ls-remote {--upload-pack="touch /tmp/test",test}
 * Parser sees one literal arg, but Bash expands to: --upload-pack="touch /tmp/test" test
 *
 * Brace expansion has two forms:
 *   1. Comma-separated: {a,b,c} → a b c
 *   2. Sequence: {1..5} → 1 2 3 4 5
 *
 * Both single and double quotes suppress brace expansion in Bash, so we use
 * fullyUnquotedContent which has both quote types stripped.
 * Backslash-escaped braces (\{, \}) also suppress expansion.
 */
function validateBraceExpansion(context: ValidationContext): PermissionResult {
  // Use pre-strip content to avoid false negatives from stripSafeRedirections
  // creating backslash adjacencies (e.g., `\>/dev/null{a,b}` → `\{a,b}` after
  // stripping, making isEscapedAtPosition think the brace is escaped).
  const content = context.fullyUnquotedPreStrip

  // SECURITY: Check for MISMATCHED brace counts in fullyUnquoted content.
  // A mismatch indicates that quoted braces (e.g., `'{'` or `"{"`) were
  // stripped by extractQuotedContent, leaving unbalanced braces in the content
  // we analyze. Our depth-matching algorithm below assumes balanced braces —
  // with a mismatch, it closes at the WRONG position, missing commas that
  // bash's algorithm WOULD find.
  //
  // Exploit: `git diff {@'{'0},--output=/tmp/pwned}`
  //   - Original: 2 `{`, 2 `}` (quoted `'{'` counts as content, not operator)
  //   - fullyUnquoted: `git diff {@0},--output=/tmp/pwned}` — 1 `{`, 2 `}`!
  //   - Our depth-matcher: closes at first `}` (after `0`), inner=`@0`, no `,`
  //   - Bash (on original): quoted `{` is content; first unquoted `}` has no
  //     `,` yet → bash treats as literal content, keeps scanning → finds `,`
  //     → final `}` closes → expands to `@{0} --output=/tmp/pwned`
  //   - git writes diff to /tmp/pwned. ARBITRARY FILE WRITE, ZERO PERMISSIONS.
  //
  // We count ONLY unescaped braces (backslash-escaped braces are literal in
  // bash). If counts mismatch AND at least one unescaped `{` exists, block —
  // our depth-matching cannot be trusted on this content.
  let unescapedOpenBraces = 0
  let unescapedCloseBraces = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{' && !isEscapedAtPosition(content, i)) {
      unescapedOpenBraces++
    } else if (content[i] === '}' && !isEscapedAtPosition(content, i)) {
      unescapedCloseBraces++
    }
  }
  // Only block when CLOSE count EXCEEDS open count — this is the specific
  // attack signature. More `}` than `{` means a quoted `{` was stripped
  // (bash saw it as content, we see extra `}` unaccounted for). The inverse
  // (more `{` than `}`) is usually legitimate unclosed/escaped braces like
  // `{foo` or `{a,b\}` where bash doesn't expand anyway.
  if (unescapedOpenBraces > 0 && unescapedCloseBraces > unescapedOpenBraces) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
      subId: 2,
    })
    return {
      behavior: 'ask',
      message:
        'Command has excess closing braces after quote stripping, indicating possible brace expansion obfuscation',
    }
  }

  // SECURITY: Additionally, check the ORIGINAL command (before quote stripping)
  // for `'{'` or `"{"` INSIDE an unquoted brace context — this is the specific
  // attack primitive. A quoted brace inside an outer unquoted `{...}` is
  // essentially always an obfuscation attempt; legitimate commands don't nest
  // quoted braces inside brace expansion (awk/find patterns are fully quoted,
  // like `awk '{print $1}'` where the OUTER brace is inside quotes too).
  //
  // This catches the attack even if an attacker crafts a payload with balanced
  // stripped braces (defense-in-depth). We use a simple heuristic: if the
  // original command has `'{'` or `'}'` or `"{"` or `"}"` (quoted single brace)
  // AND also has an unquoted `{`, that's suspicious.
  if (unescapedOpenBraces > 0) {
    const orig = context.originalCommand
    // Look for quoted single-brace patterns: '{', '}', "{",  "}"
    // These are the attack primitive — a brace char wrapped in quotes.
    if (/['"][{}]['"]/.test(orig)) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
        subId: 3,
      })
      return {
        behavior: 'ask',
        message:
          'Command contains quoted brace character inside brace context (potential brace expansion obfuscation)',
      }
    }
  }

  // Scan for unescaped `{` characters, then check if they form brace expansion.
  // We use a manual scan rather than a simple regex lookbehind because
  // lookbehinds can't handle double-escaped backslashes (\\{ is unescaped `{`).
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '{') continue
    if (isEscapedAtPosition(content, i)) continue

    // Find matching unescaped `}` by tracking nesting depth.
    // Previous approach broke on nested `{`, missing commas between the outer
    // `{` and the nested one (e.g., `{--upload-pack="evil",{test}}`).
    let depth = 1
    let matchingClose = -1
    for (let j = i + 1; j < content.length; j++) {
      const ch = content[j]
      if (ch === '{' && !isEscapedAtPosition(content, j)) {
        depth++
      } else if (ch === '}' && !isEscapedAtPosition(content, j)) {
        depth--
        if (depth === 0) {
          matchingClose = j
          break
        }
      }
    }

    if (matchingClose === -1) continue

    // Check for `,` or `..` at the outermost nesting level between this
    // `{` and its matching `}`. Only depth-0 triggers matter — bash splits
    // brace expansion at outer-level commas/sequences.
    let innerDepth = 0
    for (let k = i + 1; k < matchingClose; k++) {
      const ch = content[k]
      if (ch === '{' && !isEscapedAtPosition(content, k)) {
        innerDepth++
      } else if (ch === '}' && !isEscapedAtPosition(content, k)) {
        innerDepth--
      } else if (innerDepth === 0) {
        if (
          ch === ',' ||
          (ch === '.' && k + 1 < matchingClose && content[k + 1] === '.')
        ) {
          logEvent('tengu_bash_security_check_triggered', {
            checkId: BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
            subId: 1,
          })
          return {
            behavior: 'ask',
            message:
              'Command contains brace expansion that could alter command parsing',
          }
        }
      }
    }
    // No expansion at this level — don't skip past; inner pairs will be
    // caught by subsequent iterations of the outer loop.
  }

  return {
    behavior: 'passthrough',
    message: 'No brace expansion detected',
  }
}

// Matches Unicode whitespace characters that shell-quote treats as word
// separators but bash treats as literal word content. While this differential
// is defense-favorable (shell-quote over-splits), blocking these proactively
// prevents future edge cases.
// eslint-disable-next-line no-misleading-character-class
const UNICODE_WS_RE =
  /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/

function validateUnicodeWhitespace(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context
  if (UNICODE_WS_RE.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.UNICODE_WHITESPACE,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains Unicode whitespace characters that could cause parsing inconsistencies',
    }
  }
  return { behavior: 'passthrough', message: 'No Unicode whitespace' }
}

function validateMidWordHash(context: ValidationContext): PermissionResult {
  const { unquotedKeepQuoteChars } = context
  // Match # preceded by a non-whitespace character (mid-word hash).
  // shell-quote treats mid-word # as comment-start but bash treats it as a
  // literal character, creating a parser differential.
  //
  // Uses unquotedKeepQuoteChars (which preserves quote delimiters but strips
  // quoted content) to catch quote-adjacent # like 'x'# — fullyUnquotedPreStrip
  // would strip both quotes and content, turning 'x'# into just # (word-start).
  //
  // SECURITY: Also check the CONTINUATION-JOINED version. The context is built
  // from the original command (pre-continuation-join). For `foo\<NL>#bar`,
  // pre-join the `#` is preceded by `\n` (whitespace → `/\S#/` doesn't match),
  // but post-join it's preceded by `o` (non-whitespace → matches). shell-quote
  // operates on the post-join text (line continuations are joined in
  // splitCommand), so the parser differential manifests on the joined text.
  // While not directly exploitable (the `#...` fragment still prompts as its
  // own subcommand), this is a defense-in-depth gap — shell-quote would drop
  // post-`#` content from path extraction.
  //
  // Exclude ${