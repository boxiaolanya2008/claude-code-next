import { join } from 'path'
import { expandEnvVarsInString } from '../../services/mcp/envExpansion.js'
import {
  type McpServerConfig,
  McpServerConfigSchema,
  type ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { errorMessage, isENOENT } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { jsonParse } from '../slowOperations.js'
import {
  isMcpbSource,
  loadMcpbFile,
  loadMcpServerUserConfig,
  type McpbLoadResult,
  type UserConfigSchema,
  type UserConfigValues,
  validateUserConfig,
} from './mcpbHandler.js'
import { getPluginDataDir } from './pluginDirectories.js'
import {
  getPluginStorageId,
  loadPluginOptions,
  substitutePluginVariables,
  substituteUserConfigVariables,
} from './pluginOptionsStorage.js'

async function loadMcpServersFromMcpb(
  plugin: LoadedPlugin,
  mcpbPath: string,
  errors: PluginError[],
): Promise<Record<string, McpServerConfig> | null> {
  try {
    logForDebugging(`Loading MCP servers from MCPB: ${mcpbPath}`)

    
    const pluginId = plugin.repository

    const result = await loadMcpbFile(
      mcpbPath,
      plugin.path,
      pluginId,
      status => {
        logForDebugging(`MCPB [${plugin.name}]: ${status}`)
      },
    )

    
    if ('status' in result && result.status === 'needs-config') {
      
      
      logForDebugging(
        `MCPB ${mcpbPath} requires user configuration. ` +
          `User can configure via: /plugin → Manage plugins → ${plugin.name} → Configure`,
      )
      
      return null
    }

    
    const successResult = result as McpbLoadResult

    
    const serverName = successResult.manifest.name

    
    
    logForDebugging(
      `Loaded MCP server "${serverName}" from MCPB (extracted to ${successResult.extractedPath})`,
    )

    return { [serverName]: successResult.mcpConfig }
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Failed to load MCPB ${mcpbPath}: ${errorMsg}`, {
      level: 'error',
    })

    
    const source = `${plugin.name}@${plugin.repository}`

    
    const isUrl = mcpbPath.startsWith('http')
    if (
      isUrl &&
      (errorMsg.includes('download') || errorMsg.includes('network'))
    ) {
      errors.push({
        type: 'mcpb-download-failed',
        source,
        plugin: plugin.name,
        url: mcpbPath,
        reason: errorMsg,
      })
    } else if (
      errorMsg.includes('manifest') ||
      errorMsg.includes('user configuration')
    ) {
      errors.push({
        type: 'mcpb-invalid-manifest',
        source,
        plugin: plugin.name,
        mcpbPath,
        validationError: errorMsg,
      })
    } else {
      errors.push({
        type: 'mcpb-extract-failed',
        source,
        plugin: plugin.name,
        mcpbPath,
        reason: errorMsg,
      })
    }

    return null
  }
}

export async function loadPluginMcpServers(
  plugin: LoadedPlugin,
  errors: PluginError[] = [],
): Promise<Record<string, McpServerConfig> | undefined> {
  let servers: Record<string, McpServerConfig> = {}

  
  const defaultMcpServers = await loadMcpServersFromFile(
    plugin.path,
    '.mcp.json',
  )
  if (defaultMcpServers) {
    servers = { ...servers, ...defaultMcpServers }
  }

  
  if (plugin.manifest.mcpServers) {
    const mcpServersSpec = plugin.manifest.mcpServers

    
    if (typeof mcpServersSpec === 'string') {
      
      if (isMcpbSource(mcpServersSpec)) {
        const mcpbServers = await loadMcpServersFromMcpb(
          plugin,
          mcpServersSpec,
          errors,
        )
        if (mcpbServers) {
          servers = { ...servers, ...mcpbServers }
        }
      } else {
        
        const mcpServers = await loadMcpServersFromFile(
          plugin.path,
          mcpServersSpec,
        )
        if (mcpServers) {
          servers = { ...servers, ...mcpServers }
        }
      }
    } else if (Array.isArray(mcpServersSpec)) {
      
      
      
      const results = await Promise.all(
        mcpServersSpec.map(async spec => {
          try {
            if (typeof spec === 'string') {
              
              if (isMcpbSource(spec)) {
                return await loadMcpServersFromMcpb(plugin, spec, errors)
              }
              
              return await loadMcpServersFromFile(plugin.path, spec)
            }
            
            return spec
          } catch (e) {
            
            
            logForDebugging(
              `Failed to load MCP servers from spec for plugin ${plugin.name}: ${e}`,
              { level: 'error' },
            )
            return null
          }
        }),
      )
      for (const result of results) {
        if (result) {
          servers = { ...servers, ...result }
        }
      }
    } else {
      
      servers = { ...servers, ...mcpServersSpec }
    }
  }

  return Object.keys(servers).length > 0 ? servers : undefined
}

async function loadMcpServersFromFile(
  pluginPath: string,
  relativePath: string,
): Promise<Record<string, McpServerConfig> | null> {
  const fs = getFsImplementation()
  const filePath = join(pluginPath, relativePath)

  let content: string
  try {
    content = await fs.readFile(filePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    if (isENOENT(e)) {
      return null
    }
    logForDebugging(`Failed to load MCP servers from ${filePath}: ${e}`, {
      level: 'error',
    })
    return null
  }

  try {
    const parsed = jsonParse(content)

    
    const mcpServers = parsed.mcpServers || parsed

    
    const validatedServers: Record<string, McpServerConfig> = {}
    for (const [name, config] of Object.entries(mcpServers)) {
      const result = McpServerConfigSchema().safeParse(config)
      if (result.success) {
        validatedServers[name] = result.data
      } else {
        logForDebugging(
          `Invalid MCP server config for ${name} in ${filePath}: ${result.error.message}`,
          { level: 'error' },
        )
      }
    }

    return validatedServers
  } catch (error) {
    logForDebugging(`Failed to load MCP servers from ${filePath}: ${error}`, {
      level: 'error',
    })
    return null
  }
}

export type UnconfiguredChannel = {
  server: string
  displayName: string
  configSchema: UserConfigSchema
}

export function getUnconfiguredChannels(
  plugin: LoadedPlugin,
): UnconfiguredChannel[] {
  const channels = plugin.manifest.channels
  if (!channels || channels.length === 0) {
    return []
  }

  
  
  const pluginId = plugin.repository

  const unconfigured: UnconfiguredChannel[] = []
  for (const channel of channels) {
    if (!channel.userConfig || Object.keys(channel.userConfig).length === 0) {
      continue
    }
    const saved = loadMcpServerUserConfig(pluginId, channel.server) ?? {}
    const validation = validateUserConfig(saved, channel.userConfig)
    if (!validation.valid) {
      unconfigured.push({
        server: channel.server,
        displayName: channel.displayName ?? channel.server,
        configSchema: channel.userConfig,
      })
    }
  }
  return unconfigured
}

function loadChannelUserConfig(
  plugin: LoadedPlugin,
  serverName: string,
): UserConfigValues | undefined {
  const channel = plugin.manifest.channels?.find(c => c.server === serverName)
  if (!channel?.userConfig) {
    return undefined
  }
  return loadMcpServerUserConfig(plugin.repository, serverName) ?? undefined
}

export function addPluginScopeToServers(
  servers: Record<string, McpServerConfig>,
  pluginName: string,
  pluginSource: string,
): Record<string, ScopedMcpServerConfig> {
  const scopedServers: Record<string, ScopedMcpServerConfig> = {}

  for (const [name, config] of Object.entries(servers)) {
    
    const scopedName = `plugin:${pluginName}:${name}`
    const scoped: ScopedMcpServerConfig = {
      ...config,
      scope: 'dynamic', 
      pluginSource,
    }
    scopedServers[scopedName] = scoped
  }

  return scopedServers
}

export async function extractMcpServersFromPlugins(
  plugins: LoadedPlugin[],
  errors: PluginError[] = [],
): Promise<Record<string, ScopedMcpServerConfig>> {
  const allServers: Record<string, ScopedMcpServerConfig> = {}

  const scopedResults = await Promise.all(
    plugins.map(async plugin => {
      if (!plugin.enabled) return null

      const servers = await loadPluginMcpServers(plugin, errors)
      if (!servers) return null

      
      
      
      
      
      const resolvedServers: Record<string, McpServerConfig> = {}
      for (const [name, config] of Object.entries(servers)) {
        const userConfig = buildMcpUserConfig(plugin, name)
        try {
          resolvedServers[name] = resolvePluginMcpEnvironment(
            config,
            plugin,
            userConfig,
            errors,
            plugin.name,
            name,
          )
        } catch (err) {
          errors?.push({
            type: 'generic-error',
            source: name,
            plugin: plugin.name,
            error: errorMessage(err),
          })
        }
      }

      
      
      plugin.mcpServers = servers

      logForDebugging(
        `Loaded ${Object.keys(servers).length} MCP servers from plugin ${plugin.name}`,
      )

      return addPluginScopeToServers(
        resolvedServers,
        plugin.name,
        plugin.source,
      )
    }),
  )

  for (const scopedServers of scopedResults) {
    if (scopedServers) {
      Object.assign(allServers, scopedServers)
    }
  }

  return allServers
}

function buildMcpUserConfig(
  plugin: LoadedPlugin,
  serverName: string,
): UserConfigValues | undefined {
  
  
  
  
  
  
  
  const topLevel = plugin.manifest.userConfig
    ? loadPluginOptions(getPluginStorageId(plugin))
    : undefined
  const channelSpecific = loadChannelUserConfig(plugin, serverName)

  if (!topLevel && !channelSpecific) return undefined
  return { ...topLevel, ...channelSpecific }
}

export function resolvePluginMcpEnvironment(
  config: McpServerConfig,
  plugin: { path: string; source: string },
  userConfig?: UserConfigValues,
  errors?: PluginError[],
  pluginName?: string,
  serverName?: string,
): McpServerConfig {
  const allMissingVars: string[] = []

  const resolveValue = (value: string): string => {
    
    let resolved = substitutePluginVariables(value, plugin)

    
    if (userConfig) {
      resolved = substituteUserConfigVariables(resolved, userConfig)
    }

    
    
    const { expanded, missingVars } = expandEnvVarsInString(resolved)
    allMissingVars.push(...missingVars)

    return expanded
  }

  let resolved: McpServerConfig

  
  switch (config.type) {
    case undefined:
    case 'stdio': {
      const stdioConfig = { ...config }

      
      if (stdioConfig.command) {
        stdioConfig.command = resolveValue(stdioConfig.command)
      }

      
      if (stdioConfig.args) {
        stdioConfig.args = stdioConfig.args.map(arg => resolveValue(arg))
      }

      
      const resolvedEnv: Record<string, string> = {
        CLAUDE_PLUGIN_ROOT: plugin.path,
        CLAUDE_PLUGIN_DATA: getPluginDataDir(plugin.source),
        ...(stdioConfig.env || {}),
      }
      for (const [key, value] of Object.entries(resolvedEnv)) {
        if (key !== 'CLAUDE_PLUGIN_ROOT' && key !== 'CLAUDE_PLUGIN_DATA') {
          resolvedEnv[key] = resolveValue(value)
        }
      }
      stdioConfig.env = resolvedEnv

      resolved = stdioConfig
      break
    }

    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = { ...config }

      
      if (remoteConfig.url) {
        remoteConfig.url = resolveValue(remoteConfig.url)
      }

      
      if (remoteConfig.headers) {
        const resolvedHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(remoteConfig.headers)) {
          resolvedHeaders[key] = resolveValue(value)
        }
        remoteConfig.headers = resolvedHeaders
      }

      resolved = remoteConfig
      break
    }

    
    case 'sse-ide':
    case 'ws-ide':
    case 'sdk':
    case 'claudeai-proxy':
      resolved = config
      break
  }

  
  if (errors && allMissingVars.length > 0) {
    const uniqueMissingVars = [...new Set(allMissingVars)]
    const varList = uniqueMissingVars.join(', ')

    logForDebugging(
      `Missing environment variables in plugin MCP config: ${varList}`,
      { level: 'warn' },
    )

    
    if (pluginName && serverName) {
      errors.push({
        type: 'mcp-config-invalid',
        source: `plugin:${pluginName}`,
        plugin: pluginName,
        serverName,
        validationError: `Missing environment variables: ${varList}`,
      })
    }
  }

  return resolved
}

export async function getPluginMcpServers(
  plugin: LoadedPlugin,
  errors: PluginError[] = [],
): Promise<Record<string, ScopedMcpServerConfig> | undefined> {
  if (!plugin.enabled) {
    return undefined
  }

  
  const servers =
    plugin.mcpServers || (await loadPluginMcpServers(plugin, errors))
  if (!servers) {
    return undefined
  }

  
  
  
  
  
  
  const resolvedServers: Record<string, McpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    const userConfig = buildMcpUserConfig(plugin, name)
    try {
      resolvedServers[name] = resolvePluginMcpEnvironment(
        config,
        plugin,
        userConfig,
        errors,
        plugin.name,
        name,
      )
    } catch (err) {
      errors?.push({
        type: 'generic-error',
        source: name,
        plugin: plugin.name,
        error: errorMessage(err),
      })
    }
  }

  
  return addPluginScopeToServers(resolvedServers, plugin.name, plugin.source)
}
