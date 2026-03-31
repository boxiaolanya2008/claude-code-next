
export const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000

export const BRIDGE_LOGIN_INSTRUCTION =
  'Remote Control is only available with claude.ai subscriptions. Please use `/login` to sign in with your claude.ai account.'

export const BRIDGE_LOGIN_ERROR =
  'Error: You must be logged in to use Remote Control.\n\n' +
  BRIDGE_LOGIN_INSTRUCTION

export const REMOTE_CONTROL_DISCONNECTED_MSG = 'Remote Control disconnected.'

export type WorkData = {
  type: 'session' | 'healthcheck'
  id: string
}

export type WorkResponse = {
  id: string
  type: 'work'
  environment_id: string
  state: string
  data: WorkData
  secret: string 
  created_at: string
}

export type WorkSecret = {
  version: number
  session_ingress_token: string
  api_base_url: string
  sources: Array<{
    type: string
    git_info?: { type: string; repo: string; ref?: string; token?: string }
  }>
  auth: Array<{ type: string; token: string }>
  claude_code_next_args?: Record<string, string> | null
  mcp_config?: unknown | null
  environment_variables?: Record<string, string> | null
  

  use_code_sessions?: boolean
}

export type SessionDoneStatus = 'completed' | 'failed' | 'interrupted'

export type SessionActivityType = 'tool_start' | 'text' | 'result' | 'error'

export type SessionActivity = {
  type: SessionActivityType
  summary: string 
  timestamp: number
}

export type SpawnMode = 'single-session' | 'worktree' | 'same-dir'

export type BridgeWorkerType = 'claude_code_next' | 'claude_code_next_assistant'

export type BridgeConfig = {
  dir: string
  machineName: string
  branch: string
  gitRepoUrl: string | null
  maxSessions: number
  spawnMode: SpawnMode
  verbose: boolean
  sandbox: boolean
  
  bridgeId: string
  

  workerType: string
  
  environmentId: string
  

  reuseEnvironmentId?: string
  
  apiBaseUrl: string
  
  sessionIngressUrl: string
  
  debugFile?: string
  
  sessionTimeoutMs?: number
}

export type PermissionResponseEvent = {
  type: 'control_response'
  response: {
    subtype: 'success'
    request_id: string
    response: Record<string, unknown>
  }
}

export type BridgeApiClient = {
  registerBridgeEnvironment(config: BridgeConfig): Promise<{
    environment_id: string
    environment_secret: string
  }>
  pollForWork(
    environmentId: string,
    environmentSecret: string,
    signal?: AbortSignal,
    reclaimOlderThanMs?: number,
  ): Promise<WorkResponse | null>
  acknowledgeWork(
    environmentId: string,
    workId: string,
    sessionToken: string,
  ): Promise<void>
  
  stopWork(environmentId: string, workId: string, force: boolean): Promise<void>
  
  deregisterEnvironment(environmentId: string): Promise<void>
  
  sendPermissionResponseEvent(
    sessionId: string,
    event: PermissionResponseEvent,
    sessionToken: string,
  ): Promise<void>
  
  archiveSession(sessionId: string): Promise<void>
  

  reconnectSession(environmentId: string, sessionId: string): Promise<void>
  

  heartbeatWork(
    environmentId: string,
    workId: string,
    sessionToken: string,
  ): Promise<{ lease_extended: boolean; state: string }>
}

export type SessionHandle = {
  sessionId: string
  done: Promise<SessionDoneStatus>
  kill(): void
  forceKill(): void
  activities: SessionActivity[] 
  currentActivity: SessionActivity | null 
  accessToken: string 
  lastStderr: string[] 
  writeStdin(data: string): void 
  
  updateAccessToken(token: string): void
}

export type SessionSpawnOpts = {
  sessionId: string
  sdkUrl: string
  accessToken: string
  
  useCcrV2?: boolean
  
  workerEpoch?: number
  

  onFirstUserMessage?: (text: string) => void
}

export type SessionSpawner = {
  spawn(opts: SessionSpawnOpts, dir: string): SessionHandle
}

export type BridgeLogger = {
  printBanner(config: BridgeConfig, environmentId: string): void
  logSessionStart(sessionId: string, prompt: string): void
  logSessionComplete(sessionId: string, durationMs: number): void
  logSessionFailed(sessionId: string, error: string): void
  logStatus(message: string): void
  logVerbose(message: string): void
  logError(message: string): void
  
  logReconnected(disconnectedMs: number): void
  
  updateIdleStatus(): void
  
  updateReconnectingStatus(delayStr: string, elapsedStr: string): void
  updateSessionStatus(
    sessionId: string,
    elapsed: string,
    activity: SessionActivity,
    trail: string[],
  ): void
  clearStatus(): void
  
  setRepoInfo(repoName: string, branch: string): void
  
  setDebugLogPath(path: string): void
  
  setAttached(sessionId: string): void
  
  updateFailedStatus(error: string): void
  
  toggleQr(): void
  
  updateSessionCount(active: number, max: number, mode: SpawnMode): void
  
  setSpawnModeDisplay(mode: 'same-dir' | 'worktree' | null): void
  
  addSession(sessionId: string, url: string): void
  
  updateSessionActivity(sessionId: string, activity: SessionActivity): void
  

  setSessionTitle(sessionId: string, title: string): void
  
  removeSession(sessionId: string): void
  
  refreshDisplay(): void
}
