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
      
      
      maxBatchSize: 500,
      
      
      
      
      
      maxQueueSize: 100_000,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      jitterMs: 1000,
      
      
      
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

  

  override async write(message: StdoutMessage): Promise<void> {
    if (message.type === 'stream_event') {
      
      
      this.streamEventBuffer.push(message)
      if (!this.streamEventTimer) {
        this.streamEventTimer = setTimeout(
          () => this.flushStreamEvents(),
          BATCH_FLUSH_INTERVAL_MS,
        )
      }
      return
    }
    
    await this.uploader.enqueue([...this.takeStreamEvents(), message])
    return this.uploader.flush()
  }

  async writeBatch(messages: StdoutMessage[]): Promise<void> {
    await this.uploader.enqueue([...this.takeStreamEvents(), ...messages])
    return this.uploader.flush()
  }

  
  get droppedBatchCount(): number {
    return this.uploader.droppedBatchCount
  }

  

  flush(): Promise<void> {
    void this.uploader.enqueue(this.takeStreamEvents())
    return this.uploader.flush()
  }

  
  private takeStreamEvents(): StdoutMessage[] {
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    const buffered = this.streamEventBuffer
    this.streamEventBuffer = []
    return buffered
  }

  
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
        
        graceTimer = setTimeout(r, CLOSE_GRACE_MS)
      }),
    ]).finally(() => {
      clearTimeout(graceTimer)
      uploader.close()
    })
    super.close()
  }

  

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

    
    logForDebugging(
      `HybridTransport: POST returned ${response.status} (retryable)`,
    )
    logForDiagnosticsNoPII('warn', 'cli_hybrid_post_retryable_error', {
      status: response.status,
    })
    throw new Error(`POST failed with ${response.status}`)
  }
}

function convertWsUrlToPostUrl(wsUrl: URL): string {
  const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:'

  
  let pathname = wsUrl.pathname
  pathname = pathname.replace('/ws/', '/session/')
  if (!pathname.endsWith('/events')) {
    pathname = pathname.endsWith('/')
      ? pathname + 'events'
      : pathname + '/events'
  }

  return `${protocol}//${wsUrl.host}${pathname}${wsUrl.search}`
}
