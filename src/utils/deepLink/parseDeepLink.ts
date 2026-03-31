

import { partiallySanitizeUnicode } from '../sanitization.js'

export const DEEP_LINK_PROTOCOL = 'claude-cli'

export type DeepLinkAction = {
  query?: string
  cwd?: string
  repo?: string
}

function containsControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) {
      return true
    }
  }
  return false
}

const REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/

const MAX_QUERY_LENGTH = 5000

const MAX_CWD_LENGTH = 4096

export function parseDeepLink(uri: string): DeepLinkAction {
  
  const normalized = uri.startsWith(`${DEEP_LINK_PROTOCOL}://`)
    ? uri
    : uri.startsWith(`${DEEP_LINK_PROTOCOL}:`)
      ? uri.replace(`${DEEP_LINK_PROTOCOL}:`, `${DEEP_LINK_PROTOCOL}://`)
      : null

  if (!normalized) {
    throw new Error(
      `Invalid deep link: expected ${DEEP_LINK_PROTOCOL}:// scheme, got "${uri}"`,
    )
  }

  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error(`Invalid deep link URL: "${uri}"`)
  }

  if (url.hostname !== 'open') {
    throw new Error(`Unknown deep link action: "${url.hostname}"`)
  }

  const cwd = url.searchParams.get('cwd') ?? undefined
  const repo = url.searchParams.get('repo') ?? undefined
  const rawQuery = url.searchParams.get('q')

  
  if (cwd && !cwd.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(cwd)) {
    throw new Error(
      `Invalid cwd in deep link: must be an absolute path, got "${cwd}"`,
    )
  }

  
  if (cwd && containsControlChars(cwd)) {
    throw new Error('Deep link cwd contains disallowed control characters')
  }
  if (cwd && cwd.length > MAX_CWD_LENGTH) {
    throw new Error(
      `Deep link cwd exceeds ${MAX_CWD_LENGTH} characters (got ${cwd.length})`,
    )
  }

  
  
  if (repo && !REPO_SLUG_PATTERN.test(repo)) {
    throw new Error(
      `Invalid repo in deep link: expected "owner/repo", got "${repo}"`,
    )
  }

  let query: string | undefined
  if (rawQuery && rawQuery.trim().length > 0) {
    
    query = partiallySanitizeUnicode(rawQuery.trim())
    if (containsControlChars(query)) {
      throw new Error('Deep link query contains disallowed control characters')
    }
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(
        `Deep link query exceeds ${MAX_QUERY_LENGTH} characters (got ${query.length})`,
      )
    }
  }

  return { query, cwd, repo }
}

export function buildDeepLink(action: DeepLinkAction): string {
  const url = new URL(`${DEEP_LINK_PROTOCOL}://open`)
  if (action.query) {
    url.searchParams.set('q', action.query)
  }
  if (action.cwd) {
    url.searchParams.set('cwd', action.cwd)
  }
  if (action.repo) {
    url.searchParams.set('repo', action.repo)
  }
  return url.toString()
}
