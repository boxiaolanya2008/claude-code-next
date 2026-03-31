import axios from 'axios'
import { hasProfileScope, isClaudeAISubscriber } from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getAuthHeaders, withOAuth401Retry } from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import { memoizeWithTTLAsync } from '../../utils/memoize.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

type MetricsEnabledResponse = {
  metrics_logging_enabled: boolean
}

type MetricsStatus = {
  enabled: boolean
  hasError: boolean
}

const CACHE_TTL_MS = 60 * 60 * 1000

const DISK_CACHE_TTL_MS = 24 * 60 * 60 * 1000

async function _fetchMetricsEnabled(): Promise<MetricsEnabledResponse> {
  const authResult = getAuthHeaders()
  if (authResult.error) {
    throw new Error(`Auth error: ${authResult.error}`)
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...authResult.headers,
  }

  const endpoint = `https://api.anthropic.com/api/claude_code_next/organizations/metrics_enabled`
  const response = await axios.get<MetricsEnabledResponse>(endpoint, {
    headers,
    timeout: 5000,
  })
  return response.data
}

async function _checkMetricsEnabledAPI(): Promise<MetricsStatus> {
  
  
  
  if (isEssentialTrafficOnly()) {
    return { enabled: false, hasError: false }
  }

  try {
    const data = await withOAuth401Retry(_fetchMetricsEnabled, {
      also403Revoked: true,
    })

    logForDebugging(
      `Metrics opt-out API response: enabled=${data.metrics_logging_enabled}`,
    )

    return {
      enabled: data.metrics_logging_enabled,
      hasError: false,
    }
  } catch (error) {
    logForDebugging(
      `Failed to check metrics opt-out status: ${errorMessage(error)}`,
    )
    logError(error)
    return { enabled: false, hasError: true }
  }
}

const memoizedCheckMetrics = memoizeWithTTLAsync(
  _checkMetricsEnabledAPI,
  CACHE_TTL_MS,
)

async function refreshMetricsStatus(): Promise<MetricsStatus> {
  const result = await memoizedCheckMetrics()
  if (result.hasError) {
    return result
  }

  const cached = getGlobalConfig().metricsStatusCache
  const unchanged = cached !== undefined && cached.enabled === result.enabled
  
  
  if (unchanged && Date.now() - cached.timestamp < DISK_CACHE_TTL_MS) {
    return result
  }

  saveGlobalConfig(current => ({
    ...current,
    metricsStatusCache: {
      enabled: result.enabled,
      timestamp: Date.now(),
    },
  }))
  return result
}

export async function checkMetricsEnabled(): Promise<MetricsStatus> {
  
  
  
  
  
  if (isClaudeAISubscriber() && !hasProfileScope()) {
    return { enabled: false, hasError: false }
  }

  const cached = getGlobalConfig().metricsStatusCache
  if (cached) {
    if (Date.now() - cached.timestamp > DISK_CACHE_TTL_MS) {
      
      
      
      void refreshMetricsStatus().catch(logError)
    }
    return {
      enabled: cached.enabled,
      hasError: false,
    }
  }

  
  return refreshMetricsStatus()
}

export const _clearMetricsEnabledCacheForTesting = (): void => {
  memoizedCheckMetrics.cache.clear()
}
