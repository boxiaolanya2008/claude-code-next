

import { createHash } from 'crypto'
import { userInfo } from 'os'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import type { SecureStorageData } from './types.js'

export const CREDENTIALS_SERVICE_SUFFIX = '-credentials'

export function getMacOsKeychainStorageServiceName(
  serviceSuffix: string = '',
): string {
  const configDir = getClaudeConfigHomeDir()
  const isDefaultDir = !process.env.CLAUDE_CONFIG_DIR

  
  
  const dirHash = isDefaultDir
    ? ''
    : `-${createHash('sha256').update(configDir).digest('hex').substring(0, 8)}`
  return `Claude Code${getOauthConfig().OAUTH_FILE_SUFFIX}${serviceSuffix}${dirHash}`
}

export function getUsername(): string {
  try {
    return process.env.USER || userInfo().username
  } catch {
    return 'claude-code-user'
  }
}

// --

// OAuth tokens expire in hours, and the only cross-process writer is another

export const KEYCHAIN_CACHE_TTL_MS = 30_000

export const keychainCacheState: {
  cache: { data: SecureStorageData | null; cachedAt: number } // cachedAt 0 = invalid
  
  
  
  generation: number
  
  
  
  readInFlight: Promise<SecureStorageData | null> | null
} = {
  cache: { data: null, cachedAt: 0 },
  generation: 0,
  readInFlight: null,
}

export function clearKeychainCache(): void {
  keychainCacheState.cache = { data: null, cachedAt: 0 }
  keychainCacheState.generation++
  keychainCacheState.readInFlight = null
}

/**
 * Prime the keychain cache from a prefetch result (keychainPrefetch.ts).
 * Only writes if the cache hasn't been touched yet — if sync read() or
 * update() already ran, their result is authoritative and we discard this.
 */
export function primeKeychainCacheFromPrefetch(stdout: string | null): void {
  if (keychainCacheState.cache.cachedAt !== 0) return
  let data: SecureStorageData | null = null
  if (stdout) {
    try {
      // eslint-disable-next-line custom-rules/no-direct-json-operations -- jsonParse() pulls slowOperations (lodash-es/cloneDeep) into the early-startup import chain; see file header
      data = JSON.parse(stdout)
    } catch {
      // malformed prefetch result — let sync read() re-fetch
      return
    }
  }
  keychainCacheState.cache = { data, cachedAt: Date.now() }
}
