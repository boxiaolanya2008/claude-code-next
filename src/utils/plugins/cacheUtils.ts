import { readdir, rm, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { clearCommandsCache } from '../../commands.js'
import { clearAllOutputStylesCache } from '../../constants/outputStyles.js'
import { clearAgentDefinitionsCache } from '../../tools/AgentTool/loadAgentsDir.js'
import { clearPromptCache } from '../../tools/SkillTool/prompt.js'
import { resetSentSkillNames } from '../attachments.js'
import { logForDebugging } from '../debug.js'
import { getErrnoCode } from '../errors.js'
import { logError } from '../log.js'
import { loadInstalledPluginsFromDisk } from './installedPluginsManager.js'
import { clearPluginAgentCache } from './loadPluginAgents.js'
import { clearPluginCommandCache } from './loadPluginCommands.js'
import {
  clearPluginHookCache,
  pruneRemovedPluginHooks,
} from './loadPluginHooks.js'
import { clearPluginOutputStyleCache } from './loadPluginOutputStyles.js'
import { clearPluginCache, getPluginCachePath } from './pluginLoader.js'
import { clearPluginOptionsCache } from './pluginOptionsStorage.js'
import { isPluginZipCacheEnabled } from './zipCache.js'

const ORPHANED_AT_FILENAME = '.orphaned_at'
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000 

export function clearAllPluginCaches(): void {
  clearPluginCache()
  clearPluginCommandCache()
  clearPluginAgentCache()
  clearPluginHookCache()
  
  
  
  
  
  
  
  pruneRemovedPluginHooks().catch(e => logError(e))
  clearPluginOptionsCache()
  clearPluginOutputStyleCache()
  clearAllOutputStylesCache()
}

export function clearAllCaches(): void {
  clearAllPluginCaches()
  clearCommandsCache()
  clearAgentDefinitionsCache()
  clearPromptCache()
  resetSentSkillNames()
}

export async function markPluginVersionOrphaned(
  versionPath: string,
): Promise<void> {
  try {
    await writeFile(getOrphanedAtPath(versionPath), `${Date.now()}`, 'utf-8')
  } catch (error) {
    logForDebugging(`Failed to write .orphaned_at: ${versionPath}: ${error}`)
  }
}

export async function cleanupOrphanedPluginVersionsInBackground(): Promise<void> {
  
  
  
  if (isPluginZipCacheEnabled()) {
    return
  }
  try {
    const installedVersions = getInstalledVersionPaths()
    if (!installedVersions) return

    const cachePath = getPluginCachePath()

    const now = Date.now()

    
    
    await Promise.all(
      [...installedVersions].map(p => removeOrphanedAtMarker(p)),
    )

    
    for (const marketplace of await readSubdirs(cachePath)) {
      const marketplacePath = join(cachePath, marketplace)

      for (const plugin of await readSubdirs(marketplacePath)) {
        const pluginPath = join(marketplacePath, plugin)

        for (const version of await readSubdirs(pluginPath)) {
          const versionPath = join(pluginPath, version)
          if (installedVersions.has(versionPath)) continue
          await processOrphanedPluginVersion(versionPath, now)
        }

        await removeIfEmpty(pluginPath)
      }

      await removeIfEmpty(marketplacePath)
    }
  } catch (error) {
    logForDebugging(`Plugin cache cleanup failed: ${error}`)
  }
}

function getOrphanedAtPath(versionPath: string): string {
  return join(versionPath, ORPHANED_AT_FILENAME)
}

async function removeOrphanedAtMarker(versionPath: string): Promise<void> {
  const orphanedAtPath = getOrphanedAtPath(versionPath)
  try {
    await unlink(orphanedAtPath)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') return
    logForDebugging(`Failed to remove .orphaned_at: ${versionPath}: ${error}`)
  }
}

function getInstalledVersionPaths(): Set<string> | null {
  try {
    const paths = new Set<string>()
    const diskData = loadInstalledPluginsFromDisk()
    for (const installations of Object.values(diskData.plugins)) {
      for (const entry of installations) {
        paths.add(entry.installPath)
      }
    }
    return paths
  } catch (error) {
    logForDebugging(`Failed to load installed plugins: ${error}`)
    return null
  }
}

async function processOrphanedPluginVersion(
  versionPath: string,
  now: number,
): Promise<void> {
  const orphanedAtPath = getOrphanedAtPath(versionPath)

  let orphanedAt: number
  try {
    orphanedAt = (await stat(orphanedAtPath)).mtimeMs
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      await markPluginVersionOrphaned(versionPath)
      return
    }
    logForDebugging(`Failed to stat orphaned marker: ${versionPath}: ${error}`)
    return
  }

  if (now - orphanedAt > CLEANUP_AGE_MS) {
    try {
      await rm(versionPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(
        `Failed to delete orphaned version: ${versionPath}: ${error}`,
      )
    }
  }
}

async function removeIfEmpty(dirPath: string): Promise<void> {
  if ((await readSubdirs(dirPath)).length === 0) {
    try {
      await rm(dirPath, { recursive: true, force: true })
    } catch (error) {
      logForDebugging(`Failed to remove empty dir: ${dirPath}: ${error}`)
    }
  }
}

async function readSubdirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }
}
