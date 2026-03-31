import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { PassThrough } from 'stream'
import { URL } from 'url'
import { getSessionId } from '../bootstrap/state.js'
import { getPollIntervalConfig } from '../bridge/pollConfig.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { setCommandLifecycleListener } from '../utils/commandLifecycle.js'
import { isDebugMode, logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'
import { gracefulShutdown } from '../utils/gracefulShutdown.js'
import { logError } from '../utils/log.js'
import { writeToStdout } from '../utils/process.js'
import { getSessionIngressAuthToken } from '../utils/sessionIngressAuth.js'
import {
  setSessionMetadataChangedListener,
  setSessionStateChangedListener,
} from '../utils/sessionState.js'
import {
  setInternalEventReader,
  setInternalEventWriter,
} from '../utils/sessionStorage.js'
import { ndjsonSafeStringify } from './ndjsonSafeStringify.js'
import { StructuredIO } from './structuredIO.js'
import { CCRClient, CCRInitError } from './transports/ccrClient.js'
import { SSETransport } from './transports/SSETransport.js'
import type { Transport } from './transports/Transport.js'
import { getTransportForUrl } from './transports/transportUtils.js'

export class RemoteIO extends StructuredIO {
  private url: URL
  private transport: Transport
  private inputStream: PassThrough
  private readonly isBridge: boolean = false
  private readonly isDebug: boolean = false
  private ccrClient: CCRClient | null = null
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    streamUrl: string,
    initialPrompt?: AsyncIterable<string>,
    replayUserMessages?: boolean,
  ) {
    const inputStream = new PassThrough({ encoding: 'utf8' })
    super(inputStream, replayUserMessages)
    this.inputStream = inputStream
    this.url = new URL(streamUrl)

    
    const headers: Record<string, string> = {}
    const sessionToken = getSessionIngressAuthToken()
    if (sessionToken) {
      headers['Authorization'] = `Bearer ${sessionToken}`
    } else {
      logForDebugging('[remote-io] No session ingress token available', {
        level: 'error',
      })
    }

    
    const erVersion = process.env.CLAUDE_CODE_NEXT_ENVIRONMENT_RUNNER_VERSION
    if (erVersion) {
      headers['x-environment-runner-version'] = erVersion
    }

    
    
    
    const refreshHeaders = (): Record<string, string> => {
      const h: Record<string, string> = {}
      const freshToken = getSessionIngressAuthToken()
      if (freshToken) {
        h['Authorization'] = `Bearer ${freshToken}`
      }
      const freshErVersion = process.env.CLAUDE_CODE_NEXT_ENVIRONMENT_RUNNER_VERSION
      if (freshErVersion) {
        h['x-environment-runner-version'] = freshErVersion
      }
      return h
    }

    
    this.transport = getTransportForUrl(
      this.url,
      headers,
      getSessionId(),
      refreshHeaders,
    )

    
    this.isBridge = process.env.CLAUDE_CODE_NEXT_ENVIRONMENT_KIND === 'bridge'
    this.isDebug = isDebugMode()
    this.transport.setOnData((data: string) => {
      this.inputStream.write(data)
      if (this.isBridge && this.isDebug) {
        writeToStdout(data.endsWith('\n') ? data : data + '\n')
      }
    })

    
    this.transport.setOnClose(() => {
      
      this.inputStream.end()
    })

    
    
    
    
    
    if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_CCR_V2)) {
      
      
      
      
      if (!(this.transport instanceof SSETransport)) {
        throw new Error(
          'CCR v2 requires SSETransport; check getTransportForUrl',
        )
      }
      this.ccrClient = new CCRClient(this.transport, this.url)
      const init = this.ccrClient.initialize()
      this.restoredWorkerState = init.catch(() => null)
      init.catch((error: unknown) => {
        logForDiagnosticsNoPII('error', 'cli_worker_lifecycle_init_failed', {
          reason: error instanceof CCRInitError ? error.reason : 'unknown',
        })
        logError(
          new Error(`CCRClient initialization failed: ${errorMessage(error)}`),
        )
        void gracefulShutdown(1, 'other')
      })
      registerCleanup(async () => this.ccrClient?.close())

      
      
      
      setInternalEventWriter((eventType, payload, options) =>
        this.ccrClient!.writeInternalEvent(eventType, payload, options),
      )

      
      
      
      setInternalEventReader(
        () => this.ccrClient!.readInternalEvents(),
        () => this.ccrClient!.readSubagentInternalEvents(),
      )

      const LIFECYCLE_TO_DELIVERY = {
        started: 'processing',
        completed: 'processed',
      } as const
      setCommandLifecycleListener((uuid, state) => {
        this.ccrClient?.reportDelivery(uuid, LIFECYCLE_TO_DELIVERY[state])
      })
      setSessionStateChangedListener((state, details) => {
        this.ccrClient?.reportState(state, details)
      })
      setSessionMetadataChangedListener(metadata => {
        this.ccrClient?.reportMetadata(metadata)
      })
    }

    
    
    void this.transport.connect()

    
    
    
    
    
    
    
    
    
    
    const keepAliveIntervalMs =
      getPollIntervalConfig().session_keepalive_interval_v2_ms
    if (this.isBridge && keepAliveIntervalMs > 0) {
      this.keepAliveTimer = setInterval(() => {
        logForDebugging('[remote-io] keep_alive sent')
        void this.write({ type: 'keep_alive' }).catch(err => {
          logForDebugging(
            `[remote-io] keep_alive write failed: ${errorMessage(err)}`,
          )
        })
      }, keepAliveIntervalMs)
      this.keepAliveTimer.unref?.()
    }

    
    registerCleanup(async () => this.close())

    
    if (initialPrompt) {
      
      
      
      
      
      const stream = this.inputStream
      void (async () => {
        for await (const chunk of initialPrompt) {
          stream.write(String(chunk).replace(/\n$/, '') + '\n')
        }
      })()
    }
  }

  override flushInternalEvents(): Promise<void> {
    return this.ccrClient?.flushInternalEvents() ?? Promise.resolve()
  }

  override get internalEventsPending(): number {
    return this.ccrClient?.internalEventsPending ?? 0
  }

  

  async write(message: StdoutMessage): Promise<void> {
    if (this.ccrClient) {
      await this.ccrClient.writeEvent(message)
    } else {
      await this.transport.write(message)
    }
    if (this.isBridge) {
      if (message.type === 'control_request' || this.isDebug) {
        writeToStdout(ndjsonSafeStringify(message) + '\n')
      }
    }
  }

  

  close(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
    this.transport.close()
    this.inputStream.end()
  }
}
