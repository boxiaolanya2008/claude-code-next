import chokidar, { type FSWatcher } from 'chokidar'
import * as platformPath from 'path'
import { getAdditionalDirectoriesForClaudeMd } from '../../bootstrap/state.js'
import {
  clearCommandMemoizationCaches,
  clearCommandsCache,
} from '../../commands.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  clearSkillCaches,
  getSkillsPath,
  onDynamicSkillsLoaded,
} from '../../skills/loadSkillsDir.js'
import { resetSentSkillNames } from '../attachments.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { getFsImplementation } from '../fsOperations.js'
import { executeConfigChangeHooks, hasBlockingResult } from '../hooks.js'
import { createSignal } from '../signal.js'

const FILE_STABILITY_THRESHOLD_MS = 1000

const FILE_STABILITY_POLL_INTERVAL_MS = 500

const RELOAD_DEBOUNCE_MS = 300

const POLLING_INTERVAL_MS = 2000

const USE_POLLING = typeof Bun !== 'undefined'

let watcher: FSWatcher | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null
const pendingChangedPaths = new Set<string>()
let initialized = false
let disposed = false
let dynamicSkillsCallbackRegistered = false
let unregisterCleanup: (() => void) | null = null
const skillsChanged = createSignal()

let testOverrides: {
  stabilityThreshold?: number
  pollInterval?: number
  reloadDebounce?: number
  
  chokidarInterval?: number
} | null = null

export async function initialize(): Promise<void> {
  if (initialized || disposed) return
  initialized = true

  
  if (!dynamicSkillsCallbackRegistered) {
    dynamicSkillsCallbackRegistered = true
    onDynamicSkillsLoaded(() => {
      // Clear memoization caches so new skills are picked up
      
      
      
      clearCommandMemoizationCaches()
      
      skillsChanged.emit()
    })
  }

  const paths = await getWatchablePaths()
  if (paths.length === 0) return

  logForDebugging(
    `Watching for changes in skill/command directories: ${paths.join(', ')}...`,
  )

  watcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: true,
    depth: 2, // Skills use skill-name/SKILL.md format
    awaitWriteFinish: {
      stabilityThreshold:
        testOverrides?.stabilityThreshold ?? FILE_STABILITY_THRESHOLD_MS,
      pollInterval:
        testOverrides?.pollInterval ?? FILE_STABILITY_POLL_INTERVAL_MS,
    },
    // Ignore special file types (sockets, FIFOs, devices) - they cannot be watched
    
    ignored: (path, stats) => {
      if (stats && !stats.isFile() && !stats.isDirectory()) return true
      
      return path.split(platformPath.sep).some(dir => dir === '.git')
    },
    ignorePermissionErrors: true,
    usePolling: USE_POLLING,
    interval: testOverrides?.chokidarInterval ?? POLLING_INTERVAL_MS,
    atomic: true,
  })

  watcher.on('add', handleChange)
  watcher.on('change', handleChange)
  watcher.on('unlink', handleChange)

  
  unregisterCleanup = registerCleanup(async () => {
    await dispose()
  })
}

/**
 * Clean up file watcher
 */
export function dispose(): Promise<void> {
  disposed = true
  if (unregisterCleanup) {
    unregisterCleanup()
    unregisterCleanup = null
  }
  let closePromise: Promise<void> = Promise.resolve()
  if (watcher) {
    closePromise = watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  pendingChangedPaths.clear()
  skillsChanged.clear()
  return closePromise
}

/**
 * Subscribe to skill changes
 */
export const subscribe = skillsChanged.subscribe

async function getWatchablePaths(): Promise<string[]> {
  const fs = getFsImplementation()
  const paths: string[] = []

  
  const userSkillsPath = getSkillsPath('userSettings', 'skills')
  if (userSkillsPath) {
    try {
      await fs.stat(userSkillsPath)
      paths.push(userSkillsPath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // User commands directory (~/.claude/commands)
  const userCommandsPath = getSkillsPath('userSettings', 'commands')
  if (userCommandsPath) {
    try {
      await fs.stat(userCommandsPath)
      paths.push(userCommandsPath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // Project skills directory (.claude/skills)
  const projectSkillsPath = getSkillsPath('projectSettings', 'skills')
  if (projectSkillsPath) {
    try {
      // For project settings, resolve to absolute path
      const absolutePath = platformPath.resolve(projectSkillsPath)
      await fs.stat(absolutePath)
      paths.push(absolutePath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // Project commands directory (.claude/commands)
  const projectCommandsPath = getSkillsPath('projectSettings', 'commands')
  if (projectCommandsPath) {
    try {
      // For project settings, resolve to absolute path
      const absolutePath = platformPath.resolve(projectCommandsPath)
      await fs.stat(absolutePath)
      paths.push(absolutePath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  // Additional directories (--add-dir) skills
  for (const dir of getAdditionalDirectoriesForClaudeMd()) {
    const additionalSkillsPath = platformPath.join(dir, '.claude', 'skills')
    try {
      await fs.stat(additionalSkillsPath)
      paths.push(additionalSkillsPath)
    } catch {
      // Path doesn't exist, skip it
    }
  }

  return paths
}

function handleChange(path: string): void {
  logForDebugging(`Detected skill change: ${path}`)
  logEvent('tengu_skill_file_changed', {
    source:
      'chokidar' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  scheduleReload(path)
}

/**
 * Debounce rapid skill changes into a single reload. When many skill files
 * change at once (e.g. auto-update installs a new binary and a new session
 * touches skill directories), each file fires its own chokidar event. Without
 * debouncing, each event triggers clearSkillCaches() + clearCommandsCache() +
 * listener notification — 30 events means 30 full reload cycles, which can
 * deadlock the Bun event loop via rapid FSWatcher watch/unwatch churn.
 */
function scheduleReload(changedPath: string): void {
  pendingChangedPaths.add(changedPath)
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(async () => {
    reloadTimer = null
    const paths = [...pendingChangedPaths]
    pendingChangedPaths.clear()
    // Fire ConfigChange hook once for the batch — the hook query is always
    // 'skills' so firing per-path (which can be hundreds during a git
    // operation) just spams the hook matcher with identical queries. Pass the
    // first path as a representative; hooks can inspect all paths via the
    // skills directory if they need the full set.
    const results = await executeConfigChangeHooks('skills', paths[0]!)
    if (hasBlockingResult(results)) {
      logForDebugging(
        `ConfigChange hook blocked skill reload (${paths.length} paths)`,
      )
      return
    }
    clearSkillCaches()
    clearCommandsCache()
    resetSentSkillNames()
    skillsChanged.emit()
  }, testOverrides?.reloadDebounce ?? RELOAD_DEBOUNCE_MS)
}

/**
 * Reset internal state for testing purposes only.
 */
export async function resetForTesting(overrides?: {
  stabilityThreshold?: number
  pollInterval?: number
  reloadDebounce?: number
  chokidarInterval?: number
}): Promise<void> {
  // Clean up existing watcher if present to avoid resource leaks
  if (watcher) {
    await watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
  pendingChangedPaths.clear()
  skillsChanged.clear()
  initialized = false
  disposed = false
  testOverrides = overrides ?? null
}

export const skillChangeDetector = {
  initialize,
  dispose,
  subscribe,
  resetForTesting,
}
