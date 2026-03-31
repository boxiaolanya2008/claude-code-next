import { randomUUID } from 'crypto'
import { getOauthConfig } from '../constants/oauth.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlCancelRequest,
  SDKControlRequest,
  SDKControlRequestInner,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { logError } from '../utils/log.js'
import { getWebSocketTLSOptions } from '../utils/mtls.js'
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from '../utils/proxy.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5
const PING_INTERVAL_MS = 30000

const MAX_SESSION_NOT_FOUND_RETRIES = 3

const PERMANENT_CLOSE_CODES = new Set([
  4003, 
])

type WebSocketState = 'connecting' | 'connected' | 'closed'

type SessionsMessage =
  | SDKMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKControlCancelRequest

function isSessionsMessage(value: unknown): value is SessionsMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }
  
  
  
  
  return typeof value.type === 'string'
}

export type SessionsWebSocketCallbacks = {
  onMessage: (message: SessionsMessage) => void
  onClose?: () => void
  onError?: (error: Error) => void
  onConnected?: () => void
  

  onReconnecting?: () => void
}

type WebSocketLike = {
  close(): void
  send(data: string): void
  ping?(): void 
}

export class SessionsWebSocket {
  private ws: WebSocketLike | null = null
  private state: WebSocketState = 'closed'
  private reconnectAttempts = 0
  private sessionNotFoundRetries = 0
  private pingInterval: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly sessionId: string,
    private readonly orgUuid: string,
    private readonly getAccessToken: () => string,
    private readonly callbacks: SessionsWebSocketCallbacks,
  ) {}

  

  async connect(): Promise<void> {
    if (this.state === 'connecting') {
      logForDebugging('[SessionsWebSocket] Already connecting')
      return
    }

    this.state = 'connecting'

    const baseUrl = getOauthConfig().BASE_API_URL.replace('https://', 'wss://')
    const url = `${baseUrl}/v1/sessions/ws/${this.sessionId}/subscribe?organization_uuid=${this.orgUuid}`

    logForDebugging(`[SessionsWebSocket] Connecting to ${url}`)

    
    const accessToken = this.getAccessToken()
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
    }

    if (typeof Bun !== 'undefined') {
      
      
      const ws = new globalThis.WebSocket(url, {
        headers,
        proxy: getWebSocketProxyUrl(url),
        tls: getWebSocketTLSOptions() || undefined,
      } as unknown as string[])
      this.ws = ws

      ws.addEventListener('open', () => {
        logForDebugging(
          '[SessionsWebSocket] Connection opened, authenticated via headers',
        )
        this.state = 'connected'
        this.reconnectAttempts = 0
        this.sessionNotFoundRetries = 0
        this.startPingInterval()
        this.callbacks.onConnected?.()
      })

      ws.addEventListener('message', (event: MessageEvent) => {
        const data =
          typeof event.data === 'string' ? event.data : String(event.data)
        this.handleMessage(data)
      })

      ws.addEventListener('error', () => {
        const err = new Error('[SessionsWebSocket] WebSocket error')
        logError(err)
        this.callbacks.onError?.(err)
      })

      
      ws.addEventListener('close', (event: CloseEvent) => {
        logForDebugging(
          `[SessionsWebSocket] Closed: code=${event.code} reason=${event.reason}`,
        )
        this.handleClose(event.code)
      })

      ws.addEventListener('pong', () => {
        logForDebugging('[SessionsWebSocket] Pong received')
      })
    } else {
      const { default: WS } = await import('ws')
      const ws = new WS(url, {
        headers,
        agent: getWebSocketProxyAgent(url),
        ...getWebSocketTLSOptions(),
      })
      this.ws = ws

      ws.on('open', () => {
        logForDebugging(
          '[SessionsWebSocket] Connection opened, authenticated via headers',
        )
        
        this.state = 'connected'
        this.reconnectAttempts = 0
        this.sessionNotFoundRetries = 0
        this.startPingInterval()
        this.callbacks.onConnected?.()
      })

      ws.on('message', (data: Buffer) => {
        this.handleMessage(data.toString())
      })

      ws.on('error', (err: Error) => {
        logError(new Error(`[SessionsWebSocket] Error: ${err.message}`))
        this.callbacks.onError?.(err)
      })

      ws.on('close', (code: number, reason: Buffer) => {
        logForDebugging(
          `[SessionsWebSocket] Closed: code=${code} reason=${reason.toString()}`,
        )
        this.handleClose(code)
      })

      ws.on('pong', () => {
        logForDebugging('[SessionsWebSocket] Pong received')
      })
    }
  }

  

  private handleMessage(data: string): void {
    try {
      const message: unknown = jsonParse(data)

      
      if (isSessionsMessage(message)) {
        this.callbacks.onMessage(message)
      } else {
        logForDebugging(
          `[SessionsWebSocket] Ignoring message type: ${typeof message === 'object' && message !== null && 'type' in message ? String(message.type) : 'unknown'}`,
        )
      }
    } catch (error) {
      logError(
        new Error(
          `[SessionsWebSocket] Failed to parse message: ${errorMessage(error)}`,
        ),
      )
    }
  }

  

  private handleClose(closeCode: number): void {
    this.stopPingInterval()

    if (this.state === 'closed') {
      return
    }

    this.ws = null

    const previousState = this.state
    this.state = 'closed'

    
    if (PERMANENT_CLOSE_CODES.has(closeCode)) {
      logForDebugging(
        `[SessionsWebSocket] Permanent close code ${closeCode}, not reconnecting`,
      )
      this.callbacks.onClose?.()
      return
    }

    
    
    
    if (closeCode === 4001) {
      this.sessionNotFoundRetries++
      if (this.sessionNotFoundRetries > MAX_SESSION_NOT_FOUND_RETRIES) {
        logForDebugging(
          `[SessionsWebSocket] 4001 retry budget exhausted (${MAX_SESSION_NOT_FOUND_RETRIES}), not reconnecting`,
        )
        this.callbacks.onClose?.()
        return
      }
      this.scheduleReconnect(
        RECONNECT_DELAY_MS * this.sessionNotFoundRetries,
        `4001 attempt ${this.sessionNotFoundRetries}/${MAX_SESSION_NOT_FOUND_RETRIES}`,
      )
      return
    }

    
    if (
      previousState === 'connected' &&
      this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS
    ) {
      this.reconnectAttempts++
      this.scheduleReconnect(
        RECONNECT_DELAY_MS,
        `attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`,
      )
    } else {
      logForDebugging('[SessionsWebSocket] Not reconnecting')
      this.callbacks.onClose?.()
    }
  }

  private scheduleReconnect(delay: number, label: string): void {
    this.callbacks.onReconnecting?.()
    logForDebugging(
      `[SessionsWebSocket] Scheduling reconnect (${label}) in ${delay}ms`,
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private startPingInterval(): void {
    this.stopPingInterval()

    this.pingInterval = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        try {
          this.ws.ping?.()
        } catch {
          
        }
      }
    }, PING_INTERVAL_MS)
  }

  

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  

  sendControlResponse(response: SDKControlResponse): void {
    if (!this.ws || this.state !== 'connected') {
      logError(new Error('[SessionsWebSocket] Cannot send: not connected'))
      return
    }

    logForDebugging('[SessionsWebSocket] Sending control response')
    this.ws.send(jsonStringify(response))
  }

  

  sendControlRequest(request: SDKControlRequestInner): void {
    if (!this.ws || this.state !== 'connected') {
      logError(new Error('[SessionsWebSocket] Cannot send: not connected'))
      return
    }

    const controlRequest: SDKControlRequest = {
      type: 'control_request',
      request_id: randomUUID(),
      request,
    }

    logForDebugging(
      `[SessionsWebSocket] Sending control request: ${request.subtype}`,
    )
    this.ws.send(jsonStringify(controlRequest))
  }

  

  isConnected(): boolean {
    return this.state === 'connected'
  }

  

  close(): void {
    logForDebugging('[SessionsWebSocket] Closing connection')
    this.state = 'closed'
    this.stopPingInterval()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      
      
      
      
      this.ws.close()
      this.ws = null
    }
  }

  

  reconnect(): void {
    logForDebugging('[SessionsWebSocket] Force reconnecting')
    this.reconnectAttempts = 0
    this.sessionNotFoundRetries = 0
    this.close()
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, 500)
  }
}
