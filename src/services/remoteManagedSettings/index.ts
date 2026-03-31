

import axios from 'axios'
import { createHash } from 'crypto'
import { open, unlink } from 'fs/promises'
import { getOauthConfig, OAUTH_BETA_HEADER } from '../../constants/oauth.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { classifyAxiosError, getErrnoCode } from '../../utils/errors.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import {
  type SettingsJson,
  SettingsSchema,
} from '../../utils/settings/types.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { getRetryDelay } from '../api/withRetry.js'
import {
  checkManagedSettingsSecurity,
  handleSecurityCheckResult,
} from './securityCheck.jsx'
import { isRemoteManagedSettingsEligible, resetSyncCache } from './syncCache.js'
import {
  getRemoteManagedSettingsSyncFromCache,
  getSettingsPath,
  setSessionCache,
} from './syncCacheState.js'
import {
  type RemoteManagedSettingsFetchResult,
  RemoteManagedSettingsResponseSchema,
} from './types.js'

const SETTINGS_TIMEOUT_MS = 10000 
const DEFAULT_MAX_RETRIES = 5
const POLLING_INTERVAL_MS = 60 * 60 * 1000 

let pollingIntervalId: ReturnType<typeof setInterval> | null = null

let loadingCompletePromise: Promise<void> | null = null
let loadingCompleteResolve: (() => void) | null = null

const LOADING_PROMISE_TIMEOUT_MS = 30000 

export function initializeRemoteManagedSettingsLoadingPromise(): void {
  if (loadingCompletePromise) {
    return
  }

  if (isRemoteManagedSettingsEligible()) {
    loadingCompletePromise = new Promise(resolve => {
      loadingCompleteResolve = resolve

      
      
      setTimeout(() => {
        if (loadingCompleteResolve) {
          logForDebugging(
            'Remote settings: Loading promise timed out, resolving anyway',
          )
          loadingCompleteResolve()
          loadingCompleteResolve = null
        }
      }, LOADING_PROMISE_TIMEOUT_MS)
    })
  }
}

function getRemoteManagedSettingsEndpoint() {
  return `${getOauthConfig().BASE_API_URL}/api/claude_code_next/settings`
}

function sortKeysDeep(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysDeep)
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep((obj as Record<string, unknown>)[key])
    }
    return sorted
  }
  return obj
}

export function computeChecksumFromSettings(settings: SettingsJson): string {
  const sorted = sortKeysDeep(settings)
  
  const normalized = jsonStringify(sorted)
  const hash = createHash('sha256').update(normalized).digest('hex')
  return `sha256:${hash}`
}

export function isEligibleForRemoteManagedSettings(): boolean {
  return isRemoteManagedSettingsEligible()
}

export async function waitForRemoteManagedSettingsToLoad(): Promise<void> {
  if (loadingCompletePromise) {
    await loadingCompletePromise
  }
}

function getRemoteSettingsAuthHeaders(): {
  headers: Record<string, string>
  error?: string
} {
  
  
  
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return {
        headers: {
          'x-api-key': apiKey,
        },
      }
    }
  } catch {
    
  }

  
  const oauthTokens = getClaudeAIOAuthTokens()
  if (oauthTokens?.accessToken) {
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    }
  }

  return {
    headers: {},
    error: 'No authentication available',
  }
}

async function fetchWithRetry(
  cachedChecksum?: string,
): Promise<RemoteManagedSettingsFetchResult> {
  let lastResult: RemoteManagedSettingsFetchResult | null = null

  for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES + 1; attempt++) {
    lastResult = await fetchRemoteManagedSettings(cachedChecksum)

    
    if (lastResult.success) {
      return lastResult
    }

    
    if (lastResult.skipRetry) {
      return lastResult
    }

    
    if (attempt > DEFAULT_MAX_RETRIES) {
      return lastResult
    }

    
    const delayMs = getRetryDelay(attempt)
    logForDebugging(
      `Remote settings: Retry ${attempt}/${DEFAULT_MAX_RETRIES} after ${delayMs}ms`,
    )
    await sleep(delayMs)
  }

  
  return lastResult!
}

async function fetchRemoteManagedSettings(
  cachedChecksum?: string,
): Promise<RemoteManagedSettingsFetchResult> {
  try {
    
    
    await checkAndRefreshOAuthTokenIfNeeded()

    
    const authHeaders = getRemoteSettingsAuthHeaders()
    if (authHeaders.error) {
      
      return {
        success: false,
        error: `Authentication required for remote settings`,
        skipRetry: true,
      }
    }

    const endpoint = getRemoteManagedSettingsEndpoint()
    const headers: Record<string, string> = {
      ...authHeaders.headers,
      'User-Agent': getClaudeCodeUserAgent(),
    }

    
    if (cachedChecksum) {
      headers['If-None-Match'] = `"${cachedChecksum}"`
    }

    const response = await axios.get(endpoint, {
      headers,
      timeout: SETTINGS_TIMEOUT_MS,
      
      
      validateStatus: status =>
        status === 200 || status === 204 || status === 304 || status === 404,
    })

    
    if (response.status === 304) {
      logForDebugging('Remote settings: Using cached settings (304)')
      return {
        success: true,
        settings: null, 
        checksum: cachedChecksum,
      }
    }

    
    
    if (response.status === 204 || response.status === 404) {
      logForDebugging(`Remote settings: No settings found (${response.status})`)
      return {
        success: true,
        settings: {},
        checksum: undefined,
      }
    }

    const parsed = RemoteManagedSettingsResponseSchema().safeParse(
      response.data,
    )
    if (!parsed.success) {
      logForDebugging(
        `Remote settings: Invalid response format - ${parsed.error.message}`,
      )
      return {
        success: false,
        error: 'Invalid remote settings format',
      }
    }

    
    const settingsValidation = SettingsSchema().safeParse(parsed.data.settings)
    if (!settingsValidation.success) {
      logForDebugging(
        `Remote settings: Settings validation failed - ${settingsValidation.error.message}`,
      )
      return {
        success: false,
        error: 'Invalid settings structure',
      }
    }

    logForDebugging('Remote settings: Fetched successfully')
    return {
      success: true,
      settings: settingsValidation.data,
      checksum: parsed.data.checksum,
    }
  } catch (error) {
    const { kind, status, message } = classifyAxiosError(error)
    if (status === 404) {
      
      return { success: true, settings: {}, checksum: '' }
    }
    switch (kind) {
      case 'auth':
        
        return {
          success: false,
          error: 'Not authorized for remote settings',
          skipRetry: true,
        }
      case 'timeout':
        return { success: false, error: 'Remote settings request timeout' }
      case 'network':
        return { success: false, error: 'Cannot connect to server' }
      default:
        return { success: false, error: message }
    }
  }
}

async function saveSettings(settings: SettingsJson): Promise<void> {
  try {
    const path = getSettingsPath()
    const handle = await open(path, 'w', 0o600)
    try {
      await handle.writeFile(jsonStringify(settings, null, 2), {
        encoding: 'utf-8',
      })
      await handle.datasync()
    } finally {
      await handle.close()
    }
    logForDebugging(`Remote settings: Saved to ${path}`)
  } catch (error) {
    logForDebugging(
      `Remote settings: Failed to save - ${error instanceof Error ? error.message : 'unknown error'}`,
    )
    
  }
}

export async function clearRemoteManagedSettingsCache(): Promise<void> {
  
  stopBackgroundPolling()

  
  resetSyncCache()

  
  loadingCompletePromise = null
  loadingCompleteResolve = null

  try {
    const path = getSettingsPath()
    await unlink(path)
  } catch {
    
  }
}

async function fetchAndLoadRemoteManagedSettings(): Promise<SettingsJson | null> {
  if (!isRemoteManagedSettingsEligible()) {
    return null
  }

  
  const cachedSettings = getRemoteManagedSettingsSyncFromCache()

  
  const cachedChecksum = cachedSettings
    ? computeChecksumFromSettings(cachedSettings)
    : undefined

  try {
    
    const result = await fetchWithRetry(cachedChecksum)

    if (!result.success) {
      
      if (cachedSettings) {
        logForDebugging(
          'Remote settings: Using stale cache after fetch failure',
        )
        setSessionCache(cachedSettings)
        return cachedSettings
      }
      
      return null
    }

    
    if (result.settings === null && cachedSettings) {
      logForDebugging('Remote settings: Cache still valid (304 Not Modified)')
      setSessionCache(cachedSettings)
      return cachedSettings
    }

    
    const newSettings = result.settings || {}
    const hasContent = Object.keys(newSettings).length > 0

    if (hasContent) {
      
      const securityResult = await checkManagedSettingsSecurity(
        cachedSettings,
        newSettings,
      )
      if (!handleSecurityCheckResult(securityResult)) {
        
        logForDebugging(
          'Remote settings: User rejected new settings, using cached settings',
        )
        return cachedSettings
      }

      setSessionCache(newSettings)
      await saveSettings(newSettings)
      logForDebugging('Remote settings: Applied new settings successfully')
      return newSettings
    }

    
    
    setSessionCache(newSettings)
    try {
      const path = getSettingsPath()
      await unlink(path)
      logForDebugging('Remote settings: Deleted cached file (404 response)')
    } catch (e) {
      const code = getErrnoCode(e)
      if (code !== 'ENOENT') {
        logForDebugging(
          `Remote settings: Failed to delete cached file - ${e instanceof Error ? e.message : 'unknown error'}`,
        )
      }
    }
    return newSettings
  } catch {
    
    if (cachedSettings) {
      logForDebugging('Remote settings: Using stale cache after error')
      setSessionCache(cachedSettings)
      return cachedSettings
    }

    
    return null
  }
}

export async function loadRemoteManagedSettings(): Promise<void> {
  
  
  
  if (isRemoteManagedSettingsEligible() && !loadingCompletePromise) {
    loadingCompletePromise = new Promise(resolve => {
      loadingCompleteResolve = resolve
    })
  }

  
  
  
  
  
  if (getRemoteManagedSettingsSyncFromCache() && loadingCompleteResolve) {
    loadingCompleteResolve()
    loadingCompleteResolve = null
  }

  try {
    const settings = await fetchAndLoadRemoteManagedSettings()

    
    if (isRemoteManagedSettingsEligible()) {
      startBackgroundPolling()
    }

    
    
    
    if (settings !== null) {
      settingsChangeDetector.notifyChange('policySettings')
    }
  } finally {
    
    if (loadingCompleteResolve) {
      loadingCompleteResolve()
      loadingCompleteResolve = null
    }
  }
}

export async function refreshRemoteManagedSettings(): Promise<void> {
  
  await clearRemoteManagedSettingsCache()

  
  if (!isRemoteManagedSettingsEligible()) {
    settingsChangeDetector.notifyChange('policySettings')
    return
  }

  
  await fetchAndLoadRemoteManagedSettings()
  logForDebugging('Remote settings: Refreshed after auth change')

  
  
  settingsChangeDetector.notifyChange('policySettings')
}

async function pollRemoteSettings(): Promise<void> {
  if (!isRemoteManagedSettingsEligible()) {
    return
  }

  
  const prevCache = getRemoteManagedSettingsSyncFromCache()
  const previousSettings = prevCache ? jsonStringify(prevCache) : null

  try {
    await fetchAndLoadRemoteManagedSettings()

    
    const newCache = getRemoteManagedSettingsSyncFromCache()
    const newSettings = newCache ? jsonStringify(newCache) : null
    if (newSettings !== previousSettings) {
      logForDebugging('Remote settings: Changed during background poll')
      settingsChangeDetector.notifyChange('policySettings')
    }
  } catch {
    
  }
}

export function startBackgroundPolling(): void {
  if (pollingIntervalId !== null) {
    return
  }

  if (!isRemoteManagedSettingsEligible()) {
    return
  }

  pollingIntervalId = setInterval(() => {
    void pollRemoteSettings()
  }, POLLING_INTERVAL_MS)
  pollingIntervalId.unref()

  
  registerCleanup(async () => stopBackgroundPolling())
}

export function stopBackgroundPolling(): void {
  if (pollingIntervalId !== null) {
    clearInterval(pollingIntervalId)
    pollingIntervalId = null
  }
}
