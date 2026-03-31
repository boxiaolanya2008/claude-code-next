import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvTruthy } from './envUtils.js'

function isAgentTeamsFlagSet(): boolean {
  return process.argv.includes('--agent-teams')
}

export function isAgentSwarmsEnabled(): boolean {
  
  if (process.env.USER_TYPE === 'ant') {
    return true
  }

  
  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_NEXT_EXPERIMENTAL_AGENT_TEAMS) &&
    !isAgentTeamsFlagSet()
  ) {
    return false
  }

  
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_flint', true)) {
    return false
  }

  return true
}
