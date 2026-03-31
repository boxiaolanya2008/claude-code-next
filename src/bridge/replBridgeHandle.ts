import { updateSessionBridgeId } from '../utils/concurrentSessions.js'
import type { ReplBridgeHandle } from './replBridge.js'
import { toCompatSessionId } from './sessionIdCompat.js'

let handle: ReplBridgeHandle | null = null

export function setReplBridgeHandle(h: ReplBridgeHandle | null): void {
  handle = h
  
  
  void updateSessionBridgeId(getSelfBridgeCompatId() ?? null).catch(() => {})
}

export function getReplBridgeHandle(): ReplBridgeHandle | null {
  return handle
}

export function getSelfBridgeCompatId(): string | undefined {
  const h = getReplBridgeHandle()
  return h ? toCompatSessionId(h.bridgeSessionId) : undefined
}
