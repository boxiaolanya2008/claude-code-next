import { quote } from './shellQuote.js'

function containsHeredoc(command: string): boolean {
  
  
  
  if (
    /\d\s*<<\s*\d/.test(command) ||
    /\[\[\s*\d+\s*<<\s*\d+\s*\]\]/.test(command) ||
    /\$\(\(.*<<.*\)\)/.test(command)
  ) {
    return false
  }

  
  const heredocRegex = /<<-?\s*(?:(['"]?)(\w+)\1|\\(\w+))/
  return heredocRegex.test(command)
}

function containsMultilineString(command: string): boolean {
  
  
  
  
  const singleQuoteMultiline = /'(?:[^'\\]|\\.)*\n(?:[^'\\]|\\.)*'/
  const doubleQuoteMultiline = /"(?:[^"\\]|\\.)*\n(?:[^"\\]|\\.)*"/

  return (
    singleQuoteMultiline.test(command) || doubleQuoteMultiline.test(command)
  )
}

export function quoteShellCommand(
  command: string,
  addStdinRedirect: boolean = true,
): string {
  
  
  if (containsHeredoc(command) || containsMultilineString(command)) {
    
    
    
    const escaped = command.replace(/'/g, "'\"'\"'")
    const quoted = `'${escaped}'`

    
    if (containsHeredoc(command)) {
      return quoted
    }

    
    return addStdinRedirect ? `${quoted} < /dev/null` : quoted
  }

  
  if (addStdinRedirect) {
    return quote([command, '<', '/dev/null'])
  }

  return quote([command])
}

export function hasStdinRedirect(command: string): boolean {
  
  
  
  return /(?:^|[\s;&|])<(?![<(])\s*\S+/.test(command)
}

export function shouldAddStdinRedirect(command: string): boolean {
  
  if (containsHeredoc(command)) {
    return false
  }

  
  if (hasStdinRedirect(command)) {
    return false
  }

  
  return true
}

const NUL_REDIRECT_REGEX = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g

export function rewriteWindowsNullRedirect(command: string): string {
  return command.replace(NUL_REDIRECT_REGEX, '$1/dev/null')
}
