import { feature } from "../../utils/bundle-mock.ts"
import { chmod, open, rename, stat, unlink } from 'fs/promises'
import mapValues from 'lodash-es/mapValues.js'
import memoize from 'lodash-es/memoize.js'
import { dirname, join, parse } from 'path'
import { getPlatform } from 'src/utils/platform.js'
import type { PluginError } from '../../types/plugin.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import { isClaudeInChromeMCPServer } from '../../utils/claudeInChrome/common.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import { getPluginMcpServers } from '../../utils/plugins/mcpPluginIntegration.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { isSettingSourceEnabled } from '../../utils/settings/constants.js'
import { getManagedFilePath } from '../../utils/settings/managedPath.js'
import { isRestrictedToPluginOnly } from '../../utils/settings/pluginOnlyPolicy.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  isMcpServerCommandEntry,
  isMcpServerNameEntry,
  isMcpServerUrlEntry,
  type SettingsJson,
} from '../../utils/settings/types.js'
import type { ValidationError } from '../../utils/settings/validation.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { fetchClaudeAIMcpConfigsIfEligible } from './claudeai.js'
import { expandEnvVarsInString } from './envExpansion.js'
import {
  type ConfigScope,
  type McpHTTPServerConfig,
  type McpJsonConfig,
  McpJsonConfigSchema,
  type McpServerConfig,
  McpServerConfigSchema,
  type McpSSEServerConfig,
  type McpStdioServerConfig,
  type McpWebSocketServerConfig,
  type ScopedMcpServerConfig,
} from './types.js'
import { getProjectMcpServerStatus } from './utils.js'

export function getEnterpriseMcpFilePath(): string {
  return join(getManagedFilePath(), 'managed-mcp.json')
}

function addScopeToServers(
  servers: Record<string, McpServerConfig> | undefined,
  scope: ConfigScope,
): Record<string, ScopedMcpServerConfig> {
  if (!servers) {
    return {}
  }
  const scopedServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    scopedServers[name] = { ...config, scope }
  }
  return scopedServers
}

async function writeMcpjsonFile(config: McpJsonConfig): Promise<void> {
  const mcpJsonPath = join(getCwd(), '.mcp.json')

  
  let existingMode: number | undefined
  try {
    const stats = await stat(mcpJsonPath)
    existingMode = stats.mode
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
    
  }

  
  const tempPath = mcpJsonPath + '.tmp.' + process.pid + '.' + Date.now()
  const handle = await open(tempPath, 'w', existingMode ?? 0o644)
  try {
    await handle.writeFile(jsonStringify(config, null, 2), {
      encoding: 'utf8',
    })
    await handle.datasync()
  } finally {
    await handle.close()
  }

  try {
    
    if (existingMode !== undefined) {
      await chmod(tempPath, existingMode)
    }
    await rename(tempPath, mcpJsonPath)
  } catch (e: unknown) {
    
    try {
      await unlink(tempPath)
    } catch {
      
    }
    throw e
  }
}

function getServerCommandArray(config: McpServerConfig): string[] | null {
  
  if (config.type !== undefined && config.type !== 'stdio') {
    return null
  }
  const stdioConfig = config as McpStdioServerConfig
  return [stdioConfig.command, ...(stdioConfig.args ?? [])]
}

function commandArraysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((val, idx) => val === b[idx])
}

function getServerUrl(config: McpServerConfig): string | null {
  return 'url' in config ? config.url : null
}

const CCR_PROXY_PATH_MARKERS = [
  '/v2/session_ingress/shttp/mcp/',
  '/v2/ccr-sessions/',
]

export function unwrapCcrProxyUrl(url: string): string {
  if (!CCR_PROXY_PATH_MARKERS.some(m => url.includes(m))) {
    return url
  }
  try {
    const parsed = new URL(url)
    const original = parsed.searchParams.get('mcp_url')
    return original || url
  } catch {
    return url
  }
}

export function getMcpServerSignature(config: McpServerConfig): string | null {
  const cmd = getServerCommandArray(config)
  if (cmd) {
    return 'stdio:' + jsonStringify(cmd)
  }
  const url = getServerUrl(config)
  if (url) {
    return 'url:' + unwrapCcrProxyUrl(url)
  }
  return null
}

export function dedupPluginMcpServers(
  pluginServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  
  const manualSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    const sig = getMcpServerSignature(config)
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
  }

  const servers: Record<string, ScopedMcpServerConfig> = {}
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  const seenPluginSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(pluginServers)) {
    const sig = getMcpServerSignature(config)
    if (sig === null) {
      servers[name] = config
      continue
    }
    const manualDup = manualSigs.get(sig)
    if (manualDup !== undefined) {
      logForDebugging(
        'Suppressing plugin MCP server "' + name + '": duplicates manually-configured "' + manualDup + '"',
      )
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    const pluginDup = seenPluginSigs.get(sig)
    if (pluginDup !== undefined) {
      logForDebugging(
        'Suppressing plugin MCP server "' + name + '": duplicates earlier plugin server "' + pluginDup + '"',
      )
      suppressed.push({ name, duplicateOf: pluginDup })
      continue
    }
    seenPluginSigs.set(sig, name)
    servers[name] = config
  }
  return { servers, suppressed }
}

export function dedupClaudeAiMcpServers(
  claudeAiServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  const manualSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    if (isMcpServerDisabled(name)) continue
    const sig = getMcpServerSignature(config)
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
  }

  const servers: Record<string, ScopedMcpServerConfig> = {}
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  for (const [name, config] of Object.entries(claudeAiServers)) {
    const sig = getMcpServerSignature(config)
    const manualDup = sig !== null ? manualSigs.get(sig) : undefined
    if (manualDup !== undefined) {
      logForDebugging(
        'Suppressing claude.ai connector "' + name + '": duplicates manually-configured "' + manualDup + '"',
      )
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    servers[name] = config
  }
  return { servers, suppressed }
}

function urlPatternToRegex(pattern: string): RegExp {
  
  const escaped = pattern.replace(/[.+?^${}()|\[\]\\]/g, '\\$&')
  
  const regexStr = escaped.replace(/\*/g, '.*')
  return new RegExp(`^${regexStr}$`)
}

function urlMatchesPattern(url: string, pattern: string): boolean {
  // Simple wildcard matching without regex
  const patternParts = pattern.split('*');
  let currentIndex = 0;
  
  for (const part of patternParts) {
    if (part === '') {
      continue;
    }
    
    const index = url.indexOf(part, currentIndex);
    if (index === -1) {
      return false;
    }
    
    currentIndex = index + part.length;
  }
  
  return true;
}

function getMcpAllowlistSettings(): SettingsJson {
  if (shouldAllowManagedMcpServersOnly()) {
    return getSettingsForSource('policySettings') ?? {}
  }
  return getInitialSettings()
}

function getMcpDenylistSettings(): SettingsJson {
  return getInitialSettings()
}

function isMcpServerDenied(
  serverName: string,
  config?: McpServerConfig,
): boolean {
  const settings = getMcpDenylistSettings()
  if (!settings.deniedMcpServers) {
    return false 
  }

  
  for (const entry of settings.deniedMcpServers) {
    if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }

  
  if (config) {
    const serverCommand = getServerCommandArray(config)
    if (serverCommand) {
      for (const entry of settings.deniedMcpServers) {
        if (
          isMcpServerCommandEntry(entry) &&
          commandArraysMatch(entry.serverCommand, serverCommand)
        ) {
          return true
        }
      }
    }

    const serverUrl = getServerUrl(config)
    if (serverUrl) {
      for (const entry of settings.deniedMcpServers) {
        if (
          isMcpServerUrlEntry(entry) &&
          urlMatchesPattern(serverUrl, entry.serverUrl)
        ) {
          return true
        }
      }
    }
  }

  return false
}

function isMcpServerAllowedByPolicy(
  serverName: string,
  config?: McpServerConfig,
): boolean {
  
  if (isMcpServerDenied(serverName, config)) {
    return false
  }

  const settings = getMcpAllowlistSettings()
  if (!settings.allowedMcpServers) {
    return true 
  }

  
  if (settings.allowedMcpServers.length === 0) {
    return false
  }

  
  const hasCommandEntries = settings.allowedMcpServers.some(
    isMcpServerCommandEntry,
  )
  const hasUrlEntries = settings.allowedMcpServers.some(isMcpServerUrlEntry)

  if (config) {
    const serverCommand = getServerCommandArray(config)
    const serverUrl = getServerUrl(config)

    if (serverCommand) {
      
      if (hasCommandEntries) {
        
        for (const entry of settings.allowedMcpServers) {
          if (
            isMcpServerCommandEntry(entry) &&
            commandArraysMatch(entry.serverCommand, serverCommand)
          ) {
            return true
          }
        }
        return false 
      } else {
        
        for (const entry of settings.allowedMcpServers) {
          if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else if (serverUrl) {
      
      if (hasUrlEntries) {
        
        for (const entry of settings.allowedMcpServers) {
          if (
            isMcpServerUrlEntry(entry) &&
            urlMatchesPattern(serverUrl, entry.serverUrl)
          ) {
            return true
          }
        }
        return false 
      } else {
        
        for (const entry of settings.allowedMcpServers) {
          if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else {
      
      for (const entry of settings.allowedMcpServers) {
        if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
          return true
        }
      }
      return false
    }
  }

  
  for (const entry of settings.allowedMcpServers) {
    if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }
  return false
}

export function filterMcpServersByPolicy<T>(configs: Record<string, T>): {
  allowed: Record<string, T>
  blocked: string[]
} {
  const allowed: Record<string, T> = {}
  const blocked: string[] = []
  for (const [name, config] of Object.entries(configs)) {
    const c = config as McpServerConfig
    if (c.type === 'sdk' || isMcpServerAllowedByPolicy(name, c)) {
      allowed[name] = config
    } else {
      blocked.push(name)
    }
  }
  return { allowed, blocked }
}

function expandEnvVars(config: McpServerConfig): {
  expanded: McpServerConfig
  missingVars: string[]
} {
  const missingVars: string[] = []

  function expandString(str: string): string {
    const { expanded, missingVars: vars } = expandEnvVarsInString(str)
    missingVars.push(...vars)
    return expanded
  }

  let expanded: McpServerConfig

  switch (config.type) {
    case undefined:
    case 'stdio': {
      const stdioConfig = config as McpStdioServerConfig
      expanded = {
        ...stdioConfig,
        command: expandString(stdioConfig.command),
        args: stdioConfig.args.map(expandString),
        env: stdioConfig.env
          ? mapValues(stdioConfig.env, expandString)
          : undefined,
      }
      break
    }
    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = config as
        | McpSSEServerConfig
        | McpHTTPServerConfig
        | McpWebSocketServerConfig
      expanded = {
        ...remoteConfig,
        url: expandString(remoteConfig.url),
        headers: remoteConfig.headers
          ? mapValues(remoteConfig.headers, expandString)
          : undefined,
      }
      break
    }
    case 'sse-ide':
    case 'ws-ide':
      expanded = config
      break
    case 'sdk':
      expanded = config
      break
    case 'claudeai-proxy':
      expanded = config
      break
  }

  return {
    expanded,
    missingVars: [...new Set(missingVars)],
  }
}

export async function addMcpConfig(
  name: string,
  config: unknown,
  scope: ConfigScope,
): Promise<void> {
  if (name.match(/[^a-zA-Z0-9_-]/)) {
    throw new Error(
      `Invalid name ${name}. Names can only contain letters, numbers, hyphens, and underscores.`,
    )
  }

  
  if (isClaudeInChromeMCPServer(name)) {
    throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
  }

  if (feature('CHICAGO_MCP')) {
    const { isComputerUseMCPServer } = await import(
      '../../utils/computerUse/common.js'
    )
    if (isComputerUseMCPServer(name)) {
      throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
    }
  }

  
  if (doesEnterpriseMcpConfigExist()) {
    throw new Error(
      `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers`,
    )
  }

  
  const result = McpServerConfigSchema().safeParse(config)
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join(', ')
    throw new Error(`Invalid configuration: ${formattedErrors}`)
  }
  const validatedConfig = result.data

  
  if (isMcpServerDenied(name, validatedConfig)) {
    throw new Error(
      `Cannot add MCP server "${name}": server is explicitly blocked by enterprise policy`,
    )
  }

  
  if (!isMcpServerAllowedByPolicy(name, validatedConfig)) {
    throw new Error(
      `Cannot add MCP server "${name}": not allowed by enterprise policy`,
    )
  }

  
  switch (scope) {
    case 'project': {
      const { servers } = getProjectMcpConfigsFromCwd()
      if (servers[name]) {
        throw new Error(`MCP server ${name} already exists in .mcp.json`)
      }
      break
    }
    case 'user': {
      const globalConfig = getGlobalConfig()
      if (globalConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in user config`)
      }
      break
    }
    case 'local': {
      const projectConfig = getCurrentProjectConfig()
      if (projectConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in local config`)
      }
      break
    }
    case 'dynamic':
      throw new Error('Cannot add MCP server to scope: dynamic')
    case 'enterprise':
      throw new Error('Cannot add MCP server to scope: enterprise')
    case 'claudeai':
      throw new Error('Cannot add MCP server to scope: claudeai')
  }

  
  switch (scope) {
    case 'project': {
      const { servers: existingServers } = getProjectMcpConfigsFromCwd()

      const mcpServers: Record<string, McpServerConfig> = {}
      for (const [serverName, serverConfig] of Object.entries(
        existingServers,
      )) {
        const { scope: _, ...configWithoutScope } = serverConfig
        mcpServers[serverName] = configWithoutScope
      }
      mcpServers[name] = validatedConfig
      const mcpConfig = { mcpServers }

      
      try {
        await writeMcpjsonFile(mcpConfig)
      } catch (error) {
        throw new Error(`Failed to write to .mcp.json: ${error}`)
      }
      break
    }

    case 'user': {
      saveGlobalConfig(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      break
    }

    case 'local': {
      saveCurrentProjectConfig(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      break
    }

    default:
      throw new Error(`Cannot add MCP server to scope: ${scope}`)
  }
}

export async function removeMcpConfig(
  name: string,
  scope: ConfigScope,
): Promise<void> {
  switch (scope) {
    case 'project': {
      const { servers: existingServers } = getProjectMcpConfigsFromCwd()

      if (!existingServers[name]) {
        throw new Error(`No MCP server found with name: ${name} in .mcp.json`)
      }

      
      const mcpServers: Record<string, McpServerConfig> = {}
      for (const [serverName, serverConfig] of Object.entries(
        existingServers,
      )) {
        if (serverName !== name) {
          const { scope: _, ...configWithoutScope } = serverConfig
          mcpServers[serverName] = configWithoutScope
        }
      }
      const mcpConfig = { mcpServers }
      try {
        await writeMcpjsonFile(mcpConfig)
      } catch (error) {
        throw new Error(`Failed to remove from .mcp.json: ${error}`)
      }
      break
    }

    case 'user': {
      const config = getGlobalConfig()
      if (!config.mcpServers?.[name]) {
        throw new Error(`No user-scoped MCP server found with name: ${name}`)
      }
      saveGlobalConfig(current => {
        const { [name]: _, ...restMcpServers } = current.mcpServers ?? {}
        return {
          ...current,
          mcpServers: restMcpServers,
        }
      })
      break
    }

    case 'local': {
      
      const config = getCurrentProjectConfig()
      if (!config.mcpServers?.[name]) {
        throw new Error(`No project-local MCP server found with name: ${name}`)
      }
      saveCurrentProjectConfig(current => {
        const { [name]: _, ...restMcpServers } = current.mcpServers ?? {}
        return {
          ...current,
          mcpServers: restMcpServers,
        }
      })
      break
    }

    default:
      throw new Error(`Cannot remove MCP server from scope: ${scope}`)
  }
}

export function getProjectMcpConfigsFromCwd(): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  
  if (!isSettingSourceEnabled('projectSettings')) {
    return { servers: {}, errors: [] }
  }

  const mcpJsonPath = join(getCwd(), '.mcp.json')

  const { config, errors } = parseMcpConfigFromFilePath({
    filePath: mcpJsonPath,
    expandVars: true,
    scope: 'project',
  })

  
  if (!config) {
    const nonMissingErrors = errors.filter(
      e => !e.message.startsWith('MCP config file not found'),
    )
    if (nonMissingErrors.length > 0) {
      logForDebugging(
        `MCP config errors for ${mcpJsonPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
        { level: 'error' },
      )
      return { servers: {}, errors: nonMissingErrors }
    }
    return { servers: {}, errors: [] }
  }

  return {
    servers: config.mcpServers
      ? addScopeToServers(config.mcpServers, 'project')
      : {},
    errors: errors || [],
  }
}

export function getMcpConfigsByScope(
  scope: 'project' | 'user' | 'local' | 'enterprise',
): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  
  const sourceMap: Record<
    string,
    'projectSettings' | 'userSettings' | 'localSettings'
  > = {
    project: 'projectSettings',
    user: 'userSettings',
    local: 'localSettings',
  }

  if (scope in sourceMap && !isSettingSourceEnabled(sourceMap[scope]!)) {
    return { servers: {}, errors: [] }
  }

  switch (scope) {
    case 'project': {
      const allServers: Record<string, ScopedMcpServerConfig> = {}
      const allErrors: ValidationError[] = []

      
      const dirs: string[] = []
      let currentDir = getCwd()

      while (currentDir !== parse(currentDir).root) {
        dirs.push(currentDir)
        currentDir = dirname(currentDir)
      }

      
      for (const dir of dirs.reverse()) {
        const mcpJsonPath = join(dir, '.mcp.json')

        const { config, errors } = parseMcpConfigFromFilePath({
          filePath: mcpJsonPath,
          expandVars: true,
          scope: 'project',
        })

        
        if (!config) {
          const nonMissingErrors = errors.filter(
            e => !e.message.startsWith('MCP config file not found'),
          )
          if (nonMissingErrors.length > 0) {
            logForDebugging(
              `MCP config errors for ${mcpJsonPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
              { level: 'error' },
            )
            allErrors.push(...nonMissingErrors)
          }
          continue
        }

        if (config.mcpServers) {
          
          Object.assign(allServers, addScopeToServers(config.mcpServers, scope))
        }

        if (errors.length > 0) {
          allErrors.push(...errors)
        }
      }

      return {
        servers: allServers,
        errors: allErrors,
      }
    }
    case 'user': {
      const mcpServers = getGlobalConfig().mcpServers
      if (!mcpServers) {
        return { servers: {}, errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars: true,
        scope: 'user',
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope),
        errors,
      }
    }
    case 'local': {
      const mcpServers = getCurrentProjectConfig().mcpServers
      if (!mcpServers) {
        return { servers: {}, errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars: true,
        scope: 'local',
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope),
        errors,
      }
    }
    case 'enterprise': {
      const enterpriseMcpPath = getEnterpriseMcpFilePath()

      const { config, errors } = parseMcpConfigFromFilePath({
        filePath: enterpriseMcpPath,
        expandVars: true,
        scope: 'enterprise',
      })

      
      if (!config) {
        const nonMissingErrors = errors.filter(
          e => !e.message.startsWith('MCP config file not found'),
        )
        if (nonMissingErrors.length > 0) {
          logForDebugging(
            `Enterprise MCP config errors for ${enterpriseMcpPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
            { level: 'error' },
          )
          return { servers: {}, errors: nonMissingErrors }
        }
        return { servers: {}, errors: [] }
      }

      return {
        servers: addScopeToServers(config.mcpServers, scope),
        errors,
      }
    }
  }
}

export function getMcpConfigByName(name: string): ScopedMcpServerConfig | null {
  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

  
  
  if (isRestrictedToPluginOnly('mcp')) {
    return enterpriseServers[name] ?? null
  }

  const { servers: userServers } = getMcpConfigsByScope('user')
  const { servers: projectServers } = getMcpConfigsByScope('project')
  const { servers: localServers } = getMcpConfigsByScope('local')

  if (enterpriseServers[name]) {
    return enterpriseServers[name]
  }
  if (localServers[name]) {
    return localServers[name]
  }
  if (projectServers[name]) {
    return projectServers[name]
  }
  if (userServers[name]) {
    return userServers[name]
  }

  return null
}

export async function getClaudeCodeMcpConfigs(
  dynamicServers: Record<string, ScopedMcpServerConfig> = {},
  extraDedupTargets: Promise<
    Record<string, ScopedMcpServerConfig>
  > = Promise.resolve({}),
): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

  
  
  if (doesEnterpriseMcpConfigExist()) {
    
    const filtered: Record<string, ScopedMcpServerConfig> = {}

    for (const [name, serverConfig] of Object.entries(enterpriseServers)) {
      if (!isMcpServerAllowedByPolicy(name, serverConfig)) {
        continue
      }
      filtered[name] = serverConfig
    }

    return { servers: filtered, errors: [] }
  }

  
  
  const mcpLocked = isRestrictedToPluginOnly('mcp')
  const noServers: { servers: Record<string, ScopedMcpServerConfig> } = {
    servers: {},
  }
  const { servers: userServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('user')
  const { servers: projectServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('project')
  const { servers: localServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('local')

  
  const pluginMcpServers: Record<string, ScopedMcpServerConfig> = {}

  const pluginResult = await loadAllPluginsCacheOnly()

  
  const mcpErrors: PluginError[] = []

  
  if (pluginResult.errors.length > 0) {
    for (const error of pluginResult.errors) {
      
      
      if (
        error.type === 'mcp-config-invalid' ||
        error.type === 'mcpb-download-failed' ||
        error.type === 'mcpb-extract-failed' ||
        error.type === 'mcpb-invalid-manifest'
      ) {
        const errorMessage = `Plugin MCP loading error - ${error.type}: ${getPluginErrorMessage(error)}`
        logError(new Error(errorMessage))
      } else {
        
        
        const errorType = error.type
        logForDebugging(
          `Plugin not available for MCP: ${error.source} - error type: ${errorType}`,
        )
      }
    }
  }

  
  const pluginServerResults = await Promise.all(
    pluginResult.enabled.map(plugin => getPluginMcpServers(plugin, mcpErrors)),
  )
  for (const servers of pluginServerResults) {
    if (servers) {
      Object.assign(pluginMcpServers, servers)
    }
  }

  
  if (mcpErrors.length > 0) {
    for (const error of mcpErrors) {
      const errorMessage = `Plugin MCP server error - ${error.type}: ${getPluginErrorMessage(error)}`
      logError(new Error(errorMessage))
    }
  }

  
  const approvedProjectServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(projectServers)) {
    if (getProjectMcpServerStatus(name) === 'approved') {
      approvedProjectServers[name] = config
    }
  }

  
  
  
  
  
  
  
  const extraTargets = await extraDedupTargets
  const enabledManualServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries({
    ...userServers,
    ...approvedProjectServers,
    ...localServers,
    ...dynamicServers,
    ...extraTargets,
  })) {
    if (
      !isMcpServerDisabled(name) &&
      isMcpServerAllowedByPolicy(name, config)
    ) {
      enabledManualServers[name] = config
    }
  }
  
  
  
  
  const enabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  const disabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(pluginMcpServers)) {
    if (
      isMcpServerDisabled(name) ||
      !isMcpServerAllowedByPolicy(name, config)
    ) {
      disabledPluginServers[name] = config
    } else {
      enabledPluginServers[name] = config
    }
  }
  const { servers: dedupedPluginServers, suppressed } = dedupPluginMcpServers(
    enabledPluginServers,
    enabledManualServers,
  )
  Object.assign(dedupedPluginServers, disabledPluginServers)
  
  
  for (const { name, duplicateOf } of suppressed) {
    
    const parts = name.split(':')
    if (parts[0] !== 'plugin' || parts.length < 3) continue
    mcpErrors.push({
      type: 'mcp-server-suppressed-duplicate',
      source: name,
      plugin: parts[1]!,
      serverName: parts.slice(2).join(':'),
      duplicateOf,
    })
  }

  
  const configs = Object.assign(
    {},
    dedupedPluginServers,
    userServers,
    approvedProjectServers,
    localServers,
  )

  
  const filtered: Record<string, ScopedMcpServerConfig> = {}

  for (const [name, serverConfig] of Object.entries(configs)) {
    if (!isMcpServerAllowedByPolicy(name, serverConfig as McpServerConfig)) {
      continue
    }
    filtered[name] = serverConfig as ScopedMcpServerConfig
  }

  return { servers: filtered, errors: mcpErrors }
}

export async function getAllMcpConfigs(): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
  
  if (doesEnterpriseMcpConfigExist()) {
    return getClaudeCodeMcpConfigs()
  }

  
  
  const claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
  const { servers: claudeCodeServers, errors } = await getClaudeCodeMcpConfigs(
    {},
    claudeaiPromise,
  )
  const { allowed: claudeaiMcpServers } = filterMcpServersByPolicy(
    await claudeaiPromise,
  )

  
  
  
  const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
    claudeaiMcpServers,
    claudeCodeServers,
  )

  
  const servers = Object.assign({}, dedupedClaudeAi, claudeCodeServers)

  return { servers, errors }
}

export function parseMcpConfig(params: {
  configObject: unknown
  expandVars: boolean
  scope: ConfigScope
  filePath?: string
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]
} {
  const { configObject, expandVars, scope, filePath } = params
  const schemaResult = McpJsonConfigSchema().safeParse(configObject)
  if (!schemaResult.success) {
    return {
      config: null,
      errors: schemaResult.error.issues.map(issue => ({
        ...(filePath && { file: filePath }),
        path: issue.path.join('.'),
        message: 'Does not adhere to MCP server configuration schema',
        mcpErrorMetadata: {
          scope,
          severity: 'fatal',
        },
      })),
    }
  }

  
  const errors: ValidationError[] = []
  const validatedServers: Record<string, McpServerConfig> = {}

  for (const [name, config] of Object.entries(schemaResult.data.mcpServers)) {
    let configToCheck = config

    if (expandVars) {
      const { expanded, missingVars } = expandEnvVars(config)

      if (missingVars.length > 0) {
        errors.push({
          ...(filePath && { file: filePath }),
          path: `mcpServers.${name}`,
          message: `Missing environment variables: ${missingVars.join(', ')}`,
          suggestion: `Set the following environment variables: ${missingVars.join(', ')}`,
          mcpErrorMetadata: {
            scope,
            serverName: name,
            severity: 'warning',
          },
        })
      }

      configToCheck = expanded
    }

    
    if (
      getPlatform() === 'windows' &&
      (!configToCheck.type || configToCheck.type === 'stdio') &&
      (configToCheck.command === 'npx' ||
        configToCheck.command.endsWith('\\npx') ||
        configToCheck.command.endsWith('/npx'))
    ) {
      errors.push({
        ...(filePath && { file: filePath }),
        path: 'mcpServers.' + name,
        message: 'Windows requires \'cmd /c\' wrapper to execute npx',
        suggestion: 'Change command to "cmd" with args ["/c", "npx", ...]',
        mcpErrorMetadata: {
          scope: scope,
          serverName: name,
          severity: 'warning'
        }
      })
    }

    validatedServers[name] = configToCheck
  }
  return {
    config: { mcpServers: validatedServers },
    errors,
  }
}

export function parseMcpConfigFromFilePath(params: {
  filePath: string
  expandVars: boolean
  scope: ConfigScope
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]
} {
  const { filePath, expandVars, scope } = params
  const fs = getFsImplementation()

  let configContent: string
  try {
    configContent = fs.readFileSync(filePath, { encoding: 'utf8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      return {
        config: null,
        errors: [
          {
            file: filePath,
            path: '',
            message: 'MCP config file not found: ' + filePath,
            suggestion: 'Check that the file path is correct',
            mcpErrorMetadata: {
              scope: scope,
              severity: 'fatal'
            }
          }
        ]
      }
    }
    logForDebugging(
      'MCP config read error for ' + filePath + ' (scope=' + scope + '): ' + error,
      { level: 'error' }
    )
    return {
      config: null,
      errors: [
        {
          file: filePath,
          path: '',
          message: 'Failed to read file: ' + error,
          suggestion: 'Check file permissions and ensure the file exists',
          mcpErrorMetadata: {
            scope: scope,
            severity: 'fatal'
          }
        }
      ]
    }
  }

  const parsedJson = safeParseJSON(configContent)

  if (!parsedJson) {
    logForDebugging(
      'MCP config is not valid JSON: ' + filePath + ' (scope=' + scope + ', length=' + configContent.length + ', first100=' + jsonStringify(configContent.slice(0, 100)) + ')',
      { level: 'error' }
    )
    return {
      config: null,
      errors: [
        {
            file: filePath,
            path: '',
            message: 'MCP config is not a valid JSON',
            suggestion: 'Fix the JSON syntax errors in the file',
            mcpErrorMetadata: {
              scope: scope,
              severity: 'fatal'
            }
          }
      ]
    }
  }

  return parseMcpConfig({
    configObject: parsedJson,
    expandVars,
    scope,
    filePath,
  })
}

export const doesEnterpriseMcpConfigExist = memoize((): boolean => {
  const { config } = parseMcpConfigFromFilePath({
    filePath: getEnterpriseMcpFilePath(),
    expandVars: true,
    scope: 'enterprise',
  })
  return config !== null
})

export function shouldAllowManagedMcpServersOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.allowManagedMcpServersOnly === true
  )
}

export function areMcpConfigsAllowedWithEnterpriseMcpConfig(
  configs: Record<string, ScopedMcpServerConfig>,
): boolean {
  
  
  
  
  return Object.values(configs).every(
    c => c.type === 'sdk' && c.name === 'claude-vscode',
  )
}

const DEFAULT_DISABLED_BUILTIN = feature('CHICAGO_MCP')
  ? (
      require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')
    ).COMPUTER_USE_MCP_SERVER_NAME
  : null

function isDefaultDisabledBuiltin(name: string): boolean {
  return DEFAULT_DISABLED_BUILTIN !== null && name === DEFAULT_DISABLED_BUILTIN
}

export function isMcpServerDisabled(name: string): boolean {
  const projectConfig = getCurrentProjectConfig()
  if (isDefaultDisabledBuiltin(name)) {
    const enabledServers = projectConfig.enabledMcpServers || []
    return !enabledServers.includes(name)
  }
  const disabledServers = projectConfig.disabledMcpServers || []
  return disabledServers.includes(name)
}

function toggleMembership(
  list: string[],
  name: string,
  shouldContain: boolean,
): string[] {
  const contains = list.includes(name)
  if (contains === shouldContain) return list
  return shouldContain ? [...list, name] : list.filter(s => s !== name)
}

export function setMcpServerEnabled(name: string, enabled: boolean): void {
  const isBuiltinStateChange =
    isDefaultDisabledBuiltin(name) && isMcpServerDisabled(name) === enabled

  saveCurrentProjectConfig(current => {
    if (isDefaultDisabledBuiltin(name)) {
      const prev = current.enabledMcpServers || []
      const next = toggleMembership(prev, name, enabled)
      if (next === prev) return current
      return { ...current, enabledMcpServers: next }
    }

    const prev = current.disabledMcpServers || []
    const next = toggleMembership(prev, name, !enabled)
    if (next === prev) return current
    return { ...current, disabledMcpServers: next }
  })

  if (isBuiltinStateChange) {
    logEvent('tengu_builtin_mcp_toggle', {
      serverName:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      enabled,
    })
  }
}
