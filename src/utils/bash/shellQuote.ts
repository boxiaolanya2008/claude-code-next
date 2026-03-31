

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

export function hasMalformedTokens(
  command: string,
  parsed: ParseEntry[],
): boolean {
  
  
  
  
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

export function hasShellQuoteSingleQuoteBug(command: string): boolean {
  
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    
    if (char === '\\' && !inSingleQuote) {
      
      i++
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote

      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
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
  
  const result = tryQuoteShellArgs([...args])

  if (result.success) {
    return result.quoted
  }

  
  
  try {
    const stringArgs = args.map(arg => {
      if (arg === null || arg === undefined) {
        return String(arg)
      }

      const type = typeof arg

      if (type === 'string' || type === 'number' || type === 'boolean') {
        return String(arg)
      }

      
      
      return jsonStringify(arg)
    })

    return shellQuoteQuote(stringArgs)
  } catch (error) {
    
    
    
    if (error instanceof Error) {
      logError(error)
    }
    throw new Error('Failed to quote shell arguments safely')
  }
}
