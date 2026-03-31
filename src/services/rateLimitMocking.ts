

import { APIError } from '@anthropic-ai/sdk'
import {
  applyMockHeaders,
  checkMockFastModeRateLimit,
  getMockHeaderless429Message,
  getMockHeaders,
  isMockFastModeRateLimitScenario,
  shouldProcessMockLimits,
} from './mockRateLimits.js'

export function processRateLimitHeaders(
  headers: globalThis.Headers,
): globalThis.Headers {
  
  if (shouldProcessMockLimits()) {
    return applyMockHeaders(headers)
  }
  return headers
}

export function shouldProcessRateLimits(isSubscriber: boolean): boolean {
  return isSubscriber || shouldProcessMockLimits()
}

export function checkMockRateLimitError(
  currentModel: string,
  isFastModeActive?: boolean,
): APIError | null {
  if (!shouldProcessMockLimits()) {
    return null
  }

  const headerlessMessage = getMockHeaderless429Message()
  if (headerlessMessage) {
    return new APIError(
      429,
      { error: { type: 'rate_limit_error', message: headerlessMessage } },
      headerlessMessage,
      
      new globalThis.Headers(),
    )
  }

  const mockHeaders = getMockHeaders()
  if (!mockHeaders) {
    return null
  }

  
  
  
  
  
  const status = mockHeaders['anthropic-ratelimit-unified-status']
  const overageStatus =
    mockHeaders['anthropic-ratelimit-unified-overage-status']
  const rateLimitType =
    mockHeaders['anthropic-ratelimit-unified-representative-claim']

  
  const isOpusLimit = rateLimitType === 'seven_day_opus'

  
  const isUsingOpus = currentModel.includes('opus')

  
  
  if (isOpusLimit && !isUsingOpus) {
    return null
  }

  
  if (isMockFastModeRateLimitScenario()) {
    const fastModeHeaders = checkMockFastModeRateLimit(isFastModeActive)
    if (fastModeHeaders === null) {
      return null
    }
    
    const error = new APIError(
      429,
      { error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
      'Rate limit exceeded',
      
      new globalThis.Headers(
        Object.entries(fastModeHeaders).filter(([_, v]) => v !== undefined) as [
          string,
          string,
        ][],
      ),
    )
    return error
  }

  const shouldThrow429 =
    status === 'rejected' && (!overageStatus || overageStatus === 'rejected')

  if (shouldThrow429) {
    
    const error = new APIError(
      429,
      { error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } },
      'Rate limit exceeded',
      
      new globalThis.Headers(
        Object.entries(mockHeaders).filter(([_, v]) => v !== undefined) as [
          string,
          string,
        ][],
      ),
    )
    return error
  }

  return null
}

export function isMockRateLimitError(error: APIError): boolean {
  return shouldProcessMockLimits() && error.status === 429
}

export { shouldProcessMockLimits }
