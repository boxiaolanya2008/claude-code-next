import {
  hasMalformedTokens,
  hasShellQuoteSingleQuoteBug,
  type ParseEntry,
  quote,
  tryParseShellCommand,
} from './shellQuote.js'

export function rearrangePipeCommand(command: string): string {
  
  if (command.includes('`')) {
    return quoteWithEvalStdinRedirect(command)
  }

  
  
  if (command.includes('$(')) {
    return quoteWithEvalStdinRedirect(command)
  }

  
  
  
  
  if (/\$[A-Za-z_{]/.test(command)) {
    return quoteWithEvalStdinRedirect(command)
  }

  
  
  
  if (containsControlStructure(command)) {
    return quoteWithEvalStdinRedirect(command)
  }

  
  
  
  const joined = joinContinuationLines(command)

  
  
  
  
  
  if (joined.includes('\n')) {
    return quoteWithEvalStdinRedirect(command)
  }

  
  
  
  
  
  if (hasShellQuoteSingleQuoteBug(joined)) {
    return quoteWithEvalStdinRedirect(command)
  }

  const parseResult = tryParseShellCommand(joined)

  
  if (!parseResult.success) {
    return quoteWithEvalStdinRedirect(command)
  }

  const parsed = parseResult.tokens

  
  
  
  
  
  
  
  
  
  if (hasMalformedTokens(joined, parsed)) {
    return quoteWithEvalStdinRedirect(command)
  }

  const firstPipeIndex = findFirstPipeOperator(parsed)

  if (firstPipeIndex <= 0) {
    return quoteWithEvalStdinRedirect(command)
  }

  
  const parts = [
    ...buildCommandParts(parsed, 0, firstPipeIndex),
    '< /dev/null',
    ...buildCommandParts(parsed, firstPipeIndex, parsed.length),
  ]

  return singleQuoteForEval(parts.join(' '))
}

function findFirstPipeOperator(parsed: ParseEntry[]): number {
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i]
    if (isOperator(entry, '|')) {
      return i
    }
  }
  return -1
}

function buildCommandParts(
  parsed: ParseEntry[],
  start: number,
  end: number,
): string[] {
  const parts: string[] = []
  
  
  let seenNonEnvVar = false

  for (let i = start; i < end; i++) {
    const entry = parsed[i]

    
    if (
      typeof entry === 'string' &&
      /^[012]$/.test(entry) &&
      i + 2 < end &&
      isOperator(parsed[i + 1])
    ) {
      const op = parsed[i + 1] as { op: string }
      const target = parsed[i + 2]

      
      if (
        op.op === '>&' &&
        typeof target === 'string' &&
        /^[012]$/.test(target)
      ) {
        parts.push(`${entry}>&${target}`)
        i += 2
        continue
      }

      
      if (op.op === '>' && target === '/dev/null') {
        parts.push(`${entry}>/dev/null`)
        i += 2
        continue
      }

      
      if (
        op.op === '>' &&
        typeof target === 'string' &&
        target.startsWith('&')
      ) {
        const fd = target.slice(1)
        if (/^[012]$/.test(fd)) {
          parts.push(`${entry}>&${fd}`)
          i += 2
          continue
        }
      }
    }

    
    if (typeof entry === 'string') {
      
      
      const isEnvVar = !seenNonEnvVar && isEnvironmentVariableAssignment(entry)

      if (isEnvVar) {
        
        
        const eqIndex = entry.indexOf('=')
        const name = entry.slice(0, eqIndex)
        const value = entry.slice(eqIndex + 1)

        
        const quotedValue = quote([value])
        parts.push(`${name}=${quotedValue}`)
      } else {
        
        seenNonEnvVar = true
        parts.push(quote([entry]))
      }
    } else if (isOperator(entry)) {
      
      if (entry.op === 'glob' && 'pattern' in entry) {
        
        parts.push(entry.pattern as string)
      } else {
        parts.push(entry.op)
        
        if (isCommandSeparator(entry.op)) {
          seenNonEnvVar = false
        }
      }
    }
  }

  return parts
}

function isEnvironmentVariableAssignment(str: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(str)
}

function isCommandSeparator(op: string): boolean {
  return op === '&&' || op === '||' || op === ';'
}

function isOperator(entry: unknown, op?: string): entry is { op: string } {
  if (!entry || typeof entry !== 'object' || !('op' in entry)) {
    return false
  }
  return op ? entry.op === op : true
}

function containsControlStructure(command: string): boolean {
  return /\b(for|while|until|if|case|select)\s/.test(command)
}

function quoteWithEvalStdinRedirect(command: string): string {
  return singleQuoteForEval(command) + ' < /dev/null'
}

function singleQuoteForEval(s: string): string {
  return "'" + s.replace(/'/g, `'"'"'`) + "'"
}

function joinContinuationLines(command: string): string {
  return command.replace(/\\+\n/g, match => {
    const backslashCount = match.length - 1 
    if (backslashCount % 2 === 1) {
      
      return '\\'.repeat(backslashCount - 1)
    } else {
      
      return match
    }
  })
}
