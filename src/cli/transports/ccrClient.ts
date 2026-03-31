import { randomUUID } from 'crypto'
import type {
  SDKPartialAssistantMessage,
  StdoutMessage,
} from 'src/entrypoints/sdk/controlTypes.js'
import { decodeJwtExpiry } from '../../bridge/jwtUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import { createAxiosInstance } from '../../utils/proxy.js'
import {
  registerSessionActivityCallback,
  unregisterSessionActivityCallback,
} from '../../utils/sessionActivity.js'
import {
  getSessionIngressAuthHeaders,
  getSessionIngressAuthToken,
} from '../../utils/sessionIngressAuth.js'
import type {
  RequiresActionDetails,
  SessionState,
} from '../../utils/sessionState.js'
import { sleep } from '../../utils/sleep.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import {
  RetryableError,
  SerialBatchEventUploader,
} from './SerialBatchEventUploader.js'
import type { SSETransport, StreamClientEvent } from './SSETransport.js'
import { WorkerStateUploader } from './WorkerStateUploader.js'

const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000

const STREAM_EVENT_FLUSH_INTERVAL_MS = 100

function alwaysValidStatus(): boolean {
  return true
}

export type CCRInitFailReason =
  | 'no_auth_headers'
  | 'missing_epoch'
  | 'worker_register_failed'

export class CCRInitError extends Error {
  constructor(readonly reason: CCRInitFailReason) {
    super(`CCRClient init failed: ${reason}`)
  }
}

const MAX_CONSECUTIVE_AUTH_FAILURES = 10

type EventPayload = {
  uuid: string
  type: string
  [key: string]: unknown
}

type ClientEvent = {
  payload: EventPayload
  ephemeral?: boolean
}

type CoalescedStreamEvent = {
  type: 'stream_event'
  uuid: string
  session_id: string
  parent_tool_use_id: string | null
  event: {
    type: 'content_block_delta'
    index: number
    delta: { type: 'text_delta'; text: string }
  }
}

export type StreamAccumulatorState = {
  
  byMessage: Map<string, string[][]>
  

  scopeToMessage: Map<string, string>
}

export function createStreamAccumulator(): StreamAccumulatorState {
  return { byMessage: new Map(), scopeToMessage: new Map() }
}

function scopeKey(m: {
  session_id: string
  parent_tool_use_id: string | null
}): string {
  return `${m.session_id}:${m.parent_tool_use_id ?? ''}`
}

export function accumulateStreamEvents(
  buffer: SDKPartialAssistantMessage[],
  state: StreamAccumulatorState,
): EventPayload[] {
  const out: EventPayload[] = []
  
  
  
  const touched = new Map<string[], CoalescedStreamEvent>()
  for (const msg of buffer) {
    switch (msg.event.type) {
      case 'message_start': {
        const id = msg.event.message.id
        const prevId = state.scopeToMessage.get(scopeKey(msg))
        if (prevId) state.byMessage.delete(prevId)
        state.scopeToMessage.set(scopeKey(msg), id)
        state.byMessage.set(id, [])
        out.push(msg)
        break
      }
      case 'content_block_delta': {
        if (msg.event.delta.type !== 'text_delta') {
          out.push(msg)
          break
        }
        const messageId = state.scopeToMessage.get(scopeKey(msg))
        const blocks = messageId ? state.byMessage.get(messageId) : undefined
        if (!blocks) {
          
          
          
          
          out.push(msg)
          break
        }
        const chunks = (blocks[msg.event.index] ??= [])
        chunks.push(msg.event.delta.text)
        const existing = touched.get(chunks)
        if (existing) {
          existing.event.delta.text = chunks.join('')
          break
        }
        const snapshot: CoalescedStreamEvent = {
          type: 'stream_event',
          uuid: msg.uuid,
          session_id: msg.session_id,
          parent_tool_use_id: msg.parent_tool_use_id,
          event: {
            type: 'content_block_delta',
            index: msg.event.index,
            delta: { type: 'text_delta', text: chunks.join('') },
          },
        }
        touched.set(chunks, snapshot)
        out.push(snapshot)
        break
      }
      default:
        out.push(msg)
    }
  }
  return out
}

export function clearStreamAccumulatorForMessage(
  state: StreamAccumulatorState,
  assistant: {
    session_id: string
    parent_tool_use_id: string | null
    message: { id: string }
  },
): void {
  state.byMessage.delete(assistant.message.id)
  const scope = scopeKey(assistant)
  if (state.scopeToMessage.get(scope) === assistant.message.id) {
    state.scopeToMessage.delete(scope)
  }
}

type RequestResult = { ok: true } | { ok: false; retryAfterMs?: number }

type WorkerEvent = {
  payload: EventPayload
  is_compaction?: boolean
  agent_id?: string
}

export type InternalEvent = {
  event_id: string
  event_type: string
  payload: Record<string, unknown>
  event_metadata?: Record<string, unknown> | null
  is_compaction: boolean
  created_at: string
  agent_id?: string
}

type ListInternalEventsResponse = {
  data: InternalEvent[]
  next_cursor?: string
}

type WorkerStateResponse = {
  worker?: {
    external_metadata?: Record<string, unknown>
  }
}

export class CCRClient {
  private workerEpoch = 0
  private readonly heartbeatIntervalMs: number
  private readonly heartbeatJitterFraction: number
  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatInFlight = false
  private closed = false
  private consecutiveAuthFailures = 0
  private currentState: SessionState | null = null
  private readonly sessionBaseUrl: string
  private readonly sessionId: string
  private readonly http = createAxiosInstance({ keepAlive: true })

  
  
  
  private streamEventBuffer: SDKPartialAssistantMessage[] = []
  private streamEventTimer: ReturnType<typeof setTimeout> | null = null
  
  
  
  
  private streamTextAccumulator = createStreamAccumulator()

  private readonly workerState: WorkerStateUploader
  private readonly eventUploader: SerialBatchEventUploader<ClientEvent>
  private readonly internalEventUploader: SerialBatchEventUploader<WorkerEvent>
  private readonly deliveryUploader: SerialBatchEventUploader<{
    eventId: string
    status: 'received' | 'processing' | 'processed'
  }>

  

  private readonly onEpochMismatch: () => never

  

  private readonly getAuthHeaders: () => Record<string, string>

  constructor(
    transport: SSETransport,
    sessionUrl: URL,
    opts?: {
      onEpochMismatch?: () => never
      heartbeatIntervalMs?: number
      heartbeatJitterFraction?: number
      

      getAuthHeaders?: () => Record<string, string>
    },
  ) {
    this.onEpochMismatch =
      opts?.onEpochMismatch ??
      (() => {
        
        process.exit(1)
      })
    this.heartbeatIntervalMs =
      opts?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.heartbeatJitterFraction = opts?.heartbeatJitterFraction ?? 0
    this.getAuthHeaders = opts?.getAuthHeaders ?? getSessionIngressAuthHeaders
    
    if (sessionUrl.protocol !== 'http:' && sessionUrl.protocol !== 'https:') {
      throw new Error(
        `CCRClient: Expected http(s) URL, got ${sessionUrl.protocol}`,
      )
    }
    const pathname = sessionUrl.pathname.replace(/\/$/, '')
    this.sessionBaseUrl = `${sessionUrl.protocol}//${sessionUrl.host}${pathname}`
    
    this.sessionId = pathname.split('/').pop() || ''

    this.workerState = new WorkerStateUploader({
      send: body =>
        this.request(
          'put',
          '/worker',
          { worker_epoch: this.workerEpoch, ...body },
          'PUT worker',
        ).then(r => r.ok),
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.eventUploader = new SerialBatchEventUploader<ClientEvent>({
      maxBatchSize: 100,
      maxBatchBytes: 10 * 1024 * 1024,
      
      
      
      
      
      maxQueueSize: 100_000,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/events',
          { worker_epoch: this.workerEpoch, events: batch },
          'client events',
        )
        if (!result.ok) {
          throw new RetryableError(
            'client event POST failed',
            result.retryAfterMs,
          )
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.internalEventUploader = new SerialBatchEventUploader<WorkerEvent>({
      maxBatchSize: 100,
      maxBatchBytes: 10 * 1024 * 1024,
      maxQueueSize: 200,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/internal-events',
          { worker_epoch: this.workerEpoch, events: batch },
          'internal events',
        )
        if (!result.ok) {
          throw new RetryableError(
            'internal event POST failed',
            result.retryAfterMs,
          )
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    this.deliveryUploader = new SerialBatchEventUploader<{
      eventId: string
      status: 'received' | 'processing' | 'processed'
    }>({
      maxBatchSize: 64,
      maxQueueSize: 64,
      send: async batch => {
        const result = await this.request(
          'post',
          '/worker/events/delivery',
          {
            worker_epoch: this.workerEpoch,
            updates: batch.map(d => ({
              event_id: d.eventId,
              status: d.status,
            })),
          },
          'delivery batch',
        )
        if (!result.ok) {
          throw new RetryableError('delivery POST failed', result.retryAfterMs)
        }
      },
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitterMs: 500,
    })

    
    
    
    
    
    transport.setOnEvent((event: StreamClientEvent) => {
      this.reportDelivery(event.event_id, 'received')
    })
  }

  

  async initialize(epoch?: number): Promise<Record<string, unknown> | null> {
    const startMs = Date.now()
    if (Object.keys(this.getAuthHeaders()).length === 0) {
      throw new CCRInitError('no_auth_headers')
    }
    if (epoch === undefined) {
      const rawEpoch = process.env.CLAUDE_CODE_NEXT_WORKER_EPOCH
      epoch = rawEpoch ? parseInt(rawEpoch, 10) : NaN
    }
    if (isNaN(epoch)) {
      throw new CCRInitError('missing_epoch')
    }
    this.workerEpoch = epoch

    
    const restoredPromise = this.getWorkerState()

    const result = await this.request(
      'put',
      '/worker',
      {
        worker_status: 'idle',
        worker_epoch: this.workerEpoch,
        
        
        external_metadata: {
          pending_action: null,
          task_summary: null,
        },
      },
      'PUT worker (init)',
    )
    if (!result.ok) {
      
      
      
      
      throw new CCRInitError('worker_register_failed')
    }
    this.currentState = 'idle'
    this.startHeartbeat()

    
    
    
    registerSessionActivityCallback(() => {
      void this.writeEvent({ type: 'keep_alive' })
    })

    logForDebugging(`CCRClient: initialized, epoch=${this.workerEpoch}`)
    logForDiagnosticsNoPII('info', 'cli_worker_lifecycle_initialized', {
      epoch: this.workerEpoch,
      duration_ms: Date.now() - startMs,
    })

    
    
    
    
    const { metadata, durationMs } = await restoredPromise
    if (!this.closed) {
      logForDiagnosticsNoPII('info', 'cli_worker_state_restored', {
        duration_ms: durationMs,
        had_state: metadata !== null,
      })
    }
    return metadata
  }

  
  
  private async getWorkerState(): Promise<{
    metadata: Record<string, unknown> | null
    durationMs: number
  }> {
    const startMs = Date.now()
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) {
      return { metadata: null, durationMs: 0 }
    }
    const data = await this.getWithRetry<WorkerStateResponse>(
      `${this.sessionBaseUrl}/worker`,
      authHeaders,
      'worker_state',
    )
    return {
      metadata: data?.worker?.external_metadata ?? null,
      durationMs: Date.now() - startMs,
    }
  }

  

  private async request(
    method: 'post' | 'put',
    path: string,
    body: unknown,
    label: string,
    { timeout = 10_000 }: { timeout?: number } = {},
  ): Promise<RequestResult> {
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) return { ok: false }

    try {
      const response = await this.http[method](
        `${this.sessionBaseUrl}${path}`,
        body,
        {
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'User-Agent': getClaudeCodeUserAgent(),
          },
          validateStatus: alwaysValidStatus,
          timeout,
        },
      )

      if (response.status >= 200 && response.status < 300) {
        this.consecutiveAuthFailures = 0
        return { ok: true }
      }
      if (response.status === 409) {
        this.handleEpochMismatch()
      }
      if (response.status === 401 || response.status === 403) {
        
        
        
        const tok = getSessionIngressAuthToken()
        const exp = tok ? decodeJwtExpiry(tok) : null
        if (exp !== null && exp * 1000 < Date.now()) {
          logForDebugging(
            `CCRClient: session_token expired (exp=${new Date(exp * 1000).toISOString()}) — no refresh was delivered, exiting`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_worker_token_expired_no_refresh')
          this.onEpochMismatch()
        }
        
        
        this.consecutiveAuthFailures++
        if (this.consecutiveAuthFailures >= MAX_CONSECUTIVE_AUTH_FAILURES) {
          logForDebugging(
            `CCRClient: ${this.consecutiveAuthFailures} consecutive auth failures with a valid-looking token — server-side auth unrecoverable, exiting`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_worker_auth_failures_exhausted')
          this.onEpochMismatch()
        }
      }
      logForDebugging(`CCRClient: ${label} returned ${response.status}`, {
        level: 'warn',
      })
      logForDiagnosticsNoPII('warn', 'cli_worker_request_failed', {
        method,
        path,
        status: response.status,
      })
      if (response.status === 429) {
        const raw = response.headers?.['retry-after']
        const seconds = typeof raw === 'string' ? parseInt(raw, 10) : NaN
        if (!isNaN(seconds) && seconds >= 0) {
          return { ok: false, retryAfterMs: seconds * 1000 }
        }
      }
      return { ok: false }
    } catch (error) {
      logForDebugging(`CCRClient: ${label} failed: ${errorMessage(error)}`, {
        level: 'warn',
      })
      logForDiagnosticsNoPII('warn', 'cli_worker_request_error', {
        method,
        path,
        error_code: getErrnoCode(error),
      })
      return { ok: false }
    }
  }

  
  reportState(state: SessionState, details?: RequiresActionDetails): void {
    if (state === this.currentState && !details) return
    this.currentState = state
    this.workerState.enqueue({
      worker_status: state,
      requires_action_details: details
        ? {
            tool_name: details.tool_name,
            action_description: details.action_description,
            request_id: details.request_id,
          }
        : null,
    })
  }

  
  reportMetadata(metadata: Record<string, unknown>): void {
    this.workerState.enqueue({ external_metadata: metadata })
  }

  

  private handleEpochMismatch(): never {
    logForDebugging('CCRClient: Epoch mismatch (409), shutting down', {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_worker_epoch_mismatch')
    this.onEpochMismatch()
  }

  
  private startHeartbeat(): void {
    this.stopHeartbeat()
    const schedule = (): void => {
      const jitter =
        this.heartbeatIntervalMs *
        this.heartbeatJitterFraction *
        (2 * Math.random() - 1)
      this.heartbeatTimer = setTimeout(tick, this.heartbeatIntervalMs + jitter)
    }
    const tick = (): void => {
      void this.sendHeartbeat()
      
      
      if (this.heartbeatTimer === null) return
      schedule()
    }
    schedule()
  }

  
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  
  private async sendHeartbeat(): Promise<void> {
    if (this.heartbeatInFlight) return
    this.heartbeatInFlight = true
    try {
      const result = await this.request(
        'post',
        '/worker/heartbeat',
        { session_id: this.sessionId, worker_epoch: this.workerEpoch },
        'Heartbeat',
        { timeout: 5_000 },
      )
      if (result.ok) {
        logForDebugging('CCRClient: Heartbeat sent')
      }
    } finally {
      this.heartbeatInFlight = false
    }
  }

  

  async writeEvent(message: StdoutMessage): Promise<void> {
    if (message.type === 'stream_event') {
      this.streamEventBuffer.push(message)
      if (!this.streamEventTimer) {
        this.streamEventTimer = setTimeout(
          () => void this.flushStreamEventBuffer(),
          STREAM_EVENT_FLUSH_INTERVAL_MS,
        )
      }
      return
    }
    await this.flushStreamEventBuffer()
    if (message.type === 'assistant') {
      clearStreamAccumulatorForMessage(this.streamTextAccumulator, message)
    }
    await this.eventUploader.enqueue(this.toClientEvent(message))
  }

  
  private toClientEvent(message: StdoutMessage): ClientEvent {
    const msg = message as unknown as Record<string, unknown>
    return {
      payload: {
        ...msg,
        uuid: typeof msg.uuid === 'string' ? msg.uuid : randomUUID(),
      } as EventPayload,
    }
  }

  

  private async flushStreamEventBuffer(): Promise<void> {
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    if (this.streamEventBuffer.length === 0) return
    const buffered = this.streamEventBuffer
    this.streamEventBuffer = []
    const payloads = accumulateStreamEvents(
      buffered,
      this.streamTextAccumulator,
    )
    await this.eventUploader.enqueue(
      payloads.map(payload => ({ payload, ephemeral: true })),
    )
  }

  

  async writeInternalEvent(
    eventType: string,
    payload: Record<string, unknown>,
    {
      isCompaction = false,
      agentId,
    }: {
      isCompaction?: boolean
      agentId?: string
    } = {},
  ): Promise<void> {
    const event: WorkerEvent = {
      payload: {
        type: eventType,
        ...payload,
        uuid: typeof payload.uuid === 'string' ? payload.uuid : randomUUID(),
      } as EventPayload,
      ...(isCompaction && { is_compaction: true }),
      ...(agentId && { agent_id: agentId }),
    }
    await this.internalEventUploader.enqueue(event)
  }

  

  flushInternalEvents(): Promise<void> {
    return this.internalEventUploader.flush()
  }

  

  async flush(): Promise<void> {
    await this.flushStreamEventBuffer()
    return this.eventUploader.flush()
  }

  

  async readInternalEvents(): Promise<InternalEvent[] | null> {
    return this.paginatedGet('/worker/internal-events', {}, 'internal_events')
  }

  

  async readSubagentInternalEvents(): Promise<InternalEvent[] | null> {
    return this.paginatedGet(
      '/worker/internal-events',
      { subagents: 'true' },
      'subagent_events',
    )
  }

  

  private async paginatedGet(
    path: string,
    params: Record<string, string>,
    context: string,
  ): Promise<InternalEvent[] | null> {
    const authHeaders = this.getAuthHeaders()
    if (Object.keys(authHeaders).length === 0) return null

    const allEvents: InternalEvent[] = []
    let cursor: string | undefined

    do {
      const url = new URL(`${this.sessionBaseUrl}${path}`)
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v)
      }
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }

      const page = await this.getWithRetry<ListInternalEventsResponse>(
        url.toString(),
        authHeaders,
        context,
      )
      if (!page) return null

      allEvents.push(...(page.data ?? []))
      cursor = page.next_cursor
    } while (cursor)

    logForDebugging(
      `CCRClient: Read ${allEvents.length} internal events from ${path}${params.subagents ? ' (subagents)' : ''}`,
    )
    return allEvents
  }

  

  private async getWithRetry<T>(
    url: string,
    authHeaders: Record<string, string>,
    context: string,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= 10; attempt++) {
      let response
      try {
        response = await this.http.get<T>(url, {
          headers: {
            ...authHeaders,
            'anthropic-version': '2023-06-01',
            'User-Agent': getClaudeCodeUserAgent(),
          },
          validateStatus: alwaysValidStatus,
          timeout: 30_000,
        })
      } catch (error) {
        logForDebugging(
          `CCRClient: GET ${url} failed (attempt ${attempt}/10): ${errorMessage(error)}`,
          { level: 'warn' },
        )
        if (attempt < 10) {
          const delay =
            Math.min(500 * 2 ** (attempt - 1), 30_000) + Math.random() * 500
          await sleep(delay)
        }
        continue
      }

      if (response.status >= 200 && response.status < 300) {
        return response.data
      }
      if (response.status === 409) {
        this.handleEpochMismatch()
      }
      logForDebugging(
        `CCRClient: GET ${url} returned ${response.status} (attempt ${attempt}/10)`,
        { level: 'warn' },
      )

      if (attempt < 10) {
        const delay =
          Math.min(500 * 2 ** (attempt - 1), 30_000) + Math.random() * 500
        await sleep(delay)
      }
    }

    logForDebugging('CCRClient: GET retries exhausted', { level: 'error' })
    logForDiagnosticsNoPII('error', 'cli_worker_get_retries_exhausted', {
      context,
    })
    return null
  }

  

  reportDelivery(
    eventId: string,
    status: 'received' | 'processing' | 'processed',
  ): void {
    void this.deliveryUploader.enqueue({ eventId, status })
  }

  
  getWorkerEpoch(): number {
    return this.workerEpoch
  }

  
  get internalEventsPending(): number {
    return this.internalEventUploader.pendingCount
  }

  
  close(): void {
    this.closed = true
    this.stopHeartbeat()
    unregisterSessionActivityCallback()
    if (this.streamEventTimer) {
      clearTimeout(this.streamEventTimer)
      this.streamEventTimer = null
    }
    this.streamEventBuffer = []
    this.streamTextAccumulator.byMessage.clear()
    this.streamTextAccumulator.scopeToMessage.clear()
    this.workerState.close()
    this.eventUploader.close()
    this.internalEventUploader.close()
    this.deliveryUploader.close()
  }
}
