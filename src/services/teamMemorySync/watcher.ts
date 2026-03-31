

import { feature } from "../utils/bundle-mock.ts"
import { type FSWatcher, watch } from 'fs'
import { mkdir, stat } from 'fs/promises'
import { join } from 'path'
import {
  getTeamMemPath,
  isTeamMemoryEnabled,
} from '../../memdir/teamMemPaths.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { getGithubRepo } from '../../utils/git.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  createSyncState,
  isTeamMemorySyncAvailable,
  pullTeamMemory,
  pushTeamMemory,
  type SyncState,
} from './index.js'
import type { TeamMemorySyncPushResult } from './types.js'

const DEBOUNCE_MS = 2000 

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pushInProgress = false
let hasPendingChanges = false
let currentPushPromise: Promise<void> | null = null
let watcherStarted = false

let pushSuppressedReason: string | null = null

export function isPermanentFailure(r: TeamMemorySyncPushResult): boolean {
  if (r.errorType === 'no_oauth' || r.errorType === 'no_repo') return true
  if (
    r.httpStatus !== undefined &&
    r.httpStatus >= 400 &&
    r.httpStatus < 500 &&
    r.httpStatus !== 409 &&
    r.httpStatus !== 429
  ) {
    return true
  }
  return false
}

let syncState: SyncState | null = null

async function executePush(): Promise<void> {
  if (!syncState) {
    return
  }
  pushInProgress = true
  try {
    const result = await pushTeamMemory(syncState)
    if (result.success) {
      hasPendingChanges = false
    }
    if (result.success && result.filesUploaded > 0) {
      logForDebugging(
        `team-memory-watcher: pushed ${result.filesUploaded} files`,
        { level: 'info' },
      )
    } else if (!result.success) {
      logForDebugging(`team-memory-watcher: push failed: ${result.error}`, {
        level: 'warn',
      })
      if (isPermanentFailure(result) && pushSuppressedReason === null) {
        pushSuppressedReason =
          result.httpStatus !== undefined
            ? `http_${result.httpStatus}`
            : (result.errorType ?? 'unknown')
        logForDebugging(
          `team-memory-watcher: suppressing retry until next unlink or session restart (${pushSuppressedReason})`,
          { level: 'warn' },
        )
        logEvent('tengu_team_mem_push_suppressed', {
          reason:
            pushSuppressedReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...(result.httpStatus && { status: result.httpStatus }),
        })
      }
    }
  } catch (e) {
    logForDebugging(`team-memory-watcher: push error: ${errorMessage(e)}`, {
      level: 'warn',
    })
  } finally {
    pushInProgress = false
    currentPushPromise = null
  }
}

function schedulePush(): void {
  if (pushSuppressedReason !== null) return
  hasPendingChanges = true
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    if (pushInProgress) {
      schedulePush()
      return
    }
    currentPushPromise = executePush()
  }, DEBOUNCE_MS)
}

async function startFileWatcher(teamDir: string): Promise<void> {
  if (watcherStarted) {
    return
  }
  watcherStarted = true

  try {
    
    
    
    await mkdir(teamDir, { recursive: true })

    watcher = watch(
      teamDir,
      { persistent: true, recursive: true },
      (_eventType, filename) => {
        if (filename === null) {
          schedulePush()
          return
        }
        if (pushSuppressedReason !== null) {
          
          
          
          void stat(join(teamDir, filename)).catch(
            (err: NodeJS.ErrnoException) => {
              if (err.code !== 'ENOENT') return
              if (pushSuppressedReason !== null) {
                logForDebugging(
                  `team-memory-watcher: unlink cleared suppression (was: ${pushSuppressedReason})`,
                  { level: 'info' },
                )
                pushSuppressedReason = null
              }
              schedulePush()
            },
          )
          return
        }
        schedulePush()
      },
    )
    watcher.on('error', err => {
      logForDebugging(
        `team-memory-watcher: fs.watch error: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    })
    logForDebugging(`team-memory-watcher: watching ${teamDir}`, {
      level: 'debug',
    })
  } catch (err) {
    
    
    
    logForDebugging(
      `team-memory-watcher: failed to watch ${teamDir}: ${errorMessage(err)}`,
      { level: 'warn' },
    )
  }

  registerCleanup(async () => stopTeamMemoryWatcher())
}

export async function startTeamMemoryWatcher(): Promise<void> {
  if (!feature('TEAMMEM')) {
    return
  }
  if (!isTeamMemoryEnabled() || !isTeamMemorySyncAvailable()) {
    return
  }
  const repoSlug = await getGithubRepo()
  if (!repoSlug) {
    logForDebugging(
      'team-memory-watcher: no github.com remote, skipping sync',
      { level: 'debug' },
    )
    return
  }

  syncState = createSyncState()

  
  
  let initialPullSuccess = false
  let initialFilesPulled = 0
  let serverHasContent = false
  try {
    const pullResult = await pullTeamMemory(syncState)
    initialPullSuccess = pullResult.success
    serverHasContent = pullResult.entryCount > 0
    if (pullResult.success && pullResult.filesWritten > 0) {
      initialFilesPulled = pullResult.filesWritten
      logForDebugging(
        `team-memory-watcher: initial pull got ${pullResult.filesWritten} files`,
        { level: 'info' },
      )
    }
  } catch (e) {
    logForDebugging(
      `team-memory-watcher: initial pull failed: ${errorMessage(e)}`,
      { level: 'warn' },
    )
  }

  
  
  
  await startFileWatcher(getTeamMemPath())

  logEvent('tengu_team_mem_sync_started', {
    initial_pull_success: initialPullSuccess,
    initial_files_pulled: initialFilesPulled,
    
    watcher_started: true,
    server_has_content: serverHasContent,
  })
}

export async function notifyTeamMemoryWrite(): Promise<void> {
  if (!syncState) {
    return
  }
  schedulePush()
}

export async function stopTeamMemoryWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
  
  if (currentPushPromise) {
    try {
      await currentPushPromise
    } catch {
      
    }
  }
  
  if (hasPendingChanges && syncState && pushSuppressedReason === null) {
    try {
      await pushTeamMemory(syncState)
    } catch {
      
    }
  }
}

export function _resetWatcherStateForTesting(opts?: {
  syncState?: SyncState
  skipWatcher?: boolean
  pushSuppressedReason?: string | null
}): void {
  watcher = null
  debounceTimer = null
  pushInProgress = false
  hasPendingChanges = false
  currentPushPromise = null
  watcherStarted = opts?.skipWatcher ?? false
  pushSuppressedReason = opts?.pushSuppressedReason ?? null
  syncState = opts?.syncState ?? null
}

export function _startFileWatcherForTesting(dir: string): Promise<void> {
  return startFileWatcher(dir)
}
