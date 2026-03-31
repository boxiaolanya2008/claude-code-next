

import { type ChildProcess, spawn } from 'child_process'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'

const CAFFEINATE_TIMEOUT_SECONDS = 300 

const RESTART_INTERVAL_MS = 4 * 60 * 1000

let caffeinateProcess: ChildProcess | null = null
let restartInterval: ReturnType<typeof setInterval> | null = null
let refCount = 0
let cleanupRegistered = false

export function startPreventSleep(): void {
  refCount++

  if (refCount === 1) {
    spawnCaffeinate()
    startRestartInterval()
  }
}

export function stopPreventSleep(): void {
  if (refCount > 0) {
    refCount--
  }

  if (refCount === 0) {
    stopRestartInterval()
    killCaffeinate()
  }
}

export function forceStopPreventSleep(): void {
  refCount = 0
  stopRestartInterval()
  killCaffeinate()
}

function startRestartInterval(): void {
  
  if (process.platform !== 'darwin') {
    return
  }

  
  if (restartInterval !== null) {
    return
  }

  restartInterval = setInterval(() => {
    
    if (refCount > 0) {
      logForDebugging('Restarting caffeinate to maintain sleep prevention')
      killCaffeinate()
      spawnCaffeinate()
    }
  }, RESTART_INTERVAL_MS)

  
  restartInterval.unref()
}

function stopRestartInterval(): void {
  if (restartInterval !== null) {
    clearInterval(restartInterval)
    restartInterval = null
  }
}

function spawnCaffeinate(): void {
  
  if (process.platform !== 'darwin') {
    return
  }

  
  if (caffeinateProcess !== null) {
    return
  }

  
  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(async () => {
      forceStopPreventSleep()
    })
  }

  try {
    
    
    
    
    caffeinateProcess = spawn(
      'caffeinate',
      ['-i', '-t', String(CAFFEINATE_TIMEOUT_SECONDS)],
      {
        stdio: 'ignore',
      },
    )

    
    caffeinateProcess.unref()

    const thisProc = caffeinateProcess
    caffeinateProcess.on('error', err => {
      logForDebugging(`caffeinate spawn error: ${err.message}`)
      if (caffeinateProcess === thisProc) caffeinateProcess = null
    })

    caffeinateProcess.on('exit', () => {
      if (caffeinateProcess === thisProc) caffeinateProcess = null
    })

    logForDebugging('Started caffeinate to prevent sleep')
  } catch {
    
    caffeinateProcess = null
  }
}

function killCaffeinate(): void {
  if (caffeinateProcess !== null) {
    const proc = caffeinateProcess
    caffeinateProcess = null
    try {
      
      proc.kill('SIGKILL')
      logForDebugging('Stopped caffeinate, allowing sleep')
    } catch {
      
    }
  }
}
