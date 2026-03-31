

import type { AppState } from '../../state/AppState.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { logError } from '../../utils/log.js'
import {
  clearMarketplacesCache,
  getDeclaredMarketplaces,
  loadKnownMarketplacesConfig,
} from '../../utils/plugins/marketplaceManager.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import {
  diffMarketplaces,
  reconcileMarketplaces,
} from '../../utils/plugins/reconciler.js'
import { refreshActivePlugins } from '../../utils/plugins/refresh.js'
import { logEvent } from '../analytics/index.js'

type SetAppState = (f: (prevState: AppState) => AppState) => void

function updateMarketplaceStatus(
  setAppState: SetAppState,
  name: string,
  status: 'pending' | 'installing' | 'installed' | 'failed',
  error?: string,
): void {
  setAppState(prevState => ({
    ...prevState,
    plugins: {
      ...prevState.plugins,
      installationStatus: {
        ...prevState.plugins.installationStatus,
        marketplaces: prevState.plugins.installationStatus.marketplaces.map(
          m => (m.name === name ? { ...m, status, error } : m),
        ),
      },
    },
  }))
}

export async function performBackgroundPluginInstallations(
  setAppState: SetAppState,
): Promise<void> {
  logForDebugging('performBackgroundPluginInstallations called')

  try {
    
    const declared = getDeclaredMarketplaces()
    const materialized = await loadKnownMarketplacesConfig().catch(() => ({}))
    const diff = diffMarketplaces(declared, materialized)

    const pendingNames = [
      ...diff.missing,
      ...diff.sourceChanged.map(c => c.name),
    ]

    
    
    
    setAppState(prev => ({
      ...prev,
      plugins: {
        ...prev.plugins,
        installationStatus: {
          marketplaces: pendingNames.map(name => ({
            name,
            status: 'pending' as const,
          })),
          plugins: [],
        },
      },
    }))

    if (pendingNames.length === 0) {
      return
    }

    logForDebugging(
      `Installing ${pendingNames.length} marketplace(s) in background`,
    )

    const result = await reconcileMarketplaces({
      onProgress: event => {
        switch (event.type) {
          case 'installing':
            updateMarketplaceStatus(setAppState, event.name, 'installing')
            break
          case 'installed':
            updateMarketplaceStatus(setAppState, event.name, 'installed')
            break
          case 'failed':
            updateMarketplaceStatus(
              setAppState,
              event.name,
              'failed',
              event.error,
            )
            break
        }
      },
    })

    const metrics = {
      installed_count: result.installed.length,
      updated_count: result.updated.length,
      failed_count: result.failed.length,
      up_to_date_count: result.upToDate.length,
    }
    logEvent('tengu_marketplace_background_install', metrics)
    logForDiagnosticsNoPII(
      'info',
      'tengu_marketplace_background_install',
      metrics,
    )

    if (result.installed.length > 0) {
      
      
      
      
      
      clearMarketplacesCache()
      logForDebugging(
        `Auto-refreshing plugins after ${result.installed.length} new marketplace(s) installed`,
      )
      try {
        await refreshActivePlugins(setAppState)
      } catch (refreshError) {
        
        
        logError(refreshError)
        logForDebugging(
          `Auto-refresh failed, falling back to needsRefresh: ${refreshError}`,
          { level: 'warn' },
        )
        clearPluginCache(
          'performBackgroundPluginInstallations: auto-refresh failed',
        )
        setAppState(prev => {
          if (prev.plugins.needsRefresh) return prev
          return {
            ...prev,
            plugins: { ...prev.plugins, needsRefresh: true },
          }
        })
      }
    } else if (result.updated.length > 0) {
      
      
      clearMarketplacesCache()
      clearPluginCache(
        'performBackgroundPluginInstallations: marketplaces reconciled',
      )
      setAppState(prev => {
        if (prev.plugins.needsRefresh) return prev
        return {
          ...prev,
          plugins: { ...prev.plugins, needsRefresh: true },
        }
      })
    }
  } catch (error) {
    logError(error)
  }
}
