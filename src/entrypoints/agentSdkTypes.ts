

import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js'

export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'

export * from './sdk/coreTypes.js'

export * from './sdk/runtimeTypes.js'

export type { Settings } from './sdk/settingsTypes.generated.js'

export * from './sdk/toolTypes.js'

import type {
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
} from './sdk/coreTypes.js'

import type {
  AnyZodRawShape,
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  InferShape,
  InternalOptions,
  InternalQuery,
  ListSessionsOptions,
  McpSdkServerConfigWithInstance,
  Options,
  Query,
  SDKSession,
  SDKSessionOptions,
  SdkMcpToolDefinition,
  SessionMessage,
  SessionMutationOptions,
} from './sdk/runtimeTypes.js'

export type {
  ListSessionsOptions,
  GetSessionInfoOptions,
  SessionMutationOptions,
  ForkSessionOptions,
  ForkSessionResult,
  SDKSessionInfo,
}

export function tool<Schema extends AnyZodRawShape>(
  _name: string,
  _description: string,
  _inputSchema: Schema,
  _handler: (
    args: InferShape<Schema>,
    extra: unknown,
  ) => Promise<CallToolResult>,
  _extras?: {
    annotations?: ToolAnnotations
    searchHint?: string
    alwaysLoad?: boolean
  },
): SdkMcpToolDefinition<Schema> {
  throw new Error('not implemented')
}

type CreateSdkMcpServerOptions = {
  name: string
  version?: string
  
  tools?: Array<SdkMcpToolDefinition<any>>
}

export function createSdkMcpServer(
  _options: CreateSdkMcpServerOptions,
): McpSdkServerConfigWithInstance {
  throw new Error('not implemented')
}

export class AbortError extends Error {}

export function query(_params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: InternalOptions
}): InternalQuery
export function query(_params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query
export function query(): Query {
  throw new Error('query is not implemented in the SDK')
}

export function unstable_v2_createSession(
  _options: SDKSessionOptions,
): SDKSession {
  throw new Error('unstable_v2_createSession is not implemented in the SDK')
}

export function unstable_v2_resumeSession(
  _sessionId: string,
  _options: SDKSessionOptions,
): SDKSession {
  throw new Error('unstable_v2_resumeSession is not implemented in the SDK')
}

export async function unstable_v2_prompt(
  _message: string,
  _options: SDKSessionOptions,
): Promise<SDKResultMessage> {
  throw new Error('unstable_v2_prompt is not implemented in the SDK')
}

export async function getSessionMessages(
  _sessionId: string,
  _options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  throw new Error('getSessionMessages is not implemented in the SDK')
}

export async function listSessions(
  _options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]> {
  throw new Error('listSessions is not implemented in the SDK')
}

export async function getSessionInfo(
  _sessionId: string,
  _options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  throw new Error('getSessionInfo is not implemented in the SDK')
}

export async function renameSession(
  _sessionId: string,
  _title: string,
  _options?: SessionMutationOptions,
): Promise<void> {
  throw new Error('renameSession is not implemented in the SDK')
}

export async function tagSession(
  _sessionId: string,
  _tag: string | null,
  _options?: SessionMutationOptions,
): Promise<void> {
  throw new Error('tagSession is not implemented in the SDK')
}

export async function forkSession(
  _sessionId: string,
  _options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  throw new Error('forkSession is not implemented in the SDK')
}

export type CronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
}

export type CronJitterConfig = {
  recurringFrac: number
  recurringCapMs: number
  oneShotMaxMs: number
  oneShotFloorMs: number
  oneShotMinuteMod: number
  recurringMaxAgeMs: number
}

export type ScheduledTaskEvent =
  | { type: 'fire'; task: CronTask }
  | { type: 'missed'; tasks: CronTask[] }

export type ScheduledTasksHandle = {
  
  events(): AsyncGenerator<ScheduledTaskEvent>
  

  getNextFireTime(): number | null
}

export function watchScheduledTasks(_opts: {
  dir: string
  signal: AbortSignal
  getJitterConfig?: () => CronJitterConfig
}): ScheduledTasksHandle {
  throw new Error('not implemented')
}

export function buildMissedTaskNotification(_missed: CronTask[]): string {
  throw new Error('not implemented')
}

export type InboundPrompt = {
  content: string | unknown[]
  uuid?: string
}

export type ConnectRemoteControlOptions = {
  dir: string
  name?: string
  workerType?: string
  branch?: string
  gitRepoUrl?: string | null
  getAccessToken: () => string | undefined
  baseUrl: string
  orgUUID: string
  model: string
}

export type RemoteControlHandle = {
  sessionUrl: string
  environmentId: string
  bridgeSessionId: string
  write(msg: SDKMessage): void
  sendResult(): void
  sendControlRequest(req: unknown): void
  sendControlResponse(res: unknown): void
  sendControlCancelRequest(requestId: string): void
  inboundPrompts(): AsyncGenerator<InboundPrompt>
  controlRequests(): AsyncGenerator<unknown>
  permissionResponses(): AsyncGenerator<unknown>
  onStateChange(
    cb: (
      state: 'ready' | 'connected' | 'reconnecting' | 'failed',
      detail?: string,
    ) => void,
  ): void
  teardown(): Promise<void>
}

export async function connectRemoteControl(
  _opts: ConnectRemoteControlOptions,
): Promise<RemoteControlHandle | null> {
  throw new Error('not implemented')
}
