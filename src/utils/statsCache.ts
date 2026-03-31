import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { open } from 'fs/promises'
import { join } from 'path'
import type { ModelUsage } from '../entrypoints/agentSdkTypes.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import type { DailyActivity, DailyModelTokens, SessionStats } from './stats.js'

export const STATS_CACHE_VERSION = 3
const MIN_MIGRATABLE_VERSION = 1
const STATS_CACHE_FILENAME = 'stats-cache.json'

let statsCacheLockPromise: Promise<void> | null = null

export async function withStatsCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  
  while (statsCacheLockPromise) {
    await statsCacheLockPromise
  }

  
  let releaseLock: (() => void) | undefined
  statsCacheLockPromise = new Promise<void>(resolve => {
    releaseLock = resolve
  })

  try {
    return await fn()
  } finally {
    
    statsCacheLockPromise = null
    releaseLock?.()
  }
}

export type PersistedStatsCache = {
  version: number
  
  
  lastComputedDate: string | null
  
  dailyActivity: DailyActivity[]
  dailyModelTokens: DailyModelTokens[]
  
  modelUsage: { [modelName: string]: ModelUsage }
  
  totalSessions: number
  totalMessages: number
  longestSession: SessionStats | null
  
  firstSessionDate: string | null
  
  hourCounts: { [hour: number]: number }
  
  totalSpeculationTimeSavedMs: number
  
  shotDistribution?: { [shotCount: number]: number }
}

export function getStatsCachePath(): string {
  return join(getClaudeConfigHomeDir(), STATS_CACHE_FILENAME)
}

function getEmptyCache(): PersistedStatsCache {
  return {
    version: STATS_CACHE_VERSION,
    lastComputedDate: null,
    dailyActivity: [],
    dailyModelTokens: [],
    modelUsage: {},
    totalSessions: 0,
    totalMessages: 0,
    longestSession: null,
    firstSessionDate: null,
    hourCounts: {},
    totalSpeculationTimeSavedMs: 0,
    shotDistribution: {},
  }
}

function migrateStatsCache(
  parsed: Partial<PersistedStatsCache> & { version: number },
): PersistedStatsCache | null {
  if (
    typeof parsed.version !== 'number' ||
    parsed.version < MIN_MIGRATABLE_VERSION ||
    parsed.version > STATS_CACHE_VERSION
  ) {
    return null
  }
  if (
    !Array.isArray(parsed.dailyActivity) ||
    !Array.isArray(parsed.dailyModelTokens) ||
    typeof parsed.totalSessions !== 'number' ||
    typeof parsed.totalMessages !== 'number'
  ) {
    return null
  }
  return {
    version: STATS_CACHE_VERSION,
    lastComputedDate: parsed.lastComputedDate ?? null,
    dailyActivity: parsed.dailyActivity,
    dailyModelTokens: parsed.dailyModelTokens,
    modelUsage: parsed.modelUsage ?? {},
    totalSessions: parsed.totalSessions,
    totalMessages: parsed.totalMessages,
    longestSession: parsed.longestSession ?? null,
    firstSessionDate: parsed.firstSessionDate ?? null,
    hourCounts: parsed.hourCounts ?? {},
    totalSpeculationTimeSavedMs: parsed.totalSpeculationTimeSavedMs ?? 0,
    
    
    shotDistribution: parsed.shotDistribution,
  }
}

export async function loadStatsCache(): Promise<PersistedStatsCache> {
  const fs = getFsImplementation()
  const cachePath = getStatsCachePath()

  try {
    const content = await fs.readFile(cachePath, { encoding: 'utf-8' })
    const parsed = jsonParse(content) as PersistedStatsCache

    
    if (parsed.version !== STATS_CACHE_VERSION) {
      const migrated = migrateStatsCache(parsed)
      if (!migrated) {
        logForDebugging(
          `Stats cache version ${parsed.version} not migratable (expected ${STATS_CACHE_VERSION}), returning empty cache`,
        )
        return getEmptyCache()
      }
      logForDebugging(
        `Migrated stats cache from v${parsed.version} to v${STATS_CACHE_VERSION}`,
      )
      
      
      
      
      await saveStatsCache(migrated)
      if (feature('SHOT_STATS') && !migrated.shotDistribution) {
        logForDebugging(
          'Migrated stats cache missing shotDistribution, forcing recomputation',
        )
        return getEmptyCache()
      }
      return migrated
    }

    
    if (
      !Array.isArray(parsed.dailyActivity) ||
      !Array.isArray(parsed.dailyModelTokens) ||
      typeof parsed.totalSessions !== 'number' ||
      typeof parsed.totalMessages !== 'number'
    ) {
      logForDebugging(
        'Stats cache has invalid structure, returning empty cache',
      )
      return getEmptyCache()
    }

    
    
    if (feature('SHOT_STATS') && !parsed.shotDistribution) {
      logForDebugging(
        'Stats cache missing shotDistribution, forcing recomputation',
      )
      return getEmptyCache()
    }

    return parsed
  } catch (error) {
    logForDebugging(`Failed to load stats cache: ${errorMessage(error)}`)
    return getEmptyCache()
  }
}

export async function saveStatsCache(
  cache: PersistedStatsCache,
): Promise<void> {
  const fs = getFsImplementation()
  const cachePath = getStatsCachePath()
  const tempPath = `${cachePath}.${randomBytes(8).toString('hex')}.tmp`

  try {
    
    const configDir = getClaudeConfigHomeDir()
    try {
      await fs.mkdir(configDir)
    } catch {
      
    }

    
    const content = jsonStringify(cache, null, 2)
    const handle = await open(tempPath, 'w', 0o600)
    try {
      await handle.writeFile(content, { encoding: 'utf-8' })
      await handle.sync()
    } finally {
      await handle.close()
    }

    
    await fs.rename(tempPath, cachePath)
    logForDebugging(
      `Stats cache saved successfully (lastComputedDate: ${cache.lastComputedDate})`,
    )
  } catch (error) {
    logError(error)
    
    try {
      await fs.unlink(tempPath)
    } catch {
      
    }
  }
}

export function mergeCacheWithNewStats(
  existingCache: PersistedStatsCache,
  newStats: {
    dailyActivity: DailyActivity[]
    dailyModelTokens: DailyModelTokens[]
    modelUsage: { [modelName: string]: ModelUsage }
    sessionStats: SessionStats[]
    hourCounts: { [hour: number]: number }
    totalSpeculationTimeSavedMs: number
    shotDistribution?: { [shotCount: number]: number }
  },
  newLastComputedDate: string,
): PersistedStatsCache {
  
  const dailyActivityMap = new Map<string, DailyActivity>()
  for (const day of existingCache.dailyActivity) {
    dailyActivityMap.set(day.date, { ...day })
  }
  for (const day of newStats.dailyActivity) {
    const existing = dailyActivityMap.get(day.date)
    if (existing) {
      existing.messageCount += day.messageCount
      existing.sessionCount += day.sessionCount
      existing.toolCallCount += day.toolCallCount
    } else {
      dailyActivityMap.set(day.date, { ...day })
    }
  }

  
  const dailyModelTokensMap = new Map<string, { [model: string]: number }>()
  for (const day of existingCache.dailyModelTokens) {
    dailyModelTokensMap.set(day.date, { ...day.tokensByModel })
  }
  for (const day of newStats.dailyModelTokens) {
    const existing = dailyModelTokensMap.get(day.date)
    if (existing) {
      for (const [model, tokens] of Object.entries(day.tokensByModel)) {
        existing[model] = (existing[model] || 0) + tokens
      }
    } else {
      dailyModelTokensMap.set(day.date, { ...day.tokensByModel })
    }
  }

  
  const modelUsage = { ...existingCache.modelUsage }
  for (const [model, usage] of Object.entries(newStats.modelUsage)) {
    if (modelUsage[model]) {
      modelUsage[model] = {
        inputTokens: modelUsage[model]!.inputTokens + usage.inputTokens,
        outputTokens: modelUsage[model]!.outputTokens + usage.outputTokens,
        cacheReadInputTokens:
          modelUsage[model]!.cacheReadInputTokens + usage.cacheReadInputTokens,
        cacheCreationInputTokens:
          modelUsage[model]!.cacheCreationInputTokens +
          usage.cacheCreationInputTokens,
        webSearchRequests:
          modelUsage[model]!.webSearchRequests + usage.webSearchRequests,
        costUSD: modelUsage[model]!.costUSD + usage.costUSD,
        contextWindow: Math.max(
          modelUsage[model]!.contextWindow,
          usage.contextWindow,
        ),
        maxOutputTokens: Math.max(
          modelUsage[model]!.maxOutputTokens,
          usage.maxOutputTokens,
        ),
      }
    } else {
      modelUsage[model] = { ...usage }
    }
  }

  
  const hourCounts = { ...existingCache.hourCounts }
  for (const [hour, count] of Object.entries(newStats.hourCounts)) {
    const hourNum = parseInt(hour, 10)
    hourCounts[hourNum] = (hourCounts[hourNum] || 0) + count
  }

  
  const totalSessions =
    existingCache.totalSessions + newStats.sessionStats.length
  const totalMessages =
    existingCache.totalMessages +
    newStats.sessionStats.reduce((sum, s) => sum + s.messageCount, 0)

  
  let longestSession = existingCache.longestSession
  for (const session of newStats.sessionStats) {
    if (!longestSession || session.duration > longestSession.duration) {
      longestSession = session
    }
  }

  
  let firstSessionDate = existingCache.firstSessionDate
  for (const session of newStats.sessionStats) {
    if (!firstSessionDate || session.timestamp < firstSessionDate) {
      firstSessionDate = session.timestamp
    }
  }

  const result: PersistedStatsCache = {
    version: STATS_CACHE_VERSION,
    lastComputedDate: newLastComputedDate,
    dailyActivity: Array.from(dailyActivityMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    dailyModelTokens: Array.from(dailyModelTokensMap.entries())
      .map(([date, tokensByModel]) => ({ date, tokensByModel }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    modelUsage,
    totalSessions,
    totalMessages,
    longestSession,
    firstSessionDate,
    hourCounts,
    totalSpeculationTimeSavedMs:
      existingCache.totalSpeculationTimeSavedMs +
      newStats.totalSpeculationTimeSavedMs,
  }

  if (feature('SHOT_STATS')) {
    const shotDistribution: { [shotCount: number]: number } = {
      ...(existingCache.shotDistribution || {}),
    }
    for (const [count, sessions] of Object.entries(
      newStats.shotDistribution || {},
    )) {
      const key = parseInt(count, 10)
      shotDistribution[key] = (shotDistribution[key] || 0) + sessions
    }
    result.shotDistribution = shotDistribution
  }

  return result
}

export function toDateString(date: Date): string {
  const parts = date.toISOString().split('T')
  const dateStr = parts[0]
  if (!dateStr) {
    throw new Error('Invalid ISO date string')
  }
  return dateStr
}

export function getTodayDateString(): string {
  return toDateString(new Date())
}

export function getYesterdayDateString(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return toDateString(yesterday)
}

export function isDateBefore(date1: string, date2: string): boolean {
  return date1 < date2
}
