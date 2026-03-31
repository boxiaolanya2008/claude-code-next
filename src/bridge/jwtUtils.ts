import { logEvent } from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { errorMessage } from '../utils/errors.js'
import { jsonParse } from '../utils/slowOperations.js'

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function decodeJwtPayload(token: string): unknown | null {
  const jwt = token.startsWith('sk-ant-si-')
    ? token.slice('sk-ant-si-'.length)
    : token
  const parts = jwt.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    return jsonParse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function decodeJwtExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token)
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'exp' in payload &&
    typeof payload.exp === 'number'
  ) {
    return payload.exp
  }
  return null
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

const FALLBACK_REFRESH_INTERVAL_MS = 30 * 60 * 1000 

const MAX_REFRESH_FAILURES = 3

const REFRESH_RETRY_DELAY_MS = 60_000

export function createTokenRefreshScheduler({
  getAccessToken,
  onRefresh,
  label,
  refreshBufferMs = TOKEN_REFRESH_BUFFER_MS,
}: {
  getAccessToken: () => string | undefined | Promise<string | undefined>
  onRefresh: (sessionId: string, oauthToken: string) => void
  label: string
  
  refreshBufferMs?: number
}): {
  schedule: (sessionId: string, token: string) => void
  scheduleFromExpiresIn: (sessionId: string, expiresInSeconds: number) => void
  cancel: (sessionId: string) => void
  cancelAll: () => void
} {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const failureCounts = new Map<string, number>()
  
  
  
  const generations = new Map<string, number>()

  function nextGeneration(sessionId: string): number {
    const gen = (generations.get(sessionId) ?? 0) + 1
    generations.set(sessionId, gen)
    return gen
  }

  function schedule(sessionId: string, token: string): void {
    const expiry = decodeJwtExpiry(token)
    if (!expiry) {
      
      
      
      
      logForDebugging(
        `[${label}:token] Could not decode JWT expiry for sessionId=${sessionId}, token prefix=${token.slice(0, 15)}…, keeping existing timer`,
      )
      return
    }

    
    const existing = timers.get(sessionId)
    if (existing) {
      clearTimeout(existing)
    }

    
    const gen = nextGeneration(sessionId)

    const expiryDate = new Date(expiry * 1000).toISOString()
    const delayMs = expiry * 1000 - Date.now() - refreshBufferMs
    if (delayMs <= 0) {
      logForDebugging(
        `[${label}:token] Token for sessionId=${sessionId} expires=${expiryDate} (past or within buffer), refreshing immediately`,
      )
      void doRefresh(sessionId, gen)
      return
    }

    logForDebugging(
      `[${label}:token] Scheduled token refresh for sessionId=${sessionId} in ${formatDuration(delayMs)} (expires=${expiryDate}, buffer=${refreshBufferMs / 1000}s)`,
    )

    const timer = setTimeout(doRefresh, delayMs, sessionId, gen)
    timers.set(sessionId, timer)
  }

  

  function scheduleFromExpiresIn(
    sessionId: string,
    expiresInSeconds: number,
  ): void {
    const existing = timers.get(sessionId)
    if (existing) clearTimeout(existing)
    const gen = nextGeneration(sessionId)
    
    
    
    const delayMs = Math.max(expiresInSeconds * 1000 - refreshBufferMs, 30_000)
    logForDebugging(
      `[${label}:token] Scheduled token refresh for sessionId=${sessionId} in ${formatDuration(delayMs)} (expires_in=${expiresInSeconds}s, buffer=${refreshBufferMs / 1000}s)`,
    )
    const timer = setTimeout(doRefresh, delayMs, sessionId, gen)
    timers.set(sessionId, timer)
  }

  async function doRefresh(sessionId: string, gen: number): Promise<void> {
    let oauthToken: string | undefined
    try {
      oauthToken = await getAccessToken()
    } catch (err) {
      logForDebugging(
        `[${label}:token] getAccessToken threw for sessionId=${sessionId}: ${errorMessage(err)}`,
        { level: 'error' },
      )
    }

    
    
    if (generations.get(sessionId) !== gen) {
      logForDebugging(
        `[${label}:token] doRefresh for sessionId=${sessionId} stale (gen ${gen} vs ${generations.get(sessionId)}), skipping`,
      )
      return
    }

    if (!oauthToken) {
      const failures = (failureCounts.get(sessionId) ?? 0) + 1
      failureCounts.set(sessionId, failures)
      logForDebugging(
        `[${label}:token] No OAuth token available for refresh, sessionId=${sessionId} (failure ${failures}/${MAX_REFRESH_FAILURES})`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'bridge_token_refresh_no_oauth')
      
      
      
      if (failures < MAX_REFRESH_FAILURES) {
        const retryTimer = setTimeout(
          doRefresh,
          REFRESH_RETRY_DELAY_MS,
          sessionId,
          gen,
        )
        timers.set(sessionId, retryTimer)
      }
      return
    }

    
    failureCounts.delete(sessionId)

    logForDebugging(
      `[${label}:token] Refreshing token for sessionId=${sessionId}: new token prefix=${oauthToken.slice(0, 15)}…`,
    )
    logEvent('tengu_bridge_token_refreshed', {})
    onRefresh(sessionId, oauthToken)

    
    
    
    const timer = setTimeout(
      doRefresh,
      FALLBACK_REFRESH_INTERVAL_MS,
      sessionId,
      gen,
    )
    timers.set(sessionId, timer)
    logForDebugging(
      `[${label}:token] Scheduled follow-up refresh for sessionId=${sessionId} in ${formatDuration(FALLBACK_REFRESH_INTERVAL_MS)}`,
    )
  }

  function cancel(sessionId: string): void {
    
    nextGeneration(sessionId)
    const timer = timers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      timers.delete(sessionId)
    }
    failureCounts.delete(sessionId)
  }

  function cancelAll(): void {
    
    for (const sessionId of generations.keys()) {
      nextGeneration(sessionId)
    }
    for (const timer of timers.values()) {
      clearTimeout(timer)
    }
    timers.clear()
    failureCounts.clear()
  }

  return { schedule, scheduleFromExpiresIn, cancel, cancelAll }
}
