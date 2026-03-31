

import { CLAUDE_AI_INFERENCE_SCOPE } from '../../constants/oauth.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
} from '../../utils/auth.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'

import {
  resetSyncCache as resetLeafCache,
  setEligibility,
} from './syncCacheState.js'

let cached: boolean | undefined

export function resetSyncCache(): void {
  cached = undefined
  resetLeafCache()
}

/**
 * Check if the current user is eligible for remote managed settings
 *
 * Eligibility:
 * - Console users (API key): All eligible (must have actual key, not just apiKeyHelper)
 * - OAuth users with known subscriptionType: Only Enterprise/C4E and Team
 * - OAuth users with subscriptionType === null (externally-injected tokens via
 *   CLAUDE_CODE_OAUTH_TOKEN / FD, or keychain tokens missing metadata): Eligible —
 *   the API returns empty settings for ineligible orgs, so the cost of a false
 *   positive is one round-trip
 *
 * This is a pre-check to determine if we should query the API.
 * The API will return empty settings for users without managed settings.
 *
 * IMPORTANT: This function must NOT call getSettings() or any function that calls
 * getSettings() to avoid circular dependencies during settings loading.
 */
export function isRemoteManagedSettingsEligible(): boolean {
  if (cached !== undefined) return cached

  
  if (getAPIProvider() !== 'firstParty') {
    return (cached = setEligibility(false))
  }

  // Custom base URL users should not hit the settings endpoint
  if (!isFirstPartyAnthropicBaseUrl()) {
    return (cached = setEligibility(false))
  }

  // Cowork runs in a VM with its own permission model; server-managed settings
  
  
  
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') {
    return (cached = setEligibility(false))
  }

  // Check OAuth first: most Claude.ai users have no API key in the keychain.
  
  
  
  const tokens = getClaudeAIOAuthTokens()

  
  
  
  
  
  
  
  if (tokens?.accessToken && tokens.subscriptionType === null) {
    return (cached = setEligibility(true))
  }

  if (
    tokens?.accessToken &&
    tokens.scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE) &&
    (tokens.subscriptionType === 'enterprise' ||
      tokens.subscriptionType === 'team')
  ) {
    return (cached = setEligibility(true))
  }

  // Console users (API key) are eligible if we can get the actual key
  
  
  
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return (cached = setEligibility(true))
    }
  } catch {
    // No API key available (e.g., CI/test environment)
  }

  return (cached = setEligibility(false))
}
