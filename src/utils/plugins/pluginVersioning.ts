

import { createHash } from 'crypto'
import { logForDebugging } from '../debug.js'
import { getHeadForDir } from '../git/gitFilesystem.js'
import type { PluginManifest, PluginSource } from './schemas.js'

export async function calculatePluginVersion(
  pluginId: string,
  source: PluginSource,
  manifest?: PluginManifest,
  installPath?: string,
  providedVersion?: string,
  gitCommitSha?: string,
): Promise<string> {
  // 1. Use explicit version from plugin.json if available
  if (manifest?.version) {
    logForDebugging(
      `Using manifest version for ${pluginId}: ${manifest.version}`,
    )
    return manifest.version
  }

  // 2. Use provided version (typically from marketplace entry)
  if (providedVersion) {
    logForDebugging(
      `Using provided version for ${pluginId}: ${providedVersion}`,
    )
    return providedVersion
  }

  // 3. Use pre-resolved git SHA if caller captured it before discarding the clone
  if (gitCommitSha) {
    const shortSha = gitCommitSha.substring(0, 12)
    if (typeof source === 'object' && source.source === 'git-subdir') {
      // Encode the subdir path in the version so cache keys differ when
      
      
      
      
      
      //   1. backslash → forward slash
      
      
      
      
      const normPath = source.path
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/+$/, '')
      const pathHash = createHash('sha256')
        .update(normPath)
        .digest('hex')
        .substring(0, 8)
      const v = `${shortSha}-${pathHash}`
      logForDebugging(
        `Using git-subdir SHA+path version for ${pluginId}: ${v} (path=${normPath})`,
      )
      return v
    }
    logForDebugging(`Using pre-resolved git SHA for ${pluginId}: ${shortSha}`)
    return shortSha
  }

  // 4. Try to get git SHA from install path
  if (installPath) {
    const sha = await getGitCommitSha(installPath)
    if (sha) {
      const shortSha = sha.substring(0, 12)
      logForDebugging(`Using git SHA for ${pluginId}: ${shortSha}`)
      return shortSha
    }
  }

  // 5. Return 'unknown' as last resort
  logForDebugging(`No version found for ${pluginId}, using 'unknown'`)
  return 'unknown'
}

/**
 * Get the git commit SHA for a directory.
 *
 * @param dirPath - Path to directory (should be a git repository)
 * @returns Full commit SHA or null if not a git repo
 */
export function getGitCommitSha(dirPath: string): Promise<string | null> {
  return getHeadForDir(dirPath)
}

/**
 * Extract version from a versioned cache path.
 *
 * Given a path like `~/.claude/plugins/cache/marketplace/plugin/1.0.0`,
 * extracts and returns `1.0.0`.
 *
 * @param installPath - Full path to plugin installation
 * @returns Version string from path, or null if not a versioned path
 */
export function getVersionFromPath(installPath: string): string | null {
  // Versioned paths have format: .../plugins/cache/marketplace/plugin/version/
  const parts = installPath.split('/').filter(Boolean)

  // Find 'cache' index to determine depth
  const cacheIndex = parts.findIndex(
    (part, i) => part === 'cache' && parts[i - 1] === 'plugins',
  )

  if (cacheIndex === -1) {
    return null
  }

  // Versioned path has 3 components after 'cache': marketplace/plugin/version
  const componentsAfterCache = parts.slice(cacheIndex + 1)
  if (componentsAfterCache.length >= 3) {
    return componentsAfterCache[2] || null
  }

  return null
}

/**
 * Check if a path is a versioned plugin path.
 *
 * @param path - Path to check
 * @returns True if path follows versioned structure
 */
export function isVersionedPath(path: string): boolean {
  return getVersionFromPath(path) !== null
}
