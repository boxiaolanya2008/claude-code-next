import { getIsNonInteractiveSession } from '../../../bootstrap/state.js'
import { logForDebugging } from '../../../utils/debug.js'
import { getPlatform } from '../../../utils/platform.js'
import {
  isInITerm2,
  isInsideTmux,
  isInsideTmuxSync,
  isIt2CliAvailable,
  isTmuxAvailable,
} from './detection.js'
import { createInProcessBackend } from './InProcessBackend.js'
import { getPreferTmuxOverIterm2 } from './it2Setup.js'
import { createPaneBackendExecutor } from './PaneBackendExecutor.js'
import { getTeammateModeFromSnapshot } from './teammateModeSnapshot.js'
import type {
  BackendDetectionResult,
  PaneBackend,
  PaneBackendType,
  TeammateExecutor,
} from './types.js'

let cachedBackend: PaneBackend | null = null

let cachedDetectionResult: BackendDetectionResult | null = null

let backendsRegistered = false

let cachedInProcessBackend: TeammateExecutor | null = null

let cachedPaneBackendExecutor: TeammateExecutor | null = null

let inProcessFallbackActive = false

let TmuxBackendClass: (new () => PaneBackend) | null = null

let ITermBackendClass: (new () => PaneBackend) | null = null

export async function ensureBackendsRegistered(): Promise<void> {
  if (backendsRegistered) return
  await import('./TmuxBackend.js')
  await import('./ITermBackend.js')
  backendsRegistered = true
}

export function registerTmuxBackend(backendClass: new () => PaneBackend): void {
  TmuxBackendClass = backendClass
}

export function registerITermBackend(
  backendClass: new () => PaneBackend,
): void {
  logForDebugging(
    `[registry] registerITermBackend called, class=${backendClass?.name || 'undefined'}`,
  )
  ITermBackendClass = backendClass
}

function createTmuxBackend(): PaneBackend {
  if (!TmuxBackendClass) {
    throw new Error(
      'TmuxBackend not registered. Import TmuxBackend.ts before using the registry.',
    )
  }
  return new TmuxBackendClass()
}

function createITermBackend(): PaneBackend {
  if (!ITermBackendClass) {
    throw new Error(
      'ITermBackend not registered. Import ITermBackend.ts before using the registry.',
    )
  }
  return new ITermBackendClass()
}

export async function detectAndGetBackend(): Promise<BackendDetectionResult> {
  
  await ensureBackendsRegistered()

  
  if (cachedDetectionResult) {
    logForDebugging(
      `[BackendRegistry] Using cached backend: ${cachedDetectionResult.backend.type}`,
    )
    return cachedDetectionResult
  }

  logForDebugging('[BackendRegistry] Starting backend detection...')

  
  const insideTmux = await isInsideTmux()
  const inITerm2 = isInITerm2()

  logForDebugging(
    `[BackendRegistry] Environment: insideTmux=${insideTmux}, inITerm2=${inITerm2}`,
  )

  
  if (insideTmux) {
    logForDebugging(
      '[BackendRegistry] Selected: tmux (running inside tmux session)',
    )
    const backend = createTmuxBackend()
    cachedBackend = backend
    cachedDetectionResult = {
      backend,
      isNative: true,
      needsIt2Setup: false,
    }
    return cachedDetectionResult
  }

  
  if (inITerm2) {
    
    const preferTmux = getPreferTmuxOverIterm2()
    if (preferTmux) {
      logForDebugging(
        '[BackendRegistry] User prefers tmux over iTerm2, skipping iTerm2 detection',
      )
    } else {
      const it2Available = await isIt2CliAvailable()
      logForDebugging(
        `[BackendRegistry] iTerm2 detected, it2 CLI available: ${it2Available}`,
      )

      if (it2Available) {
        logForDebugging(
          '[BackendRegistry] Selected: iterm2 (native iTerm2 with it2 CLI)',
        )
        const backend = createITermBackend()
        cachedBackend = backend
        cachedDetectionResult = {
          backend,
          isNative: true,
          needsIt2Setup: false,
        }
        return cachedDetectionResult
      }
    }

    
    const tmuxAvailable = await isTmuxAvailable()
    logForDebugging(
      `[BackendRegistry] it2 not available, tmux available: ${tmuxAvailable}`,
    )

    if (tmuxAvailable) {
      logForDebugging(
        '[BackendRegistry] Selected: tmux (fallback in iTerm2, it2 setup recommended)',
      )
      
      
      const backend = createTmuxBackend()
      cachedBackend = backend
      cachedDetectionResult = {
        backend,
        isNative: false,
        needsIt2Setup: !preferTmux,
      }
      return cachedDetectionResult
    }

    
    logForDebugging(
      '[BackendRegistry] ERROR: iTerm2 detected but no it2 CLI and no tmux',
    )
    throw new Error(
      'iTerm2 detected but it2 CLI not installed. Install it2 with: pip install it2',
    )
  }

  
  const tmuxAvailable = await isTmuxAvailable()
  logForDebugging(
    `[BackendRegistry] Not in tmux or iTerm2, tmux available: ${tmuxAvailable}`,
  )

  if (tmuxAvailable) {
    logForDebugging('[BackendRegistry] Selected: tmux (external session mode)')
    const backend = createTmuxBackend()
    cachedBackend = backend
    cachedDetectionResult = {
      backend,
      isNative: false,
      needsIt2Setup: false,
    }
    return cachedDetectionResult
  }

  
  logForDebugging('[BackendRegistry] ERROR: No pane backend available')
  throw new Error(getTmuxInstallInstructions())
}

function getTmuxInstallInstructions(): string {
  const platform = getPlatform()

  switch (platform) {
    case 'macos':
      return `To use agent swarms, install tmux:
  brew install tmux
Then start a tmux session with: tmux new-session -s claude`

    case 'linux':
    case 'wsl':
      return `To use agent swarms, install tmux:
  sudo apt install tmux    # Ubuntu/Debian
  sudo dnf install tmux    # Fedora/RHEL
Then start a tmux session with: tmux new-session -s claude`

    case 'windows':
      return `To use agent swarms, you need tmux which requires WSL (Windows Subsystem for Linux).
Install WSL first, then inside WSL run:
  sudo apt install tmux
Then start a tmux session with: tmux new-session -s claude`

    default:
      return `To use agent swarms, install tmux using your system's package manager.
Then start a tmux session with: tmux new-session -s claude`
  }
}

export function getBackendByType(type: PaneBackendType): PaneBackend {
  switch (type) {
    case 'tmux':
      return createTmuxBackend()
    case 'iterm2':
      return createITermBackend()
  }
}

export function getCachedBackend(): PaneBackend | null {
  return cachedBackend
}

export function getCachedDetectionResult(): BackendDetectionResult | null {
  return cachedDetectionResult
}

export function markInProcessFallback(): void {
  logForDebugging('[BackendRegistry] Marking in-process fallback as active')
  inProcessFallbackActive = true
}

function getTeammateMode(): 'auto' | 'tmux' | 'in-process' {
  return getTeammateModeFromSnapshot()
}

export function isInProcessEnabled(): boolean {
  
  
  if (getIsNonInteractiveSession()) {
    logForDebugging(
      '[BackendRegistry] isInProcessEnabled: true (non-interactive session)',
    )
    return true
  }

  const mode = getTeammateMode()

  let enabled: boolean
  if (mode === 'in-process') {
    enabled = true
  } else if (mode === 'tmux') {
    enabled = false
  } else {
    
    
    
    if (inProcessFallbackActive) {
      logForDebugging(
        '[BackendRegistry] isInProcessEnabled: true (fallback after pane backend unavailable)',
      )
      return true
    }
    
    
    const insideTmux = isInsideTmuxSync()
    const inITerm2 = isInITerm2()
    enabled = !insideTmux && !inITerm2
  }

  logForDebugging(
    `[BackendRegistry] isInProcessEnabled: ${enabled} (mode=${mode}, insideTmux=${isInsideTmuxSync()}, inITerm2=${isInITerm2()})`,
  )
  return enabled
}

export function getResolvedTeammateMode(): 'in-process' | 'tmux' {
  return isInProcessEnabled() ? 'in-process' : 'tmux'
}

export function getInProcessBackend(): TeammateExecutor {
  if (!cachedInProcessBackend) {
    cachedInProcessBackend = createInProcessBackend()
  }
  return cachedInProcessBackend
}

export async function getTeammateExecutor(
  preferInProcess: boolean = false,
): Promise<TeammateExecutor> {
  if (preferInProcess && isInProcessEnabled()) {
    logForDebugging('[BackendRegistry] Using in-process executor')
    return getInProcessBackend()
  }

  
  logForDebugging('[BackendRegistry] Using pane backend executor')
  return getPaneBackendExecutor()
}

async function getPaneBackendExecutor(): Promise<TeammateExecutor> {
  if (!cachedPaneBackendExecutor) {
    const detection = await detectAndGetBackend()
    cachedPaneBackendExecutor = createPaneBackendExecutor(detection.backend)
    logForDebugging(
      `[BackendRegistry] Created PaneBackendExecutor wrapping ${detection.backend.type}`,
    )
  }
  return cachedPaneBackendExecutor
}

export function resetBackendDetection(): void {
  cachedBackend = null
  cachedDetectionResult = null
  cachedInProcessBackend = null
  cachedPaneBackendExecutor = null
  backendsRegistered = false
  inProcessFallbackActive = false
}
