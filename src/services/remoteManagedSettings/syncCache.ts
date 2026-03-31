

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

export function isRemoteManagedSettingsEligible(): boolean {
  if (cached !== undefined) return cached

  
  if (getAPIProvider() !== 'firstParty') {
    return (cached = setEligibility(false))
  }

  
  if (!isFirstPartyAnthropicBaseUrl()) {
    return (cached = setEligibility(false))
  }

  
  
  
  
  if (process.env.CLAUDE_CODE_NEXT_ENTRYPOINT === 'local-agent') {
    return (cached = setEligibility(false))
  }

  
  
  
  
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

  
  
  
  
  try {
    const { key: apiKey } = getAnthropicApiKeyWithSource({
      skipRetrievingKeyFromApiKeyHelper: true,
    })
    if (apiKey) {
      return (cached = setEligibility(true))
    }
  } catch {
    
  }

  return (cached = setEligibility(false))
}
