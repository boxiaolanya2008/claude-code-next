import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'openai'

/**
 * Determine the API provider based on environment variables.
 * Priority: Bedrock > Vertex > Foundry > firstParty (Anthropic)
 */
export function getAPIProvider(): Exclude<APIProvider, 'openai'> {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

/**
 * Get the current LLM provider.
 * Simple logic: if OPENAI_API_KEY is set, use OpenAI; otherwise use Anthropic.
 */
export function getCurrentProvider(): 'anthropic' | 'openai' {
  // If OpenAI key is configured, use OpenAI
  if (process.env.OPENAI_API_KEY) {
    return 'openai'
  }
  // Otherwise use Anthropic (default)
  return 'anthropic'
}

/**
 * Check if currently using OpenAI provider.
 */
export function isUsingOpenAI(): boolean {
  return getCurrentProvider() === 'openai'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
