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
  if (disposed) return 
  if (dirs.length === 0) return

  logForDebugging(
    `Watching for changes in setting files ${[...settingsFiles].join(', ')}...${dropInDir ? ` and drop-in directory ${dropInDir}` : ''}`,
  )

  watcher = chokidar.watch(dirs, {
    persistent: true,
    ignoreInitial: true,
    depth: 0, 
    awaitWriteFinish: {
      stabilityThreshold:
        testOverrides?.stabilityThreshold ?? FILE_STABILITY_THRESHOLD_MS,
      pollInterval:
        testOverrides?.pollInterval ?? FILE_STABILITY_POLL_INTERVAL_MS,
    },
    ignored: (path, stats) => {
      
      
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
    
    ignorePermissionErrors: true,
    usePolling: false, 
    atomic: true, 
  })

  watcher.on('change', handleChange)
  watcher.on('unlink', handleDelete)
  watcher.on('add', handleAdd)
}

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

export const subscribe = settingsChanged.subscribe

async function getWatchTargets(): Promise<{
  dirs: string[]
  settingsFiles: Set<string>
  dropInDir: string | null
}> {
  
  const dirToSettingsFiles = new Map<string, Set<string>>()
  const dirsWithExistingFiles = new Set<string>()

  for (const source of SETTING_SOURCES) {
    
    
    
    
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
      
    }
  }

  
  
  const settingsFiles = new Set<string>()
  for (const dir of dirsWithExistingFiles) {
    const filesInDir = dirToSettingsFiles.get(dir)
    if (filesInDir) {
      for (const file of filesInDir) {
        settingsFiles.add(file)
      }
    }
  }

  
  
  
  
  let dropInDir: string | null = null
  const managedDropIn = getManagedSettingsDropInDir()
  try {
    const stats = await stat(managedDropIn)
    if (stats.isDirectory()) {
      dirsWithExistingFiles.add(managedDropIn)
      dropInDir = managedDropIn
    }
  } catch {
    
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

  
  
  const pendingTimer = pendingDeletions.get(path)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingDeletions.delete(path)
    logForDebugging(
      `Cancelled pending deletion of ${path} — file was recreated`,
    )
  }

  
  if (consumeInternalWrite(path, INTERNAL_WRITE_WINDOW_MS)) {
    return
  }

  logForDebugging(`Detected change to ${path}`)

  
  
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

function handleAdd(path: string): void {
  const source = getSourceForPath(path)
  if (!source) return

  
  const pendingTimer = pendingDeletions.get(path)
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingDeletions.delete(path)
    logForDebugging(`Cancelled pending deletion of ${path} — file was re-added`)
  }

  
  handleChange(path)
}

function handleDelete(path: string): void {
  const source = getSourceForPath(path)
  if (!source) return

  logForDebugging(`Detected deletion of ${path}`)

  
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
  
  const normalizedPath = platformPath.normalize(path)

  
  const dropInDir = getManagedSettingsDropInDir()
  if (normalizedPath.startsWith(dropInDir + platformPath.sep)) {
    return 'policySettings'
  }

  return SETTING_SOURCES.find(
    source => getSettingsFilePathForSource(source) === normalizedPath,
  )
}

function startMdmPoll(): void {
  
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

function fanOut(source: SettingSource): void {
  resetSettingsCache()
  settingsChanged.emit(source)
}

export function notifyChange(source: SettingSource): void {
  logForDebugging(`Programmatic settings change notification for ${source}`)
  fanOut(source)
}

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
