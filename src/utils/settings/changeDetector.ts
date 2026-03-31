import chokidar, { type FSWatcher } from 'chokidar'
import { stat } from 'fs/promises'
import * as platformPath from 'path'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  type ConfigChangeSource,
  executeConfigChangeHooks,
  hasBlockingResult,
} from '../hooks.js'
import { createSignal } from '../signal.js'
import { jsonStringify } from '../slowOperations.js'
import { SETTING_SOURCES, type SettingSource } from './constants.js'
import { clearInternalWrites, consumeInternalWrite } from './internalWrites.js'
import { getManagedSettingsDropInDir } from './managedPath.js'
import {
  getHkcuSettings,
  getMdmSettings,
  refreshMdmSettings,
  setMdmSettingsCache,
} from './mdm/settings.js'
import { getSettingsFilePathForSource } from './settings.js'
import { resetSettingsCache } from './settingsCache.js'

const FILE_STABILITY_THRESHOLD_MS = 1000

const FILE_STABILITY_POLL_INTERVAL_MS = 500

const INTERNAL_WRITE_WINDOW_MS = 5000

const MDM_POLL_INTERVAL_MS = 30 * 60 * 1000 

const DELETION_GRACE_MS =
  FILE_STABILITY_THRESHOLD_MS + FILE_STABILITY_POLL_INTERVAL_MS + 200

let watcher: FSWatcher | null = null
let mdmPollTimer: ReturnType<typeof setInterval> | null = null
let lastMdmSnapshot: string | null = null
let initialized = false
let disposed = false
const pendingDeletions = new Map<string, ReturnType<typeof setTimeout>>()
const settingsChanged = createSignal<[source: SettingSource]>()

let testOverrides: {
  stabilityThreshold?: number
  pollInterval?: number
  mdmPollInterval?: number
  deletionGrace?: number
} | null = null

export async function initialize(): Promise<void> {
  if (getIsRemoteMode()) return
  if (initialized || disposed) return
  initialized = true

  
  startMdmPoll()

  
  registerCleanup(dispose)

  const { dirs, settingsFiles, dropInDir } = await getWatchTargets()
  if (disposed) return // dispose() ran during the await
  if (dirs.length === 0) return

  logForDebugging(
    `Watching for changes in setting files ${[...settingsFiles].join(', ')}...${dropInDir ? ` and drop-in directory ${dropInDir}` : ''}`,
  )

  watcher = chokidar.watch(dirs, {
    persistent: true,
    ignoreInitial: true,
    depth: 0, // Only watch immediate children, not subdirectories
    awaitWriteFinish: {
      stabilityThreshold:
        testOverrides?.stabilityThreshold ?? FILE_STABILITY_THRESHOLD_MS,
      pollInterval:
        testOverrides?.pollInterval ?? FILE_STABILITY_POLL_INTERVAL_MS,
    },
    ignored: (path, stats) => {
      // Ignore special file types (sockets, FIFOs, devices) - they cannot be watched
      
      if (stats && !stats.isFile() && !stats.isDirectory()) return true
      
      if (path.split(platformPath.sep).some(dir => dir === '.git')) return true
      
      
      if (!stats || stats.isDirectory()) return false
      
      
      
      const normalized = platformPath.normalize(path)
      if (settingsFiles.has(normalized)) return false
      
      if (
        dropInDir &&
        normalized.startsWith(dropInDir + platformPath.sep) &&
        normalized.endsWith('.json')
      ) {
        return false
      }
      return true
    },
    // Additional options for stability
    ignorePermissionErrors: true,
    usePolling: false, // Use native file system events
    atomic: true, // Handle atomic writes better
  })

  watcher.on('change', handleChange)
  watcher.on('unlink', handleDelete)
  watcher.on('add', handleAdd)
}

/**
 * Clean up file watcher. Returns a promise that resolves when chokidar's
 * close() settles — callers that need the watcher fully stopped before
 * removing the watched directory (e.g. test teardown) must await this.
 * Fire-and-forget is still valid where timing doesn't matter.
 */
export function dispose(): Promise<void> {
  disposed = true
  if (mdmPollTimer) {
    clearInterval(mdmPollTimer)
    mdmPollTimer = null
  }
  for (const timer of pendingDeletions.values()) clearTimeout(timer)
  pendingDeletions.clear()
  lastMdmSnapshot = null
  clearInternalWrites()
  settingsChanged.clear()
  const w = watcher
  watcher = null
  return w ? w.close() : Promise.resolve()
}

/**
 * Subscribe to settings changes
 */
export const subscribe = settingsChanged.subscribe

async function getWatchTargets(): Promise<{
  dirs: string[]
  settingsFiles: Set<string>
  dropInDir: string | null
}> {
  // Map from directory to all potential settings files in that directory
  const dirToSettingsFiles = new Map<string, Set<string>>()
  const dirsWithExistingFiles = new Set<string>()

  for (const source of SETTING_SOURCES) {
    // Skip flagSettings - they're provided via CLI and won't change during the session.
    
    
    
    if (source === 'flagSettings') {
      continue
    }
    const path = getSettingsFilePathForSource(source)
    if (!path) {
      continue
    }

    const dir = platformPath.dirname(path)

    
    if (!dirToSettingsFiles.has(dir)) {
      dirToSettingsFiles.set(dir, new Set())
    }
    dirToSettingsFiles.get(dir)!.add(path)

    
    try {
      const stats = await stat(path)
      if (stats.isFile()) {
        dirsWithExistingFiles.add(dir)
      }
    } catch {
      // File doesn't exist, that's fine
    }
  }

  // For watched directories, include ALL potential settings file paths
  
  const settingsFiles = new Set<string>()
  for (const dir of dirsWithExistingFiles) {
    const filesInDir = dirToSettingsFiles.get(dir)
    if (filesInDir) {
      for (const file of filesInDir) {
        settingsFiles.add(file)
      }
    }
  }

  // Also watch the managed-settings.d/ drop-in directory for policy fragments.
  
  
  
  let dropInDir: string | null = null
  const managedDropIn = getManagedSettingsDropInDir()
  try {
    const stats = await stat(managedDropIn)
    if (stats.isDirectory()) {
      dirsWithExistingFiles.add(managedDropIn)
      dropInDir = managedDropIn
    }
  } catch {
    // Drop-in directory doesn't exist, that's fine
  }

  return { dirs: [...dirsWithExistingFiles], settingsFiles, dropInDir }
}

function settingSourceToConfigChangeSource(
  source: SettingSource,
): ConfigChangeSource {
  switch (source) {
    case 'userSettings':
      return 'user_settings'
    case 'projectSettings':
      return 'project_settings'
    case 'localSettings':
      return 'local_settings'
    case 'flagSettings':
    case 'policySettings':
      return 'policy_settings'
  }
}

function handleChange(path: string): void {
  const source = getSourceForPath(path)
  if (!source) return

  // If a deletion was pending for this path (delete-and-recreate pattern),
  // cancel the deletion — we'll process this as a change instead.
  const pendingTimer = pendingDeletions.get(path)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingDeletions.delete(path)
    logForDebugging(
      `Cancelled pending deletion of ${path} — file was recreated`,
    )
  }

  // Check if this was an internal write
  if (consumeInternalWrite(path, INTERNAL_WRITE_WINDOW_MS)) {
    return
  }

  logForDebugging(`Detected change to ${path}`)

  // Fire ConfigChange hook first — if blocked (exit code 2 or decision: 'block'),
  // skip applying the change to the session
  void executeConfigChangeHooks(
    settingSourceToConfigChangeSource(source),
    path,
  ).then(results => {
    if (hasBlockingResult(results)) {
      logForDebugging(`ConfigChange hook blocked change to ${path}`)
      return
    }
    fanOut(source)
  })
}

/**
 * Handle a file being re-added (e.g. after a delete-and-recreate). Cancels any
 * pending deletion grace timer and treats the event as a change.
 */
function handleAdd(path: string): void {
  const source = getSourceForPath(path)
  if (!source) return

  // Cancel any pending deletion — the file is back
  const pendingTimer = pendingDeletions.get(path)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingDeletions.delete(path)
    logForDebugging(`Cancelled pending deletion of ${path} — file was re-added`)
  }

  // Treat as a change (re-read settings)
  handleChange(path)
}

/**
 * Handle a file being deleted. Uses a grace period to absorb delete-and-recreate
 * patterns (e.g. auto-updater, another session starting up). If the file is
 * recreated within the grace period (detected via 'add' or 'change' event),
 * the deletion is cancelled and treated as a normal change instead.
 */
function handleDelete(path: string): void {
  const source = getSourceForPath(path)
  if (!source) return

  logForDebugging(`Detected deletion of ${path}`)

  // If there's already a pending deletion for this path, let it run
  if (pendingDeletions.has(path)) return

  const timer = setTimeout(
    (p, src) => {
      pendingDeletions.delete(p)

      
      void executeConfigChangeHooks(
        settingSourceToConfigChangeSource(src),
        p,
      ).then(results => {
        if (hasBlockingResult(results)) {
          logForDebugging(`ConfigChange hook blocked deletion of ${p}`)
          return
        }
        fanOut(src)
      })
    },
    testOverrides?.deletionGrace ?? DELETION_GRACE_MS,
    path,
    source,
  )
  pendingDeletions.set(path, timer)
}

function getSourceForPath(path: string): SettingSource | undefined {
  // Normalize path because chokidar uses forward slashes on Windows
  const normalizedPath = platformPath.normalize(path)

  
  const dropInDir = getManagedSettingsDropInDir()
  if (normalizedPath.startsWith(dropInDir + platformPath.sep)) {
    return 'policySettings'
  }

  return SETTING_SOURCES.find(
    source => getSettingsFilePathForSource(source) === normalizedPath,
  )
}

/**
 * Start polling for MDM settings changes (registry/plist).
 * Takes a snapshot of current MDM settings and compares on each tick.
 */
function startMdmPoll(): void {
  // Capture initial snapshot (includes both admin MDM and user-writable HKCU)
  const initial = getMdmSettings()
  const initialHkcu = getHkcuSettings()
  lastMdmSnapshot = jsonStringify({
    mdm: initial.settings,
    hkcu: initialHkcu.settings,
  })

  mdmPollTimer = setInterval(() => {
    if (disposed) return

    void (async () => {
      try {
        const { mdm: current, hkcu: currentHkcu } = await refreshMdmSettings()
        if (disposed) return

        const currentSnapshot = jsonStringify({
          mdm: current.settings,
          hkcu: currentHkcu.settings,
        })

        if (currentSnapshot !== lastMdmSnapshot) {
          lastMdmSnapshot = currentSnapshot
          
          setMdmSettingsCache(current, currentHkcu)
          logForDebugging('Detected MDM settings change via poll')
          fanOut('policySettings')
        }
      } catch (error) {
        logForDebugging(`MDM poll error: ${errorMessage(error)}`)
      }
    })()
  }, testOverrides?.mdmPollInterval ?? MDM_POLL_INTERVAL_MS)

  
  mdmPollTimer.unref()
}

/**
 * Reset the settings cache, then notify all listeners.
 *
 * The cache reset MUST happen here (single producer), not in each listener
 * (N consumers). Previously, listeners like useSettingsChange and
 * applySettingsChange reset defensively because some notification paths
 * (file-watch at :289/340, MDM poll at :385) did not reset before iterating
 * listeners. That defense caused N-way thrashing when N listeners were
 * subscribed: each listener cleared the cache, re-read from disk (populating
 * it), then the next listener cleared it again — N full disk reloads per
 * notification. Profile showed 5 loadSettingsFromDisk calls in 12ms when
 * remote managed settings resolved at startup.
 *
 * With the reset centralized here, one notification = one disk reload: the
 * first listener to call getSettingsWithErrors() pays the miss and
 * repopulates; all subsequent listeners hit the cache.
 */
function fanOut(source: SettingSource): void {
  resetSettingsCache()
  settingsChanged.emit(source)
}

/**
 * Manually notify listeners of a settings change.
 * Used for programmatic settings changes (e.g., remote managed settings refresh)
 * that don't involve file system changes.
 */
export function notifyChange(source: SettingSource): void {
  logForDebugging(`Programmatic settings change notification for ${source}`)
  fanOut(source)
}

/**
 * Reset internal state for testing purposes only.
 * This allows re-initialization after dispose().
 * Optionally accepts timing overrides for faster test execution.
 *
 * Closes the watcher and returns the close promise so preload's afterEach
 * can await it BEFORE nuking perTestSettingsDir. Without this, chokidar's
 * pending awaitWriteFinish poll fires on the deleted dir → ENOENT (#25253).
 */
export function resetForTesting(overrides?: {
  stabilityThreshold?: number
  pollInterval?: number
  mdmPollInterval?: number
  deletionGrace?: number
}): Promise<void> {
  if (mdmPollTimer) {
    clearInterval(mdmPollTimer)
    mdmPollTimer = null
  }
  for (const timer of pendingDeletions.values()) clearTimeout(timer)
  pendingDeletions.clear()
  lastMdmSnapshot = null
  initialized = false
  disposed = false
  testOverrides = overrides ?? null
  const w = watcher
  watcher = null
  return w ? w.close() : Promise.resolve()
}

export const settingsChangeDetector = {
  initialize,
  dispose,
  subscribe,
  notifyChange,
  resetForTesting,
}
