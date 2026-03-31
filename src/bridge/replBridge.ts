
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
  /**
   * Returns a policy verdict so this module can emit an error control_response
   * without importing the policy checks itself (bootstrap-isolation constraint).
   * The callback must guard `auto` (isAutoModeGateEnabled) and
   * `bypassPermissions` (isBypassPermissionsModeDisabled AND
   * isBypassPermissionsModeAvailable) BEFORE calling transitionPermissionMode —
   * that function's internal auto-gate check is a defensive throw, not a
   * graceful guard, and its side-effect order is setAutoModeActive(true) then
   * throw, which corrupts the 3-way invariant documented in src/CLAUDE.md if
   * the callback lets the throw escape here.
   */
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  /**
   * Fires on each real user message to flow through writeMessages() until
   * the callback returns true (done). Mirrors remoteBridgeCore.ts's
   * onUserMessage so the REPL bridge can derive a session title from early
   * prompts when none was set at init time (e.g. user runs /remote-control
   * on an empty conversation, then types). Tool-result wrappers, meta
   * messages, and display-tag-only messages are skipped. Receives
   * currentSessionId so the wrapper can PATCH the title without a closure
   * dance to reach the not-yet-returned handle. The caller owns the
   * derive-at-count-1-and-3 policy; the transport just keeps calling until
   * told to stop. Not fired for the writeSdkMessages daemon path (daemon
   * sets its own title at init). Distinct from SessionSpawnOpts's
   * onFirstUserMessage (spawn-bridge, PR #21250), which stays fire-once.
   */
  onUserMessage?: (text: string, sessionId: string) => boolean
  /** See InitBridgeOptions.perpetual. */
  perpetual?: boolean
  /**
   * Seeds lastTransportSequenceNum — the SSE event-stream high-water mark
   * that's carried across transport swaps within one process. Daemon callers
   * pass the value they persisted at shutdown so the FIRST SSE connect of a
   * fresh process sends from_sequence_num and the server doesn't replay full
   * history. REPL callers omit (fresh session each run → 0 is correct).
   */
  initialSSESequenceNum?: number
}

/**
 * Superset of ReplBridgeHandle. Adds getSSESequenceNum for daemon callers
 * that persist the SSE seq-num across process restarts and pass it back as
 * initialSSESequenceNum on the next start.
 */
export type BridgeCoreHandle = ReplBridgeHandle & {
  /**
   * Current SSE sequence-number high-water mark. Updates as transports
   * swap. Daemon callers persist this on shutdown and pass it back as
   * initialSSESequenceNum on next start.
   */
  getSSESequenceNum(): number
}

/**
 * Poll error recovery constants. When the work poll starts failing (e.g.
 * server 500s), we use exponential backoff and give up after this timeout.
 * This is deliberately long — the server is the authority on when a session
 * is truly dead. As long as the server accepts our poll, we keep waiting
 * for it to re-dispatch the work item.
 */
const POLL_ERROR_INITIAL_DELAY_MS = 2_000
const POLL_ERROR_MAX_DELAY_MS = 60_000
const POLL_ERROR_GIVE_UP_MS = 15 * 60 * 1000

// Monotonically increasing counter for distinguishing init calls in logs
let initSequence = 0

/**
 * Bootstrap-free core: env registration → session creation → poll loop →
 * ingress WS → teardown. Reads nothing from bootstrap/state or
 * sessionStorage — all context comes from params. Caller (initReplBridge
 * below, or a daemon in PR 4) has already passed entitlement gates and
 * gathered git/auth/title.
 *
 * Returns null on registration or session-creation failure.
 */
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

  // bridgePointer import hoisted: perpetual mode reads it before register;
  // non-perpetual writes it after session create; both use clear at teardown.
  const { writeBridgePointer, clearBridgePointer, readBridgePointer } =
    await import('./bridgePointer.js')

  // Perpetual mode: read the crash-recovery pointer and treat it as prior
  // state. The pointer is written unconditionally after session create
  // (crash-recovery for all sessions); perpetual mode just skips the
  // teardown clear so it survives clean exits too. Only reuse 'repl'
  // pointers — a crashed standalone bridge (`claude remote-control`)
  // writes source:'standalone' with a different workerType.
  const rawPrior = perpetual ? await readBridgePointer(dir) : null
  const prior = rawPrior?.source === 'repl' ? rawPrior : null

  logForDebugging(
    `[bridge:repl] initBridgeCore #${seq} starting (initialMessages=${initialMessages?.length ?? 0}${prior ? ` perpetual prior=env:${prior.environmentId}` : ''})`,
  )

  // 5. Register bridge environment
  const rawApi = createBridgeApiClient({
    baseUrl,
    getAccessToken,
    runnerVersion: MACRO.VERSION,
    onDebug: logForDebugging,
    onAuth401,
    getTrustedDeviceToken,
  })
  // Ant-only: interpose so /bridge-kick can inject poll/register/heartbeat
  // failures. Zero cost in external builds (rawApi passes through unchanged).
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
    // Stale pointer may be the cause (expired/deleted env) — clear it so
    // the next start doesn't retry the same dead ID.
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
    // The pointer stores what createBridgeSession returned (session_*,
    // compat/convert.go:41). /bridge/reconnect is an environments-layer
    
    
    
    
    
    
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

  // Perpetual init: env is alive but has no queued work after clean
  
  
  // here the env is alive but idle.
  const reusedPriorSession = prior
    ? await tryReconnectInPlace(prior.environmentId, prior.sessionId)
    : false
  if (prior && !reusedPriorSession) {
    await clearBridgePointer(dir)
  }

  // 6. Create session on the bridge. Initial messages are NOT included as
  
  
  // initial messages are flushed via the ingress WebSocket once it connects.

  
  
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

  // Crash-recovery pointer: written now so a kill -9 at any point after
  
  
  
  
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

  // Bounded ring buffer of UUIDs for messages we've already sent to the
  // server via the ingress WebSocket. Serves two purposes:
  //  1. Echo filtering — ignore our own messages bouncing back on the WS.
  //  2. Secondary dedup in writeMessages — catch race conditions where
  //     the hook's index-based tracking isn't sufficient.
  //
  // Seeded with initialMessageUUIDs so that when the server echoes back
  // the initial conversation context over the ingress WebSocket, those
  // messages are recognized as echoes and not re-injected into the REPL.
  //
  // Capacity of 2000 covers well over any realistic echo window (echoes
  // arrive within milliseconds) and any messages that might be re-encountered
  // after compaction. The hook's lastWrittenIndexRef is the primary dedup;
  // this is a safety net.
  const recentPostedUUIDs = new BoundedUUIDSet(2000)
  for (const uuid of initialMessageUUIDs) {
    recentPostedUUIDs.add(uuid)
  }

  // Bounded set of INBOUND prompt UUIDs we've already forwarded to the REPL.
  // Defensive dedup for when the server re-delivers prompts (seq-num
  // negotiation failure, server edge cases, transport swap races). The
  // seq-num carryover below is the primary fix; this is the safety net.
  const recentInboundUUIDs = new BoundedUUIDSet(2000)

  // 7. Start poll loop for work items — this is what makes the session
  // "live" on claude.ai. When a user types there, the backend dispatches
  // a work item to our environment. We poll for it, get the ingress token,
  // and connect the ingress WebSocket.
  //
  // The poll loop keeps running: when work arrives it connects the ingress
  // WebSocket, and if the WebSocket drops unexpectedly (code != 1000) it
  // resumes polling to get a fresh ingress token and reconnect.
  const pollController = new AbortController()
  // Adapter over either HybridTransport (v1: WS reads + POST writes to
  // Session-Ingress) or SSETransport+CCRClient (v2: SSE reads + POST
  // writes to CCR /worker/*). The v1/v2 choice is made in onWorkReceived:
  // server-driven via secret.use_code_sessions, with CLAUDE_BRIDGE_USE_CCR_V2
  // as an ant-dev override.
  let transport: ReplBridgeTransport | null = null
  // Bumped on every onWorkReceived. Captured in createV2ReplTransport's .then()
  
  
  
  
  
  let v2Generation = 0
  
  
  
  
  
  
  
  
  
  
  
  let lastTransportSequenceNum = reusedPriorSession ? initialSSESequenceNum : 0
  
  let currentWorkId: string | null = null
  
  let currentIngressToken: string | null = null
  
  // so the poll loop immediately switches back to fast polling for new work.
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

    // Close the stale transport. Capture seq BEFORE close — if Strategy 1
    
    
    
    if (transport) {
      const seq = transport.getLastSequenceNum()
      if (seq > lastTransportSequenceNum) {
        lastTransportSequenceNum = seq
      }
      transport.close()
      transport = null
    }
    // Transport is gone — wake the poll loop out of its at-capacity
    
    wakePollLoop()
    
    
    flushGate.drop()

    
    
    if (currentWorkId) {
      const workIdBeingCleared = currentWorkId
      await api
        .stopWork(environmentId, workIdBeingCleared, false)
        .catch(() => {})
      
      
      
      
      
      
      // transport is connected to.
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

    // Bail out if teardown started while we were awaiting
    if (pollController.signal.aborted) {
      logForDebugging('[bridge:repl] Reconnect aborted by teardown')
      return false
    }

    // Strategy 1: idempotent re-register with the server-issued env ID.
    
    
    
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
    // Clear before any await — a stale value would poison the next fresh
    
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

    // Same race as above, narrower window: poll loop may have set up a
    
    
    if (transport !== null) {
      logForDebugging(
        '[bridge:repl] Poll loop recovered during registerBridgeEnvironment await — deferring to it',
      )
      environmentRecreations = 0
      return true
    }

    // Strategy 1: same helper as perpetual init. currentSessionId stays
    
    // previouslyFlushedUUIDs preserved (no re-flush).
    if (await tryReconnectInPlace(requestedEnvId, currentSessionId)) {
      logEvent('tengu_bridge_repl_reconnected_in_place', {})
      environmentRecreations = 0
      return true
    }
    // Env differs → TTL-expired/reaped; or reconnect failed.
    
    if (environmentId !== requestedEnvId) {
      logEvent('tengu_bridge_repl_env_expired_fresh_session', {})
    }

    // Strategy 2: fresh session on the now-registered environment.
    
    // or reconnectSession rejected it). Don't deregister the env — we just
    // got a fresh secret for it and are about to use it.
    await archiveSession(currentSessionId)

    // Bail out if teardown started while we were archiving
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after archive, cleaning up',
      )
      await api.deregisterEnvironment(environmentId).catch(() => {})
      return false
    }

    // Re-read the current title in case the user renamed the session.
    // REPL wrapper reads session storage; daemon wrapper returns the
    // original title (nothing to refresh).
    const currentTitle = getCurrentTitle()

    // Create a new session on the now-registered environment
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

    // Bail out if teardown started during session creation (up to 15s)
    if (pollController.signal.aborted) {
      logForDebugging(
        '[bridge:repl] Reconnect aborted after session creation, cleaning up',
      )
      await archiveSession(newSessionId)
      return false
    }

    currentSessionId = newSessionId
    // Re-publish to the PID file so peer dedup (peerRegistry.ts) picks up the
    // new ID — setReplBridgeHandle only fires at init/teardown, not reconnect.
    void updateSessionBridgeId(toCompatSessionId(newSessionId)).catch(() => {})
    // Reset per-session transport state IMMEDIATELY after the session swap,
    // before any await. If this runs after `await writeBridgePointer` below,
    // there's a window where handle.bridgeSessionId already returns session B
    
    
    // which PASSES the session-ID validation check and defeats it entirely.
    
    
    
    
    
    
    
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

    
    
    // not lifetime total.
    environmentRecreations = 0

    return true
  }

  // Helper: get the current OAuth access token for session ingress auth.
  
  
  function getOAuthToken(): string | undefined {
    return getAccessToken()
  }

  // Drain any messages that were queued during the initial flush.
  
  
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

  // Teardown reference — set after definition below. All callers are async
  
  let doTeardownImpl: (() => Promise<void>) | null = null
  function triggerTeardown(): void {
    void doTeardownImpl?.()
  }

  /**
   * Body of the transport's setOnClose callback, hoisted to initBridgeCore
   * scope so /bridge-kick can fire it directly. setOnClose wraps this with
   * a stale-transport guard; debugFireClose calls it bare.
   *
   * With autoReconnect:true, this only fires on: clean close (1000),
   * permanent server rejection (4001/1002/4003), or 10-min budget
   * exhaustion. Transient drops are retried internally by the transport.
   */
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
    // Transport is gone — wake the poll loop out of its at-capacity
    
    
    wakePollLoop()
    
    
    
    
    
    const dropped = flushGate.drop()
    if (dropped > 0) {
      logForDebugging(
        `[bridge:repl] Dropping ${dropped} pending message(s) on transport close (code=${closeCode})`,
        { level: 'warn' },
      )
    }

    if (closeCode === 1000) {
      // Clean close — session ended normally. Tear down the bridge.
      onStateChange?.('failed', 'session ended')
      pollController.abort()
      triggerTeardown()
      return
    }

    // Transport reconnect budget exhausted or permanent server
    
    
    
    
    
    
    
    
    onStateChange?.(
      'reconnecting',
      `Remote Control connection lost (code ${closeCode})`,
    )
    logForDebugging(
      `[bridge:repl] Transport reconnect budget exhausted (code=${closeCode}), attempting env reconnect`,
    )
    void reconnectEnvironmentWithSession().then(success => {
      if (success) return
      // doReconnect has four abort-check return-false sites for
      
      
      if (pollController.signal.aborted) return
      // doReconnect returns false (never throws) on genuine failure.
      
      
      
      
      
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

  // Ant-only: SIGUSR2 → force doReconnect() for manual testing. Skips the
  
  
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

  // Ant-only: /bridge-kick fault injection. handleTransportPermanentClose
  // is defined below and assigned into this slot so the slash command can
  
  
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
    // REPL bridge is single-session: having any transport == at capacity.
    
    
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
    // Work-item JWT expired (or work gone). The transport is useless —
    
    
    // during which the work lease (300s TTL) expires and the server stops
    
    
    
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
      // When new work arrives while a transport is already open, the
      
      
      
      
      
      
      
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

      
      
      // a mismatch indicates an unexpected server-side reassignment.
      
      
      
      
      
      
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

      
      //
      
      
      
      
      
      
      
      
      
      
      
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
      // Reset flush state — the old flush (if any) is no longer relevant.
      
      // transport's flush completes (the hook has already advanced its
      // lastWrittenIndex and won't re-send them).
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
          // Guard: if transport was replaced by a newer onWorkReceived call
          
          if (transport !== newTransport) return

          logForDebugging('[bridge:repl] Ingress transport connected')
          logEvent('tengu_bridge_repl_ws_connected', {})

          
          
          
          // and overwriting it with OAuth would break subsequent /worker

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
  /** Called when the environment has been deleted. Returns new credentials or null. */
  onEnvironmentLost?: () => Promise<{
    environmentId: string
    environmentSecret: string
  } | null>
  
  getWsState?: () => string
  

  isAtCapacity?: () => boolean
  

  capacitySignal?: () => CapacitySignal
  
  onFatalError?: () => void
  /** Poll interval config getter — defaults to DEFAULT_POLL_CONFIG. */
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
  
  
  
  // which stays true while the transport auto-reconnects, so the poll
  
  
  let suspensionDetected = false

  while (!signal.aborted) {
    // Capture credentials outside try so the catch block can detect
    
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
        // Read-and-clear: after a detected suspension, skip the at-capacity
        
        
        
        const skipAtCapacityOnce = suspensionDetected
        suspensionDetected = false
        if (isAtCapacity?.() && capacitySignal && !skipAtCapacityOnce) {
          const atCapMs = pollConfig.poll_interval_ms_at_capacity
          
          
          
          
          //   - Poll deadline reached (atCapMs > 0 only)
          
          
          
          
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
                  
                  
                  
                  
                  // tear down work state and skip backoff: isAtCapacity()
                  
                  
                  
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
                // bridgeApi throttles empty-poll logs (EMPTY_POLL_LOG_INTERVAL=100)
                
                
                logForDebugging(
                  `[bridge:repl] Heartbeat poll_due after ${hbCycles} cycles — falling through to pollForWork`,
                )
              }
              continue
            }
          }
          // At-capacity sleep — reached by both the legacy path (heartbeat
          
          
          
          
          // else the heartbeat interval as a floor (guaranteed > 0 on the
          
          const sleepMs =
            atCapMs > 0
              ? atCapMs
              : pollConfig.non_exclusive_heartbeat_interval_ms
          if (sleepMs > 0) {
            const cap = capacitySignal()
            const sleepStart = Date.now()
            await sleep(sleepMs, cap.signal)
            cap.cleanup()
            
            
            // SIGSTOP, VM pause) — even a pathological GC pause is seconds,
            // not minutes. Early aborts (wakePollLoop → cap.signal) produce
            
            
            
            
            
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

      // Decode before type dispatch — need the JWT for the explicit ack.
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

      // Explicitly acknowledge to prevent redelivery. Non-fatal on failure:
      // server re-delivers, and the onWorkReceived callback handles dedup.
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
        // If credentials have already been refreshed by a concurrent
        
        
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
          // Credentials are updated in the outer scope via
          
          
          
          
          
          
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

      // Fatal errors (401/403/404/410) — no point retrying
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
        
        // environments:manage permission) — suppress user-visible error
        
        if (!isSuppressible) {
          onStateChange?.(
            'failed',
            isExpiry
              ? 'session expired · /remote-control to reconnect'
              : err.message,
          )
        }
        // Always trigger teardown — matches bridgeMain.ts where fatalExit=true
        
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

      // Give up after continuous failures
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

      // Exponential backoff: 2s → 4s → 8s → 16s → 32s → 60s (cap)
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
            // Best-effort — if heartbeat also fails the lease dies, same as
            
            
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

// Exported for testing only
export {
  startWorkPollLoop as _startWorkPollLoopForTesting,
  POLL_ERROR_INITIAL_DELAY_MS as _POLL_ERROR_INITIAL_DELAY_MS_ForTesting,
  POLL_ERROR_MAX_DELAY_MS as _POLL_ERROR_MAX_DELAY_MS_ForTesting,
  POLL_ERROR_GIVE_UP_MS as _POLL_ERROR_GIVE_UP_MS_ForTesting,
}
