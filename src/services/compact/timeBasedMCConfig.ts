import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

export type TimeBasedMCConfig = {
  
  enabled: boolean
  

  gapThresholdMinutes: number
  

  keepRecent: number
}

const TIME_BASED_MC_CONFIG_DEFAULTS: TimeBasedMCConfig = {
  enabled: false,
  gapThresholdMinutes: 60,
  keepRecent: 5,
}

export function getTimeBasedMCConfig(): TimeBasedMCConfig {
  
  
  return getFeatureValue_CACHED_MAY_BE_STALE<TimeBasedMCConfig>(
    'tengu_slate_heron',
    TIME_BASED_MC_CONFIG_DEFAULTS,
  )
}
