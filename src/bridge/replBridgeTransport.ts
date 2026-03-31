import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { CCRClient } from '../cli/transports/ccrClient.js'
import type { HybridTransport } from '../cli/transports/HybridTransport.js'
import { SSETransport } from '../cli/transports/SSETransport.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { updateSessionIngressAuthToken } from '../utils/sessionIngressAuth.js'
import type { SessionState } from '../utils/sessionState.js'
import { registerWorker } from './workSecret.js'

export type ReplBridgeTransport = {
  write(message: StdoutMessage): Promise<void>
  writeBatch(messages: StdoutMessage[]): Promise<void>
  close(): void
  isConnectedStatus(): boolean
  getStateLabel(): string
  setOnData(callback: (data: string) => void): void
  setOnClose(callback: (closeCode?: number) => void): void
  setOnConnect(callback: () => void): void
  connect(): void
  /**
   * High-water mark of the underlying read stream's event sequence numbers.
   * replBridge reads this before swapping transports so the new one can
   * resume from where the old one left off (otherwise the server replays
   * the entire session history from seq 0).
   *
   * v1 returns 0 — Session-Ingress WS doesn't use SSE sequence numbers;
   * replay-on-reconnect is handled by the server-side message cursor.
   */
  getLastSequenceNum(): number
  

  readonly droppedBatchCount: number
  

  reportState(state: SessionState): void
  /** PUT /worker external_metadata (v2 only; v1 is a no-op). */
  reportMetadata(metadata: Record<string, unknown>): void
  /**
   * POST /worker/events/{id}/delivery (v2 only; v1 is a no-op). Populates
   * CCR's processing_at/processed_at columns. `received` is auto-fired by
   * CCRClient on every SSE frame and is not exposed here.
   */
  reportDelivery(eventId: string, status: 'processing' | 'processed'): void
  /**
   * Drain the write queue before close() (v2 only; v1 resolves
   * immediately — HybridTransport POSTs are already awaited per-write).
   */
  flush(): Promise<void>
}

/**
 * v1 adapter: HybridTransport already has the full surface (it extends
 * WebSocketTransport which has setOnConnect + getStateLabel). This is a
 * no-op wrapper that exists only so replBridge's `transport` variable
 * has a single type.
 */
export function createV1ReplTransport(
  hybrid: HybridTransport,
): ReplBridgeTransport {
  return {
    write: msg => hybrid.write(msg),
    writeBatch: msgs => hybrid.writeBatch(msgs),
    close: () => hybrid.close(),
    isConnectedStatus: () => hybrid.isConnectedStatus(),
    getStateLabel: () => hybrid.getStateLabel(),
    setOnData: cb => hybrid.setOnData(cb),
    setOnClose: cb => hybrid.setOnClose(cb),
    setOnConnect: cb => hybrid.setOnConnect(cb),
    connect: () => void hybrid.connect(),
    // v1 Session-Ingress WS doesn't use SSE sequence numbers; replay
    // semantics are different. Always return 0 so the seq-num carryover
    // logic in replBridge is a no-op for v1.
    getLastSequenceNum: () => 0,
    get droppedBatchCount() {
      return hybrid.droppedBatchCount
    },
    reportState: () => {},
    reportMetadata: () => {},
    reportDelivery: () => {},
    flush: () => Promise.resolve(),
  }
}

/**
 * v2 adapter: wrap SSETransport (reads) + CCRClient (writes, heartbeat,
 * state, delivery tracking).
 *
 * Auth: v2 endpoints validate the JWT's session_id claim (register_worker.go:32)
 * and worker role (environment_auth.py:856). OAuth tokens have neither.
 * This is the inverse of the v1 replBridge path, which deliberately uses OAuth.
 * The JWT is refreshed when the poll loop re-dispatches work — the caller
 * invokes createV2ReplTransport again with the fresh token.
 *
 * Registration happens here (not in the caller) so the entire v2 handshake
 * is one async step. registerWorker failure propagates — replBridge will
 * catch it and stay on the poll loop.
 */
export async function createV2ReplTransport(opts: {
  sessionUrl: string
  ingressToken: string
  sessionId: string
  

  initialSequenceNum?: number
  

  epoch?: number
  
  heartbeatIntervalMs?: number
  
  heartbeatJitterFraction?: number
  

  outboundOnly?: boolean
  

  getAuthToken?: () => string | undefined
}): Promise<ReplBridgeTransport> {
  const {
    sessionUrl,
    ingressToken,
    sessionId,
    initialSequenceNum,
    getAuthToken,
  } = opts

  
  
  
  
  let getAuthHeaders: (() => Record<string, string>) | undefined
  if (getAuthToken) {
    getAuthHeaders = (): Record<string, string> => {
      const token = getAuthToken()
      if (!token) return {}
      return { Authorization: `Bearer ${token}` }
    }
  } else {
    // CCRClient.request() and SSETransport.connect() both read auth via
    
    
    updateSessionIngressAuthToken(ingressToken)
  }

  const epoch = opts.epoch ?? (await registerWorker(sessionUrl, ingressToken))
  logForDebugging(
    `[bridge:repl] CCR v2: worker sessionId=${sessionId} epoch=${epoch}${opts.epoch !== undefined ? ' (from /bridge)' : ' (via registerWorker)'}`,
  )

  
  
  const sseUrl = new URL(sessionUrl)
  sseUrl.pathname = sseUrl.pathname.replace(/\/$/, '') + '/worker/events/stream'

  const sse = new SSETransport(
    sseUrl,
    {},
    sessionId,
    undefined,
    initialSequenceNum,
    getAuthHeaders,
  )
  let onCloseCb: ((closeCode?: number) => void) | undefined
  const ccr = new CCRClient(sse, new URL(sessionUrl), {
    getAuthHeaders,
    heartbeatIntervalMs: opts.heartbeatIntervalMs,
    heartbeatJitterFraction: opts.heartbeatJitterFraction,
    // Default is process.exit(1) — correct for spawn-mode children. In-process,
    // that kills the REPL. Close instead: replBridge's onClose wakes the poll
    // loop, which picks up the server's re-dispatch (with fresh epoch).
    onEpochMismatch: () => {
      logForDebugging(
        '[bridge:repl] CCR v2: epoch superseded (409) — closing for poll-loop recovery',
      )
      
      
      
      
      try {
        ccr.close()
        sse.close()
        onCloseCb?.(4090)
      } catch (closeErr: unknown) {
        logForDebugging(
          `[bridge:repl] CCR v2: error during epoch-mismatch cleanup: ${errorMessage(closeErr)}`,
          { level: 'error' },
        )
      }
      // Don't return — the calling request() code continues after the 409
      // branch, so callers see the logged warning and a false return. We
      // throw to unwind; the uploaders catch it as a send failure.
      throw new Error('epoch superseded')
    },
  })

  // CCRClient's constructor wired sse.setOnEvent → reportDelivery('received').
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  sse.setOnEvent(event => {
    ccr.reportDelivery(event.event_id, 'received')
    ccr.reportDelivery(event.event_id, 'processed')
  })

  
  
  
  // sse.connect() opens the stream (events flow to onData/onClose immediately),
  // and ccr.initialize().then() fires onConnectCb.
  
  
  
  
  
  
  
  let onConnectCb: (() => void) | undefined
  let ccrInitialized = false
  let closed = false

  return {
    write(msg) {
      return ccr.writeEvent(msg)
    },
    async writeBatch(msgs) {
      // SerialBatchEventUploader already batches internally (maxBatchSize=100);
      // sequential enqueue preserves order and the uploader coalesces.
      
      
      for (const m of msgs) {
        if (closed) break
        await ccr.writeEvent(m)
      }
    },
    close() {
      closed = true
      ccr.close()
      sse.close()
    },
    isConnectedStatus() {
      // Write-readiness, not read-readiness — replBridge checks this
      
      return ccrInitialized
    },
    getStateLabel() {
      // SSETransport doesn't expose its state string; synthesize from
      // what we can observe. replBridge only uses this for debug logging.
      if (sse.isClosedStatus()) return 'closed'
      if (sse.isConnectedStatus()) return ccrInitialized ? 'connected' : 'init'
      return 'connecting'
    },
    setOnData(cb) {
      sse.setOnData(cb)
    },
    setOnClose(cb) {
      onCloseCb = cb
      // SSE reconnect-budget exhaustion fires onClose(undefined) — map to
      // 4092 so ws_closed telemetry can distinguish it from HTTP-status
      // closes (SSETransport:280 passes response.status). Stop CCRClient's
      
      
      sse.setOnClose(code => {
        ccr.close()
        cb(code ?? 4092)
      })
    },
    setOnConnect(cb) {
      onConnectCb = cb
    },
    getLastSequenceNum() {
      return sse.getLastSequenceNum()
    },
    // v2 write path (CCRClient) doesn't set maxConsecutiveFailures — no drops.
    droppedBatchCount: 0,
    reportState(state) {
      ccr.reportState(state)
    },
    reportMetadata(metadata) {
      ccr.reportMetadata(metadata)
    },
    reportDelivery(eventId, status) {
      ccr.reportDelivery(eventId, status)
    },
    flush() {
      return ccr.flush()
    },
    connect() {
      // Outbound-only: skip the SSE read stream entirely — no inbound
      // events to receive, no delivery ACKs to send. Only the CCRClient
      // write path (POST /worker/events) and heartbeat are needed.
      if (!opts.outboundOnly) {
        // Fire-and-forget — SSETransport.connect() awaits readStream()
        // (the read loop) and only resolves on stream close/error. The
        // spawn-mode path in remoteIO.ts does the same void discard.
        void sse.connect()
      }
      void ccr.initialize(epoch).then(
        () => {
          ccrInitialized = true
          logForDebugging(
            `[bridge:repl] v2 transport ready for writes (epoch=${epoch}, sse=${sse.isConnectedStatus() ? 'open' : 'opening'})`,
          )
          onConnectCb?.()
        },
        (err: unknown) => {
          logForDebugging(
            `[bridge:repl] CCR v2 initialize failed: ${errorMessage(err)}`,
            { level: 'error' },
          )
          // Close transport resources and notify replBridge via onClose
          // so the poll loop can retry on the next work dispatch.
          // Without this callback, replBridge never learns the transport
          // failed to initialize and sits with transport === null forever.
          ccr.close()
          sse.close()
          onCloseCb?.(4091) // 4091 = init failure, distinguishable from 4090 epoch mismatch
        },
      )
    },
  }
}
