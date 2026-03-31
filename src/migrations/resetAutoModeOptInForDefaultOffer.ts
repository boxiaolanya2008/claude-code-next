import { feature } from "../utils/bundle-mock.ts"
import { logEvent } from 'src/services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import { getAutoModeEnabledState } from '../utils/permissions/permissionSetup.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

export function resetAutoModeOptInForDefaultOffer(): void {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    const config = getGlobalConfig()
    if (config.hasResetAutoModeOptInForDefaultOffer) return
    if (getAutoModeEnabledState() !== 'enabled') return

    try {
      const user = getSettingsForSource('userSettings')
      if (
        user?.skipAutoPermissionPrompt &&
        user?.permissions?.defaultMode !== 'auto'
      ) {
        updateSettingsForSource('userSettings', {
          skipAutoPermissionPrompt: undefined,
        })
        logEvent('tengu_migrate_reset_auto_opt_in_for_default_offer', {})
      }

      saveGlobalConfig(c => {
        if (c.hasResetAutoModeOptInForDefaultOffer) return c
        return { ...c, hasResetAutoModeOptInForDefaultOffer: true }
      })
    } catch (error) {
      logError(new Error(`Failed to reset auto mode opt-in: ${error}`))
    }
  }
}
