

import { getGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { getSettingsForSource } from './settings/settings.js'

export function applyExtraCACertsFromConfig(): void {
  if (process.env.NODE_EXTRA_CA_CERTS) {
    return 
  }
  const configPath = getExtraCertsPathFromConfig()
  if (configPath) {
    process.env.NODE_EXTRA_CA_CERTS = configPath
    logForDebugging(
      `CA certs: Applied NODE_EXTRA_CA_CERTS from config to process.env: ${configPath}`,
    )
  }
}

function getExtraCertsPathFromConfig(): string | undefined {
  try {
    const globalConfig = getGlobalConfig()
    const globalEnv = globalConfig?.env
    
    
    
    const settings = getSettingsForSource('userSettings')
    const settingsEnv = settings?.env

    logForDebugging(
      `CA certs: Config fallback - globalEnv keys: ${globalEnv ? Object.keys(globalEnv).join(',') : 'none'}, settingsEnv keys: ${settingsEnv ? Object.keys(settingsEnv).join(',') : 'none'}`,
    )

    
    const path =
      settingsEnv?.NODE_EXTRA_CA_CERTS || globalEnv?.NODE_EXTRA_CA_CERTS
    if (path) {
      logForDebugging(
        `CA certs: Found NODE_EXTRA_CA_CERTS in config/settings: ${path}`,
      )
    }
    return path
  } catch (error) {
    logForDebugging(`CA certs: Config fallback failed: ${error}`, {
      level: 'error',
    })
    return undefined
  }
}
