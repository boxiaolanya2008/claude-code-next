import * as path from 'path'
import { pathToFileURL } from 'url'
import type { InitializeParams } from 'vscode-languageserver-protocol'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import type { createLSPClient as createLSPClientType } from './LSPClient.js'
import type { LspServerState, ScopedLspServerConfig } from './types.js'

const LSP_ERROR_CONTENT_MODIFIED = -32801

const MAX_RETRIES_FOR_TRANSIENT_ERRORS = 3

const RETRY_BASE_DELAY_MS = 500

export type LSPServerInstance = {
  /** Unique server identifier */
  readonly name: string
  
  readonly config: ScopedLspServerConfig
  
  readonly state: LspServerState
  
  readonly startTime: Date | undefined
  
  readonly lastError: Error | undefined
  
  readonly restartCount: number
  
  start(): Promise<void>
  
  stop(): Promise<void>
  
  restart(): Promise<void>
  
  isHealthy(): boolean
  
  sendRequest<T>(method: string, params: unknown): Promise<T>
  
  sendNotification(method: string, params: unknown): Promise<void>
  
  onNotification(method: string, handler: (params: unknown) => void): void
  /** Register a handler for LSP requests from the server */
  onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): void
}

/**
 * Creates and manages a single LSP server instance.
 *
 * Uses factory function pattern with closures for state encapsulation (avoiding classes).
 * Provides state tracking, health monitoring, and request forwarding for an LSP server.
 * Supports manual restart with configurable retry limits.
 *
 * State machine transitions:
 * - stopped → starting → running
 * - running → stopping → stopped
 * - any → error (on failure)
 * - error → starting (on retry)
 *
 * @param name - Unique identifier for this server instance
 * @param config - Server configuration including command, args, and limits
 * @returns LSP server instance with lifecycle management methods
 *
 * @example
 * const instance = createLSPServerInstance('my-server', config)
 * await instance.start()
 * const result = await instance.sendRequest('textDocument/definition', params)
 * await instance.stop()
 */
export function createLSPServerInstance(
  name: string,
  config: ScopedLspServerConfig,
): LSPServerInstance {
  // Validate that unimplemented fields are not set
  if (config.restartOnCrash !== undefined) {
    throw new Error(
      `LSP server '${name}': restartOnCrash is not yet implemented. Remove this field from the configuration.`,
    )
  }
  if (config.shutdownTimeout !== undefined) {
    throw new Error(
      `LSP server '${name}': shutdownTimeout is not yet implemented. Remove this field from the configuration.`,
    )
  }

  // Private state encapsulated via closures. Lazy-require LSPClient so
  // vscode-jsonrpc (~129KB) only loads when an LSP server is actually
  // instantiated, not when the static import chain reaches this module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createLSPClient } = require('./LSPClient.js') as {
    createLSPClient: typeof createLSPClientType
  }
  let state: LspServerState = 'stopped'
  let startTime: Date | undefined
  let lastError: Error | undefined
  let restartCount = 0
  let crashRecoveryCount = 0
  // Propagate crash state so ensureServerStarted can restart on next use.
  // Without this, state stays 'running' after crash and the server is never
  // restarted (zombie state).
  const client = createLSPClient(name, error => {
    state = 'error'
    lastError = error
    crashRecoveryCount++
  })

  /**
   * Starts the LSP server and initializes it with workspace information.
   *
   * If the server is already running or starting, this method returns immediately.
   * On failure, sets state to 'error', logs for monitoring, and throws.
   *
   * @throws {Error} If server fails to start or initialize
   */
  async function start(): Promise<void> {
    if (state === 'running' || state === 'starting') {
      return
    }

    // Cap crash-recovery attempts so a persistently crashing server doesn't
    
    const maxRestarts = config.maxRestarts ?? 3
    if (state === 'error' && crashRecoveryCount > maxRestarts) {
      const error = new Error(
        `LSP server '${name}' exceeded max crash recovery attempts (${maxRestarts})`,
      )
      lastError = error
      logError(error)
      throw error
    }

    let initPromise: Promise<unknown> | undefined
    try {
      state = 'starting'
      logForDebugging(`Starting LSP server instance: ${name}`)

      
      await client.start(config.command, config.args || [], {
        env: config.env,
        cwd: config.workspaceFolder,
      })

      
      const workspaceFolder = config.workspaceFolder || getCwd()
      const workspaceUri = pathToFileURL(workspaceFolder).href

      const initParams: InitializeParams = {
        processId: process.pid,

        // Pass server-specific initialization options from plugin config
        
        
        
        initializationOptions: config.initializationOptions ?? {},

        // Modern approach (LSP 3.16+) - required for Pyright, gopls
        workspaceFolders: [
          {
            uri: workspaceUri,
            name: path.basename(workspaceFolder),
          },
        ],

        // Deprecated fields - some servers still need these for proper URI resolution
        rootPath: workspaceFolder, // Deprecated in LSP 3.8 but needed by some servers
        rootUri: workspaceUri, // Deprecated in LSP 3.16 but needed by typescript-language-server for goToDefinition

        
        capabilities: {
          workspace: {
            // Don't claim to support workspace/configuration since we don't implement it
            
            configuration: false,
            // Don't claim to support workspace folders changes since we don't handle
            
            workspaceFolders: false,
          },
          textDocument: {
            synchronization: {
              dynamicRegistration: false,
              willSave: false,
              willSaveWaitUntil: false,
              didSave: true,
            },
            publishDiagnostics: {
              relatedInformation: true,
              tagSupport: {
                valueSet: [1, 2], // Unnecessary (1), Deprecated (2)
              },
              versionSupport: false,
              codeDescriptionSupport: true,
              dataSupport: false,
            },
            hover: {
              dynamicRegistration: false,
              contentFormat: ['markdown', 'plaintext'],
            },
            definition: {
              dynamicRegistration: false,
              linkSupport: true,
            },
            references: {
              dynamicRegistration: false,
            },
            documentSymbol: {
              dynamicRegistration: false,
              hierarchicalDocumentSymbolSupport: true,
            },
            callHierarchy: {
              dynamicRegistration: false,
            },
          },
          general: {
            positionEncodings: ['utf-16'],
          },
        },
      }

      initPromise = client.initialize(initParams)
      if (config.startupTimeout !== undefined) {
        await withTimeout(
          initPromise,
          config.startupTimeout,
          `LSP server '${name}' timed out after ${config.startupTimeout}ms during initialization`,
        )
      } else {
        await initPromise
      }

      state = 'running'
      startTime = new Date()
      crashRecoveryCount = 0
      logForDebugging(`LSP server instance started: ${name}`)
    } catch (error) {
      // Clean up the spawned child process on timeout/error
      client.stop().catch(() => {})
      
      initPromise?.catch(() => {})
      state = 'error'
      lastError = error as Error
      logError(error)
      throw error
    }
  }

  /**
   * Stops the LSP server gracefully.
   *
   * If already stopped or stopping, returns immediately.
   * On failure, sets state to 'error', logs for monitoring, and throws.
   *
   * @throws {Error} If server fails to stop
   */
  async function stop(): Promise<void> {
    if (state === 'stopped' || state === 'stopping') {
      return
    }

    try {
      state = 'stopping'
      await client.stop()
      state = 'stopped'
      logForDebugging(`LSP server instance stopped: ${name}`)
    } catch (error) {
      state = 'error'
      lastError = error as Error
      logError(error)
      throw error
    }
  }

  /**
   * Manually restarts the server by stopping and starting it.
   *
   * Increments restartCount and enforces maxRestarts limit.
   * Note: This is NOT automatic - must be called explicitly.
   *
   * @throws {Error} If stop or start fails, or if restartCount exceeds config.maxRestarts (default: 3)
   */
  async function restart(): Promise<void> {
    try {
      await stop()
    } catch (error) {
      const stopError = new Error(
        `Failed to stop LSP server '${name}' during restart: ${errorMessage(error)}`,
      )
      logError(stopError)
      throw stopError
    }

    restartCount++

    const maxRestarts = config.maxRestarts ?? 3
    if (restartCount > maxRestarts) {
      const error = new Error(
        `Max restart attempts (${maxRestarts}) exceeded for server '${name}'`,
      )
      logError(error)
      throw error
    }

    try {
      await start()
    } catch (error) {
      const startError = new Error(
        `Failed to start LSP server '${name}' during restart (attempt ${restartCount}/${maxRestarts}): ${errorMessage(error)}`,
      )
      logError(startError)
      throw startError
    }
  }

  /**
   * Checks if the server is healthy and ready to handle requests.
   *
   * @returns true if state is 'running' AND the client has completed initialization
   */
  function isHealthy(): boolean {
    return state === 'running' && client.isInitialized
  }

  /**
   * Sends an LSP request to the server with retry logic for transient errors.
   *
   * Checks server health before sending and wraps errors with context.
   * Automatically retries on "content modified" errors (code -32801) which occur
   * when servers like rust-analyzer are still indexing. This is expected LSP behavior
   * and clients should retry silently per the LSP specification.
   *
   * @param method - LSP method name (e.g., 'textDocument/definition')
   * @param params - Method-specific parameters
   * @returns The server's response
   * @throws {Error} If server is not healthy or request fails after all retries
   */
  async function sendRequest<T>(method: string, params: unknown): Promise<T> {
    if (!isHealthy()) {
      const error = new Error(
        `Cannot send request to LSP server '${name}': server is ${state}` +
          `${lastError ? `, last error: ${lastError.message}` : ''}`,
      )
      logError(error)
      throw error
    }

    let lastAttemptError: Error | undefined

    for (
      let attempt = 0;
      attempt <= MAX_RETRIES_FOR_TRANSIENT_ERRORS;
      attempt++
    ) {
      try {
        return await client.sendRequest(method, params)
      } catch (error) {
        lastAttemptError = error as Error

        
        
        
        
        const errorCode = (error as { code?: number }).code
        const isContentModifiedError =
          typeof errorCode === 'number' &&
          errorCode === LSP_ERROR_CONTENT_MODIFIED

        if (
          isContentModifiedError &&
          attempt < MAX_RETRIES_FOR_TRANSIENT_ERRORS
        ) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
          logForDebugging(
            `LSP request '${method}' to '${name}' got ContentModified error, ` +
              `retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES_FOR_TRANSIENT_ERRORS})…`,
          )
          await sleep(delay)
          continue
        }

        // Non-retryable error or max retries exceeded
        break
      }
    }

    // All retries failed or non-retryable error
    const requestError = new Error(
      `LSP request '${method}' failed for server '${name}': ${lastAttemptError?.message ?? 'unknown error'}`,
    )
    logError(requestError)
    throw requestError
  }

  /**
   * Send a notification to the LSP server (fire-and-forget).
   * Used for file synchronization (didOpen, didChange, didClose).
   */
  async function sendNotification(
    method: string,
    params: unknown,
  ): Promise<void> {
    if (!isHealthy()) {
      const error = new Error(
        `Cannot send notification to LSP server '${name}': server is ${state}`,
      )
      logError(error)
      throw error
    }

    try {
      await client.sendNotification(method, params)
    } catch (error) {
      const notificationError = new Error(
        `LSP notification '${method}' failed for server '${name}': ${errorMessage(error)}`,
      )
      logError(notificationError)
      throw notificationError
    }
  }

  /**
   * Registers a handler for LSP notifications from the server.
   *
   * @param method - LSP notification method (e.g., 'window/logMessage')
   * @param handler - Callback function to handle the notification
   */
  function onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): void {
    client.onNotification(method, handler)
  }

  /**
   * Registers a handler for LSP requests from the server.
   *
   * Some LSP servers send requests TO the client (reverse direction).
   * This allows registering handlers for such requests.
   *
   * @param method - LSP request method (e.g., 'workspace/configuration')
   * @param handler - Callback function to handle the request and return a response
   */
  function onRequest<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): void {
    client.onRequest(method, handler)
  }

  // Return public API
  return {
    name,
    config,
    get state() {
      return state
    },
    get startTime() {
      return startTime
    },
    get lastError() {
      return lastError
    },
    get restartCount() {
      return restartCount
    },
    start,
    stop,
    restart,
    isHealthy,
    sendRequest,
    sendNotification,
    onNotification,
    onRequest,
  }
}

/**
 * Race a promise against a timeout. Cleans up the timer regardless of outcome
 * to avoid unhandled rejections from orphaned setTimeout callbacks.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout((rej, msg) => rej(new Error(msg)), ms, reject, message)
  })
  return Promise.race([promise, timeoutPromise]).finally(() =>
    clearTimeout(timer!),
  )
}
