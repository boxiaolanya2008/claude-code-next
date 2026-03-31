import { feature } from 'bun:bundle'
import { useEffect, useRef } from 'react'
import {
  type AppState,
  useAppState,
  useAppStateStore,
  useSetAppState,
} from 'src/state/AppState.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import {
  createDisabledBypassPermissionsContext,
  shouldDisableBypassPermissions,
  verifyAutoModeGateAccess,
} from './permissionSetup.js'

let bypassPermissionsCheckRan = false

export async function checkAndDisableBypassPermissionsIfNeeded(
  toolPermissionContext: ToolPermissionContext,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<void> {
  
  
  if (bypassPermissionsCheckRan) {
    return
  }
  bypassPermissionsCheckRan = true

  if (!toolPermissionContext.isBypassPermissionsModeAvailable) {
    return
  }

  const shouldDisable = await shouldDisableBypassPermissions()
  if (!shouldDisable) {
    return
  }

  setAppState(prev => {
    return {
      ...prev,
      toolPermissionContext: createDisabledBypassPermissionsContext(
        prev.toolPermissionContext,
      ),
    }
  })
}

export function resetBypassPermissionsCheck(): void {
  bypassPermissionsCheckRan = false
}

export function useKickOffCheckAndDisableBypassPermissionsIfNeeded(): void {
  const toolPermissionContext = useAppState(s => s.toolPermissionContext)
  const setAppState = useSetAppState()

  
  useEffect(() => {
    if (getIsRemoteMode()) return
    void checkAndDisableBypassPermissionsIfNeeded(
      toolPermissionContext,
      setAppState,
    )
    
  }, [])
}

let autoModeCheckRan = false

export async function checkAndDisableAutoModeIfNeeded(
  toolPermissionContext: ToolPermissionContext,
  setAppState: (f: (prev: AppState) => AppState) => void,
  fastMode?: boolean,
): Promise<void> {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (autoModeCheckRan) {
      return
    }
    autoModeCheckRan = true

    const { updateContext, notification } = await verifyAutoModeGateAccess(
      toolPermissionContext,
      fastMode,
    )
    setAppState(prev => {
      
      
      
      
      const nextCtx = updateContext(prev.toolPermissionContext)
      const newState =
        nextCtx === prev.toolPermissionContext
          ? prev
          : { ...prev, toolPermissionContext: nextCtx }
      if (!notification) return newState
      return {
        ...newState,
        notifications: {
          ...newState.notifications,
          queue: [
            ...newState.notifications.queue,
            {
              key: 'auto-mode-gate-notification',
              text: notification,
              color: 'warning' as const,
              priority: 'high' as const,
            },
          ],
        },
      }
    })
  }
}

export function resetAutoModeGateCheck(): void {
  autoModeCheckRan = false
}

export function useKickOffCheckAndDisableAutoModeIfNeeded(): void {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const fastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const store = useAppStateStore()
  const isFirstRunRef = useRef(true)

  
  
  
  
  
  
  useEffect(() => {
    if (getIsRemoteMode()) return
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false
    } else {
      resetAutoModeGateCheck()
    }
    void checkAndDisableAutoModeIfNeeded(
      store.getState().toolPermissionContext,
      setAppState,
      fastMode,
    )
    
  }, [mainLoopModel, mainLoopModelForSession, fastMode])
}
