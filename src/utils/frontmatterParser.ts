

import { logForDebugging } from './debug.js'
import type { HooksSettings } from './settings/types.js'
import { parseYaml } from './yaml.js'

export type FrontmatterData = {
  
  'allowed-tools'?: string | string[] | null
  description?: string | null
  
  
  type?: string | null
  'argument-hint'?: string | null
  when_to_use?: string | null
  version?: string | null
  
  
  'hide-from-slash-command-tool'?: string | null
  
  
  model?: string | null
  
  skills?: string | null
  
  
  
  
  'user-invocable'?: string | null
  
  
  
  
  hooks?: HooksSettings | null
  
  
  effort?: string | null
  
  
  
  context?: 'inline' | 'fork' | null
  
  
  agent?: string | null
  
  
  
  
  paths?: string | string[] | null
  
  
  
  
  shell?: string | null
  [key: string]: unknown
}

export type ParsedMarkdown = {
  frontmatter: FrontmatterData
  content: string
}

const YAML_SPECIAL_CHARS = /[{}[\]*&#!|>%@`]|: /

function quoteProblematicValues(frontmatterText: string): string {
  const lines = frontmatterText.split('\n')
  const result: string[] = []

  for (const line of lines) {
    
    const match = line.match(/^([a-zA-Z_-]+):\s+(.+)$/)
    if (match) {
      const [, key, value] = match
      if (!key || !value) {
        result.push(line)
        continue
      }

      
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        result.push(line)
        continue
      }

      
      if (YAML_SPECIAL_CHARS.test(value)) {
        
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        result.push(`${key}: "${escaped}"`)
        continue
      }
    }

    result.push(line)
  }

  return result.join('\n')
}

export const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

export function parseFrontmatter(
  markdown: string,
  sourcePath?: string,
): ParsedMarkdown {
  const match = markdown.match(FRONTMATTER_REGEX)

  if (!match) {
    
    return {
      frontmatter: {},
      content: markdown,
    }
  }

  const frontmatterText = match[1] || ''
  const content = markdown.slice(match[0].length)

  let frontmatter: FrontmatterData = {}
  try {
    const parsed = parseYaml(frontmatterText) as FrontmatterData | null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed
    }
  } catch {
    
    try {
      const quotedText = quoteProblematicValues(frontmatterText)
      const parsed = parseYaml(quotedText) as FrontmatterData | null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = parsed
      }
    } catch (retryError) {
      
      const location = sourcePath ? ` in ${sourcePath}` : ''
      logForDebugging(
        `Failed to parse YAML frontmatter${location}: ${retryError instanceof Error ? retryError.message : retryError}`,
        { level: 'warn' },
      )
    }
  }

  return {
    frontmatter,
    content,
  }
}

export function splitPathInFrontmatter(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input.flatMap(splitPathInFrontmatter)
  }
  if (typeof input !== 'string') {
    return []
  }
  
  const parts: string[] = []
  let current = ''
  let braceDepth = 0

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (char === '{') {
      braceDepth++
      current += char
    } else if (char === '}') {
      braceDepth--
      current += char
    } else if (char === ',' && braceDepth === 0) {
      
      const trimmed = current.trim()
      if (trimmed) {
        parts.push(trimmed)
      }
      current = ''
    } else {
      current += char
    }
  }

  
  const trimmed = current.trim()
  if (trimmed) {
    parts.push(trimmed)
  }

  
  return parts
    .filter(p => p.length > 0)
    .flatMap(pattern => expandBraces(pattern))
}

function expandBraces(pattern: string): string[] {
  
  const braceMatch = pattern.match(/^([^{]*)\{([^}]+)\}(.*)$/)

  if (!braceMatch) {
    
    return [pattern]
  }

  const prefix = braceMatch[1] || ''
  const alternatives = braceMatch[2] || ''
  const suffix = braceMatch[3] || ''

  
  const parts = alternatives.split(',').map(alt => alt.trim())

  
  const expanded: string[] = []
  for (const part of parts) {
    const combined = prefix + part + suffix
    
    const furtherExpanded = expandBraces(combined)
    expanded.push(...furtherExpanded)
  }

  return expanded
}

export function parsePositiveIntFromFrontmatter(
  value: unknown,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  return undefined
}

export function coerceDescriptionToString(
  value: unknown,
  componentName?: string,
  pluginName?: string,
): string | null {
  if (value == null) {
    return null
  }
  if (typeof value === 'string') {
    return value.trim() || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  
  const source = pluginName
    ? `${pluginName}:${componentName}`
    : (componentName ?? 'unknown')
  logForDebugging(`Description invalid for ${source} - omitting`, {
    level: 'warn',
  })
  return null
}

export function parseBooleanFrontmatter(value: unknown): boolean {
  return value === true || value === 'true'
}

export type FrontmatterShell = 'bash' | 'powershell'

const FRONTMATTER_SHELLS: readonly FrontmatterShell[] = ['bash', 'powershell']

export function parseShellFrontmatter(
  value: unknown,
  source: string,
): FrontmatterShell | undefined {
  if (value == null) {
    return undefined
  }
  const normalized = String(value).trim().toLowerCase()
  if (normalized === '') {
    return undefined
  }
  if ((FRONTMATTER_SHELLS as readonly string[]).includes(normalized)) {
    return normalized as FrontmatterShell
  }
  logForDebugging(
    `Frontmatter 'shell: ${value}' in ${source} is not recognized. Valid values: ${FRONTMATTER_SHELLS.join(', ')}. Falling back to bash.`,
    { level: 'warn' },
  )
  return undefined
}
