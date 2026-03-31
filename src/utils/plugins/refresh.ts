

import { getOriginalCwd } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { reinitializeLspServerManager } from '../../services/lsp/manager.js'
import type { AppState } from '../../state/AppState.js'
import type { AgentDefinitionsResult } from '../../tools/AgentTool/loadAgentsDir.js'
import { getAgentDefinitionsWithOverrides } from '../../tools/AgentTool/loadAgentsDir.js'
import type { PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { clearAllCaches } from './cacheUtils.js'
import { getPluginCommands } from './loadPluginCommands.js'
import { loadPluginHooks } from './loadPluginHooks.js'
import { loadPluginLspServers } from './lspPluginIntegration.js'
import { loadPluginMcpServers } from './mcpPluginIntegration.js'
import { clearPluginCacheExclusions } from './orphanedPluginFilter.js'
import { loadAllPlugins } from './pluginLoader.js'

type SetAppState = (updater: (prev: AppState) => AppState) => void

export type RefreshActivePluginsResult = {
  enabled_count: number
  disabled_count: number
  command_count: number
  agent_count: number
  hook_count: number
  mcp_count: number
  

  lsp_count: number
  error_count: number
  

  agentDefinitions: AgentDefinitionsResult
  
  pluginCommands: Command[]
}

export async function refreshActivePlugins(
  setAppState: SetAppState,
): Promise<RefreshActivePluginsResult> {
  logForDebugging('refreshActivePlugins: clearing all plugin caches')
  clearAllCaches()
  
  
  clearPluginCacheExclusions()

  
  
  
  
  
  
  
  const pluginResult = await loadAllPlugins()
  const [pluginCommands, agentDefinitions] = await Promise.all([
    getPluginCommands(),
    getAgentDefinitionsWithOverrides(getOriginalCwd()),
  ])

  const { enabled, disabled, errors } = pluginResult

  
  
  
  
  
  
  const [mcpCounts, lspCounts] = await Promise.all([
    Promise.all(
      enabled.map(async p => {
        if (p.mcpServers) return Object.keys(p.mcpServers).length
        const servers = await loadPluginMcpServers(p, errors)
        if (servers) p.mcpServers = servers
        return servers ? Object.keys(servers).length : 0
      }),
    ),
    Promise.all(
      enabled.map(async p => {
        if (p.lspServers) return Object.keys(p.lspServers).length
        const servers = await loadPluginLspServers(p, errors)
        if (servers) p.lspServers = servers
        return servers ? Object.keys(servers).length : 0
      }),
    ),
  ])
  const mcp_count = mcpCounts.reduce((sum, n) => sum + n, 0)
  const lsp_count = lspCounts.reduce((sum, n) => sum + n, 0)

  setAppState(prev => ({
    ...prev,
    plugins: {
      ...prev.plugins,
      enabled,
      disabled,
      commands: pluginCommands,
      errors: mergePluginErrors(prev.plugins.errors, errors),
      needsRefresh: false,
    },
    agentDefinitions,
    mcp: {
      ...prev.mcp,
      pluginReconnectKey: prev.mcp.pluginReconnectKey + 1,
    },
  }))

  
  
  
  
  
  reinitializeLspServerManager()

  
  
  
  
  
  let hook_load_failed = false
  try {
    await loadPluginHooks()
  } catch (e) {
    hook_load_failed = true
    logError(e)
    logForDebugging(
      `refreshActivePlugins: loadPluginHooks failed: ${errorMessage(e)}`,
    )
  }

  const hook_count = enabled.reduce((sum, p) => {
    if (!p.hooksConfig) return sum
    return (
      sum +
      Object.values(p.hooksConfig).reduce(
        (s, matchers) =>
          s + (matchers?.reduce((h, m) => h + m.hooks.length, 0) ?? 0),
        0,
      )
    )
  }, 0)

  logForDebugging(
    `refreshActivePlugins: ${enabled.length} enabled, ${pluginCommands.length} commands, ${agentDefinitions.allAgents.length} agents, ${hook_count} hooks, ${mcp_count} MCP, ${lsp_count} LSP`,
  )

  return {
    enabled_count: enabled.length,
    disabled_count: disabled.length,
    command_count: pluginCommands.length,
    agent_count: agentDefinitions.allAgents.length,
    hook_count,
    mcp_count,
    lsp_count,
    error_count: errors.length + (hook_load_failed ? 1 : 0),
    agentDefinitions,
    pluginCommands,
  }
}

function mergePluginErrors(
  existing: PluginError[],
  fresh: PluginError[],
): PluginError[] {
  const preserved = existing.filter(
    e => e.source === 'lsp-manager' || e.source.startsWith('plugin:'),
  )
  const freshKeys = new Set(fresh.map(errorKey))
  const deduped = preserved.filter(e => !freshKeys.has(errorKey(e)))
  return [...deduped, ...fresh]
}

function errorKey(e: PluginError): string {
  return e.type === 'generic-error'
    ? `generic-error:${e.source}:${e.error}`
    : `${e.type}:${e.source}`
}
