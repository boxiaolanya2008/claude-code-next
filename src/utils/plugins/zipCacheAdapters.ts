

import { readFile } from 'fs/promises'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { loadKnownMarketplacesConfigSafe } from './marketplaceManager.js'
import {
  type KnownMarketplacesFile,
  KnownMarketplacesFileSchema,
  type PluginMarketplace,
  PluginMarketplaceSchema,
} from './schemas.js'
import {
  atomicWriteToZipCache,
  getMarketplaceJsonRelativePath,
  getPluginZipCachePath,
  getZipCacheKnownMarketplacesPath,
} from './zipCache.js'

export async function readZipCacheKnownMarketplaces(): Promise<KnownMarketplacesFile> {
  try {
    const content = await readFile(getZipCacheKnownMarketplacesPath(), 'utf-8')
    const parsed = KnownMarketplacesFileSchema().safeParse(jsonParse(content))
    if (!parsed.success) {
      logForDebugging(
        `Invalid known_marketplaces.json in zip cache: ${parsed.error.message}`,
        { level: 'error' },
      )
      return {}
    }
    return parsed.data
  } catch {
    return {}
  }
}

export async function writeZipCacheKnownMarketplaces(
  data: KnownMarketplacesFile,
): Promise<void> {
  await atomicWriteToZipCache(
    getZipCacheKnownMarketplacesPath(),
    jsonStringify(data, null, 2),
  )
}

export async function readMarketplaceJson(
  marketplaceName: string,
): Promise<PluginMarketplace | null> {
  const zipCachePath = getPluginZipCachePath()
  if (!zipCachePath) {
    return null
  }
  const relPath = getMarketplaceJsonRelativePath(marketplaceName)
  const fullPath = join(zipCachePath, relPath)
  try {
    const content = await readFile(fullPath, 'utf-8')
    const parsed = jsonParse(content)
    const result = PluginMarketplaceSchema().safeParse(parsed)
    if (result.success) {
      return result.data
    }
    logForDebugging(
      `Invalid marketplace JSON for ${marketplaceName}: ${result.error}`,
    )
    return null
  } catch {
    return null
  }
}

export async function saveMarketplaceJsonToZipCache(
  marketplaceName: string,
  installLocation: string,
): Promise<void> {
  const zipCachePath = getPluginZipCachePath()
  if (!zipCachePath) {
    return
  }
  const content = await readMarketplaceJsonContent(installLocation)
  if (content !== null) {
    const relPath = getMarketplaceJsonRelativePath(marketplaceName)
    await atomicWriteToZipCache(join(zipCachePath, relPath), content)
  }
}

async function readMarketplaceJsonContent(dir: string): Promise<string | null> {
  const candidates = [
    join(dir, '.claude-plugin', 'marketplace.json'),
    join(dir, 'marketplace.json'),
    dir, 
  ]
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf-8')
    } catch {
      
    }
  }
  return null
}

export async function syncMarketplacesToZipCache(): Promise<void> {
  
  
  
  const knownMarketplaces = await loadKnownMarketplacesConfigSafe()

  
  for (const [name, entry] of Object.entries(knownMarketplaces)) {
    if (!entry.installLocation) continue
    try {
      await saveMarketplaceJsonToZipCache(name, entry.installLocation)
    } catch (error) {
      logForDebugging(`Failed to save marketplace JSON for ${name}: ${error}`)
    }
  }

  
  const zipCacheKnownMarketplaces = await readZipCacheKnownMarketplaces()
  const mergedKnownMarketplaces: KnownMarketplacesFile = {
    ...zipCacheKnownMarketplaces,
    ...knownMarketplaces,
  }
  await writeZipCacheKnownMarketplaces(mergedKnownMarketplaces)
}
