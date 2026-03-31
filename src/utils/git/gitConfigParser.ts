

import { readFile } from 'fs/promises'
import { join } from 'path'

export async function parseGitConfigValue(
  gitDir: string,
  section: string,
  subsection: string | null,
  key: string,
): Promise<string | null> {
  try {
    const config = await readFile(join(gitDir, 'config'), 'utf-8')
    return parseConfigString(config, section, subsection, key)
  } catch {
    return null
  }
}

export function parseConfigString(
  config: string,
  section: string,
  subsection: string | null,
  key: string,
): string | null {
  const lines = config.split('\n')
  const sectionLower = section.toLowerCase()
  const keyLower = key.toLowerCase()

  let inSection = false
  for (const line of lines) {
    const trimmed = line.trim()

    
    if (trimmed.length === 0 || trimmed[0] === '#' || trimmed[0] === ';') {
      continue
    }

    
    if (trimmed[0] === '[') {
      inSection = matchesSectionHeader(trimmed, sectionLower, subsection)
      continue
    }

    if (!inSection) {
      continue
    }

    
    const parsed = parseKeyValue(trimmed)
    if (parsed && parsed.key.toLowerCase() === keyLower) {
      return parsed.value
    }
  }

  return null
}

function parseKeyValue(line: string): { key: string; value: string } | null {
  
  let i = 0
  while (i < line.length && isKeyChar(line[i]!)) {
    i++
  }
  if (i === 0) {
    return null
  }
  const key = line.slice(0, i)

  
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    i++
  }

  
  if (i >= line.length || line[i] !== '=') {
    
    return null
  }
  i++ 

  
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    i++
  }

  const value = parseValue(line, i)
  return { key, value }
}

function parseValue(line: string, start: number): string {
  let result = ''
  let inQuote = false
  let i = start

  while (i < line.length) {
    const ch = line[i]!

    
    if (!inQuote && (ch === '#' || ch === ';')) {
      break
    }

    if (ch === '"') {
      inQuote = !inQuote
      i++
      continue
    }

    if (ch === '\\' && i + 1 < line.length) {
      const next = line[i + 1]!
      if (inQuote) {
        
        switch (next) {
          case 'n':
            result += '\n'
            break
          case 't':
            result += '\t'
            break
          case 'b':
            result += '\b'
            break
          case '"':
            result += '"'
            break
          case '\\':
            result += '\\'
            break
          default:
            
            result += next
            break
        }
        i += 2
        continue
      }
      
      
      if (next === '\\') {
        result += '\\'
        i += 2
        continue
      }
      
    }

    result += ch
    i++
  }

  
  
  
  
  if (!inQuote) {
    result = trimTrailingWhitespace(result)
  }

  return result
}

function trimTrailingWhitespace(s: string): string {
  let end = s.length
  while (end > 0 && (s[end - 1] === ' ' || s[end - 1] === '\t')) {
    end--
  }
  return s.slice(0, end)
}

function matchesSectionHeader(
  line: string,
  sectionLower: string,
  subsection: string | null,
): boolean {
  
  let i = 1

  
  while (
    i < line.length &&
    line[i] !== ']' &&
    line[i] !== ' ' &&
    line[i] !== '\t' &&
    line[i] !== '"'
  ) {
    i++
  }
  const foundSection = line.slice(1, i).toLowerCase()

  if (foundSection !== sectionLower) {
    return false
  }

  if (subsection === null) {
    
    return i < line.length && line[i] === ']'
  }

  
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    i++
  }

  
  if (i >= line.length || line[i] !== '"') {
    return false
  }
  i++ 

  
  let foundSubsection = ''
  while (i < line.length && line[i] !== '"') {
    if (line[i] === '\\' && i + 1 < line.length) {
      const next = line[i + 1]!
      if (next === '\\' || next === '"') {
        foundSubsection += next
        i += 2
        continue
      }
      
      foundSubsection += next
      i += 2
      continue
    }
    foundSubsection += line[i]
    i++
  }

  
  if (i >= line.length || line[i] !== '"') {
    return false
  }
  i++ 

  if (i >= line.length || line[i] !== ']') {
    return false
  }

  return foundSubsection === subsection
}

function isKeyChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === '-'
  )
}
