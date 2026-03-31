import { logForDebugging } from '../utils/debug.js'
import { BridgeFatalError } from './bridgeApi.js'
import type { BridgeApiClient } from './types.js'

type BridgeFault = {
  method:
    | 'pollForWork'
    | 'registerBridgeEnvironment'
    | 'reconnectSession'
    | 'heartbeatWork'
  

  kind: 'fatal' | 'transient'
  status: number
  errorType?: string
  
  count: number
}

export type BridgeDebugHandle = {
  /** Invoke the transport's permanent-close handler directly. Tests the
   *  ws_closed → reconnectEnvironmentWithSession escalation (#22148). */
  fireClose: (code: number) => void
  /** Call reconnectEnvironmentWithSession() — same as SIGUSR2 but
   *  reachable from the slash command. */
  forceReconnect: () => void
  /** Queue a fault for the next N calls to the named api method. */
  injectFault: (fault: BridgeFault) => void
  /** Abort the at-capacity sleep so an injected poll fault lands
   *  immediately instead of up to 10min later. */
  wakePollLoop: () => void
  /** env/session IDs for the debug.log grep. */
  describe: () => string
}

let debugHandle: BridgeDebugHandle | null = null
const faultQueue: BridgeFault[] = []

export function registerBridgeDebugHandle(h: BridgeDebugHandle): void {
  debugHandle = h
}

export function clearBridgeDebugHandle(): void {
  debugHandle = null
  faultQueue.length = 0
}

export function getBridgeDebugHandle(): BridgeDebugHandle | null {
  return debugHandle
}

export function injectBridgeFault(fault: BridgeFault): void {
  faultQueue.push(fault)
  logForDebugging(
    `[bridge:debug] Queued fault: ${fault.method} ${fault.kind}/${fault.status}${fault.errorType ? `/${fault.errorType}` : ''} ×${fault.count}`,
  )
}

/**
 * Wrap a BridgeApiClient so each call first checks the fault queue. If a
 * matching fault is queued, throw the specified error instead of calling
 * through. Delegates everything else to the real client.
 *
 * Only called when USER_TYPE === 'ant' — zero overhead in external builds.
 */
export function wrapApiForFaultInjection(
  api: BridgeApiClient,
): BridgeApiClient {
  function consume(method: BridgeFault['method']): BridgeFault | null {
    const idx = faultQueue.findIndex(f => f.method === method)
    if (idx === -1) return null
    const fault = faultQueue[idx]!
    fault.count--
    if (fault.count <= 0) faultQueue.splice(idx, 1)
    return fault
  }

  function throwFault(fault: BridgeFault, context: string): never {
    logForDebugging(
      `[bridge:debug] Injecting ${fault.kind} fault into ${context}: status=${fault.status} errorType=${fault.errorType ?? 'none'}`,
    )
    if (fault.kind === 'fatal') {
      throw new BridgeFatalError(
        `[injected] ${context} ${fault.status}`,
        fault.status,
        fault.errorType,
      )
    }
    // Transient: mimic an axios rejection (5xx / network). No .status on
    
    throw new Error(`[injected transient] ${context} ${fault.status}`)
  }

  return {
    ...api,
    async pollForWork(envId, secret, signal, reclaimMs) {
      const f = consume('pollForWork')
      if (f) throwFault(f, 'Poll')
      return api.pollForWork(envId, secret, signal, reclaimMs)
    },
    async registerBridgeEnvironment(config) {
      const f = consume('registerBridgeEnvironment')
      if (f) throwFault(f, 'Registration')
      return api.registerBridgeEnvironment(config)
    },
    async reconnectSession(envId, sessionId) {
      const f = consume('reconnectSession')
      if (f) throwFault(f, 'ReconnectSession')
      return api.reconnectSession(envId, sessionId)
    },
    async heartbeatWork(envId, workId, token) {
      const f = consume('heartbeatWork')
      if (f) throwFault(f, 'Heartbeat')
      return api.heartbeatWork(envId, workId, token)
    },
  }
}
