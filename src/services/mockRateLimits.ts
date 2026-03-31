

import type { SubscriptionType } from '../services/oauth/types.js'
import { setMockBillingAccessOverride } from '../utils/billing.js'
import type { OverageDisabledReason } from './claudeAiLimits.js'

type MockHeaders = {
  'anthropic-ratelimit-unified-status'?:
    | 'allowed'
    | 'allowed_warning'
    | 'rejected'
  'anthropic-ratelimit-unified-reset'?: string
  'anthropic-ratelimit-unified-representative-claim'?:
    | 'five_hour'
    | 'seven_day'
    | 'seven_day_opus'
    | 'seven_day_sonnet'
  'anthropic-ratelimit-unified-overage-status'?:
    | 'allowed'
    | 'allowed_warning'
    | 'rejected'
  'anthropic-ratelimit-unified-overage-reset'?: string
  'anthropic-ratelimit-unified-overage-disabled-reason'?: OverageDisabledReason
  'anthropic-ratelimit-unified-fallback'?: 'available'
  'anthropic-ratelimit-unified-fallback-percentage'?: string
  'retry-after'?: string
  
  'anthropic-ratelimit-unified-5h-utilization'?: string
  'anthropic-ratelimit-unified-5h-reset'?: string
  'anthropic-ratelimit-unified-5h-surpassed-threshold'?: string
  'anthropic-ratelimit-unified-7d-utilization'?: string
  'anthropic-ratelimit-unified-7d-reset'?: string
  'anthropic-ratelimit-unified-7d-surpassed-threshold'?: string
  'anthropic-ratelimit-unified-overage-utilization'?: string
  'anthropic-ratelimit-unified-overage-surpassed-threshold'?: string
}

export type MockHeaderKey =
  | 'status'
  | 'reset'
  | 'claim'
  | 'overage-status'
  | 'overage-reset'
  | 'overage-disabled-reason'
  | 'fallback'
  | 'fallback-percentage'
  | 'retry-after'
  | '5h-utilization'
  | '5h-reset'
  | '5h-surpassed-threshold'
  | '7d-utilization'
  | '7d-reset'
  | '7d-surpassed-threshold'

export type MockScenario =
  | 'normal'
  | 'session-limit-reached'
  | 'approaching-weekly-limit'
  | 'weekly-limit-reached'
  | 'overage-active'
  | 'overage-warning'
  | 'overage-exhausted'
  | 'out-of-credits'
  | 'org-zero-credit-limit'
  | 'org-spend-cap-hit'
  | 'member-zero-credit-limit'
  | 'seat-tier-zero-credit-limit'
  | 'opus-limit'
  | 'opus-warning'
  | 'sonnet-limit'
  | 'sonnet-warning'
  | 'fast-mode-limit'
  | 'fast-mode-short-limit'
  | 'extra-usage-required'
  | 'clear'

let mockHeaders: MockHeaders = {}
let mockEnabled = false
let mockHeaderless429Message: string | null = null
let mockSubscriptionType: SubscriptionType | null = null
let mockFastModeRateLimitDurationMs: number | null = null
let mockFastModeRateLimitExpiresAt: number | null = null

const DEFAULT_MOCK_SUBSCRIPTION: SubscriptionType = 'max'

type ExceededLimit = {
  type: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
  resetsAt: number 
}

let exceededLimits: ExceededLimit[] = []

export function setMockHeader(
  key: MockHeaderKey,
  value: string | undefined,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  mockEnabled = true

  
  const fullKey = (
    key === 'retry-after' ? 'retry-after' : `anthropic-ratelimit-unified-${key}`
  ) as keyof MockHeaders

  if (value === undefined || value === 'clear') {
    delete mockHeaders[fullKey]
    if (key === 'claim') {
      exceededLimits = []
    }
    
    if (key === 'status' || key === 'overage-status') {
      updateRetryAfter()
    }
    return
  } else {
    
    if (key === 'reset' || key === 'overage-reset') {
      
      const hours = Number(value)
      if (!isNaN(hours)) {
        value = String(Math.floor(Date.now() / 1000) + hours * 3600)
      }
    }

    
    if (key === 'claim') {
      const validClaims = [
        'five_hour',
        'seven_day',
        'seven_day_opus',
        'seven_day_sonnet',
      ]
      if (validClaims.includes(value)) {
        
        let resetsAt: number
        if (value === 'five_hour') {
          resetsAt = Math.floor(Date.now() / 1000) + 5 * 3600
        } else if (
          value === 'seven_day' ||
          value === 'seven_day_opus' ||
          value === 'seven_day_sonnet'
        ) {
          resetsAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
        } else {
          resetsAt = Math.floor(Date.now() / 1000) + 3600
        }

        
        exceededLimits = exceededLimits.filter(l => l.type !== value)
        exceededLimits.push({ type: value as ExceededLimit['type'], resetsAt })

        
        updateRepresentativeClaim()
        return
      }
    }
    
    
    
    const headers: Partial<Record<keyof MockHeaders, string>> = mockHeaders
    headers[fullKey] = value

    
    if (key === 'status' || key === 'overage-status') {
      updateRetryAfter()
    }
  }

  
  if (Object.keys(mockHeaders).length === 0) {
    mockEnabled = false
  }
}

function updateRetryAfter(): void {
  const status = mockHeaders['anthropic-ratelimit-unified-status']
  const overageStatus =
    mockHeaders['anthropic-ratelimit-unified-overage-status']
  const reset = mockHeaders['anthropic-ratelimit-unified-reset']

  if (
    status === 'rejected' &&
    (!overageStatus || overageStatus === 'rejected') &&
    reset
  ) {
    
    const resetTimestamp = Number(reset)
    const secondsUntilReset = Math.max(
      0,
      resetTimestamp - Math.floor(Date.now() / 1000),
    )
    mockHeaders['retry-after'] = String(secondsUntilReset)
  } else {
    delete mockHeaders['retry-after']
  }
}

function updateRepresentativeClaim(): void {
  if (exceededLimits.length === 0) {
    delete mockHeaders['anthropic-ratelimit-unified-representative-claim']
    delete mockHeaders['anthropic-ratelimit-unified-reset']
    delete mockHeaders['retry-after']
    return
  }

  
  const furthest = exceededLimits.reduce((prev, curr) =>
    curr.resetsAt > prev.resetsAt ? curr : prev,
  )

  
  mockHeaders['anthropic-ratelimit-unified-representative-claim'] =
    furthest.type
  mockHeaders['anthropic-ratelimit-unified-reset'] = String(furthest.resetsAt)

  
  if (mockHeaders['anthropic-ratelimit-unified-status'] === 'rejected') {
    const overageStatus =
      mockHeaders['anthropic-ratelimit-unified-overage-status']
    if (!overageStatus || overageStatus === 'rejected') {
      
      const secondsUntilReset = Math.max(
        0,
        furthest.resetsAt - Math.floor(Date.now() / 1000),
      )
      mockHeaders['retry-after'] = String(secondsUntilReset)
    } else {
      
      delete mockHeaders['retry-after']
    }
  } else {
    delete mockHeaders['retry-after']
  }
}

export function addExceededLimit(
  type: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet',
  hoursFromNow: number,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  mockEnabled = true
  const resetsAt = Math.floor(Date.now() / 1000) + hoursFromNow * 3600

  
  exceededLimits = exceededLimits.filter(l => l.type !== type)
  exceededLimits.push({ type, resetsAt })

  
  if (exceededLimits.length > 0) {
    mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
  }

  updateRepresentativeClaim()
}

export function setMockEarlyWarning(
  claimAbbrev: '5h' | '7d' | 'overage',
  utilization: number,
  hoursFromNow?: number,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  mockEnabled = true

  
  
  clearMockEarlyWarning()

  
  const defaultHours = claimAbbrev === '5h' ? 4 : 5 * 24
  const hours = hoursFromNow ?? defaultHours
  const resetsAt = Math.floor(Date.now() / 1000) + hours * 3600

  mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-utilization`] =
    String(utilization)
  mockHeaders[`anthropic-ratelimit-unified-${claimAbbrev}-reset`] =
    String(resetsAt)
  
  mockHeaders[
    `anthropic-ratelimit-unified-${claimAbbrev}-surpassed-threshold`
  ] = String(utilization)

  
  if (!mockHeaders['anthropic-ratelimit-unified-status']) {
    mockHeaders['anthropic-ratelimit-unified-status'] = 'allowed'
  }
}

export function clearMockEarlyWarning(): void {
  delete mockHeaders['anthropic-ratelimit-unified-5h-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-5h-reset']
  delete mockHeaders['anthropic-ratelimit-unified-5h-surpassed-threshold']
  delete mockHeaders['anthropic-ratelimit-unified-7d-utilization']
  delete mockHeaders['anthropic-ratelimit-unified-7d-reset']
  delete mockHeaders['anthropic-ratelimit-unified-7d-surpassed-threshold']
}

export function setMockRateLimitScenario(scenario: MockScenario): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  if (scenario === 'clear') {
    mockHeaders = {}
    mockHeaderless429Message = null
    mockEnabled = false
    return
  }

  mockEnabled = true

  
  const fiveHoursFromNow = Math.floor(Date.now() / 1000) + 5 * 3600
  const sevenDaysFromNow = Math.floor(Date.now() / 1000) + 7 * 24 * 3600

  
  mockHeaders = {}
  mockHeaderless429Message = null

  
  
  const preserveExceededLimits = [
    'overage-active',
    'overage-warning',
    'overage-exhausted',
  ].includes(scenario)
  if (!preserveExceededLimits) {
    exceededLimits = []
  }

  switch (scenario) {
    case 'normal':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-reset': String(fiveHoursFromNow),
      }
      break

    case 'session-limit-reached':
      exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break

    case 'approaching-weekly-limit':
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day',
      }
      break

    case 'weekly-limit-reached':
      exceededLimits = [{ type: 'seven_day', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break

    case 'overage-active': {
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'allowed'
      
      const endOfMonthActive = new Date()
      endOfMonthActive.setMonth(endOfMonthActive.getMonth() + 1, 1)
      endOfMonthActive.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthActive.getTime() / 1000),
      )
      break
    }

    case 'overage-warning': {
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] =
        'allowed_warning'
      
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000),
      )
      break
    }

    case 'overage-exhausted': {
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      
      
      const endOfMonthExhausted = new Date()
      endOfMonthExhausted.setMonth(endOfMonthExhausted.getMonth() + 1, 1)
      endOfMonthExhausted.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthExhausted.getTime() / 1000),
      )
      break
    }

    case 'out-of-credits': {
      
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'out_of_credits'
      const endOfMonth = new Date()
      endOfMonth.setMonth(endOfMonth.getMonth() + 1, 1)
      endOfMonth.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonth.getTime() / 1000),
      )
      break
    }

    case 'org-zero-credit-limit': {
      
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'org_service_zero_credit_limit'
      const endOfMonthZero = new Date()
      endOfMonthZero.setMonth(endOfMonthZero.getMonth() + 1, 1)
      endOfMonthZero.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthZero.getTime() / 1000),
      )
      break
    }

    case 'org-spend-cap-hit': {
      
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'org_level_disabled_until'
      const endOfMonthHit = new Date()
      endOfMonthHit.setMonth(endOfMonthHit.getMonth() + 1, 1)
      endOfMonthHit.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthHit.getTime() / 1000),
      )
      break
    }

    case 'member-zero-credit-limit': {
      
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'member_zero_credit_limit'
      const endOfMonthMember = new Date()
      endOfMonthMember.setMonth(endOfMonthMember.getMonth() + 1, 1)
      endOfMonthMember.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthMember.getTime() / 1000),
      )
      break
    }

    case 'seat-tier-zero-credit-limit': {
      
      
      if (exceededLimits.length === 0) {
        exceededLimits = [{ type: 'five_hour', resetsAt: fiveHoursFromNow }]
      }
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-status'] = 'rejected'
      mockHeaders['anthropic-ratelimit-unified-overage-disabled-reason'] =
        'seat_tier_zero_credit_limit'
      const endOfMonthSeatTier = new Date()
      endOfMonthSeatTier.setMonth(endOfMonthSeatTier.getMonth() + 1, 1)
      endOfMonthSeatTier.setHours(0, 0, 0, 0)
      mockHeaders['anthropic-ratelimit-unified-overage-reset'] = String(
        Math.floor(endOfMonthSeatTier.getTime() / 1000),
      )
      break
    }

    case 'opus-limit': {
      exceededLimits = [{ type: 'seven_day_opus', resetsAt: sevenDaysFromNow }]
      updateRepresentativeClaim()
      
      
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    }

    case 'opus-warning': {
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_opus',
      }
      break
    }

    case 'sonnet-limit': {
      exceededLimits = [
        { type: 'seven_day_sonnet', resetsAt: sevenDaysFromNow },
      ]
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      break
    }

    case 'sonnet-warning': {
      mockHeaders = {
        'anthropic-ratelimit-unified-status': 'allowed_warning',
        'anthropic-ratelimit-unified-reset': String(sevenDaysFromNow),
        'anthropic-ratelimit-unified-representative-claim': 'seven_day_sonnet',
      }
      break
    }

    case 'fast-mode-limit': {
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      
      mockFastModeRateLimitDurationMs = 10 * 60 * 1000
      break
    }

    case 'fast-mode-short-limit': {
      updateRepresentativeClaim()
      mockHeaders['anthropic-ratelimit-unified-status'] = 'rejected'
      
      mockFastModeRateLimitDurationMs = 10 * 1000
      break
    }

    case 'extra-usage-required': {
      
      mockHeaderless429Message =
        'Extra usage is required for long context requests.'
      break
    }

    default:
      break
  }
}

export function getMockHeaderless429Message(): string | null {
  if (process.env.USER_TYPE !== 'ant') {
    return null
  }
  
  if (process.env.CLAUDE_MOCK_HEADERLESS_429) {
    return process.env.CLAUDE_MOCK_HEADERLESS_429
  }
  if (!mockEnabled) {
    return null
  }
  return mockHeaderless429Message
}

export function getMockHeaders(): MockHeaders | null {
  if (
    !mockEnabled ||
    process.env.USER_TYPE !== 'ant' ||
    Object.keys(mockHeaders).length === 0
  ) {
    return null
  }
  return mockHeaders
}

export function getMockStatus(): string {
  if (
    !mockEnabled ||
    (Object.keys(mockHeaders).length === 0 && !mockSubscriptionType)
  ) {
    return 'No mock headers active (using real limits)'
  }

  const lines: string[] = []
  lines.push('Active mock headers:')

  
  const effectiveSubscription =
    mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
  if (mockSubscriptionType) {
    lines.push(`  Subscription Type: ${mockSubscriptionType} (explicitly set)`)
  } else {
    lines.push(`  Subscription Type: ${effectiveSubscription} (default)`)
  }

  Object.entries(mockHeaders).forEach(([key, value]) => {
    if (value !== undefined) {
      
      const formattedKey = key
        .replace('anthropic-ratelimit-unified-', '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())

      
      if (key.includes('reset') && value) {
        const timestamp = Number(value)
        const date = new Date(timestamp * 1000)
        lines.push(`  ${formattedKey}: ${value} (${date.toLocaleString()})`)
      } else {
        lines.push(`  ${formattedKey}: ${value}`)
      }
    }
  })

  
  if (exceededLimits.length > 0) {
    lines.push('\nExceeded limits (contributing to representative claim):')
    exceededLimits.forEach(limit => {
      const date = new Date(limit.resetsAt * 1000)
      lines.push(`  ${limit.type}: resets at ${date.toLocaleString()}`)
    })
  }

  return lines.join('\n')
}

export function clearMockHeaders(): void {
  mockHeaders = {}
  exceededLimits = []
  mockSubscriptionType = null
  mockFastModeRateLimitDurationMs = null
  mockFastModeRateLimitExpiresAt = null
  mockHeaderless429Message = null
  setMockBillingAccessOverride(null)
  mockEnabled = false
}

export function applyMockHeaders(
  headers: globalThis.Headers,
): globalThis.Headers {
  const mock = getMockHeaders()
  if (!mock) {
    return headers
  }

  
  
  const newHeaders = new globalThis.Headers(headers)

  
  Object.entries(mock).forEach(([key, value]) => {
    if (value !== undefined) {
      newHeaders.set(key, value)
    }
  })

  return newHeaders
}

export function shouldProcessMockLimits(): boolean {
  if (process.env.USER_TYPE !== 'ant') {
    return false
  }
  return mockEnabled || Boolean(process.env.CLAUDE_MOCK_HEADERLESS_429)
}

export function getCurrentMockScenario(): MockScenario | null {
  if (!mockEnabled) {
    return null
  }

  
  if (!mockHeaders) return null

  const status = mockHeaders['anthropic-ratelimit-unified-status']
  const overage = mockHeaders['anthropic-ratelimit-unified-overage-status']
  const claim = mockHeaders['anthropic-ratelimit-unified-representative-claim']

  if (claim === 'seven_day_opus') {
    return status === 'rejected' ? 'opus-limit' : 'opus-warning'
  }

  if (claim === 'seven_day_sonnet') {
    return status === 'rejected' ? 'sonnet-limit' : 'sonnet-warning'
  }

  if (overage === 'rejected') return 'overage-exhausted'
  if (overage === 'allowed_warning') return 'overage-warning'
  if (overage === 'allowed') return 'overage-active'

  if (status === 'rejected') {
    if (claim === 'five_hour') return 'session-limit-reached'
    if (claim === 'seven_day') return 'weekly-limit-reached'
  }

  if (status === 'allowed_warning') {
    if (claim === 'seven_day') return 'approaching-weekly-limit'
  }

  if (status === 'allowed') return 'normal'

  return null
}

export function getScenarioDescription(scenario: MockScenario): string {
  switch (scenario) {
    case 'normal':
      return 'Normal usage, no limits'
    case 'session-limit-reached':
      return 'Session rate limit exceeded'
    case 'approaching-weekly-limit':
      return 'Approaching weekly aggregate limit'
    case 'weekly-limit-reached':
      return 'Weekly aggregate limit exceeded'
    case 'overage-active':
      return 'Using extra usage (overage active)'
    case 'overage-warning':
      return 'Approaching extra usage limit'
    case 'overage-exhausted':
      return 'Both subscription and extra usage limits exhausted'
    case 'out-of-credits':
      return 'Out of extra usage credits (wallet empty)'
    case 'org-zero-credit-limit':
      return 'Org spend cap is zero (no extra usage budget)'
    case 'org-spend-cap-hit':
      return 'Org spend cap hit for the month'
    case 'member-zero-credit-limit':
      return 'Member limit is zero (admin can allocate more)'
    case 'seat-tier-zero-credit-limit':
      return 'Seat tier limit is zero (admin can allocate more)'
    case 'opus-limit':
      return 'Opus limit reached'
    case 'opus-warning':
      return 'Approaching Opus limit'
    case 'sonnet-limit':
      return 'Sonnet limit reached'
    case 'sonnet-warning':
      return 'Approaching Sonnet limit'
    case 'fast-mode-limit':
      return 'Fast mode rate limit'
    case 'fast-mode-short-limit':
      return 'Fast mode rate limit (short)'
    case 'extra-usage-required':
      return 'Headerless 429: Extra usage required for 1M context'
    case 'clear':
      return 'Clear mock headers (use real limits)'
    default:
      return 'Unknown scenario'
  }
}

export function setMockSubscriptionType(
  subscriptionType: SubscriptionType | null,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }
  mockEnabled = true
  mockSubscriptionType = subscriptionType
}

export function getMockSubscriptionType(): SubscriptionType | null {
  if (!mockEnabled || process.env.USER_TYPE !== 'ant') {
    return null
  }
  
  return mockSubscriptionType || DEFAULT_MOCK_SUBSCRIPTION
}

export function shouldUseMockSubscription(): boolean {
  return (
    mockEnabled &&
    mockSubscriptionType !== null &&
    process.env.USER_TYPE === 'ant'
  )
}

export function setMockBillingAccess(hasAccess: boolean | null): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }
  mockEnabled = true
  setMockBillingAccessOverride(hasAccess)
}

export function isMockFastModeRateLimitScenario(): boolean {
  return mockFastModeRateLimitDurationMs !== null
}

export function checkMockFastModeRateLimit(
  isFastModeActive?: boolean,
): MockHeaders | null {
  if (mockFastModeRateLimitDurationMs === null) {
    return null
  }

  
  if (!isFastModeActive) {
    return null
  }

  
  if (
    mockFastModeRateLimitExpiresAt !== null &&
    Date.now() >= mockFastModeRateLimitExpiresAt
  ) {
    clearMockHeaders()
    return null
  }

  
  if (mockFastModeRateLimitExpiresAt === null) {
    mockFastModeRateLimitExpiresAt =
      Date.now() + mockFastModeRateLimitDurationMs
  }

  
  const remainingMs = mockFastModeRateLimitExpiresAt - Date.now()
  const headersToSend = { ...mockHeaders }
  headersToSend['retry-after'] = String(
    Math.max(1, Math.ceil(remainingMs / 1000)),
  )

  return headersToSend
}
