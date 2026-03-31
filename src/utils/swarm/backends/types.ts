import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'

export type BackendType = 'tmux' | 'iterm2' | 'in-process'

export type PaneBackendType = 'tmux' | 'iterm2'

export type PaneId = string

export type CreatePaneResult = {
  /** The pane ID for the newly created pane */
  paneId: PaneId
  
  isFirstTeammate: boolean
}

/**
 * Interface for pane management backends.
 * Abstracts operations for creating and managing terminal panes
 * for teammate visualization in swarm mode.
 */
export type PaneBackend = {
  /** The type identifier for this backend */
  readonly type: BackendType

  
  readonly displayName: string

  
  readonly supportsHideShow: boolean

  

  isAvailable(): Promise<boolean>

  

  isRunningInside(): Promise<boolean>

  

  createTeammatePaneInSwarmView(
    name: string,
    color: AgentColorName,
  ): Promise<CreatePaneResult>

  

  sendCommandToPane(
    paneId: PaneId,
    command: string,
    useExternalSession?: boolean,
  ): Promise<void>

  

  setPaneBorderColor(
    paneId: PaneId,
    color: AgentColorName,
    useExternalSession?: boolean,
  ): Promise<void>

  

  setPaneTitle(
    paneId: PaneId,
    name: string,
    color: AgentColorName,
    useExternalSession?: boolean,
  ): Promise<void>

  

  enablePaneBorderStatus(
    windowTarget?: string,
    useExternalSession?: boolean,
  ): Promise<void>

  

  rebalancePanes(windowTarget: string, hasLeader: boolean): Promise<void>

  

  killPane(paneId: PaneId, useExternalSession?: boolean): Promise<boolean>

  

  hidePane(paneId: PaneId, useExternalSession?: boolean): Promise<boolean>

  

  showPane(
    paneId: PaneId,
    targetWindowOrPane: string,
    useExternalSession?: boolean,
  ): Promise<boolean>
}

/**
 * Result from backend detection.
 */
export type BackendDetectionResult = {
  /** The backend that should be used */
  backend: PaneBackend
  
  isNative: boolean
  
  needsIt2Setup?: boolean
}

// =============================================================================
// In-Process Teammate Types

/**
 * Identity fields for a teammate.
 * This is a subset shared with TeammateContext (Task #4) to avoid circular deps.
 * lifecycle-specialist defines the full TeammateContext with additional fields.
 */
export type TeammateIdentity = {
  /** Agent name (e.g., "researcher", "tester") */
  name: string
  
  teamName: string
  
  color?: AgentColorName
  
  planModeRequired?: boolean
}

/**
 * Configuration for spawning a teammate (any execution mode).
 */
export type TeammateSpawnConfig = TeammateIdentity & {
  /** Initial prompt to send to the teammate */
  prompt: string
  
  cwd: string
  
  model?: string
  
  systemPrompt?: string
  
  systemPromptMode?: 'default' | 'replace' | 'append'
  
  worktreePath?: string
  
  parentSessionId: string
  
  permissions?: string[]
  

  allowPermissionPrompts?: boolean
}

/**
 * Result from spawning a teammate.
 */
export type TeammateSpawnResult = {
  /** Whether spawn was successful */
  success: boolean
  
  agentId: string
  
  error?: string

  

  abortController?: AbortController

  

  taskId?: string

  
  paneId?: PaneId
}

/**
 * Message to send to a teammate.
 */
export type TeammateMessage = {
  /** Message content */
  text: string
  
  from: string
  
  color?: string
  
  timestamp?: string
  
  summary?: string
}

/**
 * Common interface for teammate execution backends.
 * Abstracts the differences between pane-based (tmux/iTerm2) and in-process execution.
 *
 * PaneBackend handles low-level pane operations; TeammateExecutor handles
 * high-level teammate lifecycle operations that work across all backends.
 */
export type TeammateExecutor = {
  /** Backend type identifier */
  readonly type: BackendType

  
  isAvailable(): Promise<boolean>

  
  spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult>

  
  sendMessage(agentId: string, message: TeammateMessage): Promise<void>

  
  terminate(agentId: string, reason?: string): Promise<boolean>

  
  kill(agentId: string): Promise<boolean>

  
  isActive(agentId: string): Promise<boolean>
}

// =============================================================================
// Type Guards

/**
 * Type guard to check if a backend type uses terminal panes.
 */
export function isPaneBackend(type: BackendType): type is 'tmux' | 'iterm2' {
  return type === 'tmux' || type === 'iterm2'
}
