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
  

  getLastSequenceNum(): number
  

  readonly droppedBatchCount: number
  

  reportState(state: SessionState): void
  
  reportMetadata(metadata: Record<string, unknown>): void
  

  reportDelivery(eventId: string, status: 'processing' | 'processed'): void
  

  flush(): Promise<void>
}

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
      
      
      
      throw new Error('epoch superseded')
    },
  })

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  sse.setOnEvent(event => {
    ccr.reportDelivery(event.event_id, 'received')
    ccr.reportDelivery(event.event_id, 'processed')
  })

  
  
  
  
  
  
  
  
  
  
  
  
  let onConnectCb: (() => void) | undefined
  let ccrInitialized = false
  let closed = false

  return {
    write(msg) {
      return ccr.writeEvent(msg)
    },
    async writeBatch(msgs) {
      
      
      
      
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
      
      
      return ccrInitialized
    },
    getStateLabel() {
      
      
      if (sse.isClosedStatus()) return 'closed'
      if (sse.isConnectedStatus()) return ccrInitialized ? 'connected' : 'init'
      return 'connecting'
    },
    setOnData(cb) {
      sse.setOnData(cb)
    },
    setOnClose(cb) {
      onCloseCb = cb
      
      
      
      
      
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
      
      
      
      if (!opts.outboundOnly) {
        
        
        
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
          
          
          
          
          ccr.close()
          sse.close()
          onCloseCb?.(4091) 
        },
      )
    },
  }
}
