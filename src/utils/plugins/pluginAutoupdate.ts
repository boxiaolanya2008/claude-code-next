

import { updatePluginOp } from '../../services/plugins/pluginOperations.js'
import { shouldSkipPluginAutoupdate } from '../config.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import {
  getPendingUpdatesDetails,
  hasPendingUpdates,
  isInstallationRelevantToCurrentProject,
  loadInstalledPluginsFromDisk,
} from './installedPluginsManager.js'
import {
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
  refreshMarketplace,
} from './marketplaceManager.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'
import { isMarketplaceAutoUpdate, type PluginScope } from './schemas.js'

export type PluginAutoUpdateCallback = (updatedPlugins: string[]) => void

let pluginUpdateCallback: PluginAutoUpdateCallback | null = null

let pendingNotification: string[] | null = null

export function onPluginsAutoUpdated(
  callback: PluginAutoUpdateCallback,
): () => void {
  pluginUpdateCallback = callback

  
  if (pendingNotification !== null && pendingNotification.length > 0) {
    callback(pendingNotification)
    pendingNotification = null
  }

  return () => {
    pluginUpdateCallback = null
  }
}

export function getAutoUpdatedPluginNames(): string[] {
  if (!hasPendingUpdates()) {
    return []
  }
  return getPendingUpdatesDetails().map(
    d => parsePluginIdentifier(d.pluginId).name,
  )
}

async function getAutoUpdateEnabledMarketplaces(): Promise<Set<string>> {
  const config = await loadKnownMarketplacesConfig()
  const declared = getDeclaredMarketplaces()
  const enabled = new Set<string>()

  for (const [name, entry] of Object.entries(config)) {
    
    const declaredAutoUpdate = declared[name]?.autoUpdate
    const autoUpdate =
      declaredAutoUpdate !== undefined
        ? declaredAutoUpdate
        : isMarketplaceAutoUpdate(name, entry)
    if (autoUpdate) {
      enabled.add(name.toLowerCase())
    }
  }

  return enabled
}

async function updatePlugin(
  pluginId: string,
  installations: Array<{ scope: PluginScope; projectPath?: string }>,
): Promise<string | null> {
  let wasUpdated = false

  for (const { scope } of installations) {
    try {
      const result = await updatePluginOp(pluginId, scope)

      if (result.success && !result.alreadyUpToDate) {
        wasUpdated = true
        logForDebugging(
          `Plugin autoupdate: updated ${pluginId} from ${result.oldVersion} to ${result.newVersion}`,
        )
      } else if (!result.alreadyUpToDate) {
        logForDebugging(
          `Plugin autoupdate: failed to update ${pluginId}: ${result.message}`,
          { level: 'warn' },
        )
      }
    } catch (error) {
      logForDebugging(
        `Plugin autoupdate: error updating ${pluginId}: ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }

  return wasUpdated ? pluginId : null
}

export async function updatePluginsForMarketplaces(
  marketplaceNames: Set<string>,
): Promise<string[]> {
  const installedPlugins = loadInstalledPluginsFromDisk()
  const pluginIds = Object.keys(installedPlugins.plugins)

  if (pluginIds.length === 0) {
    return []
  }

  const results = await Promise.allSettled(
    pluginIds.map(async pluginId => {
      const { marketplace } = parsePluginIdentifier(pluginId)
      if (!marketplace || !marketplaceNames.has(marketplace.toLowerCase())) {
        return null
      }

      const allInstallations = installedPlugins.plugins[pluginId]
      if (!allInstallations || allInstallations.length === 0) {
        return null
      }

      const relevantInstallations = allInstallations.filter(
        isInstallationRelevantToCurrentProject,
      )
      if (relevantInstallations.length === 0) {
        return null
      }

      return updatePlugin(pluginId, relevantInstallations)
    }),
  )

  return results
    .filter(
      (r): r is PromiseFulfilledResult<string> =>
        r.status === 'fulfilled' && r.value !== null,
    )
    .map(r => r.value)
}

async function updatePlugins(
  autoUpdateEnabledMarketplaces: Set<string>,
): Promise<string[]> {
  return updatePluginsForMarketplaces(autoUpdateEnabledMarketplaces)
}

export function autoUpdateMarketplacesAndPluginsInBackground(): void {
  void (async () => {
    if (shouldSkipPluginAutoupdate()) {
      logForDebugging('Plugin autoupdate: skipped (auto-updater disabled)')
      return
    }

    try {
      
      const autoUpdateEnabledMarketplaces =
        await getAutoUpdateEnabledMarketplaces()

      if (autoUpdateEnabledMarketplaces.size === 0) {
        return
      }

      
      const refreshResults = await Promise.allSettled(
        Array.from(autoUpdateEnabledMarketplaces).map(async name => {
          try {
            await refreshMarketplace(name, undefined, {
              disableCredentialHelper: true,
            })
          } catch (error) {
            logForDebugging(
              `Plugin autoupdate: failed to refresh marketplace ${name}: ${errorMessage(error)}`,
              { level: 'warn' },
            )
          }
        }),
      )

      
      const failures = refreshResults.filter(r => r.status === 'rejected')
      if (failures.length > 0) {
        logForDebugging(
          `Plugin autoupdate: ${failures.length} marketplace refresh(es) failed`,
          { level: 'warn' },
        )
      }

      logForDebugging('Plugin autoupdate: checking installed plugins')
      const updatedPlugins = await updatePlugins(autoUpdateEnabledMarketplaces)

      if (updatedPlugins.length > 0) {
        if (pluginUpdateCallback) {
          
          pluginUpdateCallback(updatedPlugins)
        } else {
          
          pendingNotification = updatedPlugins
        }
      }
    } catch (error) {
      logError(error)
    }
  })()
}
