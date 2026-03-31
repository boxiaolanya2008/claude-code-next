
import { randomUUID } from 'crypto'
import {
  createBridgeApiClient,
  BridgeFatalError,
  isExpiredErrorType,
  isSuppressible403,
} from './bridgeApi.js'
import type { BridgeConfig, BridgeApiClient } from './types.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import {
  handleIngressMessage,
  handleServerControlRequest,
  makeResultMessage,
  isEligibleBridgeMessage,
  extractTitleText,
  BoundedUUIDSet,
} from './bridgeMessaging.js'
import {
  decodeWorkSecret,
  buildSdkUrl,
  buildCCRv2SdkUrl,
  sameSessionId,
} from './workSecret.js'
import { toCompatSessionId, toInfraSessionId } from './sessionIdCompat.js'
import { updateSessionBridgeId } from '../utils/concurrentSessions.js'
import { getTrustedDeviceToken } from './trustedDevice.js'
import { HybridTransport } from '../cli/transports/HybridTransport.js'
import {
  type ReplBridgeTransport,
  createV1ReplTransport,
  createV2ReplTransport,
} from './replBridgeTransport.js'
import { updateSessionIngressAuthToken } from '../utils/sessionIngressAuth.js'
import { isEnvTruthy, isInProtectedNamespace } from '../utils/envUtils.js'
import { validateBridgeId } from './bridgeApi.js'
import {
  describeAxiosError,
  extractHttpStatus,
  logBridgeSkip,
} from './debugUtils.js'
import type { Message } from '../types/message.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import { createCapacityWake, type CapacitySignal } from './capacityWake.js'
import { FlushGate } from './flushGate.js'
import {
  DEFAULT_POLL_CONFIG,
  type PollIntervalConfig,
} from './pollConfigDefaults.js'
import { errorMessage } from '../utils/errors.js'
import { sleep } from '../utils/sleep.js'
import {
  wrapApiForFaultInjection,
  registerBridgeDebugHandle,
  clearBridgeDebugHandle,
  injectBridgeFault,
} from './bridgeDebug.js'

export type ReplBridgeHandle = {
  bridgeSessionId: string
  environmentId: string
  sessionIngressUrl: string
  writeMessages(messages: Message[]): void
  writeSdkMessages(messages: SDKMessage[]): void
  sendControlRequest(request: SDKControlRequest): void
  sendControlResponse(response: SDKControlResponse): void
  sendControlCancelRequest(requestId: string): void
  sendResult(): void
  teardown(): Promise<void>
}

export type BridgeState = 'ready' | 'connected' | 'reconnecting' | 'failed'

export type BridgeCoreParams = {
  dir: string
  machineName: string
  branch: string
  gitRepoUrl: string | null
  title: string
  baseUrl: string
  sessionIngressUrl: string
  

  workerType: string
  getAccessToken: () => string | undefined
  

  createSession: (opts: {
    environmentId: string
    title: string
    gitRepoUrl: string | null
    branch: string
    signal: AbortSignal
  }) => Promise<string | null>
  

  archiveSession: (sessionId: string) => Promise<void>
  

  getCurrentTitle?: () => string
  

  toSDKMessages?: (messages: Message[]) => SDKMessage[]
  

  onAuth401?: (staleAccessToken: string) => Promise<boolean>
  

  getPollIntervalConfig?: () => PollIntervalConfig
  

  initialHistoryCap?: number
  
  initialMessages?: Message[]
  previouslyFlushedUUIDs?: Set<string>
  onInboundMessage?: (msg: SDKMessage) => void
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  

  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  

  onUserMessage?: (text: string, sessionId: string) => boolean
  
  perpetual?: boolean
  

  initialSSESequenceNum?: number
}

export type BridgeCoreHandle = ReplBridgeHandle & {
  

  getSSESequenceNum(): number
}

const POLL_ERROR_INITIAL_DELAY_MS = 2_000
const POLL_ERROR_MAX_DELAY_MS = 60_000
const POLL_ERROR_GIVE_UP_MS = 15 * 60 * 1000

let initSequence = 0

export async function initBridgeCore(
  params: BridgeCoreParams,
): Promise<BridgeCoreHandle | null> {
  const {
    dir,
    machineName,
    branch,
    gitRepoUrl,
    title,
    baseUrl,
    sessionIngressUrl,
    workerType,
    getAccessToken,
    createSession,
    archiveSession,
    getCurrentTitle = () => title,
    toSDKMessages = () => {
      throw new Error(
        'BridgeCoreParams.toSDKMessages not provided. Pass it if you use writeMessages() or initialMessages — daemon callers that only use writeSdkMessages() never hit this path.',
      )
    },
    onAuth401,
    getPollIntervalConfig = () => DEFAULT_POLL_CONFIG,
    initialHistoryCap = 200,
    initialMessages,
    previouslyFlushedUUIDs,
    onInboundMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    onUserMessage,
    perpetual,
    initialSSESequenceNum = 0,
  } = params

  const seq = ++initSequence

  
  
  const { writeBridgePointer, clearBridgePointer, readBridgePointer } =
    await import('./bridgePointer.js')

  
  
  
  
  
  
  const rawPrior = perpetual ? await readBridgePointer(dir) : null
  const prior = rawPrior?.source === 'repl' ? rawPrior : null

  logForDebugging(
    `[bridge:repl] initBridgeCore #${seq} starting (initialMessages=${initialMessages?.length ?? 0}${prior ? ` perpetual prior=env:${prior.environmentId}` : ''})`,
  )

  
  const rawApi = createBridgeApiClient({
    baseUrl,
    getAccessToken,
    runnerVersion: MACRO.VERSION,
    onDebug: logForDebugging,
    onAuth401,
    getTrustedDeviceToken,
  })
  
  
  const api =
    process.env.USER_TYPE === 'ant' ? wrapApiForFaultInjection(rawApi) : rawApi

  const bridgeConfig: BridgeConfig = {
    dir,
    machineName,
    branch,
    gitRepoUrl,
    maxSessions: 1,
    spawnMode: 'single-session',
    verbose: false,
    sandbox: false,
    bridgeId: randomUUID(),
    workerType,
    environmentId: randomUUID(),
    reuseEnvironmentId: prior?.environmentId,
    apiBaseUrl: baseUrl,
    sessionIngressUrl,
  }

  let environmentId: string
  let environmentSecret: string
  try {
    const reg = await api.registerBridgeEnvironment(bridgeConfig)
    environmentId = reg.environment_id
    environmentSecret = reg.environment_secret
  } catch (err) {
    logBridgeSkip(
      'registration_failed',
      `[bridge:repl] Environment registration failed: ${errorMessage(err)}`,
    )
    
    
    if (prior) {
      await clearBridgePointer(dir)
    }
    onStateChange?.('failed', errorMessage(err))
    return null
  }

  logForDebugging(`[bridge:repl] Environment registered: ${environmentId}`)
  logForDiagnosticsNoPII('info', 'bridge_repl_env_registered')
  logEvent('tengu_bridge_repl_env_registered', {})

  

  async function tryReconnectInPlace(
    requestedEnvId: string,
    sessionId: string,
  ): Promise<boolean> {
    if (environmentId !== requestedEnvId) {
      logForDebugging(
        `[bridge:repl] Env mismatch (requested ${requestedEnvId}, got ${environmentId}) — cannot reconnect in place`,
      )
      return false
    }
    
    
    
    
    
    
    
    
    const infraId = toInfraSessionId(sessionId)
    const candidates =
      infraId === sessionId ? [sessionId] : [sessionId, infraId]
    for (const id of candidates) {
      try {
        await api.reconnectSession(environmentId, id)
        logForDebugging(
          `[bridge:repl] Reconnected session ${id} in place on env ${environmentId}`,
        )
        return true
      } catch (err) {
        logForDebugging(
          `[bridge:repl] reconnectSession(${id}) failed: ${errorMessage(err)}`,
        )
      }
    }
    logForDebugging(
      '[bridge:repl] reconnectSession exhausted — falling through to fresh session',
    )
    return false
  }

  
  
  
  
  const reusedPriorSession = prior
    ? await tryReconnectInPlace(prior.environmentId, prior.sessionId)
    : false
  if (prior && !reusedPriorSession) {
    await clearBridgePointer(dir)
  }

  
  
  
  

  
  
  let currentSessionId: string

  if (reusedPriorSession && prior) {
    currentSessionId = prior.sessionId
    logForDebugging(
      `[bridge:repl] Perpetual session reused: ${currentSessionId}`,
    )
    
    
    
    
    if (initialMessages && previouslyFlushedUUIDs) {
      for (const msg of initialMessages) {
        previouslyFlushedUUIDs.add(msg.uuid)
      }
    }
  } else {
    const createdSessionId = await createSession({
      environmentId,
      title,
      gitRepoUrl,
      branch,
      signal: AbortSignal.timeout(15_000),
    })

    if (!createdSessionId) {
      logForDebugging(
        '[bridge:repl] Session creation failed, deregistering environment',
      )
      logEvent('tengu_bridge_repl_session_failed', {})
      await api.deregisterEnvironment(environmentId).catch(() => {})
      onStateChange?.('failed', 'Session creation failed')
      return null
    }

    currentSessionId = createdSessionId
    logForDebugging(`[bridge:repl] Session created: ${currentSessionId}`)
  }

  
  
  
  
  
  await writeBridgePointer(dir, {
    sessionId: currentSessionId,
    environmentId,
    source: 'repl',
  })
  logForDiagnosticsNoPII('info', 'bridge_repl_session_created')
  logEvent('tengu_bridge_repl_started', {
    has_initial_messages: !!(initialMessages && initialMessages.length > 0),
    inProtectedNamespace: isInProtectedNamespace(),
  })

  
  
  const initialMessageUUIDs = new Set<string>()
  if (initialMessages) {
    for (const msg of initialMessages) {
      initialMessageUUIDs.add(msg.uuid)
    }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const recentPostedUUIDs = new BoundedUUIDSet(2000)
  for (const uuid of initialMessageUUIDs) {
    recentPostedUUIDs.add(uuid)
  }

  
  
  
  
  const recentInboundUUIDs = new BoundedUUIDSet(2000)

  
  
  
  
  
  
  
  
  const pollController = new AbortController()
  
  
  
  
  
  let transport: ReplBridgeTransport | null = null
  
  
  
  
  
  
  let v2Generation = 0
  
  
  
  
  
  
  
  
  
  
  
  let lastTransportSequenceNum = reusedPriorSession ? initialSSESequenceNum : 0
  
  let currentWorkId: string | null = null
  
  let currentIngressToken: string | null = null
  
  
  const capacityWake = createCapacityWake(pollController.signal)
  const wakePollLoop = capacityWake.wake
  const capacitySignal = capacityWake.signal
  
  
  const flushGate = new FlushGate<Message>()

  
  
  
  let userMessageCallbackDone = !onUserMessage

  
  
  const MAX_ENVIRONMENT_RECREATIONS = 3
  let environmentRecreations = 0
  let reconnectPromise: Promise<boolean> | null = null

  

  async function reconnectEnvironmentWithSession(): Promise<boolean> {
    if (reconnectPromise) {
      return reconnectPromise
    }
    reconnectPromise = doReconnect()
    try {
      return await reconnectPromise
    } finally {
      reconnectPromise = null
    }
  }

  async function doReconnect(): Promise<boolean> {
    environmentRecreations++
    
    
    
    v2Generation++
    logForDebugging(
      `[bridge:repl] Reconnecting after env lost (attempt ${environmentRecreations}/${MAX_ENVIRONMENT_RECREATIONS})`,
    )

    if (environmentRecreations > MAX_ENVIRONMENT_RECREATIONS) {
      logForDebugging(
        `[bridge:repl] Environment reconnect limit reached (${MAX_ENVIRONMENT_RECREATIONS}), giving up`,
      )
      return false
    }

    
    
    
    
    if (transport) {
      const seq = transport.getLastSequenceNum()
      if (seq > lastTransportSequenceNum) {
        lastTransportSequenceNum = seq
      }
      transport.close()
      transport = null
    }
    
    
    wakePollLoop()
    
    
    flushGate.drop()

    
    
    if (currentWorkId) {
      const workIdBeingCleared = currentWorkId
      await api
        .stopWork(environmentId, workIdBeingCleared, false)
        .catch(() => {})
      
      
      
      
      
      
      
      if (currentWorkId !== workIdBeingCleared) {
        logForDebugging(
          '[bridge:repl] Poll loop recovered during stopWork await — deferring to it',
        )
        environmentRecreations = 0
        return true
      }
      currentWorkId = null
      currentIngressToken = null
    }

    
    if (pollController.signal.aborted) {
      logForDebugging('[bridge:repl] Reconnect aborted by teardown')
      return false
    }

    
    
    
    
    const requestedEnvId = environmentId
    bridgeConfig.reuseEnvironmentId = requestedEnvId
    try {
      const reg = await api.registerBridgeEnvironment(bridgeConfig)
      environmentId = reg.environment_id
      environmentSecret = reg.environment_secret
    } catch (err) {
      bridgeConfig.reuseEnvironmentId = undefined
      logForDebugging(
        `[bridge:repl] Environment re-registration failed: ${errorMessage(err)}`,
      )
      return false
    }
    
    
    bridgeConfig.reuseEnvironmentId = undefined

    logForDebugging(
      `[bridge:repl] Re-registered: requested=${requestedEnvId} got=${environmentId}`,
    )

    
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after env registration, cleaning up',
      )
      await api.deregisterEnvironment(environmentId).catch(() => {})
      return false
    }

    
    
    
    if (transport !== null) {
      logForDebugging(
        '[bridge:repl] Poll loop recovered during registerBridgeEnvironment await — deferring to it',
      )
      environmentRecreations = 0
      return true
    }

    
    
    
    if (await tryReconnectInPlace(requestedEnvId, currentSessionId)) {
      logEvent('tengu_bridge_repl_reconnected_in_place', {})
      environmentRecreations = 0
      return true
    }
    
    
    if (environmentId !== requestedEnvId) {
      logEvent('tengu_bridge_repl_env_expired_fresh_session', {})
    }

    
    
    
    
    await archiveSession(currentSessionId)

    
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after archive, cleaning up',
      )
      await api.deregisterEnvironment(environmentId).catch(() => {})
      return false
    }

    
    
    
    const currentTitle = getCurrentTitle()

    
    const newSessionId = await createSession({
      environmentId,
      title: currentTitle,
      gitRepoUrl,
      branch,
      signal: AbortSignal.timeout(15_000),
    })

    if (!newSessionId) {
      logForDebugging(
        '[bridge:repl] Session creation failed during reconnection',
      )
      return false
    }

    
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after session creation, cleaning up',
      )
      await archiveSession(newSessionId)
      return false
    }

    currentSessionId = newSessionId
    
    
    void updateSessionBridgeId(toCompatSessionId(newSessionId)).catch(() => {})
    
    
    
    
    
    
    
    
    
    
    
    
    
    lastTransportSequenceNum = 0
    recentInboundUUIDs.clear()
    
    
    
    
    
    
    userMessageCallbackDone = !onUserMessage
    logForDebugging(`[bridge:repl] Re-created session: ${currentSessionId}`)

    
    
    
    await writeBridgePointer(dir, {
      sessionId: currentSessionId,
      environmentId,
      source: 'repl',
    })

    
    
    previouslyFlushedUUIDs?.clear()

    
    
    
    environmentRecreations = 0

    return true
  }

  
  
  
  function getOAuthToken(): string | undefined {
    return getAccessToken()
  }

  
  
  
  function drainFlushGate(): void {
    const msgs = flushGate.end()
    if (msgs.length === 0) return
    if (!transport) {
      logForDebugging(
        `[bridge:repl] Cannot drain ${msgs.length} pending message(s): no transport`,
      )
      return
    }
    for (const msg of msgs) {
      recentPostedUUIDs.add(msg.uuid)
    }
    const sdkMessages = toSDKMessages(msgs)
    const events = sdkMessages.map(sdkMsg => ({
      ...sdkMsg,
      session_id: currentSessionId,
    }))
    logForDebugging(
      `[bridge:repl] Drained ${msgs.length} pending message(s) after flush`,
    )
    void transport.writeBatch(events)
  }

  
  
  let doTeardownImpl: (() => Promise<void>) | null = null
  function triggerTeardown(): void {
    void doTeardownImpl?.()
  }

  

  function handleTransportPermanentClose(closeCode: number | undefined): void {
    logForDebugging(
      `[bridge:repl] Transport permanently closed: code=${closeCode}`,
    )
    logEvent('tengu_bridge_repl_ws_closed', {
      code: closeCode,
    })
    
    
    
    if (transport) {
      const closedSeq = transport.getLastSequenceNum()
      if (closedSeq > lastTransportSequenceNum) {
        lastTransportSequenceNum = closedSeq
      }
      transport = null
    }
    
    
    
    wakePollLoop()
    
    
    
    
    
    const dropped = flushGate.drop()
    if (dropped > 0) {
      logForDebugging(
        `[bridge:repl] Dropping ${dropped} pending message(s) on transport close (code=${closeCode})`,
        { level: 'warn' },
      )
    }

    if (closeCode === 1000) {
      
      onStateChange?.('failed', 'session ended')
      pollController.abort()
      triggerTeardown()
      return
    }

    
    
    
    
    
    
    
    
    
    onStateChange?.(
      'reconnecting',
      `Remote Control connection lost (code ${closeCode})`,
    )
    logForDebugging(
      `[bridge:repl] Transport reconnect budget exhausted (code=${closeCode}), attempting env reconnect`,
    )
    void reconnectEnvironmentWithSession().then(success => {
      if (success) return
      
      
      
      if (pollController.signal.aborted) return
      
      
      
      
      
      
      logForDebugging(
        '[bridge:repl] reconnectEnvironmentWithSession resolved false — tearing down',
      )
      logEvent('tengu_bridge_repl_reconnect_failed', {
        close_code: closeCode,
      })
      onStateChange?.('failed', 'reconnection failed')
      triggerTeardown()
    })
  }

  
  
  
  let sigusr2Handler: (() => void) | undefined
  if (process.env.USER_TYPE === 'ant' && process.platform !== 'win32') {
    sigusr2Handler = () => {
      logForDebugging(
        '[bridge:repl] SIGUSR2 received — forcing doReconnect() for testing',
      )
      void reconnectEnvironmentWithSession()
    }
    process.on('SIGUSR2', sigusr2Handler)
  }

  
  
  
  
  let debugFireClose: ((code: number) => void) | null = null
  if (process.env.USER_TYPE === 'ant') {
    registerBridgeDebugHandle({
      fireClose: code => {
        if (!debugFireClose) {
          logForDebugging('[bridge:debug] fireClose: no transport wired yet')
          return
        }
        logForDebugging(`[bridge:debug] fireClose(${code}) — injecting`)
        debugFireClose(code)
      },
      forceReconnect: () => {
        logForDebugging('[bridge:debug] forceReconnect — injecting')
        void reconnectEnvironmentWithSession()
      },
      injectFault: injectBridgeFault,
      wakePollLoop,
      describe: () =>
        `env=${environmentId} session=${currentSessionId} transport=${transport?.getStateLabel() ?? 'null'} workId=${currentWorkId ?? 'null'}`,
    })
  }

  const pollOpts = {
    api,
    getCredentials: () => ({ environmentId, environmentSecret }),
    signal: pollController.signal,
    getPollIntervalConfig,
    onStateChange,
    getWsState: () => transport?.getStateLabel() ?? 'null',
    
    
    
    isAtCapacity: () => transport !== null,
    capacitySignal,
    onFatalError: triggerTeardown,
    getHeartbeatInfo: () => {
      if (!currentWorkId || !currentIngressToken) {
        return null
      }
      return {
        environmentId,
        workId: currentWorkId,
        sessionToken: currentIngressToken,
      }
    },
    
    
    
    
    
    
    
    onHeartbeatFatal: (err: BridgeFatalError) => {
      logForDebugging(
        `[bridge:repl] heartbeatWork fatal (status=${err.status}) — tearing down work item for fast re-dispatch`,
      )
      if (transport) {
        const seq = transport.getLastSequenceNum()
        if (seq > lastTransportSequenceNum) {
          lastTransportSequenceNum = seq
        }
        transport.close()
        transport = null
      }
      flushGate.drop()
      
      
      if (currentWorkId) {
        void api
          .stopWork(environmentId, currentWorkId, false)
          .catch((e: unknown) => {
            logForDebugging(
              `[bridge:repl] stopWork after heartbeat fatal: ${errorMessage(e)}`,
            )
          })
      }
      currentWorkId = null
      currentIngressToken = null
      wakePollLoop()
      onStateChange?.(
        'reconnecting',
        'Work item lease expired, fetching fresh token',
      )
    },
    async onEnvironmentLost() {
      const success = await reconnectEnvironmentWithSession()
      if (!success) {
        return null
      }
      return { environmentId, environmentSecret }
    },
    onWorkReceived: (
      workSessionId: string,
      ingressToken: string,
      workId: string,
      serverUseCcrV2: boolean,
    ) => {
      
      
      
      
      
      
      
      
      if (transport?.isConnectedStatus()) {
        logForDebugging(
          `[bridge:repl] Work received while transport connected, replacing with fresh token (workId=${workId})`,
        )
      }

      logForDebugging(
        `[bridge:repl] Work received: workId=${workId} workSessionId=${workSessionId} currentSessionId=${currentSessionId} match=${sameSessionId(workSessionId, currentSessionId)}`,
      )

      
      
      
      
      void writeBridgePointer(dir, {
        sessionId: currentSessionId,
        environmentId,
        source: 'repl',
      })

      
      
      
      
      
      
      
      
      
      if (!sameSessionId(workSessionId, currentSessionId)) {
        logForDebugging(
          `[bridge:repl] Rejecting foreign session: expected=${currentSessionId} got=${workSessionId}`,
        )
        return
      }

      currentWorkId = workId
      currentIngressToken = ingressToken

      
      
      
      
      
      
      
      
      
      const useCcrV2 =
        serverUseCcrV2 || isEnvTruthy(process.env.CLAUDE_BRIDGE_USE_CCR_V2)

      
      
      
      
      
      
      
      
      
      
      
      
      
      let v1OauthToken: string | undefined
      if (!useCcrV2) {
        v1OauthToken = getOAuthToken()
        if (!v1OauthToken) {
          logForDebugging(
            '[bridge:repl] No OAuth token available for session ingress, skipping work',
          )
          return
        }
        updateSessionIngressAuthToken(v1OauthToken)
      }
      logEvent('tengu_bridge_repl_work_received', {})

      
      
      
      if (transport) {
        const oldTransport = transport
        transport = null
        
        
        
        
        const oldSeq = oldTransport.getLastSequenceNum()
        if (oldSeq > lastTransportSequenceNum) {
          lastTransportSequenceNum = oldSeq
        }
        oldTransport.close()
      }
      
      
      
      
      flushGate.deactivate()

      
      
      
      const onServerControlRequest = (request: SDKControlRequest): void =>
        handleServerControlRequest(request, {
          transport,
          sessionId: currentSessionId,
          onInterrupt,
          onSetModel,
          onSetMaxThinkingTokens,
          onSetPermissionMode,
        })

      let initialFlushDone = false

      
      
      
      const wireTransport = (newTransport: ReplBridgeTransport): void => {
        transport = newTransport

        newTransport.setOnConnect(() => {
          
          
          if (transport !== newTransport) return

          logForDebugging('[bridge:repl] Ingress transport connected')
          logEvent('tengu_bridge_repl_ws_connected', {})

          
          
          
          

async function startWorkPollLoop({
  api,
  getCredentials,
  signal,
  onStateChange,
  onWorkReceived,
  onEnvironmentLost,
  getWsState,
  isAtCapacity,
  capacitySignal,
  onFatalError,
  getPollIntervalConfig = () => DEFAULT_POLL_CONFIG,
  getHeartbeatInfo,
  onHeartbeatFatal,
}: {
  api: BridgeApiClient
  getCredentials: () => { environmentId: string; environmentSecret: string }
  signal: AbortSignal
  onStateChange?: (state: BridgeState, detail?: string) => void
  onWorkReceived: (
    sessionId: string,
    ingressToken: string,
    workId: string,
    useCodeSessions: boolean,
  ) => void
  
  onEnvironmentLost?: () => Promise<{
    environmentId: string
    environmentSecret: string
  } | null>
  
  getWsState?: () => string
  

  isAtCapacity?: () => boolean
  

  capacitySignal?: () => CapacitySignal
  
  onFatalError?: () => void
  
  getPollIntervalConfig?: () => PollIntervalConfig
  

  getHeartbeatInfo?: () => {
    environmentId: string
    workId: string
    sessionToken: string
  } | null
  

  onHeartbeatFatal?: (err: BridgeFatalError) => void
}): Promise<void> {
  const MAX_ENVIRONMENT_RECREATIONS = 3

  logForDebugging(
    `[bridge:repl] Starting work poll loop for env=${getCredentials().environmentId}`,
  )

  let consecutiveErrors = 0
  let firstErrorTime: number | null = null
  let lastPollErrorTime: number | null = null
  let environmentRecreations = 0
  
  
  
  
  
  
  let suspensionDetected = false

  while (!signal.aborted) {
    
    
    const { environmentId: envId, environmentSecret: envSecret } =
      getCredentials()
    const pollConfig = getPollIntervalConfig()
    try {
      const work = await api.pollForWork(
        envId,
        envSecret,
        signal,
        pollConfig.reclaim_older_than_ms,
      )

      
      
      
      
      
      
      environmentRecreations = 0

      
      if (consecutiveErrors > 0) {
        logForDebugging(
          `[bridge:repl] Poll recovered after ${consecutiveErrors} consecutive error(s)`,
        )
        consecutiveErrors = 0
        firstErrorTime = null
        lastPollErrorTime = null
        onStateChange?.('ready')
      }

      if (!work) {
        
        
        
        
        const skipAtCapacityOnce = suspensionDetected
        suspensionDetected = false
        if (isAtCapacity?.() && capacitySignal && !skipAtCapacityOnce) {
          const atCapMs = pollConfig.poll_interval_ms_at_capacity
          
          
          
          
          
          
          
          
          
          if (
            pollConfig.non_exclusive_heartbeat_interval_ms > 0 &&
            getHeartbeatInfo
          ) {
            logEvent('tengu_bridge_heartbeat_mode_entered', {
              heartbeat_interval_ms:
                pollConfig.non_exclusive_heartbeat_interval_ms,
            })
            
            
            const pollDeadline = atCapMs > 0 ? Date.now() + atCapMs : null
            let needsBackoff = false
            let hbCycles = 0
            while (
              !signal.aborted &&
              isAtCapacity() &&
              (pollDeadline === null || Date.now() < pollDeadline)
            ) {
              const hbConfig = getPollIntervalConfig()
              if (hbConfig.non_exclusive_heartbeat_interval_ms <= 0) break

              const info = getHeartbeatInfo()
              if (!info) break

              
              
              
              const cap = capacitySignal()

              try {
                await api.heartbeatWork(
                  info.environmentId,
                  info.workId,
                  info.sessionToken,
                )
              } catch (err) {
                logForDebugging(
                  `[bridge:repl:heartbeat] Failed: ${errorMessage(err)}`,
                )
                if (err instanceof BridgeFatalError) {
                  cap.cleanup()
                  logEvent('tengu_bridge_heartbeat_error', {
                    status:
                      err.status as unknown as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                    error_type: (err.status === 401 || err.status === 403
                      ? 'auth_failed'
                      : 'fatal') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  })
                  
                  
                  
                  
                  
                  
                  
                  
                  if (onHeartbeatFatal) {
                    onHeartbeatFatal(err)
                    logForDebugging(
                      `[bridge:repl:heartbeat] Fatal (status=${err.status}), work state cleared — fast-polling for re-dispatch`,
                    )
                  } else {
                    needsBackoff = true
                  }
                  break
                }
              }

              hbCycles++
              await sleep(
                hbConfig.non_exclusive_heartbeat_interval_ms,
                cap.signal,
              )
              cap.cleanup()
            }

            const exitReason = needsBackoff
              ? 'error'
              : signal.aborted
                ? 'shutdown'
                : !isAtCapacity()
                  ? 'capacity_changed'
                  : pollDeadline !== null && Date.now() >= pollDeadline
                    ? 'poll_due'
                    : 'config_disabled'
            logEvent('tengu_bridge_heartbeat_mode_exited', {
              reason:
                exitReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              heartbeat_cycles: hbCycles,
            })

            
            
            
            
            if (!needsBackoff) {
              if (exitReason === 'poll_due') {
                
                
                
                logForDebugging(
                  `[bridge:repl] Heartbeat poll_due after ${hbCycles} cycles — falling through to pollForWork`,
                )
              }
              continue
            }
          }
          
          
          
          
          
          
          
          const sleepMs =
            atCapMs > 0
              ? atCapMs
              : pollConfig.non_exclusive_heartbeat_interval_ms
          if (sleepMs > 0) {
            const cap = capacitySignal()
            const sleepStart = Date.now()
            await sleep(sleepMs, cap.signal)
            cap.cleanup()
            
            
            
            
            
            
            
            
            
            const overrun = Date.now() - sleepStart - sleepMs
            if (overrun > 60_000) {
              logForDebugging(
                `[bridge:repl] At-capacity sleep overran by ${Math.round(overrun / 1000)}s — process suspension detected, forcing one fast-poll cycle`,
              )
              logEvent('tengu_bridge_repl_suspension_detected', {
                overrun_ms: overrun,
              })
              suspensionDetected = true
            }
          }
        } else {
          await sleep(pollConfig.poll_interval_ms_not_at_capacity, signal)
        }
        continue
      }

      
      let secret
      try {
        secret = decodeWorkSecret(work.secret)
      } catch (err) {
        logForDebugging(
          `[bridge:repl] Failed to decode work secret: ${errorMessage(err)}`,
        )
        logEvent('tengu_bridge_repl_work_secret_failed', {})
        
        
        await api.stopWork(envId, work.id, false).catch(() => {})
        continue
      }

      
      
      logForDebugging(`[bridge:repl] Acknowledging workId=${work.id}`)
      try {
        await api.acknowledgeWork(envId, work.id, secret.session_ingress_token)
      } catch (err) {
        logForDebugging(
          `[bridge:repl] Acknowledge failed workId=${work.id}: ${errorMessage(err)}`,
        )
      }

      if (work.data.type === 'healthcheck') {
        logForDebugging('[bridge:repl] Healthcheck received')
        continue
      }

      if (work.data.type === 'session') {
        const workSessionId = work.data.id
        try {
          validateBridgeId(workSessionId, 'session_id')
        } catch {
          logForDebugging(
            `[bridge:repl] Invalid session_id in work: ${workSessionId}`,
          )
          continue
        }

        onWorkReceived(
          workSessionId,
          secret.session_ingress_token,
          work.id,
          secret.use_code_sessions === true,
        )
        logForDebugging('[bridge:repl] Work accepted, continuing poll loop')
      }
    } catch (err) {
      if (signal.aborted) break

      
      
      
      
      
      
      
      
      
      
      if (
        err instanceof BridgeFatalError &&
        err.status === 404 &&
        onEnvironmentLost
      ) {
        
        
        
        const currentEnvId = getCredentials().environmentId
        if (envId !== currentEnvId) {
          logForDebugging(
            `[bridge:repl] Stale poll error for old env=${envId}, current env=${currentEnvId} — skipping onEnvironmentLost`,
          )
          consecutiveErrors = 0
          firstErrorTime = null
          continue
        }

        environmentRecreations++
        logForDebugging(
          `[bridge:repl] Environment deleted, attempting re-registration (attempt ${environmentRecreations}/${MAX_ENVIRONMENT_RECREATIONS})`,
        )
        logEvent('tengu_bridge_repl_env_lost', {
          attempt: environmentRecreations,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)

        if (environmentRecreations > MAX_ENVIRONMENT_RECREATIONS) {
          logForDebugging(
            `[bridge:repl] Environment re-registration limit reached (${MAX_ENVIRONMENT_RECREATIONS}), giving up`,
          )
          onStateChange?.(
            'failed',
            'Environment deleted and re-registration limit reached',
          )
          onFatalError?.()
          break
        }

        onStateChange?.('reconnecting', 'environment lost, recreating session')
        const newCreds = await onEnvironmentLost()
        
        
        
        
        
        if (signal.aborted) break
        if (newCreds) {
          
          
          
          
          
          
          
          consecutiveErrors = 0
          firstErrorTime = null
          onStateChange?.('ready')
          logForDebugging(
            `[bridge:repl] Re-registered environment: ${newCreds.environmentId}`,
          )
          continue
        }

        onStateChange?.(
          'failed',
          'Environment deleted and re-registration failed',
        )
        onFatalError?.()
        break
      }

      
      if (err instanceof BridgeFatalError) {
        const isExpiry = isExpiredErrorType(err.errorType)
        const isSuppressible = isSuppressible403(err)
        logForDebugging(
          `[bridge:repl] Fatal poll error: ${err.message} (status=${err.status}, type=${err.errorType ?? 'unknown'})${isSuppressible ? ' (suppressed)' : ''}`,
        )
        logEvent('tengu_bridge_repl_fatal_error', {
          status: err.status,
          error_type:
            err.errorType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        logForDiagnosticsNoPII(
          isExpiry ? 'info' : 'error',
          'bridge_repl_fatal_error',
          { status: err.status, error_type: err.errorType },
        )
        
        
        
        if (!isSuppressible) {
          onStateChange?.(
            'failed',
            isExpiry
              ? 'session expired · /remote-control to reconnect'
              : err.message,
          )
        }
        
        
        onFatalError?.()
        break
      }

      const now = Date.now()

      
      
      
      
      if (
        lastPollErrorTime !== null &&
        now - lastPollErrorTime > POLL_ERROR_MAX_DELAY_MS * 2
      ) {
        logForDebugging(
          `[bridge:repl] Detected system sleep (${Math.round((now - lastPollErrorTime) / 1000)}s gap), resetting poll error budget`,
        )
        logForDiagnosticsNoPII('info', 'bridge_repl_poll_sleep_detected', {
          gapMs: now - lastPollErrorTime,
        })
        consecutiveErrors = 0
        firstErrorTime = null
      }
      lastPollErrorTime = now

      consecutiveErrors++
      if (firstErrorTime === null) {
        firstErrorTime = now
      }
      const elapsed = now - firstErrorTime
      const httpStatus = extractHttpStatus(err)
      const errMsg = describeAxiosError(err)
      const wsLabel = getWsState?.() ?? 'unknown'

      logForDebugging(
        `[bridge:repl] Poll error (attempt ${consecutiveErrors}, elapsed ${Math.round(elapsed / 1000)}s, ws=${wsLabel}): ${errMsg}`,
      )
      logEvent('tengu_bridge_repl_poll_error', {
        status: httpStatus,
        consecutiveErrors,
        elapsedMs: elapsed,
      } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)

      
      
      if (consecutiveErrors === 1) {
        onStateChange?.('reconnecting', errMsg)
      }

      
      if (elapsed >= POLL_ERROR_GIVE_UP_MS) {
        logForDebugging(
          `[bridge:repl] Poll failures exceeded ${POLL_ERROR_GIVE_UP_MS / 1000}s (${consecutiveErrors} errors), giving up`,
        )
        logForDiagnosticsNoPII('info', 'bridge_repl_poll_give_up')
        logEvent('tengu_bridge_repl_poll_give_up', {
          consecutiveErrors,
          elapsedMs: elapsed,
          lastStatus: httpStatus,
        } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
        onStateChange?.('failed', 'connection to server lost')
        break
      }

      
      const backoff = Math.min(
        POLL_ERROR_INITIAL_DELAY_MS * 2 ** (consecutiveErrors - 1),
        POLL_ERROR_MAX_DELAY_MS,
      )
      
      
      
      
      if (getPollIntervalConfig().non_exclusive_heartbeat_interval_ms > 0) {
        const info = getHeartbeatInfo?.()
        if (info) {
          try {
            await api.heartbeatWork(
              info.environmentId,
              info.workId,
              info.sessionToken,
            )
          } catch {
            
            
            
          }
        }
      }
      await sleep(backoff, signal)
    }
  }

  logForDebugging(
    `[bridge:repl] Work poll loop ended (aborted=${signal.aborted}) env=${getCredentials().environmentId}`,
  )
}

export {
  startWorkPollLoop as _startWorkPollLoopForTesting,
  POLL_ERROR_INITIAL_DELAY_MS as _POLL_ERROR_INITIAL_DELAY_MS_ForTesting,
  POLL_ERROR_MAX_DELAY_MS as _POLL_ERROR_MAX_DELAY_MS_ForTesting,
  POLL_ERROR_GIVE_UP_MS as _POLL_ERROR_GIVE_UP_MS_ForTesting,
}
