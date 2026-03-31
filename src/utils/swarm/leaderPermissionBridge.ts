

import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type { ToolPermissionContext } from '../../Tool.js'

export type SetToolUseConfirmQueueFn = (
  updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
) => void

export type SetToolPermissionContextFn = (
  context: ToolPermissionContext,
  options?: { preserveMode?: boolean },
) => void

let registeredSetter: SetToolUseConfirmQueueFn | null = null
let registeredPermissionContextSetter: SetToolPermissionContextFn | null = null

export function registerLeaderToolUseConfirmQueue(
  setter: SetToolUseConfirmQueueFn,
): void {
  registeredSetter = setter
}

export function getLeaderToolUseConfirmQueue(): SetToolUseConfirmQueueFn | null {
  return registeredSetter
}

export function unregisterLeaderToolUseConfirmQueue(): void {
  registeredSetter = null
}

export function registerLeaderSetToolPermissionContext(
  setter: SetToolPermissionContextFn,
): void {
  registeredPermissionContextSetter = setter
}

export function getLeaderSetToolPermissionContext(): SetToolPermissionContextFn | null {
  return registeredPermissionContextSetter
}

export function unregisterLeaderSetToolPermissionContext(): void {
  registeredPermissionContextSetter = null
}
