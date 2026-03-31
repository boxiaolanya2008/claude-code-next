

import { getGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import { getSettingsForSource } from './settings/settings.js'

export function applyExtraCACertsFromConfig(): void {
  if (process.env.NODE_EXTRA_CA_CERTS) {
    return // Already set in environment, nothing to do
  }
  const configPath = getExtraCertsPathFromConfig()
  if (configPath) {
    process.env.NODE_EXTRA_CA_CERTS = configPath
    logForDebugging(
      `CA certs: Applied NODE_EXTRA_CA_CERTS from config to process.env: ${configPath}`,
    )
  }
}

/**
 * Read NODE_EXTRA_CA_CERTS from settings/config as a fallback.
 *
 * NODE_EXTRA_CA_CERTS is categorized as a non-safe env var (it allows
 * trusting attacker-controlled servers), so it's only applied to process.env
 * after the trust dialog. But we need the CA cert early to establish the TLS
 * connection to an HTTPS proxy during init().
 *
 * We read from global config (~/.claude.json) and user settings
 * (~/.claude/settings.json). These are user-controlled files that don't
 * require trust approval.
 */
function getExtraCertsPathFromConfig(): string | undefined {
  try {
    const globalConfig = getGlobalConfig()
    const globalEnv = globalConfig?.env
    
    // not project-level settings, to prevent malicious projects from
    
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
