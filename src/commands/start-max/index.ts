import type { Command } from '../../commands.js'

const startMax = {
  type: 'local-jsx',
  name: 'start-max',
  description: 'Start max mode with optimized settings',
  load: () => import('./start-max.js'),
} satisfies Command

export default startMax
