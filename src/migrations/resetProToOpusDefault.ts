import { logEvent } from 'src/services/analytics/index.js'
import { isProSubscriber } from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'

export function resetProToOpusDefault(): void {
  const config = getGlobalConfig()

  if (config.opusProMigrationComplete) {
    return
  }

  const apiProvider = getAPIProvider()

  
  if (apiProvider !== 'firstParty' || !isProSubscriber()) {
    saveGlobalConfig(current => ({
      ...current,
      opusProMigrationComplete: true,
    }))
    logEvent('tengu_reset_pro_to_opus_default', { skipped: true })
    return
  }

  const settings = getSettings_DEPRECATED()

  
  if (settings?.model === undefined) {
    const opusProMigrationTimestamp = Date.now()
    saveGlobalConfig(current => ({
      ...current,
      opusProMigrationComplete: true,
      opusProMigrationTimestamp,
    }))
    logEvent('tengu_reset_pro_to_opus_default', {
      skipped: false,
      had_custom_model: false,
    })
  } else {
    
    saveGlobalConfig(current => ({
      ...current,
      opusProMigrationComplete: true,
    }))
    logEvent('tengu_reset_pro_to_opus_default', {
      skipped: false,
      had_custom_model: true,
    })
  }
}
