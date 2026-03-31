

import { basename, posix, resolve, sep } from 'path'
import { getCwd } from '../../utils/cwd.js'
import { PS_TOKENIZER_DASH_CHARS } from '../../utils/powershell/parser.js'

function resolveCwdReentry(normalized: string): string {
  if (!normalized.startsWith('../')) return normalized
  const cwdBase = basename(getCwd()).toLowerCase()
  if (!cwdBase) return normalized
  
  
  
  const prefix = '../' + cwdBase + '/'
  let s = normalized
  while (s.startsWith(prefix)) {
    s = s.slice(prefix.length)
  }
  
  if (s === '../' + cwdBase) return '.'
  return s
}

function normalizeGitPathArg(arg: string): string {
  let s = arg
  
  
  if (s.length > 0 && (PS_TOKENIZER_DASH_CHARS.has(s[0]!) || s[0] === '/')) {
    const c = s.indexOf(':', 1)
    if (c > 0) s = s.slice(c + 1)
  }
  s = s.replace(/^['"]|['"]$/g, '')
  s = s.replace(/`/g, '')
  
  
  s = s.replace(/^(?:[A-Za-z0-9_.]+\\){0,3}FileSystem::/i, '')
  
  
  
  s = s.replace(/^[A-Za-z]:(?![/\\])/, '')
  s = s.replace(/\\/g, '/')
  
  
  
  
  s = s
    .split('/')
    .map(c => {
      if (c === '') return c
      let prev
      do {
        prev = c
        c = c.replace(/ +$/, '')
        if (c === '.' || c === '..') return c
        c = c.replace(/\.+$/, '')
      } while (c !== prev)
      return c || '.'
    })
    .join('/')
  s = posix.normalize(s)
  if (s.startsWith('./')) s = s.slice(2)
  return s.toLowerCase()
}

const GIT_INTERNAL_PREFIXES = ['head', 'objects', 'refs', 'hooks'] as const

function resolveEscapingPathToCwdRelative(n: string): string | null {
  const cwd = getCwd()
  
  
  
  const abs = resolve(cwd, n)
  const cwdWithSep = cwd.endsWith(sep) ? cwd : cwd + sep
  
  
  
  const absLower = abs.toLowerCase()
  const cwdLower = cwd.toLowerCase()
  const cwdWithSepLower = cwdWithSep.toLowerCase()
  if (absLower === cwdLower) return '.'
  if (!absLower.startsWith(cwdWithSepLower)) return null
  return abs.slice(cwdWithSep.length).replace(/\\/g, '/').toLowerCase()
}

function matchesGitInternalPrefix(n: string): boolean {
  if (n === 'head' || n === '.git') return true
  if (n.startsWith('.git/') || /^git~\d+($|\/)/.test(n)) return true
  for (const p of GIT_INTERNAL_PREFIXES) {
    if (p === 'head') continue
    if (n === p || n.startsWith(p + '/')) return true
  }
  return false
}

export function isGitInternalPathPS(arg: string): boolean {
  const n = resolveCwdReentry(normalizeGitPathArg(arg))
  if (matchesGitInternalPrefix(n)) return true
  
  
  
  
  if (n.startsWith('../') || n.startsWith('/') || /^[a-z]:/.test(n)) {
    const rel = resolveEscapingPathToCwdRelative(n)
    if (rel !== null && matchesGitInternalPrefix(rel)) return true
  }
  return false
}

export function isDotGitPathPS(arg: string): boolean {
  const n = resolveCwdReentry(normalizeGitPathArg(arg))
  if (matchesDotGitPrefix(n)) return true
  
  
  if (n.startsWith('../') || n.startsWith('/') || /^[a-z]:/.test(n)) {
    const rel = resolveEscapingPathToCwdRelative(n)
    if (rel !== null && matchesDotGitPrefix(rel)) return true
  }
  return false
}

function matchesDotGitPrefix(n: string): boolean {
  if (n === '.git' || n.startsWith('.git/')) return true
  
  
  
  return /^git~\d+($|\/)/.test(n)
}
