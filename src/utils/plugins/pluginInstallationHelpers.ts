

import { randomBytes } from 'crypto'
import { rename, rm } from 'fs/promises'
import { dirname, join, resolve, sep } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import { getCwd } from '../cwd.js'
import { toError } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import { buildPluginTelemetryFields } from '../telemetry/pluginTelemetry.js'
import { clearAllCaches } from './cacheUtils.js'
import {
  formatDependencyCountSuffix,
  getEnabledPluginIdsForScope,
  type ResolutionResult,
  resolveDependencyClosure,
} from './dependencyResolver.js'
import {
  addInstalledPlugin,
  getGitCommitSha,
} from './installedPluginsManager.js'
import { getManagedPluginNames } from './managedPlugins.js'
import { getMarketplaceCacheOnly, getPluginById } from './marketplaceManager.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
  scopeToSettingSource,
} from './pluginIdentifier.js'
import {
  cachePlugin,
  getVersionedCachePath,
  getVersionedZipCachePath,
} from './pluginLoader.js'
import { isPluginBlockedByPolicy } from './pluginPolicy.js'
import { calculatePluginVersion } from './pluginVersioning.js'
import {
  isLocalPluginSource,
  type PluginMarketplaceEntry,
  type PluginScope,
  type PluginSource,
} from './schemas.js'
import {
  convertDirectoryToZipInPlace,
  isPluginZipCacheEnabled,
} from './zipCache.js'

export type PluginInstallationInfo = {
  pluginId: string
  installPath: string
  version?: string
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

export function validatePathWithinBase(
  basePath: string,
  relativePath: string,
): string {
  const resolvedPath = resolve(basePath, relativePath)
  const normalizedBase = resolve(basePath) + sep

  
  
  
  if (
    !resolvedPath.startsWith(normalizedBase) &&
    resolvedPath !== resolve(basePath)
  ) {
    throw new Error(
      `Path traversal detected: "${relativePath}" would escape the base directory`,
    )
  }

  return resolvedPath
}

export async function cacheAndRegisterPlugin(
  pluginId: string,
  entry: PluginMarketplaceEntry,
  scope: PluginScope = 'user',
  projectPath?: string,
  localSourcePath?: string,
): Promise<string> {
  
  
  const source: PluginSource =
    typeof entry.source === 'string' && localSourcePath
      ? (localSourcePath as PluginSource)
      : entry.source

  const cacheResult = await cachePlugin(source, {
    manifest: entry as PluginMarketplaceEntry,
  })

  
  
  
  
  
  const pathForGitSha = localSourcePath || cacheResult.path
  const gitCommitSha =
    cacheResult.gitCommitSha ?? (await getGitCommitSha(pathForGitSha))

  const now = getCurrentTimestamp()
  const version = await calculatePluginVersion(
    pluginId,
    entry.source,
    cacheResult.manifest,
    pathForGitSha,
    entry.version,
    cacheResult.gitCommitSha,
  )

  
  const versionedPath = getVersionedCachePath(pluginId, version)
  let finalPath = cacheResult.path

  
  if (cacheResult.path !== versionedPath) {
    
    await getFsImplementation().mkdir(dirname(versionedPath))

    
    await rm(versionedPath, { recursive: true, force: true })

    
    
    
    const normalizedCachePath = cacheResult.path.endsWith(sep)
      ? cacheResult.path
      : cacheResult.path + sep
    const isSubdirectory = versionedPath.startsWith(normalizedCachePath)

    if (isSubdirectory) {
      
      
      
      
      const tempPath = join(
        dirname(cacheResult.path),
        `.claude-plugin-temp-${Date.now()}-${randomBytes(4).toString('hex')}`,
      )
      await rename(cacheResult.path, tempPath)
      await getFsImplementation().mkdir(dirname(versionedPath))
      await rename(tempPath, versionedPath)
    } else {
      
      await rename(cacheResult.path, versionedPath)
    }
    finalPath = versionedPath
  }

  
  if (isPluginZipCacheEnabled()) {
    const zipPath = getVersionedZipCachePath(pluginId, version)
    await convertDirectoryToZipInPlace(finalPath, zipPath)
    finalPath = zipPath
  }

  
  addInstalledPlugin(
    pluginId,
    {
      version,
      installedAt: now,
      lastUpdated: now,
      installPath: finalPath,
      gitCommitSha,
    },
    scope,
    projectPath,
  )

  return finalPath
}

export function registerPluginInstallation(
  info: PluginInstallationInfo,
  scope: PluginScope = 'user',
  projectPath?: string,
): void {
  const now = getCurrentTimestamp()
  addInstalledPlugin(
    info.pluginId,
    {
      version: info.version || 'unknown',
      installedAt: now,
      lastUpdated: now,
      installPath: info.installPath,
    },
    scope,
    projectPath,
  )
}

export function parsePluginId(
  pluginId: string,
): { name: string; marketplace: string } | null {
  const parts = pluginId.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null
  }

  return {
    name: parts[0],
    marketplace: parts[1],
  }
}

export type InstallCoreResult =
  | { ok: true; closure: string[]; depNote: string }
  | { ok: false; reason: 'local-source-no-location'; pluginName: string }
  | { ok: false; reason: 'settings-write-failed'; message: string }
  | {
      ok: false
      reason: 'resolution-failed'
      resolution: ResolutionResult & { ok: false }
    }
  | { ok: false; reason: 'blocked-by-policy'; pluginName: string }
  | {
      ok: false
      reason: 'dependency-blocked-by-policy'
      pluginName: string
      blockedDependency: string
    }

export function formatResolutionError(
  r: ResolutionResult & { ok: false },
): string {
  switch (r.reason) {
    case 'cycle':
      return `Dependency cycle: ${r.chain.join(' → ')}`
    case 'cross-marketplace': {
      const depMkt = parsePluginIdentifier(r.dependency).marketplace
      const where = depMkt
        ? `marketplace "${depMkt}"`
        : 'a different marketplace'
      const hint = depMkt
        ? ` Add "${depMkt}" to allowCrossMarketplaceDependenciesOn in the ROOT marketplace's marketplace.json (the marketplace of the plugin you're installing — only its allowlist applies; no transitive trust).`
        : ''
      return `Dependency "${r.dependency}" (required by ${r.requiredBy}) is in ${where}, which is not in the allowlist — cross-marketplace dependencies are blocked by default. Install it manually first.${hint}`
    }
    case 'not-found': {
      const { marketplace: depMkt } = parsePluginIdentifier(r.missing)
      return depMkt
        ? `Dependency "${r.missing}" (required by ${r.requiredBy}) not found. Is the "${depMkt}" marketplace added?`
        : `Dependency "${r.missing}" (required by ${r.requiredBy}) not found in any configured marketplace`
    }
  }
}

export async function installResolvedPlugin({
  pluginId,
  entry,
  scope,
  marketplaceInstallLocation,
}: {
  pluginId: string
  entry: PluginMarketplaceEntry
  scope: 'user' | 'project' | 'local'
  marketplaceInstallLocation?: string
}): Promise<InstallCoreResult> {
  const settingSource = scopeToSettingSource(scope)

  
  
  
  
  if (isPluginBlockedByPolicy(pluginId)) {
    return { ok: false, reason: 'blocked-by-policy', pluginName: entry.name }
  }

  
  
  
  const depInfo = new Map<
    string,
    { entry: PluginMarketplaceEntry; marketplaceInstallLocation: string }
  >()
  
  
  
  
  if (isLocalPluginSource(entry.source) && !marketplaceInstallLocation) {
    return {
      ok: false,
      reason: 'local-source-no-location',
      pluginName: entry.name,
    }
  }
  if (marketplaceInstallLocation) {
    depInfo.set(pluginId, { entry, marketplaceInstallLocation })
  }

  const rootMarketplace = parsePluginIdentifier(pluginId).marketplace
  const allowedCrossMarketplaces = new Set(
    (rootMarketplace
      ? (await getMarketplaceCacheOnly(rootMarketplace))
          ?.allowCrossMarketplaceDependenciesOn
      : undefined) ?? [],
  )
  const resolution = await resolveDependencyClosure(
    pluginId,
    async id => {
      if (depInfo.has(id)) return depInfo.get(id)!.entry
      if (id === pluginId) return entry
      const info = await getPluginById(id)
      if (info) depInfo.set(id, info)
      return info?.entry ?? null
    },
    getEnabledPluginIdsForScope(settingSource),
    allowedCrossMarketplaces,
  )
  if (!resolution.ok) {
    return { ok: false, reason: 'resolution-failed', resolution }
  }

  
  
  
  
  for (const id of resolution.closure) {
    if (id !== pluginId && isPluginBlockedByPolicy(id)) {
      return {
        ok: false,
        reason: 'dependency-blocked-by-policy',
        pluginName: entry.name,
        blockedDependency: id,
      }
    }
  }

  
  const closureEnabled: Record<string, true> = {}
  for (const id of resolution.closure) closureEnabled[id] = true
  const { error } = updateSettingsForSource(settingSource, {
    enabledPlugins: {
      ...getSettingsForSource(settingSource)?.enabledPlugins,
      ...closureEnabled,
    },
  })
  if (error) {
    return {
      ok: false,
      reason: 'settings-write-failed',
      message: error.message,
    }
  }

  
  const projectPath = scope !== 'user' ? getCwd() : undefined
  for (const id of resolution.closure) {
    let info = depInfo.get(id)
    
    
    if (!info && id === pluginId) {
      const mktLocation = (await getPluginById(id))?.marketplaceInstallLocation
      if (mktLocation) info = { entry, marketplaceInstallLocation: mktLocation }
    }
    if (!info) continue

    let localSourcePath: string | undefined
    const { source } = info.entry
    if (isLocalPluginSource(source)) {
      localSourcePath = validatePathWithinBase(
        info.marketplaceInstallLocation,
        source,
      )
    }
    await cacheAndRegisterPlugin(
      id,
      info.entry,
      scope,
      projectPath,
      localSourcePath,
    )
  }

  clearAllCaches()

  const depNote = formatDependencyCountSuffix(
    resolution.closure.filter(id => id !== pluginId),
  )
  return { ok: true, closure: resolution.closure, depNote }
}

export type InstallPluginResult =
  | { success: true; message: string }
  | { success: false; error: string }

export type InstallPluginParams = {
  pluginId: string
  entry: PluginMarketplaceEntry
  marketplaceName: string
  scope?: 'user' | 'project' | 'local'
  trigger?: 'hint' | 'user'
}

export async function installPluginFromMarketplace({
  pluginId,
  entry,
  marketplaceName,
  scope = 'user',
  trigger = 'user',
}: InstallPluginParams): Promise<InstallPluginResult> {
  try {
    
    
    
    const pluginInfo = await getPluginById(pluginId)
    const marketplaceInstallLocation = pluginInfo?.marketplaceInstallLocation

    const result = await installResolvedPlugin({
      pluginId,
      entry,
      scope,
      marketplaceInstallLocation,
    })

    if (!result.ok) {
      switch (result.reason) {
        case 'local-source-no-location':
          return {
            success: false,
            error: `Cannot install local plugin "${result.pluginName}" without marketplace install location`,
          }
        case 'settings-write-failed':
          return {
            success: false,
            error: `Failed to update settings: ${result.message}`,
          }
        case 'resolution-failed':
          return {
            success: false,
            error: formatResolutionError(result.resolution),
          }
        case 'blocked-by-policy':
          return {
            success: false,
            error: `Plugin "${result.pluginName}" is blocked by your organization's policy and cannot be installed`,
          }
        case 'dependency-blocked-by-policy':
          return {
            success: false,
            error: `Cannot install "${result.pluginName}": dependency "${result.blockedDependency}" is blocked by your organization's policy`,
          }
      }
    }

    
    
    
    
    
    logEvent('tengu_plugin_installed', {
      _PROTO_plugin_name:
        entry.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      _PROTO_marketplace_name:
        marketplaceName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      plugin_id: (isOfficialMarketplaceName(marketplaceName)
        ? pluginId
        : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      trigger:
        trigger as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      install_source: (trigger === 'hint'
        ? 'ui-suggestion'
        : 'ui-discover') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginTelemetryFields(
        entry.name,
        marketplaceName,
        getManagedPluginNames(),
      ),
      ...(entry.version && {
        version:
          entry.version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })

    return {
      success: true,
      message: `✓ Installed ${entry.name}${result.depNote}. Run /reload-plugins to activate.`,
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logError(toError(err))
    return { success: false, error: `Failed to install: ${errorMessage}` }
  }
}
