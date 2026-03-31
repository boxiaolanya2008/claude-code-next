

import { useCallback, useEffect, useRef } from 'react'
import { useInterval } from 'usehooks-ts'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import {
  type PermissionUpdate,
  permissionUpdateSchema,
} from '../utils/permissions/PermissionUpdateSchema.js'
import {
  isSwarmWorker,
  type PermissionResponse,
  pollForResponse,
  removeWorkerResponse,
} from '../utils/swarm/permissionSync.js'
import { getAgentName, getTeamName } from '../utils/teammate.js'

const POLL_INTERVAL_MS = 500

function parsePermissionUpdates(raw: unknown): PermissionUpdate[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const schema = permissionUpdateSchema()
  const valid: PermissionUpdate[] = []
  for (const entry of raw) {
    const result = schema.safeParse(entry)
    if (result.success) {
      valid.push(result.data)
    } else {
      logForDebugging(
        `[SwarmPermissionPoller] Dropping malformed permissionUpdate entry: ${result.error.message}`,
        { level: 'warn' },
      )
    }
  }
  return valid
}

export type PermissionResponseCallback = {
  requestId: string
  toolUseId: string
  onAllow: (
    updatedInput: Record<string, unknown> | undefined,
    permissionUpdates: PermissionUpdate[],
    feedback?: string,
  ) => void
  onReject: (feedback?: string) => void
}

type PendingCallbackRegistry = Map<string, PermissionResponseCallback>

const pendingCallbacks: PendingCallbackRegistry = new Map()

export function registerPermissionCallback(
  callback: PermissionResponseCallback,
): void {
  pendingCallbacks.set(callback.requestId, callback)
  logForDebugging(
    `[SwarmPermissionPoller] Registered callback for request ${callback.requestId}`,
  )
}

export function unregisterPermissionCallback(requestId: string): void {
  pendingCallbacks.delete(requestId)
  logForDebugging(
    `[SwarmPermissionPoller] Unregistered callback for request ${requestId}`,
  )
}

export function hasPermissionCallback(requestId: string): boolean {
  return pendingCallbacks.has(requestId)
}

export function clearAllPendingCallbacks(): void {
  pendingCallbacks.clear()
  pendingSandboxCallbacks.clear()
}

export function processMailboxPermissionResponse(params: {
  requestId: string
  decision: 'approved' | 'rejected'
  feedback?: string
  updatedInput?: Record<string, unknown>
  permissionUpdates?: unknown
}): boolean {
  const callback = pendingCallbacks.get(params.requestId)

  if (!callback) {
    logForDebugging(
      `[SwarmPermissionPoller] No callback registered for mailbox response ${params.requestId}`,
    )
    return false
  }

  logForDebugging(
    `[SwarmPermissionPoller] Processing mailbox response for request ${params.requestId}: ${params.decision}`,
  )

  
  pendingCallbacks.delete(params.requestId)

  if (params.decision === 'approved') {
    const permissionUpdates = parsePermissionUpdates(params.permissionUpdates)
    const updatedInput = params.updatedInput
    callback.onAllow(updatedInput, permissionUpdates)
  } else {
    callback.onReject(params.feedback)
  }

  return true
}

export type SandboxPermissionResponseCallback = {
  requestId: string
  host: string
  resolve: (allow: boolean) => void
}

const pendingSandboxCallbacks: Map<string, SandboxPermissionResponseCallback> =
  new Map()

export function registerSandboxPermissionCallback(
  callback: SandboxPermissionResponseCallback,
): void {
  pendingSandboxCallbacks.set(callback.requestId, callback)
  logForDebugging(
    `[SwarmPermissionPoller] Registered sandbox callback for request ${callback.requestId}`,
  )
}

export function hasSandboxPermissionCallback(requestId: string): boolean {
  return pendingSandboxCallbacks.has(requestId)
}

export function processSandboxPermissionResponse(params: {
  requestId: string
  host: string
  allow: boolean
}): boolean {
  const callback = pendingSandboxCallbacks.get(params.requestId)

  if (!callback) {
    logForDebugging(
      `[SwarmPermissionPoller] No sandbox callback registered for request ${params.requestId}`,
    )
    return false
  }

  logForDebugging(
    `[SwarmPermissionPoller] Processing sandbox response for request ${params.requestId}: allow=${params.allow}`,
  )

  
  pendingSandboxCallbacks.delete(params.requestId)

  
  callback.resolve(params.allow)

  return true
}

function processResponse(response: PermissionResponse): boolean {
  const callback = pendingCallbacks.get(response.requestId)

  if (!callback) {
    logForDebugging(
      `[SwarmPermissionPoller] No callback registered for request ${response.requestId}`,
    )
    return false
  }

  logForDebugging(
    `[SwarmPermissionPoller] Processing response for request ${response.requestId}: ${response.decision}`,
  )

  
  pendingCallbacks.delete(response.requestId)

  if (response.decision === 'approved') {
    const permissionUpdates = parsePermissionUpdates(response.permissionUpdates)
    const updatedInput = response.updatedInput
    callback.onAllow(updatedInput, permissionUpdates)
  } else {
    callback.onReject(response.feedback)
  }

  return true
}

export function useSwarmPermissionPoller(): void {
  const isProcessingRef = useRef(false)

  const poll = useCallback(async () => {
    
    if (!isSwarmWorker()) {
      return
    }

    
    if (isProcessingRef.current) {
      return
    }

    
    if (pendingCallbacks.size === 0) {
      return
    }

    isProcessingRef.current = true

    try {
      const agentName = getAgentName()
      const teamName = getTeamName()

      if (!agentName || !teamName) {
        return
      }

      
      for (const [requestId, _callback] of pendingCallbacks) {
        const response = await pollForResponse(requestId, agentName, teamName)

        if (response) {
          
          const processed = processResponse(response)

          if (processed) {
            
            await removeWorkerResponse(requestId, agentName, teamName)
          }
        }
      }
    } catch (error) {
      logForDebugging(
        `[SwarmPermissionPoller] Error during poll: ${errorMessage(error)}`,
      )
    } finally {
      isProcessingRef.current = false
    }
  }, [])

  
  const shouldPoll = isSwarmWorker()
  useInterval(() => void poll(), shouldPoll ? POLL_INTERVAL_MS : null)

  
  useEffect(() => {
    if (isSwarmWorker()) {
      void poll()
    }
  }, [poll])
}
