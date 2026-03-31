

import { uninstallPluginOp } from '../../services/plugins/pluginOperations.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { loadInstalledPluginsV2 } from './installedPluginsManager.js'
import {
  getMarketplace,
  loadKnownMarketplacesConfigSafe,
} from './marketplaceManager.js'
import {
  addFlaggedPlugin,
  getFlaggedPlugins,
  loadFlaggedPlugins,
} from './pluginFlagging.js'
import type { InstalledPluginsFileV2, PluginMarketplace } from './schemas.js'

export function detectDelistedPlugins(
  installedPlugins: InstalledPluginsFileV2,
  marketplace: PluginMarketplace,
  marketplaceName: string,
): string[] {
  const marketplacePluginNames = new Set(marketplace.plugins.map(p => p.name))
  const suffix = `@${marketplaceName}`

  const delisted: string[] = []
  for (const pluginId of Object.keys(installedPlugins.plugins)) {
    if (!pluginId.endsWith(suffix)) continue

    const pluginName = pluginId.slice(0, -suffix.length)
    if (!marketplacePluginNames.has(pluginName)) {
      delisted.push(pluginId)
    }
  }

  return delisted
}

export async function detectAndUninstallDelistedPlugins(): Promise<string[]> {
  await loadFlaggedPlugins()

  const installedPlugins = loadInstalledPluginsV2()
  const alreadyFlagged = getFlaggedPlugins()
  
  
  
  const knownMarketplaces = await loadKnownMarketplacesConfigSafe()
  const newlyFlagged: string[] = []

  for (const marketplaceName of Object.keys(knownMarketplaces)) {
    try {
      const marketplace = await getMarketplace(marketplaceName)

      if (!marketplace.forceRemoveDeletedPlugins) continue

      const delisted = detectDelistedPlugins(
        installedPlugins,
        marketplace,
        marketplaceName,
      )

      for (const pluginId of delisted) {
        if (pluginId in alreadyFlagged) continue

        
        const installations = installedPlugins.plugins[pluginId] ?? []
        const hasUserInstall = installations.some(
          i =>
            i.scope === 'user' || i.scope === 'project' || i.scope === 'local',
        )
        if (!hasUserInstall) continue

        
        for (const installation of installations) {
          const { scope } = installation
          if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
            continue
          }
          try {
            await uninstallPluginOp(pluginId, scope)
          } catch (error) {
            logForDebugging(
              `Failed to auto-uninstall delisted plugin ${pluginId} from ${scope}: ${errorMessage(error)}`,
              { level: 'error' },
            )
          }
        }

        await addFlaggedPlugin(pluginId)
        newlyFlagged.push(pluginId)
      }
    } catch (error) {
      
      logForDebugging(
        `Failed to check for delisted plugins in "${marketplaceName}": ${errorMessage(error)}`,
        { level: 'warn' },
      )
    }
  }

  return newlyFlagged
}
