

import {
  type ParseEntry,
  parse as shellQuoteParse,
  quote as shellQuoteQuote,
} from 'shell-quote'
import { logError } from '../log.js'
import { jsonStringify } from '../slowOperations.js'

export type { ParseEntry } from 'shell-quote'

export type ShellParseResult =
  | { success: true; tokens: ParseEntry[] }
  | { success: false; error: string }

export type ShellQuoteResult =
  | { success: true; quoted: string }
  | { success: false; error: string }

export function tryParseShellCommand(
  cmd: string,
  env?:
    | Record<string, string | undefined>
    | ((key: string) => string | undefined),
): ShellParseResult {
  try {
    const tokens =
      typeof env === 'function'
        ? shellQuoteParse(cmd, env)
        : shellQuoteParse(cmd, env)
    return { success: true, tokens }
  } catch (error) {
    if (error instanceof Error) {
      logError(error)
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parse error',
    }
  }
}

export function tryQuoteShellArgs(args: unknown[]): ShellQuoteResult {
  try {
    const validated: string[] = args.map((arg, index) => {
      if (arg === null || arg === undefined) {
        return String(arg)
      }

      const type = typeof arg

      if (type === 'string') {
        return arg as string
      }
      if (type === 'number' || type === 'boolean') {
        return String(arg)
      }

      if (type === 'object') {
        throw new Error(
          `Cannot quote argument at index ${index}: object values are not supported`,
        )
      }
      if (type === 'symbol') {
        throw new Error(
          `Cannot quote argument at index ${index}: symbol values are not supported`,
        )
      }
      if (type === 'function') {
        throw new Error(
          `Cannot quote argument at index ${index}: function values are not supported`,
        )
      }

      throw new Error(
        `Cannot quote argument at index ${index}: unsupported type ${type}`,
      )
    })

    const quoted = shellQuoteQuote(validated)
    return { success: true, quoted }
  } catch (error) {
    if (error instanceof Error) {
      logError(error)
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown quote error',
    }
  }
}

/**
 * Checks if parsed tokens contain malformed entries that suggest shell-quote
 * misinterpreted the command. This happens when input contains ambiguous
 * patterns (like JSON-like strings with semicolons) that shell-quote parses
 * according to shell rules, producing token fragments.
 *
 * For example, `echo {"hi":"hi;evil"}` gets parsed with `;` as an operator,
 * producing tokens like `{hi:"hi` (unbalanced brace). Legitimate commands
 * produce complete, balanced tokens.
 *
 * Also detects unterminated quotes in the original command: shell-quote
 * silently drops an unmatched `"` or `'` and parses the rest as unquoted,
 * leaving no trace in the tokens. `echo "hi;evil | cat` (one unmatched `"`)
 * is a bash syntax error, but shell-quote yields clean tokens with `;` as
 * an operator. The token-level checks below can't catch this, so we walk
 * the original command with bash quote semantics and flag odd parity.
 *
 * Security: This prevents command injection via HackerOne #3482049 where
 * shell-quote's correct parsing of ambiguous input can be exploited.
 */
export function hasMalformedTokens(
  command: string,
  parsed: ParseEntry[],
): boolean {
  // Check for unterminated quotes in the original command. shell-quote drops
  
  
  
  let inSingle = false
  let inDouble = false
  let doubleCount = 0
  let singleCount = 0
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === '\\' && !inSingle) {
      i++
      continue
    }
    if (c === '"' && !inSingle) {
      doubleCount++
      inDouble = !inDouble
    } else if (c === "'" && !inDouble) {
      singleCount++
      inSingle = !inSingle
    }
  }
  if (doubleCount % 2 !== 0 || singleCount % 2 !== 0) return true

  for (const entry of parsed) {
    if (typeof entry !== 'string') continue

    
    const openBraces = (entry.match(/{/g) || []).length
    const closeBraces = (entry.match(/}/g) || []).length
    if (openBraces !== closeBraces) return true

    
    const openParens = (entry.match(/\(/g) || []).length
    const closeParens = (entry.match(/\)/g) || []).length
    if (openParens !== closeParens) return true

    
    const openBrackets = (entry.match(/\[/g) || []).length
    const closeBrackets = (entry.match(/\]/g) || []).length
    if (openBrackets !== closeBrackets) return true

    
    
    
    
    const doubleQuotes = entry.match(/(?<!\\)"/g) || []
    if (doubleQuotes.length % 2 !== 0) return true

    
    
    const singleQuotes = entry.match(/(?<!\\)'/g) || []
    if (singleQuotes.length % 2 !== 0) return true
  }
  return false
}

/**
 * Detects commands containing '\' patterns that exploit the shell-quote library's
 * incorrect handling of backslashes inside single quotes.
 *
 * In bash, single quotes preserve ALL characters literally - backslash has no
 * special meaning. So '\' is just the string \ (the quote opens, contains \,
 * and the next ' closes it). But shell-quote incorrectly treats \ as an escape
 * character inside single quotes, causing '\' to NOT close the quoted string.
 *
 * This means the pattern '\' <payload> '\' hides <payload> from security checks
 * because shell-quote thinks it's all one single-quoted string.
 */
export function hasShellQuoteSingleQuoteBug(command: string): boolean {
  // Walk the command with correct bash single-quote semantics
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    
    if (char === '\\' && !inSingleQuote) {
      // Skip the next character (it's escaped)
      i++
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote

      // Check if we just closed a single quote and the content ends with
      // trailing backslashes. shell-quote's chunker regex '((\\'|[^'])*?)'
      
      // while bash treats backslash as literal. This creates a differential
      
      
      
      //   '\' -> shell-quote: \' = literal ', still open. bash: \, closed.
      
      
      
      
      //   '\\' alone -> shell-quote backtracks, both parsers agree string closes. OK.
      
      
      
      
      
      
      
      
      //   the opener of the next single-quoted arg), no backtracking occurs and
      
      
      
      if (!inSingleQuote) {
        let backslashCount = 0
        let j = i - 1
        while (j >= 0 && command[j] === '\\') {
          backslashCount++
          j--
        }
        if (backslashCount > 0 && backslashCount % 2 === 1) {
          return true
        }
        // Even trailing backslashes: only a bug when a later ' exists that
        // the chunker regex can use as a false closing quote. We check for
        // ANY later ' because the regex doesn't respect bash quote state
        // (e.g., a ' inside double quotes is also consumable).
        if (
          backslashCount > 0 &&
          backslashCount % 2 === 0 &&
          command.indexOf("'", i + 1) !== -1
        ) {
          return true
        }
      }
      continue
    }
  }

  return false
}

export function quote(args: ReadonlyArray<unknown>): string {
  // First try the strict validation
  const result = tryQuoteShellArgs([...args])

  if (result.success) {
    return result.quoted
  }

  // If strict validation failed, use lenient fallback
  
  try {
    const stringArgs = args.map(arg => {
      if (arg === null || arg === undefined) {
        return String(arg)
      }

      const type = typeof arg

      if (type === 'string' || type === 'number' || type === 'boolean') {
        return String(arg)
      }

      // For unsupported types, use JSON.stringify as a safe fallback
      
      return jsonStringify(arg)
    })

    return shellQuoteQuote(stringArgs)
  } catch (error) {
    // SECURITY: Never use JSON.stringify as a fallback for shell quoting.
    
    
    if (error instanceof Error) {
      logError(error)
    }
    throw new Error('Failed to quote shell arguments safely')
  }
}
