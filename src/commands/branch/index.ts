import { feature } from "../../utils/bundle-mock.ts"
import type { Command } from '../../commands.js'

const branch = {
  type: 'local-jsx',
  name: 'branch',
  
  aliases: feature('FORK_SUBAGENT') ? [] : ['fork'],
  description: 'Create a branch of the current conversation at this point',
  argumentHint: '[name]',
  load: () => import('./branch.js'),
} satisfies Command

export default branch
