import axios, { type AxiosError } from 'axios'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js'
import { SerialBatchEventUploader } from './SerialBatchEventUploader.js'
import {
  WebSocketTransport,
  type WebSocketTransportOptions,
} from './WebSocketTransport.js'

const BATCH_FLUSH_INTERVAL_MS = 100

const POST_TIMEOUT_MS = 15_000

// 3s here exceeds it, but the process lives ~2s longer for hooks+analytics.
const CLOSE_GRACE_MS = 3000

export class HybridTransport extends WebSocketTransport {
  private postUrl: string
  private uploader: SerialBatchEventUploader<StdoutMessage>

  
  
  private streamEventBuffer: StdoutMessage[] = []
  private streamEventTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    url: URL,
    headers: Record<string, string> = {},
    sessionId?: string,
    refreshHeaders?: () => Record<string, string>,
    options?: WebSocketTransportOptions & {
      maxConsecutiveFailures?: number
      onBatchDropped?: (batchSize: number, failures: number) => void
    },
  ) {
    super(url, headers, sessionId, refreshHeaders, options)
    const { maxConsecutiveFailures, onBatchDropped } = options ?? {}
    this.postUrl = convertWsUrlToPostUrl(url)
    this.uploader = new SerialBatchEventUploader<StdoutMessage>({
      // Large cap — session-ingress accepts arbitrary batch sizes. Events
      
      maxBatchSize: 500,
      // Bridge callers use `void transport.write()` — backpressure doesn't
      // apply (they don't await). A batch >maxQueueSize deadlocks (see
      
      
      
      maxQueueSize: 100_000,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      jitterMs: 1000,
      // Optional cap so a persistently-failing server can't pin the drain
      // loop for the lifetime of the process. Undefined = indefinite retry.
      // replBridge sets this; the 1P transportUtils path does not.
      maxConsecutiveFailures,
      onBatchDropped: (batchSize, failures) => {
        logForDiagnosticsNoPII(
          'error',
          'cli_hybrid_batch_dropped_max_failures',
          {
            batchSize,
            failures,
          },
        )
        onBatchDropped?.(batchSize, failures)
      },
      send: batch => this.postOnce(batch),
    })
    logForDebugging(`HybridTransport: POST URL = ${this.postUrl}`)
    logForDiagnosticsNoPII('info', 'cli_hybrid_transport_initialized')
  }

  /**
   * Enqueue a message and wait for the queue to drain. Returning flush()
   * preserves the contract that `await write()` resolves after the event is
   * POSTed (relied on by tests and replBridge's initial flush). Fire-and-forget
   * callers (`void transport.write()`) are unaffected — they don't await,
   * so the later resolution doesn't add latency.
   */
  override async write(message: StdoutMessage): Promise<void> {
    if (message.type === 'stream_event') {
      // Delay: accumulate stream_events briefly before enqueueing.
      
      this.streamEventBuffer.push(message)
      if (!this.streamEventTimer) {
        this.streamEventTimer = setTimeout(
          () => this.flushStreamEvents(),
          BATCH_FLUSH_INTERVAL_MS,
        )
      }
      return
    }
    // Immediate: flush any buffered stream_events (ordering), then this event.
    await this.uploader.enqueue([...this.takeStreamEvents(), message])
    return this.uploader.flush()
  }

  async writeBatch(messages: StdoutMessage[]): Promise<void> {
    await this.uploader.enqueue([...this.takeStreamEvents(), ...messages])
    return this.uploader.flush()
  }

  /** Snapshot before/after writeBatch() to detect silent drops. */
  get droppedBatchCount(): number {
    return this.uploader.droppedBatchCount
  }

  /**
   * Block until all pending events are POSTed. Used by bridge's initial
   * history flush so onStateChange('connected') fires after persistence.
   */
  flush(): Promise<void> {
    void this.uploader.enqueue(this.takeStreamEvents())
    return this.uploader.flush()
  }

  /** Take ownership of buffered stream_events and clear the delay timer. */
  private takeStreamEvents(): StdoutMessage[] {
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    const buffered = this.streamEventBuffer
    this.streamEventBuffer = []
    return buffered
  }

  /** Delay timer fired — enqueue accumulated stream_events. */
  private flushStreamEvents(): void {
    this.streamEventTimer = null
    void this.uploader.enqueue(this.takeStreamEvents())
  }

  override close(): void {
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    this.streamEventBuffer = []
    
    
    
    
    
    const uploader = this.uploader
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    void Promise.race([
      uploader.flush(),
      new Promise<void>(r => {
        // eslint-disable-next-line no-restricted-syntax -- need timer ref for clearTimeout
        graceTimer = setTimeout(r, CLOSE_GRACE_MS)
      }),
    ]).finally(() => {
      clearTimeout(graceTimer)
      uploader.close()
    })
    super.close()
  }

  /**
   * Single-attempt POST. Throws on retryable failures (429, 5xx, network)
   * so SerialBatchEventUploader re-queues and retries. Returns on success
   * and on permanent failures (4xx non-429, no token) so the uploader moves on.
   */
  private async postOnce(events: StdoutMessage[]): Promise<void> {
    const sessionToken = getSessionIngressAuthToken()
    if (!sessionToken) {
      logForDebugging('HybridTransport: No session token available for POST')
      logForDiagnosticsNoPII('warn', 'cli_hybrid_post_no_token')
      return
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${sessionToken}`,
      'Content-Type': 'application/json',
    }

    let response
    try {
      response = await axios.post(
        this.postUrl,
        { events },
        {
          headers,
          validateStatus: () => true,
          timeout: POST_TIMEOUT_MS,
        },
      )
    } catch (error) {
      const axiosError = error as AxiosError
      logForDebugging(`HybridTransport: POST error: ${axiosError.message}`)
      logForDiagnosticsNoPII('warn', 'cli_hybrid_post_network_error')
      throw error
    }

    if (response.status >= 200 && response.status < 300) {
      logForDebugging(`HybridTransport: POST success count=${events.length}`)
      return
    }

    // 4xx (except 429) are permanent — drop, don't retry.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429
    ) {
      logForDebugging(
        `HybridTransport: POST returned ${response.status} (permanent), dropping`,
      )
      logForDiagnosticsNoPII('warn', 'cli_hybrid_post_client_error', {
        status: response.status,
      })
      return
    }

    // 429 / 5xx — retryable. Throw so uploader re-queues and backs off.
    logForDebugging(
      `HybridTransport: POST returned ${response.status} (retryable)`,
    )
    logForDiagnosticsNoPII('warn', 'cli_hybrid_post_retryable_error', {
      status: response.status,
    })
    throw new Error(`POST failed with ${response.status}`)
  }
}

/**
 * Convert a WebSocket URL to the HTTP POST endpoint URL.
 * From: wss://api.example.com/v2/session_ingress/ws/<session_id>
 * To: https://api.example.com/v2/session_ingress/session/<session_id>/events
 */
function convertWsUrlToPostUrl(wsUrl: URL): string {
  const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:'

  // Replace /ws/ with /session/ and append /events
  let pathname = wsUrl.pathname
  pathname = pathname.replace('/ws/', '/session/')
  if (!pathname.endsWith('/events')) {
    pathname = pathname.endsWith('/')
      ? pathname + 'events'
      : pathname + '/events'
  }

  return `${protocol}//${wsUrl.host}${pathname}${wsUrl.search}`
}
