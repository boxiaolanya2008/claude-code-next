import type { OverageDisabledReason } from 'src/services/claudeAiLimits.js'
import { isClaudeAISubscriber } from '../auth.js'
import { getGlobalConfig } from '../config.js'
import { is1mContextDisabled } from '../context.js'

function isExtraUsageEnabled(): boolean {
  const reason = getGlobalConfig().cachedExtraUsageDisabledReason
  
  if (reason === undefined) {
    return false
  }
  
  if (reason === null) {
    return true
  }
  
  switch (reason as OverageDisabledReason) {
    
    case 'out_of_credits':
      return true
    
    case 'overage_not_provisioned':
    case 'org_level_disabled':
    case 'org_level_disabled_until':
    case 'seat_tier_level_disabled':
    case 'member_level_disabled':
    case 'seat_tier_zero_credit_limit':
    case 'group_zero_credit_limit':
    case 'member_zero_credit_limit':
    case 'org_service_level_disabled':
    case 'org_service_zero_credit_limit':
    case 'no_limits_configured':
    case 'unknown':
      return false
    default:
      return false
  }
}

export function checkOpus1mAccess(): boolean {
  if (is1mContextDisabled()) {
    return false
  }

  if (isClaudeAISubscriber()) {
    
    return isExtraUsageEnabled()
  }

  
  return true
}

export function checkSonnet1mAccess(): boolean {
  if (is1mContextDisabled()) {
    return false
  }

  if (isClaudeAISubscriber()) {
    
    return isExtraUsageEnabled()
  }

  
  return true
}
