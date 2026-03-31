

export function partiallySanitizeUnicode(prompt: string): string {
  let current = prompt
  let previous = ''
  let iterations = 0
  const MAX_ITERATIONS = 10 

  
  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current

    
    current = current.normalize('NFKC')

    

    
    
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '')

    
    
    // so we also implement a fallback that strips out some specifically known dangerous ranges.
    current = current
      .replace(/[\u200B-\u200F]/g, '') 
      .replace(/[\u202A-\u202E]/g, '') 
      .replace(/[\u2066-\u2069]/g, '') 
      .replace(/[\uFEFF]/g, '') 
      .replace(/[\uE000-\uF8FF]/g, '') 

    iterations++
  }

  // If we hit max iterations, crash loudly. This should only ever happen if there is a bug or if someone purposefully created a deeply nested unicode string.
  if (iterations >= MAX_ITERATIONS) {
    throw new Error(
      `Unicode sanitization reached maximum iterations (${MAX_ITERATIONS}) for input: ${prompt.slice(0, 100)}`,
    )
  }

  return current
}

export function recursivelySanitizeUnicode(value: string): string
export function recursivelySanitizeUnicode<T>(value: T[]): T[]
export function recursivelySanitizeUnicode<T extends object>(value: T): T
export function recursivelySanitizeUnicode<T>(value: T): T
export function recursivelySanitizeUnicode(value: unknown): unknown {
  if (typeof value === 'string') {
    return partiallySanitizeUnicode(value)
  }

  if (Array.isArray(value)) {
    return value.map(recursivelySanitizeUnicode)
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      sanitized[recursivelySanitizeUnicode(key)] =
        recursivelySanitizeUnicode(val)
    }
    return sanitized
  }

  // Return other primitive values (numbers, booleans, null, undefined) unchanged
  return value
}
