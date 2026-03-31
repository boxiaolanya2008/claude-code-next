

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

  // Ensure zip cache directory structure exists
  if (zipCacheMode) {
    await getFsImplementation().mkdir(getZipCacheMarketplacesDir())
    await getFsImplementation().mkdir(getZipCachePluginsDir())
  }

  // Declared now includes an implicit claude-plugins-official entry when any
  
  
  
  
  const declaredCount = Object.keys(getDeclaredMarketplaces()).length

  const metrics = {
    marketplaces_installed: 0,
    delisted_count: 0,
  }

  // Initialize from seedChanged so the caller (print.ts) calls
  
  
  
  let pluginsChanged = seedChanged

  try {
    if (declaredCount === 0) {
      logForDebugging('installPluginsForHeadless: no marketplaces declared')
    } else {
      // Reconcile declared marketplaces (settings intent + implicit official)
      
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

    // Zip cache: save marketplace JSONs for offline access on ephemeral containers.
    
    
    if (zipCacheMode) {
      await syncMarketplacesToZipCache()
    }

    // Delisting enforcement
    const newlyDelisted = await detectAndUninstallDelistedPlugins()
    metrics.delisted_count = newlyDelisted.length
    if (newlyDelisted.length > 0) {
      pluginsChanged = true
    }

    if (pluginsChanged) {
      clearPluginCache('headlessPluginInstall: plugins changed')
    }

    // Zip cache: register session cleanup for extracted plugin temp dirs
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
