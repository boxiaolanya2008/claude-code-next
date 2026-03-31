

import { randomBytes } from 'crypto'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'

const BACKSLASH_PLACEHOLDER = '\x00BACKSLASH\x00'
const PLUS_PLACEHOLDER = '\x00PLUS\x00'
const QUESTION_PLACEHOLDER = '\x00QUESTION\x00'
const PIPE_PLACEHOLDER = '\x00PIPE\x00'
const LPAREN_PLACEHOLDER = '\x00LPAREN\x00'
const RPAREN_PLACEHOLDER = '\x00RPAREN\x00'
const BACKSLASH_PLACEHOLDER_RE = new RegExp(BACKSLASH_PLACEHOLDER, 'g')
const PLUS_PLACEHOLDER_RE = new RegExp(PLUS_PLACEHOLDER, 'g')
const QUESTION_PLACEHOLDER_RE = new RegExp(QUESTION_PLACEHOLDER, 'g')
const PIPE_PLACEHOLDER_RE = new RegExp(PIPE_PLACEHOLDER, 'g')
const LPAREN_PLACEHOLDER_RE = new RegExp(LPAREN_PLACEHOLDER, 'g')
const RPAREN_PLACEHOLDER_RE = new RegExp(RPAREN_PLACEHOLDER, 'g')

export type SedEditInfo = {
  
  filePath: string
  
  pattern: string
  
  replacement: string
  
  flags: string
  
  extendedRegex: boolean
}

export function isSedInPlaceEdit(command: string): boolean {
  const info = parseSedEditCommand(command)
  return info !== null
}

export function parseSedEditCommand(command: string): SedEditInfo | null {
  const trimmed = command.trim()

  
  const sedMatch = trimmed.match(/^\s*sed\s+/)
  if (!sedMatch) return null

  const withoutSed = trimmed.slice(sedMatch[0].length)
  const parseResult = tryParseShellCommand(withoutSed)
  if (!parseResult.success) return null
  const tokens = parseResult.tokens

  
  const args: string[] = []
  for (const token of tokens) {
    if (typeof token === 'string') {
      args.push(token)
    } else if (
      typeof token === 'object' &&
      token !== null &&
      'op' in token &&
      token.op === 'glob'
    ) {
      
      return null
    }
  }

  
  let hasInPlaceFlag = false
  let extendedRegex = false
  let expression: string | null = null
  let filePath: string | null = null

  let i = 0
  while (i < args.length) {
    const arg = args[i]!

    
    if (arg === '-i' || arg === '--in-place') {
      hasInPlaceFlag = true
      i++
      
      
      
      if (i < args.length) {
        const nextArg = args[i]
        
        if (
          typeof nextArg === 'string' &&
          !nextArg.startsWith('-') &&
          (nextArg === '' || nextArg.startsWith('.'))
        ) {
          i++ 
        }
      }
      continue
    }
    if (arg.startsWith('-i')) {
      
      hasInPlaceFlag = true
      i++
      continue
    }

    
    if (arg === '-E' || arg === '-r' || arg === '--regexp-extended') {
      extendedRegex = true
      i++
      continue
    }

    
    if (arg === '-e' || arg === '--expression') {
      if (i + 1 < args.length && typeof args[i + 1] === 'string') {
        
        if (expression !== null) return null
        expression = args[i + 1]!
        i += 2
        continue
      }
      return null
    }
    if (arg.startsWith('--expression=')) {
      if (expression !== null) return null
      expression = arg.slice('--expression='.length)
      i++
      continue
    }

    
    if (arg.startsWith('-')) {
      
      return null
    }

    
    if (expression === null) {
      
      expression = arg
    } else if (filePath === null) {
      
      filePath = arg
    } else {
      
      return null
    }

    i++
  }

  
  if (!hasInPlaceFlag || !expression || !filePath) {
    return null
  }

  
  
  const substMatch = expression.match(/^s\
  if (!substMatch) {
    return null
  }

  const rest = expression.slice(2) 

  
  let pattern = ''
  let replacement = ''
  let flags = ''
  let state: 'pattern' | 'replacement' | 'flags' = 'pattern'
  let j = 0

  while (j < rest.length) {
    const char = rest[j]!

    if (char === '\\' && j + 1 < rest.length) {
      
      if (state === 'pattern') {
        pattern += char + rest[j + 1]
      } else if (state === 'replacement') {
        replacement += char + rest[j + 1]
      } else {
        flags += char + rest[j + 1]
      }
      j += 2
      continue
    }

    if (char === '/') {
      if (state === 'pattern') {
        state = 'replacement'
      } else if (state === 'replacement') {
        state = 'flags'
      } else {
        
        return null
      }
      j++
      continue
    }

    if (state === 'pattern') {
      pattern += char
    } else if (state === 'replacement') {
      replacement += char
    } else {
      flags += char
    }
    j++
  }

  
  if (state !== 'flags') {
    return null
  }

  
  const validFlags = /^[gpimIM1-9]*$/
  if (!validFlags.test(flags)) {
    return null
  }

  return {
    filePath,
    pattern,
    replacement,
    flags,
    extendedRegex,
  }
}

export function applySedSubstitution(
  content: string,
  sedInfo: SedEditInfo,
): string {
  
  let regexFlags = ''

  
  if (sedInfo.flags.includes('g')) {
    regexFlags += 'g'
  }

  
  if (sedInfo.flags.includes('i') || sedInfo.flags.includes('I')) {
    regexFlags += 'i'
  }

  
  if (sedInfo.flags.includes('m') || sedInfo.flags.includes('M')) {
    regexFlags += 'm'
  }

  
  let jsPattern = sedInfo.pattern
    
    .replace(/\\\

  
  
  
  
  if (!sedInfo.extendedRegex) {
    jsPattern = jsPattern
      
      .replace(/\\\\/g, BACKSLASH_PLACEHOLDER)
      
      .replace(/\\\+/g, PLUS_PLACEHOLDER)
      .replace(/\\\?/g, QUESTION_PLACEHOLDER)
      .replace(/\\\|/g, PIPE_PLACEHOLDER)
      .replace(/\\\(/g, LPAREN_PLACEHOLDER)
      .replace(/\\\)/g, RPAREN_PLACEHOLDER)
      
      .replace(/\+/g, '\\+')
      .replace(/\?/g, '\\?')
      .replace(/\|/g, '\\|')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      
      .replace(BACKSLASH_PLACEHOLDER_RE, '\\\\')
      .replace(PLUS_PLACEHOLDER_RE, '+')
      .replace(QUESTION_PLACEHOLDER_RE, '?')
      .replace(PIPE_PLACEHOLDER_RE, '|')
      .replace(LPAREN_PLACEHOLDER_RE, '(')
      .replace(RPAREN_PLACEHOLDER_RE, ')')
  }

  
  
  
  const salt = randomBytes(8).toString('hex')
  const ESCAPED_AMP_PLACEHOLDER = `___ESCAPED_AMPERSAND_${salt}___`
  const jsReplacement = sedInfo.replacement
    
    .replace(/\\\
    
    .replace(/\\&/g, ESCAPED_AMP_PLACEHOLDER)
    
    .replace(/&/g, '$&')
    
    .replace(new RegExp(ESCAPED_AMP_PLACEHOLDER, 'g'), '&')

  try {
    const regex = new RegExp(jsPattern, regexFlags)
    return content.replace(regex, jsReplacement)
  } catch {
    
    return content
  }
}
