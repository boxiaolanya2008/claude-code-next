import chalk from 'chalk'
import { writeSync } from 'fs'
import memoize from 'lodash-es/memoize.js'
import { onExit } from 'signal-exit'
import type { ExitReason } from 'src/entrypoints/agentSdkTypes.js'
import {
  getIsInteractive,
  getIsScrollDraining,
  getLastMainRequestId,
  getSessionId,
  isSessionPersistenceDisabled,
} from '../bootstrap/state.js'
import instances from '../ink/instances.js'
import {
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
} from '../ink/termio/csi.js'
import {
  DBP,
  DFE,
  DISABLE_MOUSE_TRACKING,
  EXIT_ALT_SCREEN,
  SHOW_CURSOR,
} from '../ink/termio/dec.js'
import {
  CLEAR_ITERM2_PROGRESS,
  CLEAR_TAB_STATUS,
  CLEAR_TERMINAL_TITLE,
  supportsTabStatus,
  wrapForMultiplexer,
} from '../ink/termio/osc.js'
import { shutdownDatadog } from '../services/analytics/datadog.js'
import { shutdown1PEventLogging } from '../services/analytics/firstPartyEventLogger.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { AppState } from '../state/AppState.js'
import { runCleanupFunctions } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { isEnvTruthy } from './envUtils.js'
import { getCurrentSessionTitle, sessionIdExists } from './sessionStorage.js'
import { sleep } from './sleep.js'
import { profileReport } from './startupProfiler.js'

function cleanupTerminalModes(): void {
  if (!process.stdout.isTTY) {
    return
  }

  try {
    
    
    
    
    
    writeSync(1, DISABLE_MOUSE_TRACKING)
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const inst = instances.get(process.stdout)
    if (inst?.isAltScreenActive) {
      try {
        inst.unmount()
      } catch {
        
        
        writeSync(1, EXIT_ALT_SCREEN)
      }
    }
    
    
    inst?.drainStdin()
    
    
    
    
    
    
    
    inst?.detachForShutdown()
    
    
    writeSync(1, DISABLE_MODIFY_OTHER_KEYS)
    writeSync(1, DISABLE_KITTY_KEYBOARD)
    
    writeSync(1, DFE)
    
    writeSync(1, DBP)
    
    writeSync(1, SHOW_CURSOR)
    
    
    writeSync(1, CLEAR_ITERM2_PROGRESS)
    
    if (supportsTabStatus()) writeSync(1, wrapForMultiplexer(CLEAR_TAB_STATUS))
    
    
    
    if (!isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_TERMINAL_TITLE)) {
      if (process.platform === 'win32') {
        process.title = ''
      } else {
        writeSync(1, CLEAR_TERMINAL_TITLE)
      }
    }
  } catch {
    
    
  }
}

let resumeHintPrinted = false

function printResumeHint(): void {
  
  if (resumeHintPrinted) {
    return
  }
  
  if (
    process.stdout.isTTY &&
    getIsInteractive() &&
    !isSessionPersistenceDisabled()
  ) {
    try {
      const sessionId = getSessionId()
      
      if (!sessionIdExists(sessionId)) {
        return
      }
      const customTitle = getCurrentSessionTitle(sessionId)

      
      let resumeArg: string
      if (customTitle) {
        
        const escaped = customTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        resumeArg = `"${escaped}"`
      } else {
        resumeArg = sessionId
      }

      writeSync(
        1,
        chalk.dim(
          `\nResume this session with:\nclaude --resume ${resumeArg}\n`,
        ),
      )
      resumeHintPrinted = true
    } catch {
      
    }
  }
}

function forceExit(exitCode: number): never {
  
  if (failsafeTimer !== undefined) {
    clearTimeout(failsafeTimer)
    failsafeTimer = undefined
  }
  
  
  
  
  
  
  
  
  
  try {
    instances.get(process.stdout)?.drainStdin()
  } catch {
    
  }
  try {
    process.exit(exitCode)
  } catch (e) {
    
    
    if ((process.env.NODE_ENV as string) === 'test') {
      throw e
    }
    
    process.kill(process.pid, 'SIGKILL')
  }
  
  
  if ((process.env.NODE_ENV as string) !== 'test') {
    throw new Error('unreachable')
  }
  
  
  return undefined as never
}

export const setupGracefulShutdown = memoize(() => {
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  onExit(() => {})

  process.on('SIGINT', () => {
    
    
    
    
    
    if (process.argv.includes('-p') || process.argv.includes('--print')) {
      return
    }
    logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGINT' })
    void gracefulShutdown(0)
  })
  process.on('SIGTERM', () => {
    logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGTERM' })
    void gracefulShutdown(143) 
  })
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => {
      logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGHUP' })
      void gracefulShutdown(129) 
    })

    
    
    
    if (process.stdin.isTTY) {
      orphanCheckInterval = setInterval(() => {
        
        
        if (getIsScrollDraining()) return
        
        if (!process.stdout.writable || !process.stdin.readable) {
          clearInterval(orphanCheckInterval)
          logForDiagnosticsNoPII('info', 'shutdown_signal', {
            signal: 'orphan_detected',
          })
          void gracefulShutdown(129)
        }
      }, 30_000) 
      orphanCheckInterval.unref() 
    }
  }

  
  
  process.on('uncaughtException', error => {
    logForDiagnosticsNoPII('error', 'uncaught_exception', {
      error_name: error.name,
      error_message: error.message.slice(0, 2000),
    })
    logEvent('tengu_uncaught_exception', {
      error_name:
        error.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  })

  
  process.on('unhandledRejection', reason => {
    const errorName =
      reason instanceof Error
        ? reason.name
        : typeof reason === 'string'
          ? 'string'
          : 'unknown'
    const errorInfo =
      reason instanceof Error
        ? {
            error_name: reason.name,
            error_message: reason.message.slice(0, 2000),
            error_stack: reason.stack?.slice(0, 4000),
          }
        : { error_message: String(reason).slice(0, 2000) }
    logForDiagnosticsNoPII('error', 'unhandled_rejection', errorInfo)
    logEvent('tengu_unhandled_rejection', {
      error_name:
        errorName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  })
})

export function gracefulShutdownSync(
  exitCode = 0,
  reason: ExitReason = 'other',
  options?: {
    getAppState?: () => AppState
    setAppState?: (f: (prev: AppState) => AppState) => void
  },
): void {
  
  
  
  process.exitCode = exitCode

  pendingShutdown = gracefulShutdown(exitCode, reason, options)
    .catch(error => {
      logForDebugging(`Graceful shutdown failed: ${error}`, { level: 'error' })
      cleanupTerminalModes()
      printResumeHint()
      forceExit(exitCode)
    })
    
    
    .catch(() => {})
}

let shutdownInProgress = false
let failsafeTimer: ReturnType<typeof setTimeout> | undefined
let orphanCheckInterval: ReturnType<typeof setInterval> | undefined
let pendingShutdown: Promise<void> | undefined

export function isShuttingDown(): boolean {
  return shutdownInProgress
}

export function resetShutdownState(): void {
  shutdownInProgress = false
  resumeHintPrinted = false
  if (failsafeTimer !== undefined) {
    clearTimeout(failsafeTimer)
    failsafeTimer = undefined
  }
  pendingShutdown = undefined
}

export function getPendingShutdownForTesting(): Promise<void> | undefined {
  return pendingShutdown
}

export async function gracefulShutdown(
  exitCode = 0,
  reason: ExitReason = 'other',
  options?: {
    getAppState?: () => AppState
    setAppState?: (f: (prev: AppState) => AppState) => void
    
    finalMessage?: string
  },
): Promise<void> {
  if (shutdownInProgress) {
    return
  }
  shutdownInProgress = true

  
  
  
  const { executeSessionEndHooks, getSessionEndHookTimeoutMs } = await import(
    './hooks.js'
  )
  const sessionEndTimeoutMs = getSessionEndHookTimeoutMs()

  
  
  
  failsafeTimer = setTimeout(
    code => {
      cleanupTerminalModes()
      printResumeHint()
      forceExit(code)
    },
    Math.max(5000, sessionEndTimeoutMs + 3500),
    exitCode,
  )
  failsafeTimer.unref()

  
  process.exitCode = exitCode

  
  
  
  
  
  cleanupTerminalModes()
  printResumeHint()

  
  
  
  
  let cleanupTimeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const cleanupPromise = (async () => {
      try {
        await runCleanupFunctions()
      } catch {
        
      }
    })()

    await Promise.race([
      cleanupPromise,
      new Promise((_, reject) => {
        cleanupTimeoutId = setTimeout(
          rej => rej(new CleanupTimeoutError()),
          2000,
          reject,
        )
      }),
    ])
    clearTimeout(cleanupTimeoutId)
  } catch {
    
    clearTimeout(cleanupTimeoutId)
  }

  
  
  
  try {
    await executeSessionEndHooks(reason, {
      ...options,
      signal: AbortSignal.timeout(sessionEndTimeoutMs),
      timeoutMs: sessionEndTimeoutMs,
    })
  } catch {
    
  }

  
  try {
    profileReport()
  } catch {
    
  }

  
  
  const lastRequestId = getLastMainRequestId()
  if (lastRequestId) {
    logEvent('tengu_cache_eviction_hint', {
      scope:
        'session_end' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      last_request_id:
        lastRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  
  
  
  try {
    await Promise.race([
      Promise.all([shutdown1PEventLogging(), shutdownDatadog()]),
      sleep(500),
    ])
  } catch {
    
  }

  if (options?.finalMessage) {
    try {
      
      writeSync(2, options.finalMessage + '\n')
    } catch {
      
    }
  }

  forceExit(exitCode)
}

class CleanupTimeoutError extends Error {
  constructor() {
    super('Cleanup timeout')
  }
}
