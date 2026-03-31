import { feature } from "../utils/bundle-mock.ts"
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getClaudeAIOAuthTokens,
  isAnthropicAuthEnabled,
} from '../utils/auth.js'

export function isVoiceGrowthBookEnabled(): boolean {
  
  
  
  return feature('VOICE_MODE')
    ? !getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quartz_disabled', false)
    : false
}

export function hasVoiceAuth(): boolean {
  
  
  
  if (!isAnthropicAuthEnabled()) {
    return false
  }
  
  
  
  const tokens = getClaudeAIOAuthTokens()
  return Boolean(tokens?.accessToken)
}

export function isVoiceModeEnabled(): boolean {
  return hasVoiceAuth() && isVoiceGrowthBookEnabled()
}
