import { APIError } from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import isEqual from 'lodash-es/isEqual.js'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { isClaudeAISubscriber } from '../utils/auth.js'
import { getModelBetas } from '../utils/betas.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import { getSmallFastModel } from '../utils/model/model.js'
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from './analytics/index.js'
import { logEvent } from './analytics/index.js'
import { getAPIMetadata } from './api/claude.js'
import { getAnthropicClient } from './api/client.js'
import {
  processRateLimitHeaders,
  shouldProcessRateLimits,
} from './rateLimitMocking.js'

export {
  getRateLimitErrorMessage,
  getRateLimitWarning,
  getUsingOverageText,
} from './rateLimitMessages.js'

type QuotaStatus = 'allowed' | 'allowed_warning' | 'rejected'

type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage'

export type { RateLimitType }

type EarlyWarningThreshold = {
  utilization: number 
  timePct: number 
}

type EarlyWarningConfig = {
  rateLimitType: RateLimitType
  claimAbbrev: '5h' | '7d'
  windowSeconds: number
  thresholds: EarlyWarningThreshold[]
}

const EARLY_WARNING_CONFIGS: EarlyWarningConfig[] = [
  {
    rateLimitType: 'five_hour',
    claimAbbrev: '5h',
    windowSeconds: 5 * 60 * 60,
    thresholds: [{ utilization: 0.9, timePct: 0.72 }],
  },
  {
    rateLimitType: 'seven_day',
    claimAbbrev: '7d',
    windowSeconds: 7 * 24 * 60 * 60,
    thresholds: [
      { utilization: 0.75, timePct: 0.6 },
      { utilization: 0.5, timePct: 0.35 },
      { utilization: 0.25, timePct: 0.15 },
    ],
  },
]

const EARLY_WARNING_CLAIM_MAP: Record<string, RateLimitType> = {
  '5h': 'five_hour',
  '7d': 'seven_day',
  overage: 'overage',
}

const RATE_LIMIT_DISPLAY_NAMES: Record<RateLimitType, string> = {
  five_hour: 'session limit',
  seven_day: 'weekly limit',
  seven_day_opus: 'Opus limit',
  seven_day_sonnet: 'Sonnet limit',
  overage: 'extra usage limit',
}

export function getRateLimitDisplayName(type: RateLimitType): string {
  return RATE_LIMIT_DISPLAY_NAMES[type] || type
}

function computeTimeProgress(resetsAt: number, windowSeconds: number): number {
  const nowSeconds = Date.now() / 1000
  const windowStart = resetsAt - windowSeconds
  const elapsed = nowSeconds - windowStart
  return Math.max(0, Math.min(1, elapsed / windowSeconds))
}

export type OverageDisabledReason =
  | 'overage_not_provisioned' 
  | 'org_level_disabled' 
  | 'org_level_disabled_until' 
  | 'out_of_credits' 
  | 'seat_tier_level_disabled' 
  | 'member_level_disabled' 
  | 'seat_tier_zero_credit_limit' 
  | 'group_zero_credit_limit' 
  | 'member_zero_credit_limit' 
  | 'org_service_level_disabled' 
  | 'org_service_zero_credit_limit' 
  | 'no_limits_configured' 
  | 'unknown' 

export type ClaudeAILimits = {
  status: QuotaStatus
  
  
  
  unifiedRateLimitFallbackAvailable: boolean
  resetsAt?: number
  rateLimitType?: RateLimitType
  utilization?: number
  overageStatus?: QuotaStatus
  overageResetsAt?: number
  overageDisabledReason?: OverageDisabledReason
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

export let currentLimits: ClaudeAILimits = {
  status: 'allowed',
  unifiedRateLimitFallbackAvailable: false,
  isUsingOverage: false,
}

type RawWindowUtilization = {
  utilization: number 
  resets_at: number 
}
type RawUtilization = {
  five_hour?: RawWindowUtilization
  seven_day?: RawWindowUtilization
}
let rawUtilization: RawUtilization = {}

export function getRawUtilization(): RawUtilization {
  return rawUtilization
}

function extractRawUtilization(headers: globalThis.Headers): RawUtilization {
  const result: RawUtilization = {}
  for (const [key, abbrev] of [
    ['five_hour', '5h'],
    ['seven_day', '7d'],
  ] as const) {
    const util = headers.get(
      `anthropic-ratelimit-unified-${abbrev}-utilization`,
    )
    const reset = headers.get(`anthropic-ratelimit-unified-${abbrev}-reset`)
    if (util !== null && reset !== null) {
      result[key] = { utilization: Number(util), resets_at: Number(reset) }
    }
  }
  return result
}

type StatusChangeListener = (limits: ClaudeAILimits) => void
export const statusListeners: Set<StatusChangeListener> = new Set()

export function emitStatusChange(limits: ClaudeAILimits) {
  currentLimits = limits
  statusListeners.forEach(listener => listener(limits))
  const hoursTillReset = Math.round(
    (limits.resetsAt ? limits.resetsAt - Date.now() / 1000 : 0) / (60 * 60),
  )

  logEvent('tengu_claudeai_limits_status_changed', {
    status:
      limits.status as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    unifiedRateLimitFallbackAvailable: limits.unifiedRateLimitFallbackAvailable,
    hoursTillReset,
  })
}

async function makeTestQuery() {
  const model = getSmallFastModel()
  const anthropic = await getAnthropicClient({
    maxRetries: 0,
    model,
    source: 'quota_check',
  })
  const messages: MessageParam[] = [{ role: 'user', content: 'quota' }]
  const betas = getModelBetas(model)
  
  return anthropic.beta.messages
    .create({
      model,
      max_tokens: 1,
      messages,
      metadata: getAPIMetadata(),
      ...(betas.length > 0 ? { betas } : {}),
    })
    .asResponse()
}

export async function checkQuotaStatus(): Promise<void> {
  
  if (isEssentialTrafficOnly()) {
    return
  }

  
  if (!shouldProcessRateLimits(isClaudeAISubscriber())) {
    return
  }

  
  
  
  if (getIsNonInteractiveSession()) {
    return
  }

  try {
    
    const raw = await makeTestQuery()

    
    extractQuotaStatusFromHeaders(raw.headers)
  } catch (error) {
    if (error instanceof APIError) {
      extractQuotaStatusFromError(error)
    }
  }
}

function getHeaderBasedEarlyWarning(
  headers: globalThis.Headers,
  unifiedRateLimitFallbackAvailable: boolean,
): ClaudeAILimits | null {
  
  for (const [claimAbbrev, rateLimitType] of Object.entries(
    EARLY_WARNING_CLAIM_MAP,
  )) {
    const surpassedThreshold = headers.get(
      `anthropic-ratelimit-unified-${claimAbbrev}-surpassed-threshold`,
    )

    
    if (surpassedThreshold !== null) {
      const utilizationHeader = headers.get(
        `anthropic-ratelimit-unified-${claimAbbrev}-utilization`,
      )
      const resetHeader = headers.get(
        `anthropic-ratelimit-unified-${claimAbbrev}-reset`,
      )

      const utilization = utilizationHeader
        ? Number(utilizationHeader)
        : undefined
      const resetsAt = resetHeader ? Number(resetHeader) : undefined

      return {
        status: 'allowed_warning',
        resetsAt,
        rateLimitType: rateLimitType as RateLimitType,
        utilization,
        unifiedRateLimitFallbackAvailable,
        isUsingOverage: false,
        surpassedThreshold: Number(surpassedThreshold),
      }
    }
  }

  return null
}

function getTimeRelativeEarlyWarning(
  headers: globalThis.Headers,
  config: EarlyWarningConfig,
  unifiedRateLimitFallbackAvailable: boolean,
): ClaudeAILimits | null {
  const { rateLimitType, claimAbbrev, windowSeconds, thresholds } = config

  const utilizationHeader = headers.get(
    `anthropic-ratelimit-unified-${claimAbbrev}-utilization`,
  )
  const resetHeader = headers.get(
    `anthropic-ratelimit-unified-${claimAbbrev}-reset`,
  )

  if (utilizationHeader === null || resetHeader === null) {
    return null
  }

  const utilization = Number(utilizationHeader)
  const resetsAt = Number(resetHeader)
  const timeProgress = computeTimeProgress(resetsAt, windowSeconds)

  
  const shouldWarn = thresholds.some(
    t => utilization >= t.utilization && timeProgress <= t.timePct,
  )

  if (!shouldWarn) {
    return null
  }

  return {
    status: 'allowed_warning',
    resetsAt,
    rateLimitType,
    utilization,
    unifiedRateLimitFallbackAvailable,
    isUsingOverage: false,
  }
}

function getEarlyWarningFromHeaders(
  headers: globalThis.Headers,
  unifiedRateLimitFallbackAvailable: boolean,
): ClaudeAILimits | null {
  
  const headerBasedWarning = getHeaderBasedEarlyWarning(
    headers,
    unifiedRateLimitFallbackAvailable,
  )
  if (headerBasedWarning) {
    return headerBasedWarning
  }

  
  
  for (const config of EARLY_WARNING_CONFIGS) {
    const timeRelativeWarning = getTimeRelativeEarlyWarning(
      headers,
      config,
      unifiedRateLimitFallbackAvailable,
    )
    if (timeRelativeWarning) {
      return timeRelativeWarning
    }
  }

  return null
}

function computeNewLimitsFromHeaders(
  headers: globalThis.Headers,
): ClaudeAILimits {
  const status =
    (headers.get('anthropic-ratelimit-unified-status') as QuotaStatus) ||
    'allowed'
  const resetsAtHeader = headers.get('anthropic-ratelimit-unified-reset')
  const resetsAt = resetsAtHeader ? Number(resetsAtHeader) : undefined
  const unifiedRateLimitFallbackAvailable =
    headers.get('anthropic-ratelimit-unified-fallback') === 'available'

  
  const rateLimitType = headers.get(
    'anthropic-ratelimit-unified-representative-claim',
  ) as RateLimitType | null
  const overageStatus = headers.get(
    'anthropic-ratelimit-unified-overage-status',
  ) as QuotaStatus | null
  const overageResetsAtHeader = headers.get(
    'anthropic-ratelimit-unified-overage-reset',
  )
  const overageResetsAt = overageResetsAtHeader
    ? Number(overageResetsAtHeader)
    : undefined

  
  const overageDisabledReason = headers.get(
    'anthropic-ratelimit-unified-overage-disabled-reason',
  ) as OverageDisabledReason | null

  
  const isUsingOverage =
    status === 'rejected' &&
    (overageStatus === 'allowed' || overageStatus === 'allowed_warning')

  
  
  let finalStatus: QuotaStatus = status
  if (status === 'allowed' || status === 'allowed_warning') {
    const earlyWarning = getEarlyWarningFromHeaders(
      headers,
      unifiedRateLimitFallbackAvailable,
    )
    if (earlyWarning) {
      return earlyWarning
    }
    
    finalStatus = 'allowed'
  }

  return {
    status: finalStatus,
    resetsAt,
    unifiedRateLimitFallbackAvailable,
    ...(rateLimitType && { rateLimitType }),
    ...(overageStatus && { overageStatus }),
    ...(overageResetsAt && { overageResetsAt }),
    ...(overageDisabledReason && { overageDisabledReason }),
    isUsingOverage,
  }
}

function cacheExtraUsageDisabledReason(headers: globalThis.Headers): void {
  
  const reason =
    headers.get('anthropic-ratelimit-unified-overage-disabled-reason') ?? null
  const cached = getGlobalConfig().cachedExtraUsageDisabledReason
  if (cached !== reason) {
    saveGlobalConfig(current => ({
      ...current,
      cachedExtraUsageDisabledReason: reason,
    }))
  }
}

export function extractQuotaStatusFromHeaders(
  headers: globalThis.Headers,
): void {
  
  const isSubscriber = isClaudeAISubscriber()

  if (!shouldProcessRateLimits(isSubscriber)) {
    
    rawUtilization = {}
    if (currentLimits.status !== 'allowed' || currentLimits.resetsAt) {
      const defaultLimits: ClaudeAILimits = {
        status: 'allowed',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      }
      emitStatusChange(defaultLimits)
    }
    return
  }

  
  const headersToUse = processRateLimitHeaders(headers)
  rawUtilization = extractRawUtilization(headersToUse)
  const newLimits = computeNewLimitsFromHeaders(headersToUse)

  
  cacheExtraUsageDisabledReason(headersToUse)

  if (!isEqual(currentLimits, newLimits)) {
    emitStatusChange(newLimits)
  }
}

export function extractQuotaStatusFromError(error: APIError): void {
  if (
    !shouldProcessRateLimits(isClaudeAISubscriber()) ||
    error.status !== 429
  ) {
    return
  }

  try {
    let newLimits = { ...currentLimits }
    if (error.headers) {
      
      const headersToUse = processRateLimitHeaders(error.headers)
      rawUtilization = extractRawUtilization(headersToUse)
      newLimits = computeNewLimitsFromHeaders(headersToUse)

      
      cacheExtraUsageDisabledReason(headersToUse)
    }
    
    newLimits.status = 'rejected'

    if (!isEqual(currentLimits, newLimits)) {
      emitStatusChange(newLimits)
    }
  } catch (e) {
    logError(e as Error)
  }
}
