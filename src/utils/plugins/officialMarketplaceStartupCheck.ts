

import { join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logEvent } from '../../services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import { checkGitAvailable, markGitUnavailable } from './gitAvailability.js'
import { isSourceAllowedByPolicy } from './marketplaceHelpers.js'
import {
  addMarketplaceSource,
  getMarketplacesCacheDir,
  loadKnownMarketplacesConfig,
  saveKnownMarketplacesConfig,
} from './marketplaceManager.js'
import {
  OFFICIAL_MARKETPLACE_NAME,
  OFFICIAL_MARKETPLACE_SOURCE,
} from './officialMarketplace.js'
import { fetchOfficialMarketplaceFromGcs } from './officialMarketplaceGcs.js'

export type OfficialMarketplaceSkipReason =
  | 'already_attempted'
  | 'already_installed'
  | 'policy_blocked'
  | 'git_unavailable'
  | 'gcs_unavailable'
  | 'unknown'

export function isOfficialMarketplaceAutoInstallDisabled(): boolean {
  return isEnvTruthy(
    process.env.CLAUDE_CODE_NEXT_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL,
  )
}

export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 10,
  INITIAL_DELAY_MS: 60 * 60 * 1000, 
  BACKOFF_MULTIPLIER: 2,
  MAX_DELAY_MS: 7 * 24 * 60 * 60 * 1000, 
}

function calculateNextRetryDelay(retryCount: number): number {
  const delay =
    RETRY_CONFIG.INITIAL_DELAY_MS *
    Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, retryCount)
  return Math.min(delay, RETRY_CONFIG.MAX_DELAY_MS)
}

function shouldRetryInstallation(
  config: ReturnType<typeof getGlobalConfig>,
): boolean {
  
  if (!config.officialMarketplaceAutoInstallAttempted) {
    return true
  }

  
  if (config.officialMarketplaceAutoInstalled) {
    return false
  }

  const failReason = config.officialMarketplaceAutoInstallFailReason
  const retryCount = config.officialMarketplaceAutoInstallRetryCount || 0
  const nextRetryTime = config.officialMarketplaceAutoInstallNextRetryTime
  const now = Date.now()

  
  if (retryCount >= RETRY_CONFIG.MAX_ATTEMPTS) {
    return false
  }

  
  if (failReason === 'policy_blocked') {
    return false
  }

  
  if (nextRetryTime && now < nextRetryTime) {
    return false
  }

  
  
  return (
    failReason === 'unknown' ||
    failReason === 'git_unavailable' ||
    failReason === 'gcs_unavailable' ||
    failReason === undefined
  )
}

export type OfficialMarketplaceCheckResult = {
  
  installed: boolean
  
  skipped: boolean
  
  reason?: OfficialMarketplaceSkipReason
  
  configSaveFailed?: boolean
}

export async function checkAndInstallOfficialMarketplace(): Promise<OfficialMarketplaceCheckResult> {
  const config = getGlobalConfig()

  
  if (!shouldRetryInstallation(config)) {
    const reason: OfficialMarketplaceSkipReason =
      config.officialMarketplaceAutoInstallFailReason ?? 'already_attempted'
    logForDebugging(`Official marketplace auto-install skipped: ${reason}`)
    return {
      installed: false,
      skipped: true,
      reason,
    }
  }

  try {
    
    if (isOfficialMarketplaceAutoInstallDisabled()) {
      logForDebugging(
        'Official marketplace auto-install disabled via env var, skipping',
      )
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'policy_blocked',
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        policy_blocked: true,
      })
      return { installed: false, skipped: true, reason: 'policy_blocked' }
    }

    
    const knownMarketplaces = await loadKnownMarketplacesConfig()
    if (knownMarketplaces[OFFICIAL_MARKETPLACE_NAME]) {
      logForDebugging(
        `Official marketplace '${OFFICIAL_MARKETPLACE_NAME}' already installed, skipping`,
      )
      
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: true,
      }))
      return { installed: false, skipped: true, reason: 'already_installed' }
    }

    
    if (!isSourceAllowedByPolicy(OFFICIAL_MARKETPLACE_SOURCE)) {
      logForDebugging(
        'Official marketplace blocked by enterprise policy, skipping',
      )
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'policy_blocked',
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        policy_blocked: true,
      })
      return { installed: false, skipped: true, reason: 'policy_blocked' }
    }

    
    
    
    
    
    const cacheDir = getMarketplacesCacheDir()
    const installLocation = join(cacheDir, OFFICIAL_MARKETPLACE_NAME)
    const gcsSha = await fetchOfficialMarketplaceFromGcs(
      installLocation,
      cacheDir,
    )
    if (gcsSha !== null) {
      const known = await loadKnownMarketplacesConfig()
      known[OFFICIAL_MARKETPLACE_NAME] = {
        source: OFFICIAL_MARKETPLACE_SOURCE,
        installLocation,
        lastUpdated: new Date().toISOString(),
      }
      await saveKnownMarketplacesConfig(known)

      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: true,
        officialMarketplaceAutoInstallFailReason: undefined,
        officialMarketplaceAutoInstallRetryCount: undefined,
        officialMarketplaceAutoInstallLastAttemptTime: undefined,
        officialMarketplaceAutoInstallNextRetryTime: undefined,
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: true,
        skipped: false,
        via_gcs: true,
      })
      return { installed: true, skipped: false }
    }
    
    
    if (
      !getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_plugin_official_mkt_git_fallback',
        true,
      )
    ) {
      logForDebugging(
        'Official marketplace GCS failed; git fallback disabled by flag — skipping install',
      )
      
      
      const retryCount =
        (config.officialMarketplaceAutoInstallRetryCount || 0) + 1
      const now = Date.now()
      const nextRetryTime = now + calculateNextRetryDelay(retryCount)
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'gcs_unavailable',
        officialMarketplaceAutoInstallRetryCount: retryCount,
        officialMarketplaceAutoInstallLastAttemptTime: now,
        officialMarketplaceAutoInstallNextRetryTime: nextRetryTime,
      }))
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        gcs_unavailable: true,
        retry_count: retryCount,
      })
      return { installed: false, skipped: true, reason: 'gcs_unavailable' }
    }

    
    const gitAvailable = await checkGitAvailable()
    if (!gitAvailable) {
      logForDebugging(
        'Git not available, skipping official marketplace auto-install',
      )
      const retryCount =
        (config.officialMarketplaceAutoInstallRetryCount || 0) + 1
      const now = Date.now()
      const nextRetryDelay = calculateNextRetryDelay(retryCount)
      const nextRetryTime = now + nextRetryDelay

      let configSaveFailed = false
      try {
        saveGlobalConfig(current => ({
          ...current,
          officialMarketplaceAutoInstallAttempted: true,
          officialMarketplaceAutoInstalled: false,
          officialMarketplaceAutoInstallFailReason: 'git_unavailable',
          officialMarketplaceAutoInstallRetryCount: retryCount,
          officialMarketplaceAutoInstallLastAttemptTime: now,
          officialMarketplaceAutoInstallNextRetryTime: nextRetryTime,
        }))
      } catch (saveError) {
        configSaveFailed = true
        
        const configError = toError(saveError)
        logError(configError)

        logForDebugging(
          `Failed to save marketplace auto-install git_unavailable state: ${saveError}`,
          { level: 'error' },
        )
      }
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        git_unavailable: true,
        retry_count: retryCount,
      })
      return {
        installed: false,
        skipped: true,
        reason: 'git_unavailable',
        configSaveFailed,
      }
    }

    
    logForDebugging('Attempting to auto-install official marketplace')
    await addMarketplaceSource(OFFICIAL_MARKETPLACE_SOURCE)

    
    logForDebugging('Successfully auto-installed official marketplace')
    const previousRetryCount =
      config.officialMarketplaceAutoInstallRetryCount || 0
    saveGlobalConfig(current => ({
      ...current,
      officialMarketplaceAutoInstallAttempted: true,
      officialMarketplaceAutoInstalled: true,
      
      officialMarketplaceAutoInstallFailReason: undefined,
      officialMarketplaceAutoInstallRetryCount: undefined,
      officialMarketplaceAutoInstallLastAttemptTime: undefined,
      officialMarketplaceAutoInstallNextRetryTime: undefined,
    }))
    logEvent('tengu_official_marketplace_auto_install', {
      installed: true,
      skipped: false,
      retry_count: previousRetryCount,
    })
    return { installed: true, skipped: false }
  } catch (error) {
    
    const errorMessage = error instanceof Error ? error.message : String(error)

    
    
    
    
    
    
    
    if (errorMessage.includes('xcrun: error:')) {
      markGitUnavailable()
      logForDebugging(
        'Official marketplace auto-install: git is a non-functional macOS xcrun shim, treating as git_unavailable',
      )
      logEvent('tengu_official_marketplace_auto_install', {
        installed: false,
        skipped: true,
        git_unavailable: true,
        macos_xcrun_shim: true,
      })
      return {
        installed: false,
        skipped: true,
        reason: 'git_unavailable',
      }
    }

    logForDebugging(
      `Failed to auto-install official marketplace: ${errorMessage}`,
      { level: 'error' },
    )
    logError(toError(error))

    const retryCount =
      (config.officialMarketplaceAutoInstallRetryCount || 0) + 1
    const now = Date.now()
    const nextRetryDelay = calculateNextRetryDelay(retryCount)
    const nextRetryTime = now + nextRetryDelay

    let configSaveFailed = false
    try {
      saveGlobalConfig(current => ({
        ...current,
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: false,
        officialMarketplaceAutoInstallFailReason: 'unknown',
        officialMarketplaceAutoInstallRetryCount: retryCount,
        officialMarketplaceAutoInstallLastAttemptTime: now,
        officialMarketplaceAutoInstallNextRetryTime: nextRetryTime,
      }))
    } catch (saveError) {
      configSaveFailed = true
      
      const configError = toError(saveError)
      logError(configError)

      logForDebugging(
        `Failed to save marketplace auto-install failure state: ${saveError}`,
        { level: 'error' },
      )

      
      
    }
    logEvent('tengu_official_marketplace_auto_install', {
      installed: false,
      skipped: true,
      failed: true,
      retry_count: retryCount,
    })

    return {
      installed: false,
      skipped: true,
      reason: 'unknown',
      configSaveFailed,
    }
  }
}
