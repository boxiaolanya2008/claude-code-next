import memoize from 'lodash-es/memoize.js'

export type DebugFilter = {
  include: string[]
  exclude: string[]
  isExclusive: boolean
}

export const parseDebugFilter = memoize(
  (filterString?: string): DebugFilter | null => {
    if (!filterString || filterString.trim() === '') {
      return null
    }

    const filters = filterString
      .split(',')
      .map(f => f.trim())
      .filter(Boolean)

    
    if (filters.length === 0) {
      return null
    }

    
    const hasExclusive = filters.some(f => f.startsWith('!'))
    const hasInclusive = filters.some(f => !f.startsWith('!'))

    if (hasExclusive && hasInclusive) {
      
      
      
      
      return null
    }

    
    const cleanFilters = filters.map(f => f.replace(/^!/, '').toLowerCase())

    return {
      include: hasExclusive ? [] : cleanFilters,
      exclude: hasExclusive ? cleanFilters : [],
      isExclusive: hasExclusive,
    }
  },
)

export function extractDebugCategories(message: string): string[] {
  const categories: string[] = []

  
  const mcpMatch = message.match(/^MCP server ["']([^"']+)["']/)
  if (mcpMatch && mcpMatch[1]) {
    categories.push('mcp')
    categories.push(mcpMatch[1].toLowerCase())
  } else {
    
    const prefixMatch = message.match(/^([^:[]+):/)
    if (prefixMatch && prefixMatch[1]) {
      categories.push(prefixMatch[1].trim().toLowerCase())
    }
  }

  
  const bracketMatch = message.match(/^\[([^\]]+)]/)
  if (bracketMatch && bracketMatch[1]) {
    categories.push(bracketMatch[1].trim().toLowerCase())
  }

  
  
  if (message.toLowerCase().includes('1p event:')) {
    categories.push('1p')
  }

  
  
  const secondaryMatch = message.match(
    /:\s*([^:]+?)(?:\s+(?:type|mode|status|event))?:/,
  )
  if (secondaryMatch && secondaryMatch[1]) {
    const secondary = secondaryMatch[1].trim().toLowerCase()
    
    if (secondary.length < 30 && !secondary.includes(' ')) {
      categories.push(secondary)
    }
  }

  
  return Array.from(new Set(categories)) 
}

export function shouldShowDebugCategories(
  categories: string[],
  filter: DebugFilter | null,
): boolean {
  
  if (!filter) {
    return true
  }

  
  if (categories.length === 0) {
    
    
    return false
  }

  if (filter.isExclusive) {
    
    return !categories.some(cat => filter.exclude.includes(cat))
  } else {
    
    return categories.some(cat => filter.include.includes(cat))
  }
}

export function shouldShowDebugMessage(
  message: string,
  filter: DebugFilter | null,
): boolean {
  
  if (!filter) {
    return true
  }

  
  const categories = extractDebugCategories(message)
  return shouldShowDebugCategories(categories, filter)
}
