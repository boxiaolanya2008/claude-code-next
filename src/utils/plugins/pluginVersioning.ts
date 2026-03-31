

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
  
  if (manifest?.version) {
    logForDebugging(
      `Using manifest version for ${pluginId}: ${manifest.version}`,
    )
    return manifest.version
  }

  
  if (providedVersion) {
    logForDebugging(
      `Using provided version for ${pluginId}: ${providedVersion}`,
    )
    return providedVersion
  }

  
  if (gitCommitSha) {
    const shortSha = gitCommitSha.substring(0, 12)
    if (typeof source === 'object' && source.source === 'git-subdir') {
      
      
      
      
      
      
      
      
      
      
      
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

  
  if (installPath) {
    const sha = await getGitCommitSha(installPath)
    if (sha) {
      const shortSha = sha.substring(0, 12)
      logForDebugging(`Using git SHA for ${pluginId}: ${shortSha}`)
      return shortSha
    }
  }

  
  logForDebugging(`No version found for ${pluginId}, using 'unknown'`)
  return 'unknown'
}

export function getGitCommitSha(dirPath: string): Promise<string | null> {
  return getHeadForDir(dirPath)
}

export function getVersionFromPath(installPath: string): string | null {
  
  const parts = installPath.split('/').filter(Boolean)

  
  const cacheIndex = parts.findIndex(
    (part, i) => part === 'cache' && parts[i - 1] === 'plugins',
  )

  if (cacheIndex === -1) {
    return null
  }

  
  const componentsAfterCache = parts.slice(cacheIndex + 1)
  if (componentsAfterCache.length >= 3) {
    return componentsAfterCache[2] || null
  }

  return null
}

export function isVersionedPath(path: string): boolean {
  return getVersionFromPath(path) !== null
}
