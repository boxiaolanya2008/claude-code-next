import axios from 'axios'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { coerce } from 'semver'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { toError } from './errors.js'
import { logError } from './log.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'
import { gt } from './semver.js'

const MAX_RELEASE_NOTES_SHOWN = 5

export const CHANGELOG_URL =
  'https://github.com/anthropics/claude-code-next/blob/main/CHANGELOG.md'
const RAW_CHANGELOG_URL =
  'https://raw.githubusercontent.com/anthropics/claude-code-next/refs/heads/main/CHANGELOG.md'

function getChangelogCachePath(): string {
  return join(getClaudeConfigHomeDir(), 'cache', 'changelog.md')
}

let changelogMemoryCache: string | null = null

export function _resetChangelogCacheForTesting(): void {
  changelogMemoryCache = null
}

export async function migrateChangelogFromConfig(): Promise<void> {
  const config = getGlobalConfig()
  if (!config.cachedChangelog) {
    return
  }

  const cachePath = getChangelogCachePath()

  
  try {
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, config.cachedChangelog, {
      encoding: 'utf-8',
      flag: 'wx', 
    })
  } catch {
    
  }

  
  saveGlobalConfig(({ cachedChangelog: _, ...rest }) => rest)
}

export async function fetchAndStoreChangelog(): Promise<void> {
  
  if (getIsNonInteractiveSession()) {
    return
  }

  
  if (isEssentialTrafficOnly()) {
    return
  }

  const response = await axios.get(RAW_CHANGELOG_URL)
  if (response.status === 200) {
    const changelogContent = response.data

    
    
    if (changelogContent === changelogMemoryCache) {
      return
    }

    const cachePath = getChangelogCachePath()

    
    await mkdir(dirname(cachePath), { recursive: true })

    
    await writeFile(cachePath, changelogContent, { encoding: 'utf-8' })
    changelogMemoryCache = changelogContent

    
    const changelogLastFetched = Date.now()
    saveGlobalConfig(current => ({
      ...current,
      changelogLastFetched,
    }))
  }
}

export async function getStoredChangelog(): Promise<string> {
  if (changelogMemoryCache !== null) {
    return changelogMemoryCache
  }
  const cachePath = getChangelogCachePath()
  try {
    const content = await readFile(cachePath, 'utf-8')
    changelogMemoryCache = content
    return content
  } catch {
    changelogMemoryCache = ''
    return ''
  }
}

export function getStoredChangelogFromMemory(): string {
  return changelogMemoryCache ?? ''
}

export function parseChangelog(content: string): Record<string, string[]> {
  try {
    if (!content) return {}

    
    const releaseNotes: Record<string, string[]> = {}

    
    const sections = content.split(/^## /gm).slice(1) 

    for (const section of sections) {
      const lines = section.trim().split('\n')
      if (lines.length === 0) continue

      
      
      const versionLine = lines[0]
      if (!versionLine) continue

      
      const version = versionLine.split(' - ')[0]?.trim() || ''
      if (!version) continue

      
      const notes = lines
        .slice(1)
        .filter(line => line.trim().startsWith('- '))
        .map(line => line.trim().substring(2).trim())
        .filter(Boolean)

      if (notes.length > 0) {
        releaseNotes[version] = notes
      }
    }

    return releaseNotes
  } catch (error) {
    logError(toError(error))
    return {}
  }
}

export function getRecentReleaseNotes(
  currentVersion: string,
  previousVersion: string | null | undefined,
  changelogContent: string = getStoredChangelogFromMemory(),
): string[] {
  try {
    const releaseNotes = parseChangelog(changelogContent)

    
    const baseCurrentVersion = coerce(currentVersion)
    const basePreviousVersion = previousVersion ? coerce(previousVersion) : null

    if (
      !basePreviousVersion ||
      (baseCurrentVersion &&
        gt(baseCurrentVersion.version, basePreviousVersion.version))
    ) {
      
      return Object.entries(releaseNotes)
        .filter(
          ([version]) =>
            !basePreviousVersion || gt(version, basePreviousVersion.version),
        )
        .sort(([versionA], [versionB]) => (gt(versionA, versionB) ? -1 : 1)) 
        .flatMap(([_, notes]) => notes)
        .filter(Boolean)
        .slice(0, MAX_RELEASE_NOTES_SHOWN)
    }
  } catch (error) {
    logError(toError(error))
    return []
  }
  return []
}

export function getAllReleaseNotes(
  changelogContent: string = getStoredChangelogFromMemory(),
): Array<[string, string[]]> {
  try {
    const releaseNotes = parseChangelog(changelogContent)

    
    const sortedVersions = Object.keys(releaseNotes).sort((a, b) =>
      gt(a, b) ? 1 : -1,
    )

    
    return sortedVersions
      .map(version => {
        const versionNotes = releaseNotes[version]
        if (!versionNotes || versionNotes.length === 0) return null

        const notes = versionNotes.filter(Boolean)
        if (notes.length === 0) return null

        return [version, notes] as [string, string[]]
      })
      .filter((item): item is [string, string[]] => item !== null)
  } catch (error) {
    logError(toError(error))
    return []
  }
}

export async function checkForReleaseNotes(
  lastSeenVersion: string | null | undefined,
  currentVersion: string = MACRO.VERSION,
): Promise<{ hasReleaseNotes: boolean; releaseNotes: string[] }> {
  
  if (process.env.USER_TYPE === 'ant') {
    const changelog = MACRO.VERSION_CHANGELOG
    if (changelog) {
      const commits = changelog.trim().split('\n').filter(Boolean)
      return {
        hasReleaseNotes: commits.length > 0,
        releaseNotes: commits,
      }
    }
    return {
      hasReleaseNotes: false,
      releaseNotes: [],
    }
  }

  
  const cachedChangelog = await getStoredChangelog()

  
  
  if (lastSeenVersion !== currentVersion || !cachedChangelog) {
    fetchAndStoreChangelog().catch(error => logError(toError(error)))
  }

  const releaseNotes = getRecentReleaseNotes(
    currentVersion,
    lastSeenVersion,
    cachedChangelog,
  )
  const hasReleaseNotes = releaseNotes.length > 0

  return {
    hasReleaseNotes,
    releaseNotes,
  }
}

export function checkForReleaseNotesSync(
  lastSeenVersion: string | null | undefined,
  currentVersion: string = MACRO.VERSION,
): { hasReleaseNotes: boolean; releaseNotes: string[] } {
  
  if (process.env.USER_TYPE === 'ant') {
    const changelog = MACRO.VERSION_CHANGELOG
    if (changelog) {
      const commits = changelog.trim().split('\n').filter(Boolean)
      return {
        hasReleaseNotes: commits.length > 0,
        releaseNotes: commits,
      }
    }
    return {
      hasReleaseNotes: false,
      releaseNotes: [],
    }
  }

  const releaseNotes = getRecentReleaseNotes(currentVersion, lastSeenVersion)
  return {
    hasReleaseNotes: releaseNotes.length > 0,
    releaseNotes,
  }
}
