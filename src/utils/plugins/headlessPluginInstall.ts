

import { logEvent } from '../../services/analytics/index.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { withDiagnosticsTiming } from '../diagLogs.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import {
  clearMarketplacesCache,
  getDeclaredMarketplaces,
  registerSeedMarketplaces,
} from './marketplaceManager.js'
import { detectAndUninstallDelistedPlugins } from './pluginBlocklist.js'
import { clearPluginCache } from './pluginLoader.js'
import { reconcileMarketplaces } from './reconciler.js'
import {
  cleanupSessionPluginCache,
  getZipCacheMarketplacesDir,
  getZipCachePluginsDir,
  isMarketplaceSourceSupportedByZipCache,
  isPluginZipCacheEnabled,
} from './zipCache.js'
import { syncMarketplacesToZipCache } from './zipCacheAdapters.js'

export async function installPluginsForHeadless(): Promise<boolean> {
  const zipCacheMode = isPluginZipCacheEnabled()
  logForDebugging(
    `installPluginsForHeadless: starting${zipCacheMode ? ' (zip cache mode)' : ''}`,
  )

  
  
  
  
  
  
  
  
  
  const seedChanged = await registerSeedMarketplaces()
  if (seedChanged) {
    clearMarketplacesCache()
    clearPluginCache('headlessPluginInstall: seed marketplaces registered')
  }

  
  if (zipCacheMode) {
    await getFsImplementation().mkdir(getZipCacheMarketplacesDir())
    await getFsImplementation().mkdir(getZipCachePluginsDir())
  }

  
  
  
  
  
  const declaredCount = Object.keys(getDeclaredMarketplaces()).length

  const metrics = {
    marketplaces_installed: 0,
    delisted_count: 0,
  }

  
  
  
  
  let pluginsChanged = seedChanged

  try {
    if (declaredCount === 0) {
      logForDebugging('installPluginsForHeadless: no marketplaces declared')
    } else {
      
      
      const reconcileResult = await withDiagnosticsTiming(
        'headless_marketplace_reconcile',
        () =>
          reconcileMarketplaces({
            skip: zipCacheMode
              ? (_name, source) =>
                  !isMarketplaceSourceSupportedByZipCache(source)
              : undefined,
            onProgress: event => {
              if (event.type === 'installed') {
                logForDebugging(
                  `installPluginsForHeadless: installed marketplace ${event.name}`,
                )
              } else if (event.type === 'failed') {
                logForDebugging(
                  `installPluginsForHeadless: failed to install marketplace ${event.name}: ${event.error}`,
                )
              }
            },
          }),
        r => ({
          installed_count: r.installed.length,
          updated_count: r.updated.length,
          failed_count: r.failed.length,
          skipped_count: r.skipped.length,
        }),
      )

      if (reconcileResult.skipped.length > 0) {
        logForDebugging(
          `installPluginsForHeadless: skipped ${reconcileResult.skipped.length} marketplace(s) unsupported by zip cache: ${reconcileResult.skipped.join(', ')}`,
        )
      }

      const marketplacesChanged =
        reconcileResult.installed.length + reconcileResult.updated.length

      
      
      
      
      if (marketplacesChanged > 0) {
        clearMarketplacesCache()
        clearPluginCache('headlessPluginInstall: marketplaces reconciled')
        pluginsChanged = true
      }

      metrics.marketplaces_installed = marketplacesChanged
    }

    
    
    
    if (zipCacheMode) {
      await syncMarketplacesToZipCache()
    }

    
    const newlyDelisted = await detectAndUninstallDelistedPlugins()
    metrics.delisted_count = newlyDelisted.length
    if (newlyDelisted.length > 0) {
      pluginsChanged = true
    }

    if (pluginsChanged) {
      clearPluginCache('headlessPluginInstall: plugins changed')
    }

    
    if (zipCacheMode) {
      registerCleanup(cleanupSessionPluginCache)
    }

    return pluginsChanged
  } catch (error) {
    logError(error)
    return false
  } finally {
    logEvent('tengu_headless_plugin_install', metrics)
  }
}
