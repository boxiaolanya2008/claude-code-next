import type { Command } from '../../commands.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

const thinkbackPlay = {
  type: 'local',
  name: 'thinkback-play',
  description: 'Play the thinkback animation',
  isEnabled: () =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_thinkback'),
  isHidden: true,
  supportsNonInteractive: false,
  load: () => import('./thinkback-play.js'),
} satisfies Command

export default thinkbackPlay
