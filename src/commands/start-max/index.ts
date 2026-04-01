import type { Command } from '../../commands.js'
import { setMockSubscriptionType } from '../../services/mockRateLimits.js'

const startMaxCommand = {
  type: 'local-jsx',
  name: 'start-max',
  description: 'Activate Max subscription tier for full feature access',
  immediate: true,
  isEnabled: () => true,
  isHidden: false,
  load: () => import('./start-max.js'),
} satisfies Command

export default startMaxCommand
