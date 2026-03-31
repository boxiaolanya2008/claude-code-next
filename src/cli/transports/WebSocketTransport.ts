import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import type WsWebSocket from 'ws'
import { logEvent } from '../../services/analytics/index.js'
import { CircularBuffer } from '../../utils/CircularBuffer.js'
import { logForDebugging } from '../../utils/debug.js'
import { logForDiagnosticsNoPII } from '../../utils/diagLogs.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getWebSocketTLSOptions } from '../../utils/mtls.js'
import {
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../utils/proxy.js'
import {
  registerSessionActivityCallback,
  unregisterSessionActivityCallback,
} from '../../utils/sessionActivity.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { Transport } from './Transport.js'

const KEEP_ALIVE_FRAME = '{"type":"keep_alive"}\n'

const DEFAULT_MAX_BUFFER_SIZE = 1000
const DEFAULT_BASE_RECONNECT_DELAY = 1000
const DEFAULT_MAX_RECONNECT_DELAY = 30000

const DEFAULT_RECONNECT_GIVE_UP_MS = 600_000
const DEFAULT_PING_INTERVAL = 10000
const DEFAULT_KEEPALIVE_INTERVAL = 300_000 

const SLEEP_DETECTION_THRESHOLD_MS = DEFAULT_MAX_RECONNECT_DELAY * 2 

const PERMANENT_CLOSE_CODES = new Set([
  1002, 
  4001, 
  4003, 
])

export type WebSocketTransportOptions = {
  

  autoReconnect?: boolean
  

  isBridge?: boolean
}

type WebSocketTransportState =
  | 'idle'
  | 'connected'
  | 'reconnecting'
  | 'closing'
  | 'closed'

type WebSocketLike = {
  close(): void
  send(data: string): void
  ping?(): void 
}

export class WebSocketTransport implements Transport {
  private ws: WebSocketLike | null = null
  private lastSentId: string | null = null
  protected url: URL
  protected state: WebSocketTransportState = 'idle'
  protected onData?: (data: string) => void
  private onCloseCallback?: (closeCode?: number) => void
  private onConnectCallback?: () => void
  private headers: Record<string, string>
  private sessionId?: string
  private autoReconnect: boolean
  private isBridge: boolean

  
  private reconnectAttempts = 0
  private reconnectStartTime: number | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private lastReconnectAttemptTime: number | null = null
  
  
  
  
  private lastActivityTime = 0

  
  private pingInterval: NodeJS.Timeout | null = null
  private pongReceived = true

  
  private keepAliveInterval: NodeJS.Timeout | null = null

  
  private messageBuffer: CircularBuffer<StdoutMessage>
  
  
  private isBunWs = false

  
  
  
  
  private connectStartTime = 0

  private refreshHeaders?: () => Record<string, string>

  constructor(
    url: URL,
    headers: Record<string, string> = {},
    sessionId?: string,
    refreshHeaders?: () => Record<string, string>,
    options?: WebSocketTransportOptions,
  ) {
    this.url = url
    this.headers = headers
    this.sessionId = sessionId
    this.refreshHeaders = refreshHeaders
    this.autoReconnect = options?.autoReconnect ?? true
    this.isBridge = options?.isBridge ?? false
    this.messageBuffer = new CircularBuffer(DEFAULT_MAX_BUFFER_SIZE)
  }

  public async connect(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'reconnecting') {
      logForDebugging(
        `WebSocketTransport: Cannot connect, current state is ${this.state}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_connect_failed')
      return
    }
    this.state = 'reconnecting'

    this.connectStartTime = Date.now()
    logForDebugging(`WebSocketTransport: Opening ${this.url.href}`)
    logForDiagnosticsNoPII('info', 'cli_websocket_connect_opening')

    
    const headers = { ...this.headers }
    if (this.lastSentId) {
      headers['X-Last-Request-Id'] = this.lastSentId
      logForDebugging(
        `WebSocketTransport: Adding X-Last-Request-Id header: ${this.lastSentId}`,
      )
    }

    if (typeof Bun !== 'undefined') {
      
      
      const ws = new globalThis.WebSocket(this.url.href, {
        headers,
        proxy: getWebSocketProxyUrl(this.url.href),
        tls: getWebSocketTLSOptions() || undefined,
      } as unknown as string[])
      this.ws = ws
      this.isBunWs = true

      ws.addEventListener('open', this.onBunOpen)
      ws.addEventListener('message', this.onBunMessage)
      ws.addEventListener('error', this.onBunError)
      
      ws.addEventListener('close', this.onBunClose)
      
      ws.addEventListener('pong', this.onPong)
    } else {
      const { default: WS } = await import('ws')
      const ws = new WS(this.url.href, {
        headers,
        agent: getWebSocketProxyAgent(this.url.href),
        ...getWebSocketTLSOptions(),
      })
      this.ws = ws
      this.isBunWs = false

      ws.on('open', this.onNodeOpen)
      ws.on('message', this.onNodeMessage)
      ws.on('error', this.onNodeError)
      ws.on('close', this.onNodeClose)
      ws.on('pong', this.onPong)
    }
  }

  
  
  
  
  

  private onBunOpen = () => {
    this.handleOpenEvent()
    
    
    if (this.lastSentId) {
      this.replayBufferedMessages('')
    }
  }

  private onBunMessage = (event: MessageEvent) => {
    const message =
      typeof event.data === 'string' ? event.data : String(event.data)
    this.lastActivityTime = Date.now()
    logForDiagnosticsNoPII('info', 'cli_websocket_message_received', {
      length: message.length,
    })
    if (this.onData) {
      this.onData(message)
    }
  }

  private onBunError = () => {
    logForDebugging('WebSocketTransport: Error', {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_error')
    
  }

  
  private onBunClose = (event: CloseEvent) => {
    const isClean = event.code === 1000 || event.code === 1001
    logForDebugging(
      `WebSocketTransport: Closed: ${event.code}`,
      isClean ? undefined : { level: 'error' },
    )
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_closed')
    this.handleConnectionError(event.code)
  }

  

  private onNodeOpen = () => {
    
    
    
    const ws = this.ws
    this.handleOpenEvent()
    if (!ws) return
    
    const nws = ws as unknown as WsWebSocket & {
      upgradeReq?: { headers?: Record<string, string> }
    }
    const upgradeResponse = nws.upgradeReq
    if (upgradeResponse?.headers?.['x-last-request-id']) {
      const serverLastId = upgradeResponse.headers['x-last-request-id']
      this.replayBufferedMessages(serverLastId)
    }
  }

  private onNodeMessage = (data: Buffer) => {
    const message = data.toString()
    this.lastActivityTime = Date.now()
    logForDiagnosticsNoPII('info', 'cli_websocket_message_received', {
      length: message.length,
    })
    if (this.onData) {
      this.onData(message)
    }
  }

  private onNodeError = (err: Error) => {
    logForDebugging(`WebSocketTransport: Error: ${err.message}`, {
      level: 'error',
    })
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_error')
    
  }

  private onNodeClose = (code: number, _reason: Buffer) => {
    const isClean = code === 1000 || code === 1001
    logForDebugging(
      `WebSocketTransport: Closed: ${code}`,
      isClean ? undefined : { level: 'error' },
    )
    logForDiagnosticsNoPII('error', 'cli_websocket_connect_closed')
    this.handleConnectionError(code)
  }

  

  private onPong = () => {
    this.pongReceived = true
  }

  private handleOpenEvent(): void {
    const connectDuration = Date.now() - this.connectStartTime
    logForDebugging('WebSocketTransport: Connected')
    logForDiagnosticsNoPII('info', 'cli_websocket_connect_connected', {
      duration_ms: connectDuration,
    })

    
    
    if (this.isBridge && this.reconnectStartTime !== null) {
      logEvent('tengu_ws_transport_reconnected', {
        attempts: this.reconnectAttempts,
        downtimeMs: Date.now() - this.reconnectStartTime,
      })
    }

    this.reconnectAttempts = 0
    this.reconnectStartTime = null
    this.lastReconnectAttemptTime = null
    this.lastActivityTime = Date.now()
    this.state = 'connected'
    this.onConnectCallback?.()

    
    this.startPingInterval()

    
    this.startKeepaliveInterval()

    
    registerSessionActivityCallback(() => {
      void this.write({ type: 'keep_alive' })
    })
  }

  protected sendLine(line: string): boolean {
    if (!this.ws || this.state !== 'connected') {
      logForDebugging('WebSocketTransport: Not connected')
      logForDiagnosticsNoPII('info', 'cli_websocket_send_not_connected')
      return false
    }

    try {
      this.ws.send(line)
      this.lastActivityTime = Date.now()
      return true
    } catch (error) {
      logForDebugging(`WebSocketTransport: Failed to send: ${error}`, {
        level: 'error',
      })
      logForDiagnosticsNoPII('error', 'cli_websocket_send_error')
      
      
      this.handleConnectionError()
      return false
    }
  }

  

  private removeWsListeners(ws: WebSocketLike): void {
    if (this.isBunWs) {
      const nws = ws as unknown as globalThis.WebSocket
      nws.removeEventListener('open', this.onBunOpen)
      nws.removeEventListener('message', this.onBunMessage)
      nws.removeEventListener('error', this.onBunError)
      
      nws.removeEventListener('close', this.onBunClose)
      
      nws.removeEventListener('pong' as 'message', this.onPong)
    } else {
      const nws = ws as unknown as WsWebSocket
      nws.off('open', this.onNodeOpen)
      nws.off('message', this.onNodeMessage)
      nws.off('error', this.onNodeError)
      nws.off('close', this.onNodeClose)
      nws.off('pong', this.onPong)
    }
  }

  protected doDisconnect(): void {
    
    this.stopPingInterval()
    this.stopKeepaliveInterval()

    
    unregisterSessionActivityCallback()

    if (this.ws) {
      
      
      this.removeWsListeners(this.ws)
      this.ws.close()
      this.ws = null
    }
  }

  private handleConnectionError(closeCode?: number): void {
    logForDebugging(
      `WebSocketTransport: Disconnected from ${this.url.href}` +
        (closeCode != null ? ` (code ${closeCode})` : ''),
    )
    logForDiagnosticsNoPII('info', 'cli_websocket_disconnected')
    if (this.isBridge) {
      
      
      
      
      logEvent('tengu_ws_transport_closed', {
        closeCode,
        msSinceLastActivity:
          this.lastActivityTime > 0 ? Date.now() - this.lastActivityTime : -1,
        
        
        
        wasConnected: this.state === 'connected',
        reconnectAttempts: this.reconnectAttempts,
      })
    }
    this.doDisconnect()

    if (this.state === 'closing' || this.state === 'closed') return

    
    
    
    
    let headersRefreshed = false
    if (closeCode === 4003 && this.refreshHeaders) {
      const freshHeaders = this.refreshHeaders()
      if (freshHeaders.Authorization !== this.headers.Authorization) {
        Object.assign(this.headers, freshHeaders)
        headersRefreshed = true
        logForDebugging(
          'WebSocketTransport: 4003 received but headers refreshed, scheduling reconnect',
        )
        logForDiagnosticsNoPII('info', 'cli_websocket_4003_token_refreshed')
      }
    }

    if (
      closeCode != null &&
      PERMANENT_CLOSE_CODES.has(closeCode) &&
      !headersRefreshed
    ) {
      logForDebugging(
        `WebSocketTransport: Permanent close code ${closeCode}, not reconnecting`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_permanent_close', {
        closeCode,
      })
      this.state = 'closed'
      this.onCloseCallback?.(closeCode)
      return
    }

    
    
    if (!this.autoReconnect) {
      this.state = 'closed'
      this.onCloseCallback?.(closeCode)
      return
    }

    
    const now = Date.now()
    if (!this.reconnectStartTime) {
      this.reconnectStartTime = now
    }

    
    
    
    
    
    if (
      this.lastReconnectAttemptTime !== null &&
      now - this.lastReconnectAttemptTime > SLEEP_DETECTION_THRESHOLD_MS
    ) {
      logForDebugging(
        `WebSocketTransport: Detected system sleep (${Math.round((now - this.lastReconnectAttemptTime) / 1000)}s gap), resetting reconnection budget`,
      )
      logForDiagnosticsNoPII('info', 'cli_websocket_sleep_detected', {
        gapMs: now - this.lastReconnectAttemptTime,
      })
      this.reconnectStartTime = now
      this.reconnectAttempts = 0
    }
    this.lastReconnectAttemptTime = now

    const elapsed = now - this.reconnectStartTime
    if (elapsed < DEFAULT_RECONNECT_GIVE_UP_MS) {
      
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }

      
      
      if (!headersRefreshed && this.refreshHeaders) {
        const freshHeaders = this.refreshHeaders()
        Object.assign(this.headers, freshHeaders)
        logForDebugging('WebSocketTransport: Refreshed headers for reconnect')
      }

      this.state = 'reconnecting'
      this.reconnectAttempts++

      const baseDelay = Math.min(
        DEFAULT_BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1),
        DEFAULT_MAX_RECONNECT_DELAY,
      )
      
      const delay = Math.max(
        0,
        baseDelay + baseDelay * 0.25 * (2 * Math.random() - 1),
      )

      logForDebugging(
        `WebSocketTransport: Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}, ${Math.round(elapsed / 1000)}s elapsed)`,
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_reconnect_attempt', {
        reconnectAttempts: this.reconnectAttempts,
      })
      if (this.isBridge) {
        logEvent('tengu_ws_transport_reconnecting', {
          attempt: this.reconnectAttempts,
          elapsedMs: elapsed,
          delayMs: Math.round(delay),
        })
      }

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        void this.connect()
      }, delay)
    } else {
      logForDebugging(
        `WebSocketTransport: Reconnection time budget exhausted after ${Math.round(elapsed / 1000)}s for ${this.url.href}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'cli_websocket_reconnect_exhausted', {
        reconnectAttempts: this.reconnectAttempts,
        elapsedMs: elapsed,
      })
      this.state = 'closed'

      
      if (this.onCloseCallback) {
        this.onCloseCallback(closeCode)
      }
    }
  }

  close(): void {
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    
    this.stopPingInterval()
    this.stopKeepaliveInterval()

    
    unregisterSessionActivityCallback()

    this.state = 'closing'
    this.doDisconnect()
  }

  private replayBufferedMessages(lastId: string): void {
    const messages = this.messageBuffer.toArray()
    if (messages.length === 0) return

    
    let startIndex = 0
    if (lastId) {
      const lastConfirmedIndex = messages.findIndex(
        message => 'uuid' in message && message.uuid === lastId,
      )
      if (lastConfirmedIndex >= 0) {
        
        startIndex = lastConfirmedIndex + 1
        
        const remaining = messages.slice(startIndex)
        this.messageBuffer.clear()
        this.messageBuffer.addAll(remaining)
        if (remaining.length === 0) {
          this.lastSentId = null
        }
        logForDebugging(
          `WebSocketTransport: Evicted ${startIndex} confirmed messages, ${remaining.length} remaining`,
        )
        logForDiagnosticsNoPII(
          'info',
          'cli_websocket_evicted_confirmed_messages',
          {
            evicted: startIndex,
            remaining: remaining.length,
          },
        )
      }
    }

    const messagesToReplay = messages.slice(startIndex)
    if (messagesToReplay.length === 0) {
      logForDebugging('WebSocketTransport: No new messages to replay')
      logForDiagnosticsNoPII('info', 'cli_websocket_no_messages_to_replay')
      return
    }

    logForDebugging(
      `WebSocketTransport: Replaying ${messagesToReplay.length} buffered messages`,
    )
    logForDiagnosticsNoPII('info', 'cli_websocket_messages_to_replay', {
      count: messagesToReplay.length,
    })

    for (const message of messagesToReplay) {
      const line = jsonStringify(message) + '\n'
      const success = this.sendLine(line)
      if (!success) {
        this.handleConnectionError()
        break
      }
    }
    
    
    
    
  }

  isConnectedStatus(): boolean {
    return this.state === 'connected'
  }

  isClosedStatus(): boolean {
    return this.state === 'closed'
  }

  setOnData(callback: (data: string) => void): void {
    this.onData = callback
  }

  setOnConnect(callback: () => void): void {
    this.onConnectCallback = callback
  }

  setOnClose(callback: (closeCode?: number) => void): void {
    this.onCloseCallback = callback
  }

  getStateLabel(): string {
    return this.state
  }

  async write(message: StdoutMessage): Promise<void> {
    if ('uuid' in message && typeof message.uuid === 'string') {
      this.messageBuffer.add(message)
      this.lastSentId = message.uuid
    }

    const line = jsonStringify(message) + '\n'

    if (this.state !== 'connected') {
      
      return
    }

    const sessionLabel = this.sessionId ? ` session=${this.sessionId}` : ''
    const detailLabel = this.getControlMessageDetailLabel(message)

    logForDebugging(
      `WebSocketTransport: Sending message type=${message.type}${sessionLabel}${detailLabel}`,
    )

    this.sendLine(line)
  }

  private getControlMessageDetailLabel(message: StdoutMessage): string {
    if (message.type === 'control_request') {
      const { request_id, request } = message
      const toolName =
        request.subtype === 'can_use_tool' ? request.tool_name : ''
      return ` subtype=${request.subtype} request_id=${request_id}${toolName ? ` tool=${toolName}` : ''}`
    }
    if (message.type === 'control_response') {
      const { subtype, request_id } = message.response
      return ` subtype=${subtype} request_id=${request_id}`
    }
    return ''
  }

  private startPingInterval(): void {
    
    this.stopPingInterval()

    this.pongReceived = true
    let lastTickTime = Date.now()

    
    
    this.pingInterval = setInterval(() => {
      if (this.state === 'connected' && this.ws) {
        const now = Date.now()
        const gap = now - lastTickTime
        lastTickTime = now

        
        
        
        
        
        
        
        
        
        
        
        
        if (gap > SLEEP_DETECTION_THRESHOLD_MS) {
          logForDebugging(
            `WebSocketTransport: ${Math.round(gap / 1000)}s tick gap detected — process was suspended, forcing reconnect`,
          )
          logForDiagnosticsNoPII(
            'info',
            'cli_websocket_sleep_detected_on_ping',
            { gapMs: gap },
          )
          this.handleConnectionError()
          return
        }

        if (!this.pongReceived) {
          logForDebugging(
            'WebSocketTransport: No pong received, connection appears dead',
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_websocket_pong_timeout')
          this.handleConnectionError()
          return
        }

        this.pongReceived = false
        try {
          this.ws.ping?.()
        } catch (error) {
          logForDebugging(`WebSocketTransport: Ping failed: ${error}`, {
            level: 'error',
          })
          logForDiagnosticsNoPII('error', 'cli_websocket_ping_failed')
        }
      }
    }, DEFAULT_PING_INTERVAL)
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private startKeepaliveInterval(): void {
    this.stopKeepaliveInterval()

    
    if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE)) {
      return
    }

    this.keepAliveInterval = setInterval(() => {
      if (this.state === 'connected' && this.ws) {
        try {
          this.ws.send(KEEP_ALIVE_FRAME)
          this.lastActivityTime = Date.now()
          logForDebugging(
            'WebSocketTransport: Sent periodic keep_alive data frame',
          )
        } catch (error) {
          logForDebugging(
            `WebSocketTransport: Periodic keep_alive failed: ${error}`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII('error', 'cli_websocket_keepalive_failed')
        }
      }
    }, DEFAULT_KEEPALIVE_INTERVAL)
  }

  private stopKeepaliveInterval(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
      this.keepAliveInterval = null
    }
  }
}
