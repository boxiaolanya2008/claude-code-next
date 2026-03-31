import { join } from 'path'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import type { SettingSource } from '../settings/constants.js'
import {
  getInitialSettings,
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import { getAddDirEnabledPlugins } from './addDirPluginSettings.js'
import {
  getInMemoryInstalledPlugins,
  migrateFromEnabledPlugins,
} from './installedPluginsManager.js'
import { getPluginById } from './marketplaceManager.js'
import {
  type ExtendedPluginScope,
  type PersistablePluginScope,
  SETTING_SOURCE_TO_SCOPE,
  scopeToSettingSource,
} from './pluginIdentifier.js'
import {
  cacheAndRegisterPlugin,
  registerPluginInstallation,
} from './pluginInstallationHelpers.js'
import { isLocalPluginSource, type PluginScope } from './schemas.js'

export async function checkEnabledPlugins(): Promise<string[]> {
  const settings = getInitialSettings()
  const enabledPlugins: string[] = []

  
  const addDirPlugins = getAddDirEnabledPlugins()
  for (const [pluginId, value] of Object.entries(addDirPlugins)) {
    if (pluginId.includes('@') && value) {
      enabledPlugins.push(pluginId)
    }
  }

  
  if (settings.enabledPlugins) {
    for (const [pluginId, value] of Object.entries(settings.enabledPlugins)) {
      if (!pluginId.includes('@')) {
        continue
      }
      const idx = enabledPlugins.indexOf(pluginId)
      if (value) {
        if (idx === -1) {
          enabledPlugins.push(pluginId)
        }
      } else {
        
        if (idx !== -1) {
          enabledPlugins.splice(idx, 1)
        }
      }
    }
  }

  return enabledPlugins
}

export function getPluginEditableScopes(): Map<string, ExtendedPluginScope> {
  const result = new Map<string, ExtendedPluginScope>()

  
  const addDirPlugins = getAddDirEnabledPlugins()
  for (const [pluginId, value] of Object.entries(addDirPlugins)) {
    if (!pluginId.includes('@')) {
      continue
    }
    if (value === true) {
      result.set(pluginId, 'flag') 
    } else if (value === false) {
      result.delete(pluginId)
    }
  }

  
  const scopeSources: Array<{
    scope: ExtendedPluginScope
    source: SettingSource
  }> = [
    { scope: 'managed', source: 'policySettings' },
    { scope: 'user', source: 'userSettings' },
    { scope: 'project', source: 'projectSettings' },
    { scope: 'local', source: 'localSettings' },
    { scope: 'flag', source: 'flagSettings' },
  ]

  for (const { scope, source } of scopeSources) {
    const settings = getSettingsForSource(source)
    if (!settings?.enabledPlugins) {
      continue
    }

    for (const [pluginId, value] of Object.entries(settings.enabledPlugins)) {
      
      if (!pluginId.includes('@')) {
        continue
      }

      
      if (pluginId in addDirPlugins && addDirPlugins[pluginId] !== value) {
        logForDebugging(
          `Plugin ${pluginId} from --add-dir (${addDirPlugins[pluginId]}) overridden by ${source} (${value})`,
        )
      }

      if (value === true) {
        
        result.set(pluginId, scope)
      } else if (value === false) {
        
        result.delete(pluginId)
      }
      
    }
  }

  logForDebugging(
    `Found ${result.size} enabled plugins with scopes: ${Array.from(
      result.entries(),
    )
      .map(([id, scope]) => `${id}(${scope})`)
      .join(', ')}`,
  )

  return result
}

export function isPersistableScope(
  scope: ExtendedPluginScope,
): scope is PersistablePluginScope {
  return scope !== 'flag'
}

export function settingSourceToScope(
  source: SettingSource,
): ExtendedPluginScope {
  return SETTING_SOURCE_TO_SCOPE[source]
}

export async function getInstalledPlugins(): Promise<string[]> {
  
  
  void migrateFromEnabledPlugins().catch(error => {
    logError(error)
  })

  
  const v2Data = getInMemoryInstalledPlugins()
  const installed = Object.keys(v2Data.plugins)
  logForDebugging(`Found ${installed.length} installed plugins`)
  return installed
}

export async function findMissingPlugins(
  enabledPlugins: string[],
): Promise<string[]> {
  try {
    const installedPlugins = await getInstalledPlugins()

    
    
    const notInstalled = enabledPlugins.filter(
      id => !installedPlugins.includes(id),
    )
    const lookups = await Promise.all(
      notInstalled.map(async pluginId => {
        try {
          const plugin = await getPluginById(pluginId)
          return { pluginId, found: plugin !== null && plugin !== undefined }
        } catch (error) {
          logForDebugging(
            `Failed to check plugin ${pluginId} in marketplace: ${error}`,
          )
          
          return { pluginId, found: false }
        }
      }),
    )
    const missing = lookups
      .filter(({ found }) => found)
      .map(({ pluginId }) => pluginId)

    return missing
  } catch (error) {
    logError(error)
    return []
  }
}

export type PluginInstallResult = {
  installed: string[]
  failed: Array<{ name: string; error: string }>
}

type InstallableScope = Exclude<PluginScope, 'managed'>

export async function installSelectedPlugins(
  pluginsToInstall: string[],
  onProgress?: (name: string, index: number, total: number) => void,
  scope: InstallableScope = 'user',
): Promise<PluginInstallResult> {
  
  const projectPath = scope !== 'user' ? getCwd() : undefined

  
  const settingSource = scopeToSettingSource(scope)
  const settings = getSettingsForSource(settingSource)
  const updatedEnabledPlugins = { ...settings?.enabledPlugins }
  const installed: string[] = []
  const failed: Array<{ name: string; error: string }> = []

  for (let i = 0; i < pluginsToInstall.length; i++) {
    const pluginId = pluginsToInstall[i]
    if (!pluginId) continue

    if (onProgress) {
      onProgress(pluginId, i + 1, pluginsToInstall.length)
    }

    try {
      const pluginInfo = await getPluginById(pluginId)
      if (!pluginInfo) {
        failed.push({
          name: pluginId,
          error: 'Plugin not found in any marketplace',
        })
        continue
      }

      
      const { entry, marketplaceInstallLocation } = pluginInfo
      if (!isLocalPluginSource(entry.source)) {
        
        await cacheAndRegisterPlugin(pluginId, entry, scope, projectPath)
      } else {
        
        registerPluginInstallation(
          {
            pluginId,
            installPath: join(marketplaceInstallLocation, entry.source),
            version: entry.version,
          },
          scope,
          projectPath,
        )
      }

      
      updatedEnabledPlugins[pluginId] = true
      installed.push(pluginId)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      failed.push({ name: pluginId, error: errorMessage })
      logError(error)
    }
  }

  
  updateSettingsForSource(settingSource, {
    ...settings,
    enabledPlugins: updatedEnabledPlugins,
  })

  return { installed, failed }
}
