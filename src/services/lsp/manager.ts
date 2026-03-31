import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  createLSPServerManager,
  type LSPServerManager,
} from './LSPServerManager.js'
import { registerLSPNotificationHandlers } from './passiveFeedback.js'

type InitializationState = 'not-started' | 'pending' | 'success' | 'failed'

let lspManagerInstance: LSPServerManager | undefined

let initializationState: InitializationState = 'not-started'

let initializationError: Error | undefined

let initializationGeneration = 0

let initializationPromise: Promise<void> | undefined

export function _resetLspManagerForTesting(): void {
  initializationState = 'not-started'
  initializationError = undefined
  initializationPromise = undefined
  initializationGeneration++
}

export function getLspServerManager(): LSPServerManager | undefined {
  
  if (initializationState === 'failed') {
    return undefined
  }
  return lspManagerInstance
}

export function getInitializationStatus():
  | { status: 'not-started' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'failed'; error: Error } {
  if (initializationState === 'failed') {
    return {
      status: 'failed',
      error: initializationError || new Error('Initialization failed'),
    }
  }
  if (initializationState === 'not-started') {
    return { status: 'not-started' }
  }
  if (initializationState === 'pending') {
    return { status: 'pending' }
  }
  return { status: 'success' }
}

export function isLspConnected(): boolean {
  if (initializationState === 'failed') return false
  const manager = getLspServerManager()
  if (!manager) return false
  const servers = manager.getAllServers()
  if (servers.size === 0) return false
  for (const server of servers.values()) {
    if (server.state !== 'error') return true
  }
  return false
}

export async function waitForInitialization(): Promise<void> {
  
  if (initializationState === 'success' || initializationState === 'failed') {
    return
  }

  
  if (initializationState === 'pending' && initializationPromise) {
    await initializationPromise
  }

  
}

export function initializeLspServerManager(): void {
  
  
  if (isBareMode()) {
    return
  }
  logForDebugging('[LSP MANAGER] initializeLspServerManager() called')

  
  if (lspManagerInstance !== undefined && initializationState !== 'failed') {
    logForDebugging(
      '[LSP MANAGER] Already initialized or initializing, skipping',
    )
    return
  }

  
  if (initializationState === 'failed') {
    lspManagerInstance = undefined
    initializationError = undefined
  }

  
  lspManagerInstance = createLSPServerManager()
  initializationState = 'pending'
  logForDebugging('[LSP MANAGER] Created manager instance, state=pending')

  
  const currentGeneration = ++initializationGeneration
  logForDebugging(
    `[LSP MANAGER] Starting async initialization (generation ${currentGeneration})`,
  )

  
  
  initializationPromise = lspManagerInstance
    .initialize()
    .then(() => {
      
      if (currentGeneration === initializationGeneration) {
        initializationState = 'success'
        logForDebugging('LSP server manager initialized successfully')

        
        if (lspManagerInstance) {
          registerLSPNotificationHandlers(lspManagerInstance)
        }
      }
    })
    .catch((error: unknown) => {
      
      if (currentGeneration === initializationGeneration) {
        initializationState = 'failed'
        initializationError = error as Error
        
        lspManagerInstance = undefined

        logError(error as Error)
        logForDebugging(
          `Failed to initialize LSP server manager: ${errorMessage(error)}`,
        )
      }
    })
}

export function reinitializeLspServerManager(): void {
  if (initializationState === 'not-started') {
    
    
    return
  }

  logForDebugging('[LSP MANAGER] reinitializeLspServerManager() called')

  
  
  
  if (lspManagerInstance) {
    void lspManagerInstance.shutdown().catch(err => {
      logForDebugging(
        `[LSP MANAGER] old instance shutdown during reinit failed: ${errorMessage(err)}`,
      )
    })
  }

  
  
  lspManagerInstance = undefined
  initializationState = 'not-started'
  initializationError = undefined

  initializeLspServerManager()
}

export async function shutdownLspServerManager(): Promise<void> {
  if (lspManagerInstance === undefined) {
    return
  }

  try {
    await lspManagerInstance.shutdown()
    logForDebugging('LSP server manager shut down successfully')
  } catch (error: unknown) {
    logError(error as Error)
    logForDebugging(
      `Failed to shutdown LSP server manager: ${errorMessage(error)}`,
    )
  } finally {
    
    lspManagerInstance = undefined
    initializationState = 'not-started'
    initializationError = undefined
    initializationPromise = undefined
    
    initializationGeneration++
  }
}
