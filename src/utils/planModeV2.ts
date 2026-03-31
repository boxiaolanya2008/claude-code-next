import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getRateLimitTier, getSubscriptionType } from './auth.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export function getPlanModeV2AgentCount(): number {
  
  if (process.env.CLAUDE_CODE_NEXT_PLAN_V2_AGENT_COUNT) {
    const count = parseInt(process.env.CLAUDE_CODE_NEXT_PLAN_V2_AGENT_COUNT, 10)
    if (!isNaN(count) && count > 0 && count <= 10) {
      return count
    }
  }

  const subscriptionType = getSubscriptionType()
  const rateLimitTier = getRateLimitTier()

  if (
    subscriptionType === 'max' &&
    rateLimitTier === 'default_claude_max_20x'
  ) {
    return 3
  }

  if (subscriptionType === 'enterprise' || subscriptionType === 'team') {
    return 3
  }

  return 1
}

export function getPlanModeV2ExploreAgentCount(): number {
  if (process.env.CLAUDE_CODE_NEXT_PLAN_V2_EXPLORE_AGENT_COUNT) {
    const count = parseInt(
      process.env.CLAUDE_CODE_NEXT_PLAN_V2_EXPLORE_AGENT_COUNT,
      10,
    )
    if (!isNaN(count) && count > 0 && count <= 10) {
      return count
    }
  }

  return 3
}

export function isPlanModeInterviewPhaseEnabled(): boolean {
  
  if (process.env.USER_TYPE === 'ant') return true

  const env = process.env.CLAUDE_CODE_NEXT_PLAN_MODE_INTERVIEW_PHASE
  if (isEnvTruthy(env)) return true
  if (isEnvDefinedFalsy(env)) return false

  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_plan_mode_interview_phase',
    false,
  )
}

export type PewterLedgerVariant = 'trim' | 'cut' | 'cap' | null

export function getPewterLedgerVariant(): PewterLedgerVariant {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<string | null>(
    'tengu_pewter_ledger',
    null,
  )
  if (raw === 'trim' || raw === 'cut' || raw === 'cap') return raw
  return null
}
