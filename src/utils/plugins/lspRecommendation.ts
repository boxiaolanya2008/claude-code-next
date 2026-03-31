

import { extname } from 'path'
import { isBinaryInstalled } from '../binaryCheck.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isPluginInstalled } from './installedPluginsManager.js'
import {
  getMarketplace,
  loadKnownMarketplacesConfig,
} from './marketplaceManager.js'
import {
  ALLOWED_OFFICIAL_MARKETPLACE_NAMES,
  type PluginMarketplaceEntry,
} from './schemas.js'

export type LspPluginRecommendation = {
  pluginId: string 
  pluginName: string 
  marketplaceName: string 
  description?: string 
  isOfficial: boolean 
  extensions: string[] 
  command: string 
}

const MAX_IGNORED_COUNT = 5

function isOfficialMarketplace(name: string): boolean {
  return ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(name.toLowerCase())
}

type LspInfo = {
  extensions: Set<string>
  command: string
}

function extractLspInfoFromManifest(
  lspServers: PluginMarketplaceEntry['lspServers'],
): LspInfo | null {
  if (!lspServers) {
    return null
  }

  
  if (typeof lspServers === 'string') {
    logForDebugging(
      '[lspRecommendation] Skipping string path lspServers (not readable from marketplace)',
    )
    return null
  }

  
  if (Array.isArray(lspServers)) {
    for (const item of lspServers) {
      
      if (typeof item === 'string') {
        continue
      }
      
      const info = extractFromServerConfigRecord(item)
      if (info) {
        return info
      }
    }
    return null
  }

  
  return extractFromServerConfigRecord(lspServers)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractFromServerConfigRecord(
  serverConfigs: Record<string, unknown>,
): LspInfo | null {
  const extensions = new Set<string>()
  let command: string | null = null

  for (const [_serverName, config] of Object.entries(serverConfigs)) {
    if (!isRecord(config)) {
      continue
    }

    
    if (!command && typeof config.command === 'string') {
      command = config.command
    }

    
    const extMapping = config.extensionToLanguage
    if (isRecord(extMapping)) {
      for (const ext of Object.keys(extMapping)) {
        extensions.add(ext.toLowerCase())
      }
    }
  }

  if (!command || extensions.size === 0) {
    return null
  }

  return { extensions, command }
}

type LspPluginInfo = {
  entry: PluginMarketplaceEntry
  marketplaceName: string
  extensions: Set<string>
  command: string
  isOfficial: boolean
}

async function getLspPluginsFromMarketplaces(): Promise<
  Map<string, LspPluginInfo>
> {
  const result = new Map<string, LspPluginInfo>()

  try {
    const config = await loadKnownMarketplacesConfig()

    for (const marketplaceName of Object.keys(config)) {
      try {
        const marketplace = await getMarketplace(marketplaceName)
        const isOfficial = isOfficialMarketplace(marketplaceName)

        for (const entry of marketplace.plugins) {
          
          if (!entry.lspServers) {
            continue
          }

          const lspInfo = extractLspInfoFromManifest(entry.lspServers)
          if (!lspInfo) {
            continue
          }

          const pluginId = `${entry.name}@${marketplaceName}`
          result.set(pluginId, {
            entry,
            marketplaceName,
            extensions: lspInfo.extensions,
            command: lspInfo.command,
            isOfficial,
          })
        }
      } catch (error) {
        logForDebugging(
          `[lspRecommendation] Failed to load marketplace ${marketplaceName}: ${error}`,
        )
      }
    }
  } catch (error) {
    logForDebugging(
      `[lspRecommendation] Failed to load marketplaces config: ${error}`,
    )
  }

  return result
}

export async function getMatchingLspPlugins(
  filePath: string,
): Promise<LspPluginRecommendation[]> {
  
  if (isLspRecommendationsDisabled()) {
    logForDebugging('[lspRecommendation] Recommendations are disabled')
    return []
  }

  
  const ext = extname(filePath).toLowerCase()
  if (!ext) {
    logForDebugging('[lspRecommendation] No file extension found')
    return []
  }

  logForDebugging(`[lspRecommendation] Looking for LSP plugins for ${ext}`)

  
  const allLspPlugins = await getLspPluginsFromMarketplaces()

  
  const config = getGlobalConfig()
  const neverPlugins = config.lspRecommendationNeverPlugins ?? []

  
  const matchingPlugins: Array<{ info: LspPluginInfo; pluginId: string }> = []

  for (const [pluginId, info] of allLspPlugins) {
    
    if (!info.extensions.has(ext)) {
      continue
    }

    
    if (neverPlugins.includes(pluginId)) {
      logForDebugging(
        `[lspRecommendation] Skipping ${pluginId} (in never suggest list)`,
      )
      continue
    }

    
    if (isPluginInstalled(pluginId)) {
      logForDebugging(
        `[lspRecommendation] Skipping ${pluginId} (already installed)`,
      )
      continue
    }

    matchingPlugins.push({ info, pluginId })
  }

  
  const pluginsWithBinary: Array<{ info: LspPluginInfo; pluginId: string }> = []

  for (const { info, pluginId } of matchingPlugins) {
    const binaryExists = await isBinaryInstalled(info.command)
    if (binaryExists) {
      pluginsWithBinary.push({ info, pluginId })
      logForDebugging(
        `[lspRecommendation] Binary '${info.command}' found for ${pluginId}`,
      )
    } else {
      logForDebugging(
        `[lspRecommendation] Skipping ${pluginId} (binary '${info.command}' not found)`,
      )
    }
  }

  
  pluginsWithBinary.sort((a, b) => {
    if (a.info.isOfficial && !b.info.isOfficial) return -1
    if (!a.info.isOfficial && b.info.isOfficial) return 1
    return 0
  })

  
  return pluginsWithBinary.map(({ info, pluginId }) => ({
    pluginId,
    pluginName: info.entry.name,
    marketplaceName: info.marketplaceName,
    description: info.entry.description,
    isOfficial: info.isOfficial,
    extensions: Array.from(info.extensions),
    command: info.command,
  }))
}

export function addToNeverSuggest(pluginId: string): void {
  saveGlobalConfig(currentConfig => {
    const current = currentConfig.lspRecommendationNeverPlugins ?? []
    if (current.includes(pluginId)) {
      return currentConfig
    }
    return {
      ...currentConfig,
      lspRecommendationNeverPlugins: [...current, pluginId],
    }
  })
  logForDebugging(`[lspRecommendation] Added ${pluginId} to never suggest`)
}

export function incrementIgnoredCount(): void {
  saveGlobalConfig(currentConfig => {
    const newCount = (currentConfig.lspRecommendationIgnoredCount ?? 0) + 1
    return {
      ...currentConfig,
      lspRecommendationIgnoredCount: newCount,
    }
  })
  logForDebugging('[lspRecommendation] Incremented ignored count')
}

export function isLspRecommendationsDisabled(): boolean {
  const config = getGlobalConfig()
  return (
    config.lspRecommendationDisabled === true ||
    (config.lspRecommendationIgnoredCount ?? 0) >= MAX_IGNORED_COUNT
  )
}

export function resetIgnoredCount(): void {
  saveGlobalConfig(currentConfig => {
    const currentCount = currentConfig.lspRecommendationIgnoredCount ?? 0
    if (currentCount === 0) {
      return currentConfig
    }
    return {
      ...currentConfig,
      lspRecommendationIgnoredCount: 0,
    }
  })
  logForDebugging('[lspRecommendation] Reset ignored count')
}
