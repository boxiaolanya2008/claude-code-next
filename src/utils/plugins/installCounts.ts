

import axios from 'axios'
import { randomBytes } from 'crypto'
import { readFile, rename, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { logForDebugging } from '../debug.js'
import { errorMessage, getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { logError } from '../log.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { classifyFetchError, logPluginFetch } from './fetchTelemetry.js'
import { getPluginsDirectory } from './pluginDirectories.js'

const INSTALL_COUNTS_CACHE_VERSION = 1
const INSTALL_COUNTS_CACHE_FILENAME = 'install-counts-cache.json'
const INSTALL_COUNTS_URL =
  'https://raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 

type InstallCountsCache = {
  version: number
  fetchedAt: string 
  counts: Array<{
    plugin: string 
    unique_installs: number
  }>
}

type GitHubStatsResponse = {
  plugins: Array<{
    plugin: string
    unique_installs: number
  }>
}

function getInstallCountsCachePath(): string {
  return join(getPluginsDirectory(), INSTALL_COUNTS_CACHE_FILENAME)
}

async function loadInstallCountsCache(): Promise<InstallCountsCache | null> {
  const cachePath = getInstallCountsCachePath()

  try {
    const content = await readFile(cachePath, { encoding: 'utf-8' })
    const parsed = jsonParse(content) as unknown

    
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      !('fetchedAt' in parsed) ||
      !('counts' in parsed)
    ) {
      logForDebugging('Install counts cache has invalid structure')
      return null
    }

    const cache = parsed as {
      version: unknown
      fetchedAt: unknown
      counts: unknown
    }

    
    if (cache.version !== INSTALL_COUNTS_CACHE_VERSION) {
      logForDebugging(
        `Install counts cache version mismatch (got ${cache.version}, expected ${INSTALL_COUNTS_CACHE_VERSION})`,
      )
      return null
    }

    
    if (typeof cache.fetchedAt !== 'string' || !Array.isArray(cache.counts)) {
      logForDebugging('Install counts cache has invalid structure')
      return null
    }

    
    const fetchedAt = new Date(cache.fetchedAt).getTime()
    if (Number.isNaN(fetchedAt)) {
      logForDebugging('Install counts cache has invalid fetchedAt timestamp')
      return null
    }

    
    const validCounts = cache.counts.every(
      (entry): entry is { plugin: string; unique_installs: number } =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.plugin === 'string' &&
        typeof entry.unique_installs === 'number',
    )
    if (!validCounts) {
      logForDebugging('Install counts cache has malformed entries')
      return null
    }

    
    const now = Date.now()
    if (now - fetchedAt > CACHE_TTL_MS) {
      logForDebugging('Install counts cache is stale (>24h old)')
      return null
    }

    
    return {
      version: cache.version as number,
      fetchedAt: cache.fetchedAt,
      counts: cache.counts,
    }
  } catch (error) {
    const code = getErrnoCode(error)
    if (code !== 'ENOENT') {
      logForDebugging(
        `Failed to load install counts cache: ${errorMessage(error)}`,
      )
    }
    return null
  }
}

async function saveInstallCountsCache(
  cache: InstallCountsCache,
): Promise<void> {
  const cachePath = getInstallCountsCachePath()
  const tempPath = `${cachePath}.${randomBytes(8).toString('hex')}.tmp`

  try {
    
    const pluginsDir = getPluginsDirectory()
    await getFsImplementation().mkdir(pluginsDir)

    
    const content = jsonStringify(cache, null, 2)
    await writeFile(tempPath, content, {
      encoding: 'utf-8',
      mode: 0o600,
    })

    
    await rename(tempPath, cachePath)
    logForDebugging('Install counts cache saved successfully')
  } catch (error) {
    logError(error)
    
    try {
      await unlink(tempPath)
    } catch {
      
    }
  }
}

async function fetchInstallCountsFromGitHub(): Promise<
  Array<{ plugin: string; unique_installs: number }>
> {
  logForDebugging(`Fetching install counts from ${INSTALL_COUNTS_URL}`)

  const started = performance.now()
  try {
    const response = await axios.get<GitHubStatsResponse>(INSTALL_COUNTS_URL, {
      timeout: 10000,
    })

    if (!response.data?.plugins || !Array.isArray(response.data.plugins)) {
      throw new Error('Invalid response format from install counts API')
    }

    logPluginFetch(
      'install_counts',
      INSTALL_COUNTS_URL,
      'success',
      performance.now() - started,
    )
    return response.data.plugins
  } catch (error) {
    logPluginFetch(
      'install_counts',
      INSTALL_COUNTS_URL,
      'failure',
      performance.now() - started,
      classifyFetchError(error),
    )
    throw error
  }
}

export async function getInstallCounts(): Promise<Map<string, number> | null> {
  
  const cache = await loadInstallCountsCache()
  if (cache) {
    logForDebugging('Using cached install counts')
    logPluginFetch('install_counts', INSTALL_COUNTS_URL, 'cache_hit', 0)
    const map = new Map<string, number>()
    for (const entry of cache.counts) {
      map.set(entry.plugin, entry.unique_installs)
    }
    return map
  }

  
  try {
    const counts = await fetchInstallCountsFromGitHub()

    
    const newCache: InstallCountsCache = {
      version: INSTALL_COUNTS_CACHE_VERSION,
      fetchedAt: new Date().toISOString(),
      counts,
    }
    await saveInstallCountsCache(newCache)

    
    const map = new Map<string, number>()
    for (const entry of counts) {
      map.set(entry.plugin, entry.unique_installs)
    }
    return map
  } catch (error) {
    
    logError(error)
    logForDebugging(`Failed to fetch install counts: ${errorMessage(error)}`)
    return null
  }
}

export function formatInstallCount(count: number): string {
  if (count < 1000) {
    return String(count)
  }

  if (count < 1000000) {
    const k = count / 1000
    
    const formatted = k.toFixed(1)
    return formatted.endsWith('.0')
      ? `${formatted.slice(0, -2)}K`
      : `${formatted}K`
  }

  const m = count / 1000000
  const formatted = m.toFixed(1)
  return formatted.endsWith('.0')
    ? `${formatted.slice(0, -2)}M`
    : `${formatted}M`
}
