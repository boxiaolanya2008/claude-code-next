import { isRemoteManagedSettingsEligible } from '../services/remoteManagedSettings/syncCache.js'
import { clearCACertsCache } from './caCerts.js'
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import {
  isProviderManagedEnvVar,
  SAFE_ENV_VARS,
} from './managedEnvConstants.js'
import { clearMTLSCache } from './mtls.js'
import { clearProxyCache, configureGlobalAgents } from './proxy.js'
import { isSettingSourceEnabled } from './settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'

function withoutSSHTunnelVars(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env || !process.env.ANTHROPIC_UNIX_SOCKET) return env || {}
  const {
    ANTHROPIC_UNIX_SOCKET: _1,
    ANTHROPIC_BASE_URL: _2,
    ANTHROPIC_API_KEY: _3,
    ANTHROPIC_AUTH_TOKEN: _4,
    CLAUDE_CODE_NEXT_OAUTH_TOKEN: _5,
    ...rest
  } = env
  return rest
}

function withoutHostManagedProviderVars(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env) return {}
  if (!isEnvTruthy(process.env.CLAUDE_CODE_NEXT_PROVIDER_MANAGED_BY_HOST)) {
    return env
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!isProviderManagedEnvVar(key)) {
      out[key] = value
    }
  }
  return out
}

let ccdSpawnEnvKeys: Set<string> | null | undefined

function withoutCcdSpawnEnvKeys(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env || !ccdSpawnEnvKeys) return env || {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!ccdSpawnEnvKeys.has(key)) out[key] = value
  }
  return out
}

function filterSettingsEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  return withoutCcdSpawnEnvKeys(
    withoutHostManagedProviderVars(withoutSSHTunnelVars(env)),
  )
}

const TRUSTED_SETTING_SOURCES = [
  'userSettings',
  'flagSettings',
  'policySettings',
] as const

export function applySafeConfigEnvironmentVariables(): void {
  
  if (ccdSpawnEnvKeys === undefined) {
    ccdSpawnEnvKeys =
      process.env.CLAUDE_CODE_NEXT_ENTRYPOINT === 'claude-desktop'
        ? new Set(Object.keys(process.env))
        : null
  }

  
  
  
  Object.assign(process.env, filterSettingsEnv(getGlobalConfig().env))

  
  
  
  
  for (const source of TRUSTED_SETTING_SOURCES) {
    if (source === 'policySettings') continue
    if (!isSettingSourceEnabled(source)) continue
    Object.assign(
      process.env,
      filterSettingsEnv(getSettingsForSource(source)?.env),
    )
  }

  
  
  
  
  
  
  isRemoteManagedSettingsEligible()

  Object.assign(
    process.env,
    filterSettingsEnv(getSettingsForSource('policySettings')?.env),
  )

  
  
  
  
  
  
  
  
  const settingsEnv = filterSettingsEnv(getSettings_DEPRECATED()?.env)
  for (const [key, value] of Object.entries(settingsEnv)) {
    if (SAFE_ENV_VARS.has(key.toUpperCase())) {
      process.env[key] = value
    }
  }
}

export function applyConfigEnvironmentVariables(): void {
  Object.assign(process.env, filterSettingsEnv(getGlobalConfig().env))

  Object.assign(process.env, filterSettingsEnv(getSettings_DEPRECATED()?.env))

  
  clearCACertsCache()
  clearMTLSCache()
  clearProxyCache()

  
  configureGlobalAgents()
}
