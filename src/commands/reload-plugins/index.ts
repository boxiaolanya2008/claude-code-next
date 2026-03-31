

import type { Command } from '../../commands.js'

const reloadPlugins = {
  type: 'local',
  name: 'reload-plugins',
  description: 'Activate pending plugin changes in the current session',
  
  
  
  supportsNonInteractive: false,
  load: () => import('./reload-plugins.js'),
} satisfies Command

export default reloadPlugins
