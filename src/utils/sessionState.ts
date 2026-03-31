export type SessionState = 'idle' | 'running' | 'requires_action'

export type RequiresActionDetails = {
  tool_name: string
  
  action_description: string
  tool_use_id: string
  request_id: string
  

  input?: Record<string, unknown>
}

import { isEnvTruthy } from './envUtils.js'
import type { PermissionMode } from './permissions/PermissionMode.js'
import { enqueueSdkEvent } from './sdkEventQueue.js'

export type SessionExternalMetadata = {
  permission_mode?: string | null
  is_ultraplan_mode?: boolean | null
  model?: string | null
  pending_action?: RequiresActionDetails | null
  
  
  
  post_turn_summary?: unknown
  
  
  
  task_summary?: string | null
}

type SessionStateChangedListener = (
  state: SessionState,
  details?: RequiresActionDetails,
) => void
type SessionMetadataChangedListener = (
  metadata: SessionExternalMetadata,
) => void
type PermissionModeChangedListener = (mode: PermissionMode) => void

let stateListener: SessionStateChangedListener | null = null
let metadataListener: SessionMetadataChangedListener | null = null
let permissionModeListener: PermissionModeChangedListener | null = null

export function setSessionStateChangedListener(
  cb: SessionStateChangedListener | null,
): void {
  stateListener = cb
}

export function setSessionMetadataChangedListener(
  cb: SessionMetadataChangedListener | null,
): void {
  metadataListener = cb
}

export function setPermissionModeChangedListener(
  cb: PermissionModeChangedListener | null,
): void {
  permissionModeListener = cb
}

let hasPendingAction = false
let currentState: SessionState = 'idle'

export function getSessionState(): SessionState {
  return currentState
}

export function notifySessionStateChanged(
  state: SessionState,
  details?: RequiresActionDetails,
): void {
  currentState = state
  stateListener?.(state, details)

  
  
  
  if (state === 'requires_action' && details) {
    hasPendingAction = true
    metadataListener?.({
      pending_action: details,
    })
  } else if (hasPendingAction) {
    hasPendingAction = false
    metadataListener?.({ pending_action: null })
  }

  
  
  if (state === 'idle') {
    metadataListener?.({ task_summary: null })
  }

  
  
  
  
  
  
  
  
  
  if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_EMIT_SESSION_STATE_EVENTS)) {
    enqueueSdkEvent({
      type: 'system',
      subtype: 'session_state_changed',
      state,
    })
  }
}

export function notifySessionMetadataChanged(
  metadata: SessionExternalMetadata,
): void {
  metadataListener?.(metadata)
}

export function notifyPermissionModeChanged(mode: PermissionMode): void {
  permissionModeListener?.(mode)
}
