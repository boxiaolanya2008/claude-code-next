

import type { PermissionUpdate } from './PermissionUpdateSchema.js'

const ESCAPED_STAR_PLACEHOLDER = '\x00ESCAPED_STAR\x00'
const ESCAPED_BACKSLASH_PLACEHOLDER = '\x00ESCAPED_BACKSLASH\x00'
const ESCAPED_STAR_PLACEHOLDER_RE = new RegExp(ESCAPED_STAR_PLACEHOLDER, 'g')
const ESCAPED_BACKSLASH_PLACEHOLDER_RE = new RegExp(
  ESCAPED_BACKSLASH_PLACEHOLDER,
  'g',
)

export type ShellPermissionRule =
  | {
      type: 'exact'
      command: string
    }
  | {
      type: 'prefix'
      prefix: string
    }
  | {
      type: 'wildcard'
      pattern: string
    }

export function permissionRuleExtractPrefix(
  permissionRule: string,
): string | null {
  const match = permissionRule.match(/^(.+):\*$/)
  return match?.[1] ?? null
}

export function hasWildcards(pattern: string): boolean {
  
  if (pattern.endsWith(':*')) {
    return false
  }
  
  
  
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') {
      
      let backslashCount = 0
      let j = i - 1
      while (j >= 0 && pattern[j] === '\\') {
        backslashCount++
        j--
      }
      
      if (backslashCount % 2 === 0) {
        return true
      }
    }
  }
  return false
}

export function matchWildcardPattern(
  pattern: string,
  command: string,
  caseInsensitive = false,
): boolean {
  
  const trimmedPattern = pattern.trim()

  
  let processed = ''
  let i = 0

  while (i < trimmedPattern.length) {
    const char = trimmedPattern[i]

    
    if (char === '\\' && i + 1 < trimmedPattern.length) {
      const nextChar = trimmedPattern[i + 1]
      if (nextChar === '*') {
        
        processed += ESCAPED_STAR_PLACEHOLDER
        i += 2
        continue
      } else if (nextChar === '\\') {
        
        processed += ESCAPED_BACKSLASH_PLACEHOLDER
        i += 2
        continue
      }
    }

    processed += char
    i++
  }

  
  const escaped = processed.replace(/[.+?^${}()|[\]\\'"]/g, '\\$&')

  
  const withWildcards = escaped.replace(/\*/g, '.*')

  
  let regexPattern = withWildcards
    .replace(ESCAPED_STAR_PLACEHOLDER_RE, '\\*')
    .replace(ESCAPED_BACKSLASH_PLACEHOLDER_RE, '\\\\')

  
  
  
  
  
  
  const unescapedStarCount = (processed.match(/\*/g) || []).length
  if (regexPattern.endsWith(' .*') && unescapedStarCount === 1) {
    regexPattern = regexPattern.slice(0, -3) + '( .*)?'
  }

  
  
  
  const flags = 's' + (caseInsensitive ? 'i' : '')
  const regex = new RegExp(`^${regexPattern}

import type { PermissionUpdate } from './PermissionUpdateSchema.js'

const ESCAPED_STAR_PLACEHOLDER = '\x00ESCAPED_STAR\x00'
const ESCAPED_BACKSLASH_PLACEHOLDER = '\x00ESCAPED_BACKSLASH\x00'
const ESCAPED_STAR_PLACEHOLDER_RE = new RegExp(ESCAPED_STAR_PLACEHOLDER, 'g')
const ESCAPED_BACKSLASH_PLACEHOLDER_RE = new RegExp(
  ESCAPED_BACKSLASH_PLACEHOLDER,
  'g',
)

export type ShellPermissionRule =
  | {
      type: 'exact'
      command: string
    }
  | {
      type: 'prefix'
      prefix: string
    }
  | {
      type: 'wildcard'
      pattern: string
    }

export function permissionRuleExtractPrefix(
  permissionRule: string,
): string | null {
  const match = permissionRule.match(/^(.+):\*$/)
  return match?.[1] ?? null
}

export function hasWildcards(pattern: string): boolean {
  
  if (pattern.endsWith(':*')) {
    return false
  }
  
  
  
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*') {
      
      let backslashCount = 0
      let j = i - 1
      while (j >= 0 && pattern[j] === '\\') {
        backslashCount++
        j--
      }
      
      if (backslashCount % 2 === 0) {
        return true
      }
    }
  }
  return false
}

export function matchWildcardPattern(
  pattern: string,
  command: string,
  caseInsensitive = false,
): boolean {
  
  const trimmedPattern = pattern.trim()

  
  let processed = ''
  let i = 0

  while (i < trimmedPattern.length) {
    const char = trimmedPattern[i]

    
    if (char === '\\' && i + 1 < trimmedPattern.length) {
      const nextChar = trimmedPattern[i + 1]
      if (nextChar === '*') {
        
        processed += ESCAPED_STAR_PLACEHOLDER
        i += 2
        continue
      } else if (nextChar === '\\') {
        
        processed += ESCAPED_BACKSLASH_PLACEHOLDER
        i += 2
        continue
      }
    }

    processed += char
    i++
  }

  
  const escaped = processed.replace(/[.+?^${}()|[\]\\'"]/g, '\\$&')

  // Convert unescaped * to .* for wildcard matching
  const withWildcards = escaped.replace(/\*/g, '.*')

  // Convert placeholders back to escaped regex literals
  let regexPattern = withWildcards
    .replace(ESCAPED_STAR_PLACEHOLDER_RE, '\\*')
    .replace(ESCAPED_BACKSLASH_PLACEHOLDER_RE, '\\\\')

  // When a pattern ends with ' *' (space + unescaped wildcard) AND the trailing
  // wildcard is the ONLY unescaped wildcard, make the trailing space-and-args
  // optional so 'git *' matches both 'git add' and bare 'git'.
  // This aligns wildcard matching with prefix rule semantics (git:*).
  // Multi-wildcard patterns like '* run *' are excluded — making the last
  // wildcard optional would incorrectly match 'npm run' (no trailing arg).
  const unescapedStarCount = (processed.match(/\*/g) || []).length
  if (regexPattern.endsWith(' .*') && unescapedStarCount === 1) {
    regexPattern = regexPattern.slice(0, -3) + '( .*)?'
  }

  // Create regex that matches the entire string.
  // The 's' (dotAll) flag makes '.' match newlines, so wildcards match
  // commands containing embedded newlines (e.g. heredoc content after splitCommand_DEPRECATED).
  const flags = 's' + (caseInsensitive ? 'i' : ', flags)

  return regex.test(command)
}

/**
 * Parse a permission rule string into a structured rule object.
 */
export function parsePermissionRule(
  permissionRule: string,
): ShellPermissionRule {
  // Check for legacy :* prefix syntax first (backwards compatibility)
  const prefix = permissionRuleExtractPrefix(permissionRule)
  if (prefix !== null) {
    return {
      type: 'prefix',
      prefix,
    }
  }

  // Check for new wildcard syntax (contains * but not :* at end)
  if (hasWildcards(permissionRule)) {
    return {
      type: 'wildcard',
      pattern: permissionRule,
    }
  }

  // Otherwise, it's an exact match
  return {
    type: 'exact',
    command: permissionRule,
  }
}

export function suggestionForExactCommand(
  toolName: string,
  command: string,
): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      rules: [
        {
          toolName,
          ruleContent: command,
        },
      ],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ]
}

export function suggestionForPrefix(
  toolName: string,
  prefix: string,
): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      rules: [
        {
          toolName,
          ruleContent: `${prefix}:*`,
        },
      ],
      behavior: 'allow',
      destination: 'localSettings',
    },
  ]
}
