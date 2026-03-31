

import { createServer, type Socket as NodeSocket } from 'node:net'
import { logForDebugging } from '../utils/debug.js'
import { getWebSocketTLSOptions } from '../utils/mtls.js'
import { getWebSocketProxyAgent, getWebSocketProxyUrl } from '../utils/proxy.js'

type WSCtor = typeof import('ws').default
let nodeWSCtor: WSCtor | undefined

type WebSocketLike = Pick<
  WebSocket,
  | 'onopen'
  | 'onmessage'
  | 'onerror'
  | 'onclose'
  | 'send'
  | 'close'
  | 'readyState'
  | 'binaryType'
>

const MAX_CHUNK_BYTES = 512 * 1024

const PING_INTERVAL_MS = 30_000

export function encodeChunk(data: Uint8Array): Uint8Array {
  const len = data.length
  
  const varint: number[] = []
  let n = len
  while (n > 0x7f) {
    varint.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  varint.push(n)
  const out = new Uint8Array(1 + varint.length + len)
  out[0] = 0x0a
  out.set(varint, 1)
  out.set(data, 1 + varint.length)
  return out
}

export function decodeChunk(buf: Uint8Array): Uint8Array | null {
  if (buf.length === 0) return new Uint8Array(0)
  if (buf[0] !== 0x0a) return null
  let len = 0
  let shift = 0
  let i = 1
  while (i < buf.length) {
    const b = buf[i]!
    len |= (b & 0x7f) << shift
    i++
    if ((b & 0x80) === 0) break
    shift += 7
    if (shift > 28) return null
  }
  if (i + len > buf.length) return null
  return buf.subarray(i, i + len)
}

export type UpstreamProxyRelay = {
  port: number
  stop: () => void
}

type ConnState = {
  ws?: WebSocketLike
  connectBuf: Buffer
  pinger?: ReturnType<typeof setInterval>
  
  
  
  
  pending: Buffer[]
  wsOpen: boolean
  
  
  
  established: boolean
  
  
  closed: boolean
}

type ClientSocket = {
  write: (data: Uint8Array | string) => void
  end: () => void
}

function newConnState(): ConnState {
  return {
    connectBuf: Buffer.alloc(0),
    pending: [],
    wsOpen: false,
    established: false,
    closed: false,
  }
}

export async function startUpstreamProxyRelay(opts: {
  wsUrl: string
  sessionId: string
  token: string
}): Promise<UpstreamProxyRelay> {
  const authHeader =
    'Basic ' + Buffer.from(`${opts.sessionId}:${opts.token}`).toString('base64')
  
  
  
  const wsAuthHeader = `Bearer ${opts.token}`

  const relay =
    typeof Bun !== 'undefined'
      ? startBunRelay(opts.wsUrl, authHeader, wsAuthHeader)
      : await startNodeRelay(opts.wsUrl, authHeader, wsAuthHeader)

  logForDebugging(`[upstreamproxy] relay listening on 127.0.0.1:${relay.port}`)
  return relay
}

function startBunRelay(
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): UpstreamProxyRelay {
  
  
  
  
  
  type BunState = ConnState & { writeBuf: Uint8Array[] }

  
  const server = Bun.listen<BunState>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(sock) {
        sock.data = { ...newConnState(), writeBuf: [] }
      },
      data(sock, data) {
        const st = sock.data
        const adapter: ClientSocket = {
          write: payload => {
            const bytes =
              typeof payload === 'string'
                ? Buffer.from(payload, 'utf8')
                : payload
            if (st.writeBuf.length > 0) {
              st.writeBuf.push(bytes)
              return
            }
            const n = sock.write(bytes)
            if (n < bytes.length) st.writeBuf.push(bytes.subarray(n))
          },
          end: () => sock.end(),
        }
        handleData(adapter, st, data, wsUrl, authHeader, wsAuthHeader)
      },
      drain(sock) {
        const st = sock.data
        while (st.writeBuf.length > 0) {
          const chunk = st.writeBuf[0]!
          const n = sock.write(chunk)
          if (n < chunk.length) {
            st.writeBuf[0] = chunk.subarray(n)
            return
          }
          st.writeBuf.shift()
        }
      },
      close(sock) {
        cleanupConn(sock.data)
      },
      error(sock, err) {
        logForDebugging(`[upstreamproxy] client socket error: ${err.message}`)
        cleanupConn(sock.data)
      },
    },
  })

  return {
    port: server.port,
    stop: () => server.stop(true),
  }
}

export async function startNodeRelay(
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): Promise<UpstreamProxyRelay> {
  nodeWSCtor = (await import('ws')).default
  const states = new WeakMap<NodeSocket, ConnState>()

  const server = createServer(sock => {
    const st = newConnState()
    states.set(sock, st)
    
    
    
    const adapter: ClientSocket = {
      write: payload => {
        sock.write(typeof payload === 'string' ? payload : Buffer.from(payload))
      },
      end: () => sock.end(),
    }
    sock.on('data', data =>
      handleData(adapter, st, data, wsUrl, authHeader, wsAuthHeader),
    )
    sock.on('close', () => cleanupConn(states.get(sock)))
    sock.on('error', err => {
      logForDebugging(`[upstreamproxy] client socket error: ${err.message}`)
      cleanupConn(states.get(sock))
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('upstreamproxy: server has no TCP address'))
        return
      }
      resolve({
        port: addr.port,
        stop: () => server.close(),
      })
    })
  })
}

function handleData(
  sock: ClientSocket,
  st: ConnState,
  data: Buffer,
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): void {
  
  
  
  if (!st.ws) {
    st.connectBuf = Buffer.concat([st.connectBuf, data])
    const headerEnd = st.connectBuf.indexOf('\r\n\r\n')
    if (headerEnd === -1) {
      
      if (st.connectBuf.length > 8192) {
        sock.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        sock.end()
      }
      return
    }
    const reqHead = st.connectBuf.subarray(0, headerEnd).toString('utf8')
    const firstLine = reqHead.split('\r\n')[0] ?? ''
    const m = firstLine.match(/^CONNECT\s+(\S+)\s+HTTP\/1\.[01]$/i)
    if (!m) {
      sock.write('HTTP/1.1 405 Method Not Allowed\r\n\r\n')
      sock.end()
      return
    }
    
    
    const trailing = st.connectBuf.subarray(headerEnd + 4)
    if (trailing.length > 0) {
      st.pending.push(Buffer.from(trailing))
    }
    st.connectBuf = Buffer.alloc(0)
    openTunnel(sock, st, firstLine, wsUrl, authHeader, wsAuthHeader)
    return
  }
  
  
  if (!st.wsOpen) {
    st.pending.push(Buffer.from(data))
    return
  }
  forwardToWs(st.ws, data)
}

function openTunnel(
  sock: ClientSocket,
  st: ConnState,
  connectLine: string,
  wsUrl: string,
  authHeader: string,
  wsAuthHeader: string,
): void {
  
  
  
  
  const headers = {
    'Content-Type': 'application/proto',
    Authorization: wsAuthHeader,
  }
  let ws: WebSocketLike
  if (nodeWSCtor) {
    ws = new nodeWSCtor(wsUrl, {
      headers,
      agent: getWebSocketProxyAgent(wsUrl),
      ...getWebSocketTLSOptions(),
    }) as unknown as WebSocketLike
  } else {
    ws = new globalThis.WebSocket(wsUrl, {
      
      headers,
      proxy: getWebSocketProxyUrl(wsUrl),
      tls: getWebSocketTLSOptions() || undefined,
    })
  }
  ws.binaryType = 'arraybuffer'
  st.ws = ws

  ws.onopen = () => {
    
    
    
    const head =
      `${connectLine}\r\n` + `Proxy-Authorization: ${authHeader}\r\n` + `\r\n`
    ws.send(encodeChunk(Buffer.from(head, 'utf8')))
    
    
    
    st.wsOpen = true
    for (const buf of st.pending) {
      forwardToWs(ws, buf)
    }
    st.pending = []
    
    
    st.pinger = setInterval(sendKeepalive, PING_INTERVAL_MS, ws)
  }

  ws.onmessage = ev => {
    const raw =
      ev.data instanceof ArrayBuffer
        ? new Uint8Array(ev.data)
        : new Uint8Array(Buffer.from(ev.data))
    const payload = decodeChunk(raw)
    if (payload && payload.length > 0) {
      st.established = true
      sock.write(payload)
    }
  }

  ws.onerror = ev => {
    const msg = 'message' in ev ? String(ev.message) : 'websocket error'
    logForDebugging(`[upstreamproxy] ws error: ${msg}`)
    if (st.closed) return
    st.closed = true
    if (!st.established) {
      sock.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    }
    sock.end()
    cleanupConn(st)
  }

  ws.onclose = () => {
    if (st.closed) return
    st.closed = true
    sock.end()
    cleanupConn(st)
  }
}

function sendKeepalive(ws: WebSocketLike): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(encodeChunk(new Uint8Array(0)))
  }
}

function forwardToWs(ws: WebSocketLike, data: Buffer): void {
  if (ws.readyState !== WebSocket.OPEN) return
  for (let off = 0; off < data.length; off += MAX_CHUNK_BYTES) {
    const slice = data.subarray(off, off + MAX_CHUNK_BYTES)
    ws.send(encodeChunk(slice))
  }
}

function cleanupConn(st: ConnState | undefined): void {
  if (!st) return
  if (st.pinger) clearInterval(st.pinger)
  if (st.ws && st.ws.readyState <= WebSocket.OPEN) {
    try {
      st.ws.close()
    } catch {
      
    }
  }
  st.ws = undefined
}
