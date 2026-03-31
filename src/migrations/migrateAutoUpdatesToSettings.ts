import { logEvent } from 'src/services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

export function migrateAutoUpdatesToSettings(): void {
  const globalConfig = getGlobalConfig()

  
  
  if (
    globalConfig.autoUpdates !== false ||
    globalConfig.autoUpdatesProtectedForNative === true
  ) {
    return
  }

  try {
    const userSettings = getSettingsForSource('userSettings') || {}

    // Always set DISABLE_AUTOUPDATER to preserve user intent
    
    updateSettingsForSource('userSettings', {
      ...userSettings,
      env: {
        ...userSettings.env,
        DISABLE_AUTOUPDATER: '1',
      },
    })

    logEvent('tengu_migrate_autoupdates_to_settings', {
      was_user_preference: true,
      already_had_env_var: !!userSettings.env?.DISABLE_AUTOUPDATER,
    })

    
    process.env.DISABLE_AUTOUPDATER = '1'

    
    saveGlobalConfig(current => {
      const {
        autoUpdates: _,
        autoUpdatesProtectedForNative: __,
        ...updatedConfig
      } = current
      return updatedConfig
    })
  } catch (error) {
    logError(new Error(`Failed to migrate auto-updates: ${error}`))
    logEvent('tengu_migrate_autoupdates_error', {
      has_error: true,
    })
  }
}
