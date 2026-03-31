import { resetSdkInitState } from '../../bootstrap/state.js'
import { isRestrictedToPluginOnly } from '../settings/pluginOnlyPolicy.js'

import * as settingsModule from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import type { HooksSettings } from '../settings/types.js'

let initialHooksConfig: HooksSettings | null = null

function getHooksFromAllowedSources(): HooksSettings {
  const policySettings = settingsModule.getSettingsForSource('policySettings')

  
  if (policySettings?.disableAllHooks === true) {
    return {}
  }

  
  if (policySettings?.allowManagedHooksOnly === true) {
    return policySettings.hooks ?? {}
  }

  
  
  
  
  
  
  
  
  if (isRestrictedToPluginOnly('hooks')) {
    return policySettings?.hooks ?? {}
  }

  const mergedSettings = settingsModule.getSettings_DEPRECATED()

  
  
  if (mergedSettings.disableAllHooks === true) {
    return policySettings?.hooks ?? {}
  }

  
  return mergedSettings.hooks ?? {}
}

export function shouldAllowManagedHooksOnly(): boolean {
  const policySettings = settingsModule.getSettingsForSource('policySettings')
  if (policySettings?.allowManagedHooksOnly === true) {
    return true
  }
  
  
  if (
    settingsModule.getSettings_DEPRECATED().disableAllHooks === true &&
    policySettings?.disableAllHooks !== true
  ) {
    return true
  }
  return false
}

export function shouldDisableAllHooksIncludingManaged(): boolean {
  return (
    settingsModule.getSettingsForSource('policySettings')?.disableAllHooks ===
    true
  )
}

export function captureHooksConfigSnapshot(): void {
  initialHooksConfig = getHooksFromAllowedSources()
}

export function updateHooksConfigSnapshot(): void {
  
  
  
  
  
  resetSettingsCache()
  initialHooksConfig = getHooksFromAllowedSources()
}

export function getHooksConfigFromSnapshot(): HooksSettings | null {
  if (initialHooksConfig === null) {
    captureHooksConfigSnapshot()
  }
  return initialHooksConfig
}

export function resetHooksConfigSnapshot(): void {
  initialHooksConfig = null
  resetSdkInitState()
}
