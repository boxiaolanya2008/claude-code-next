import {
  DANGEROUS_SHELL_SETTINGS,
  SAFE_ENV_VARS,
} from '../../utils/managedEnvConstants.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import { jsonStringify } from '../../utils/slowOperations.js'

type DangerousShellSetting = (typeof DANGEROUS_SHELL_SETTINGS)[number]

export type DangerousSettings = {
  shellSettings: Partial<Record<DangerousShellSetting, string>>
  envVars: Record<string, string>
  hasHooks: boolean
  hooks?: unknown
}

export function extractDangerousSettings(
  settings: SettingsJson | null | undefined,
): DangerousSettings {
  if (!settings) {
    return {
      shellSettings: {},
      envVars: {},
      hasHooks: false,
    }
  }

  
  const shellSettings: Partial<Record<DangerousShellSetting, string>> = {}
  for (const key of DANGEROUS_SHELL_SETTINGS) {
    const value = settings[key]
    if (typeof value === 'string' && value.length > 0) {
      shellSettings[key] = value
    }
  }

  
  const envVars: Record<string, string> = {}
  if (settings.env && typeof settings.env === 'object') {
    for (const [key, value] of Object.entries(settings.env)) {
      if (typeof value === 'string' && value.length > 0) {
        
        if (!SAFE_ENV_VARS.has(key.toUpperCase())) {
          envVars[key] = value
        }
      }
    }
  }

  
  const hasHooks =
    settings.hooks !== undefined &&
    settings.hooks !== null &&
    typeof settings.hooks === 'object' &&
    Object.keys(settings.hooks).length > 0

  return {
    shellSettings,
    envVars,
    hasHooks,
    hooks: hasHooks ? settings.hooks : undefined,
  }
}

export function hasDangerousSettings(dangerous: DangerousSettings): boolean {
  return (
    Object.keys(dangerous.shellSettings).length > 0 ||
    Object.keys(dangerous.envVars).length > 0 ||
    dangerous.hasHooks
  )
}

export function hasDangerousSettingsChanged(
  oldSettings: SettingsJson | null | undefined,
  newSettings: SettingsJson | null | undefined,
): boolean {
  const oldDangerous = extractDangerousSettings(oldSettings)
  const newDangerous = extractDangerousSettings(newSettings)

  
  if (!hasDangerousSettings(newDangerous)) {
    return false
  }

  
  if (!hasDangerousSettings(oldDangerous)) {
    return true
  }

  
  const oldJson = jsonStringify({
    shellSettings: oldDangerous.shellSettings,
    envVars: oldDangerous.envVars,
    hooks: oldDangerous.hooks,
  })
  const newJson = jsonStringify({
    shellSettings: newDangerous.shellSettings,
    envVars: newDangerous.envVars,
    hooks: newDangerous.hooks,
  })

  return oldJson !== newJson
}

export function formatDangerousSettingsList(
  dangerous: DangerousSettings,
): string[] {
  const items: string[] = []

  
  for (const key of Object.keys(dangerous.shellSettings)) {
    items.push(key)
  }

  
  for (const key of Object.keys(dangerous.envVars)) {
    items.push(key)
  }

  
  if (dangerous.hasHooks) {
    items.push('hooks')
  }

  return items
}
