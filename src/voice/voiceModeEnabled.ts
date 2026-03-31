import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getClaudeAIOAuthTokens,
  isAnthropicAuthEnabled,
} from '../utils/auth.js'

export function isVoiceGrowthBookEnabled(): boolean {
  // Positive ternary pattern — see docs/feature-gating.md.
  
  
  return feature('VOICE_MODE')
    ? !getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quartz_disabled', false)
    : false
}

/**
 * Auth-only check for voice mode. Returns true when the user has a valid
 * Anthropic OAuth token. Backed by the memoized getClaudeAIOAuthTokens —
 * first call spawns `security` on macOS (~20-50ms), subsequent calls are
 * cache hits. The memoize clears on token refresh (~once/hour), so one
 * cold spawn per refresh is expected. Cheap enough for usage-time checks.
 */
export function hasVoiceAuth(): boolean {
  // Voice mode requires Anthropic OAuth — it uses the voice_stream
  
  // Bedrock, Vertex, or Foundry.
  if (!isAnthropicAuthEnabled()) {
    return false
  }
  // isAnthropicAuthEnabled only checks the auth *provider*, not whether
  
  
  const tokens = getClaudeAIOAuthTokens()
  return Boolean(tokens?.accessToken)
}

/**
 * Full runtime check: auth + GrowthBook kill-switch. Callers: `/voice`
 * (voice.ts, voice/index.ts), ConfigTool, VoiceModeNotice — command-time
 * paths where a fresh keychain read is acceptable. For React render
 * paths use useVoiceEnabled() instead (memoizes the auth half).
 */
export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceGrowthBookEnabled()
}
