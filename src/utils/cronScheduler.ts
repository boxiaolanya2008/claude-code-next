

import type { FSWatcher } from 'chokidar'
import {
  getScheduledTasksEnabled,
  getSessionCronTasks,
  removeSessionCronTasks,
  setScheduledTasksEnabled,
} from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { cronToHuman } from './cron.js'
import {
  type CronJitterConfig,
  type CronTask,
  DEFAULT_CRON_JITTER_CONFIG,
  findMissedTasks,
  getCronFilePath,
  hasCronTasksSync,
  jitteredNextCronRunMs,
  markCronTasksFired,
  oneShotJitteredNextCronRunMs,
  readCronTasks,
  removeCronTasks,
} from './cronTasks.js'
import {
  releaseSchedulerLock,
  tryAcquireSchedulerLock,
} from './cronTasksLock.js'
import { logForDebugging } from './debug.js'

const CHECK_INTERVAL_MS = 1000
const FILE_STABILITY_MS = 300

const LOCK_PROBE_INTERVAL_MS = 5000

export function isRecurringTaskAged(
  t: CronTask,
  nowMs: number,
  maxAgeMs: number,
): boolean {
  if (maxAgeMs === 0) return false
  return Boolean(t.recurring && !t.permanent && nowMs - t.createdAt >= maxAgeMs)
}

type CronSchedulerOptions = {
  /** Called when a task fires (regular or missed-on-startup). */
  onFire: (prompt: string) => void
  /** While true, firing is deferred to the next tick. */
  isLoading: () => boolean
  

  assistantMode?: boolean
  

  onFireTask?: (task: CronTask) => void
  /**
   * When provided, receives the missed one-shot tasks on initial load (and
   * onFire is NOT called with the pre-formatted notification). Daemon decides
   * how to surface them.
   */
  onMissed?: (tasks: CronTask[]) => void
  /**
   * Directory containing .claude/scheduled_tasks.json. When provided, the
   * scheduler never touches bootstrap state: getProjectRoot/getSessionId are
   * not read, and the getScheduledTasksEnabled() poll is skipped (enable()
   * runs immediately on start). Required for Agent SDK daemon callers.
   */
  dir?: string
  

  lockIdentity?: string
  

  getJitterConfig?: () => CronJitterConfig
  

  isKilled?: () => boolean
  

  filter?: (t: CronTask) => boolean
}

export type CronScheduler = {
  start: () => void
  stop: () => void
  /**
   * Epoch ms of the soonest scheduled fire across all loaded tasks, or null
   * if nothing is scheduled (no tasks, or all tasks already in-flight).
   * Daemon callers use this to decide whether to tear down an idle agent
   * subprocess or keep it warm for an imminent fire.
   */
  getNextFireTime: () => number | null
}

export function createCronScheduler(
  options: CronSchedulerOptions,
): CronScheduler {
  const {
    onFire,
    isLoading,
    assistantMode = false,
    onFireTask,
    onMissed,
    dir,
    lockIdentity,
    getJitterConfig,
    isKilled,
    filter,
  } = options
  const lockOpts = dir || lockIdentity ? { dir, lockIdentity } : undefined

  
  
  
  let tasks: CronTask[] = []
  
  const nextFireAt = new Map<string, number>()
  
  
  const missedAsked = new Set<string>()
  
  
  const inFlight = new Set<string>()

  let enablePoll: ReturnType<typeof setInterval> | null = null
  let checkTimer: ReturnType<typeof setInterval> | null = null
  let lockProbeTimer: ReturnType<typeof setInterval> | null = null
  let watcher: FSWatcher | null = null
  let stopped = false
  let isOwner = false

  async function load(initial: boolean) {
    const next = await readCronTasks(dir)
    if (stopped) return
    tasks = next

    
    
    
    
    
    
    
    
    if (!initial) return

    const now = Date.now()
    const missed = findMissedTasks(next, now).filter(
      t => !t.recurring && !missedAsked.has(t.id) && (!filter || filter(t)),
    )
    if (missed.length > 0) {
      for (const t of missed) {
        missedAsked.add(t.id)
        
        
        nextFireAt.set(t.id, Infinity)
      }
      logEvent('tengu_scheduled_task_missed', {
        count: missed.length,
        taskIds: missed
          .map(t => t.id)
          .join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      if (onMissed) {
        onMissed(missed)
      } else {
        onFire(buildMissedTaskNotification(missed))
      }
      void removeCronTasks(
        missed.map(t => t.id),
        dir,
      ).catch(e =>
        logForDebugging(`[ScheduledTasks] failed to remove missed tasks: ${e}`),
      )
      logForDebugging(
        `[ScheduledTasks] surfaced ${missed.length} missed one-shot task(s)`,
      )
    }
  }

  function check() {
    if (isKilled?.()) return
    if (isLoading() && !assistantMode) return
    const now = Date.now()
    const seen = new Set<string>()
    
    
    
    const firedFileRecurring: string[] = []
    
    
    
    
    const jitterCfg = getJitterConfig?.() ?? DEFAULT_CRON_JITTER_CONFIG

    
    // session tasks are removed synchronously from memory, file tasks go
    
    function process(t: CronTask, isSession: boolean) {
      if (filter && !filter(t)) return
      seen.add(t.id)
      if (inFlight.has(t.id)) return

      let next = nextFireAt.get(t.id)
      if (next === undefined) {
        // First sight — anchor from lastFiredAt (recurring) or createdAt.
        
        
        
        
        // so on next process spawn first-sight computes the SAME newNext we
        
        
        
        next = t.recurring
          ? (jitteredNextCronRunMs(
              t.cron,
              t.lastFiredAt ?? t.createdAt,
              t.id,
              jitterCfg,
            ) ?? Infinity)
          : (oneShotJitteredNextCronRunMs(
              t.cron,
              t.createdAt,
              t.id,
              jitterCfg,
            ) ?? Infinity)
        nextFireAt.set(t.id, next)
        logForDebugging(
          `[ScheduledTasks] scheduled ${t.id} for ${next === Infinity ? 'never' : new Date(next).toISOString()}`,
        )
      }

      if (now < next) return

      logForDebugging(
        `[ScheduledTasks] firing ${t.id}${t.recurring ? ' (recurring)' : ''}`,
      )
      logEvent('tengu_scheduled_task_fire', {
        recurring: t.recurring ?? false,
        taskId:
          t.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      if (onFireTask) {
        onFireTask(t)
      } else {
        onFire(t.prompt)
      }

      // Aged-out recurring tasks fall through to the one-shot delete paths
      
      
      const aged = isRecurringTaskAged(t, now, jitterCfg.recurringMaxAgeMs)
      if (aged) {
        const ageHours = Math.floor((now - t.createdAt) / 1000 / 60 / 60)
        logForDebugging(
          `[ScheduledTasks] recurring task ${t.id} aged out (${ageHours}h since creation), deleting after final fire`,
        )
        logEvent('tengu_scheduled_task_expired', {
          taskId:
            t.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ageHours,
        })
      }

      if (t.recurring && !aged) {
        // Recurring: reschedule from now (not from next) to avoid rapid
        
        
        const newNext =
          jitteredNextCronRunMs(t.cron, now, t.id, jitterCfg) ?? Infinity
        nextFireAt.set(t.id, newNext)
        
        
        if (!isSession) firedFileRecurring.push(t.id)
      } else if (isSession) {
        // One-shot (or aged-out recurring) session task: synchronous memory
        
        
        removeSessionCronTasks([t.id])
        nextFireAt.delete(t.id)
      } else {
        // One-shot (or aged-out recurring) file task: delete from disk.
        
        
        inFlight.add(t.id)
        void removeCronTasks([t.id], dir)
          .catch(e =>
            logForDebugging(
              `[ScheduledTasks] failed to remove task ${t.id}: ${e}`,
            ),
          )
          .finally(() => inFlight.delete(t.id))
        nextFireAt.delete(t.id)
      }
    }

    // File-backed tasks: only when we own the scheduler lock. The lock
    
    
    if (isOwner) {
      for (const t of tasks) process(t, false)
      
      
      
      
      
      
      if (firedFileRecurring.length > 0) {
        for (const id of firedFileRecurring) inFlight.add(id)
        void markCronTasksFired(firedFileRecurring, now, dir)
          .catch(e =>
            logForDebugging(
              `[ScheduledTasks] failed to persist lastFiredAt: ${e}`,
            ),
          )
          .finally(() => {
            for (const id of firedFileRecurring) inFlight.delete(id)
          })
      }
    }
    // Session-only tasks: process-private, the lock does not apply — the
    
    
    
    
    if (dir === undefined) {
      for (const t of getSessionCronTasks()) process(t, true)
    }

    if (seen.size === 0) {
      // No live tasks this tick — clear the whole schedule so
      
      
      
      nextFireAt.clear()
      return
    }
    // Evict schedule entries for tasks no longer present. When !isOwner,
    // file-task ids aren't in `seen` and get evicted — harmless: they
    // re-anchor from createdAt on the first owned tick.
    for (const id of nextFireAt.keys()) {
      if (!seen.has(id)) nextFireAt.delete(id)
    }
  }

  async function enable() {
    if (stopped) return
    if (enablePoll) {
      clearInterval(enablePoll)
      enablePoll = null
    }

    const { default: chokidar } = await import('chokidar')
    if (stopped) return

    // Acquire the per-project scheduler lock. Only the owning session runs
    // check(). Other sessions probe periodically to take over if the owner
    // dies. Prevents double-firing when multiple Claudes share a cwd.
    isOwner = await tryAcquireSchedulerLock(lockOpts).catch(() => false)
    if (stopped) {
      if (isOwner) {
        isOwner = false
        void releaseSchedulerLock(lockOpts)
      }
      return
    }
    if (!isOwner) {
      lockProbeTimer = setInterval(() => {
        void tryAcquireSchedulerLock(lockOpts)
          .then(owned => {
            if (stopped) {
              if (owned) void releaseSchedulerLock(lockOpts)
              return
            }
            if (owned) {
              isOwner = true
              if (lockProbeTimer) {
                clearInterval(lockProbeTimer)
                lockProbeTimer = null
              }
            }
          })
          .catch(e => logForDebugging(String(e), { level: 'error' }))
      }, LOCK_PROBE_INTERVAL_MS)
      lockProbeTimer.unref?.()
    }

    void load(true)

    const path = getCronFilePath(dir)
    watcher = chokidar.watch(path, {
      persistent: false,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: FILE_STABILITY_MS },
      ignorePermissionErrors: true,
    })
    watcher.on('add', () => void load(false))
    watcher.on('change', () => void load(false))
    watcher.on('unlink', () => {
      if (!stopped) {
        tasks = []
        nextFireAt.clear()
      }
    })

    checkTimer = setInterval(check, CHECK_INTERVAL_MS)
    // Don't keep the process alive for the scheduler alone — in -p text mode
    
    checkTimer.unref?.()
  }

  return {
    start() {
      stopped = false
      
      
      
      if (dir !== undefined) {
        logForDebugging(
          `[ScheduledTasks] scheduler start() — dir=${dir}, hasTasks=${hasCronTasksSync(dir)}`,
        )
        void enable()
        return
      }
      logForDebugging(
        `[ScheduledTasks] scheduler start() — enabled=${getScheduledTasksEnabled()}, hasTasks=${hasCronTasksSync()}`,
      )
      
      
      if (
        !getScheduledTasksEnabled() &&
        (assistantMode || hasCronTasksSync())
      ) {
        setScheduledTasksEnabled(true)
      }
      if (getScheduledTasksEnabled()) {
        void enable()
        return
      }
      enablePoll = setInterval(
        en => {
          if (getScheduledTasksEnabled()) void en()
        },
        CHECK_INTERVAL_MS,
        enable,
      )
      enablePoll.unref?.()
    },
    stop() {
      stopped = true
      if (enablePoll) {
        clearInterval(enablePoll)
        enablePoll = null
      }
      if (checkTimer) {
        clearInterval(checkTimer)
        checkTimer = null
      }
      if (lockProbeTimer) {
        clearInterval(lockProbeTimer)
        lockProbeTimer = null
      }
      void watcher?.close()
      watcher = null
      if (isOwner) {
        isOwner = false
        void releaseSchedulerLock(lockOpts)
      }
    },
    getNextFireTime() {
      // nextFireAt uses Infinity for "never" (in-flight one-shots, bad cron
      
      
      let min = Infinity
      for (const t of nextFireAt.values()) {
        if (t < min) min = t
      }
      return min === Infinity ? null : min
    },
  }
}

/**
 * Build the missed-task notification text. Guidance precedes the task list
 * and the list is wrapped in a code fence so a multi-line imperative prompt
 * is not interpreted as immediate instructions to avoid self-inflicted
 * prompt injection. The full prompt body is preserved — this path DOES
 * need the model to execute the prompt after user
 * confirmation, and tasks are already deleted from JSON before the model
 * sees this notification.
 */
export function buildMissedTaskNotification(missed: CronTask[]): string {
  const plural = missed.length > 1
  const header =
    `The following one-shot scheduled task${plural ? 's were' : ' was'} missed while Claude was not running. ` +
    `${plural ? 'They have' : 'It has'} already been removed from .claude/scheduled_tasks.json.\n\n` +
    `Do NOT execute ${plural ? 'these prompts' : 'this prompt'} yet. ` +
    `First use the AskUserQuestion tool to ask whether to run ${plural ? 'each one' : 'it'} now. ` +
    `Only execute if the user confirms.`

  const blocks = missed.map(t => {
    const meta = `[${cronToHuman(t.cron)}, created ${new Date(t.createdAt).toLocaleString()}]`
    
    
    
    const longestRun = (t.prompt.match(/`+/g) ?? []).reduce(
      (max, run) => Math.max(max, run.length),
      0,
    )
    const fence = '`'.repeat(Math.max(3, longestRun + 1))
    return `${meta}\n${fence}\n${t.prompt}\n${fence}`
  })

  return `${header}\n\n${blocks.join('\n\n')}`
}
