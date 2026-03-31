import { feature } from "../utils/bundle-mock.ts"
import partition from 'lodash-es/partition.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { COORDINATOR_MODE_ALLOWED_TOOLS } from '../constants/tools.js'
import { isMcpTool } from '../services/mcp/utils.js'
import type { Tool, ToolPermissionContext, Tools } from '../Tool.js'

const PR_ACTIVITY_TOOL_SUFFIXES = [
  'subscribe_pr_activity',
  'unsubscribe_pr_activity',
]

export function isPrActivitySubscriptionTool(name: string): boolean {
  return PR_ACTIVITY_TOOL_SUFFIXES.some(suffix => name.endsWith(suffix))
}

const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js'))
  : null

export function applyCoordinatorToolFilter(tools: Tools): Tools {
  return tools.filter(
    t =>
      COORDINATOR_MODE_ALLOWED_TOOLS.has(t.name) ||
      isPrActivitySubscriptionTool(t.name),
  )
}

export function mergeAndFilterTools(
  initialTools: Tools,
  assembled: Tools,
  mode: ToolPermissionContext['mode'],
): Tools {
  
  
  
  
  
  const [mcp, builtIn] = partition(
    uniqBy([...initialTools, ...assembled], 'name'),
    isMcpTool,
  )
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  const tools = [...builtIn.sort(byName), ...mcp.sort(byName)]

  if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
    if (coordinatorModeModule.isCoordinatorMode()) {
      return applyCoordinatorToolFilter(tools)
    }
  }

  return tools
}
