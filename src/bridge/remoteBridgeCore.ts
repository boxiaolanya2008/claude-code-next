

import { feature } from "../utils/bundle-mock.ts"
import axios from 'axios'
import {
  createV2ReplTransport,
  type ReplBridgeTransport,
} from './replBridgeTransport.js'
import { buildCCRv2SdkUrl } from './workSecret.js'
import { toCompatSessionId } from './sessionIdCompat.js'
import { FlushGate } from './flushGate.js'
import { createTokenRefreshScheduler } from './jwtUtils.js'
import { getTrustedDeviceToken } from './trustedDevice.js'
import {
  getEnvLessBridgeConfig,
  type EnvLessBridgeConfig,
} from './envLessBridgeConfig.js'
import {
  handleIngressMessage,
  handleServerControlRequest,
  makeResultMessage,
  isEligibleBridgeMessage,
  extractTitleText,
  BoundedUUIDSet,
} from './bridgeMessaging.js'
import { logBridgeSkip } from './debugUtils.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { isInProtectedNamespace } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'
import { sleep } from '../utils/sleep.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { ReplBridgeHandle, BridgeState } from './replBridge.js'
import type { Message } from '../types/message.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'

const ANTHROPIC_VERSION = '2023-06-01'

type ConnectCause = 'initial' | 'proactive_refresh' | 'auth_401_recovery'

function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

export type EnvLessBridgeParams = {
  baseUrl: string
  orgUUID: string
  title: string
  getAccessToken: () => string | undefined
  onAuth401?: (staleAccessToken: string) => Promise<boolean>
  

  toSDKMessages: (messages: Message[]) => SDKMessage[]
  initialHistoryCap: number
  initialMessages?: Message[]
  onInboundMessage?: (msg: SDKMessage) => void | Promise<void>
  

  onUserMessage?: (text: string, sessionId: string) => boolean
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  

  outboundOnly?: boolean
  
  tags?: string[]
}

export async function initEnvLessBridgeCore(
  params: EnvLessBridgeParams,
): Promise<ReplBridgeHandle | null> {
  const {
    baseUrl,
    orgUUID,
    title,
    getAccessToken,
    onAuth401,
    toSDKMessages,
    initialHistoryCap,
    initialMessages,
    onInboundMessage,
    onUserMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onStateChange,
    outboundOnly,
    tags,
  } = params

  const cfg = await getEnvLessBridgeConfig()

  
  const accessToken = getAccessToken()
  if (!accessToken) {
    logForDebugging('[remote-bridge] No OAuth token')
    return null
  }

  const createdSessionId = await withRetry(
    () =>
      createCodeSession(baseUrl, accessToken, title, cfg.http_timeout_ms, tags),
    'createCodeSession',
    cfg,
  )
  if (!createdSessionId) {
    onStateChange?.('failed', 'Session creation failed — see debug log')
    logBridgeSkip('v2_session_create_failed', undefined, true)
    return null
  }
  const sessionId: string = createdSessionId
  logForDebugging(`[remote-bridge] Created session ${sessionId}`)
  logForDiagnosticsNoPII('info', 'bridge_repl_v2_session_created')

  
  const credentials = await withRetry(
    () =>
      fetchRemoteCredentials(
        sessionId,
        baseUrl,
        accessToken,
        cfg.http_timeout_ms,
      ),
    'fetchRemoteCredentials',
    cfg,
  )
  if (!credentials) {
    onStateChange?.('failed', 'Remote credentials fetch failed — see debug log')
    logBridgeSkip('v2_remote_creds_failed', undefined, true)
    void archiveSession(
      sessionId,
      baseUrl,
      accessToken,
      orgUUID,
      cfg.http_timeout_ms,
    )
    return null
  }
  logForDebugging(
    `[remote-bridge] Fetched bridge credentials (expires_in=${credentials.expires_in}s)`,
  )

  
  const sessionUrl = buildCCRv2SdkUrl(credentials.api_base_url, sessionId)
  logForDebugging(`[remote-bridge] v2 session URL: ${sessionUrl}`)

  let transport: ReplBridgeTransport
  try {
    transport = await createV2ReplTransport({
      sessionUrl,
      ingressToken: credentials.worker_jwt,
      sessionId,
      epoch: credentials.worker_epoch,
      heartbeatIntervalMs: cfg.heartbeat_interval_ms,
      heartbeatJitterFraction: cfg.heartbeat_jitter_fraction,
      
      
      
      
      
      getAuthToken: () => credentials.worker_jwt,
      outboundOnly,
    })
  } catch (err) {
    logForDebugging(
      `[remote-bridge] v2 transport setup failed: ${errorMessage(err)}`,
      { level: 'error' },
    )
    onStateChange?.('failed', `Transport setup failed: ${errorMessage(err)}`)
    logBridgeSkip('v2_transport_setup_failed', undefined, true)
    void archiveSession(
      sessionId,
      baseUrl,
      accessToken,
      orgUUID,
      cfg.http_timeout_ms,
    )
    return null
  }
  logForDebugging(
    `[remote-bridge] v2 transport created (epoch=${credentials.worker_epoch})`,
  )
  onStateChange?.('ready')

  

  
  
  
  
  
  const recentPostedUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)
  const initialMessageUUIDs = new Set<string>()
  if (initialMessages) {
    for (const msg of initialMessages) {
      initialMessageUUIDs.add(msg.uuid)
      recentPostedUUIDs.add(msg.uuid)
    }
  }

  
  
  const recentInboundUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)

  
  
  const flushGate = new FlushGate<Message>()

  let initialFlushDone = false
  let tornDown = false
  let authRecoveryInFlight = false
  
  
  
  let userMessageCallbackDone = !onUserMessage

  
  
  
  
  let connectCause: ConnectCause = 'initial'

  
  
  
  
  let connectDeadline: ReturnType<typeof setTimeout> | undefined
  function onConnectTimeout(cause: ConnectCause): void {
    if (tornDown) return
    logEvent('tengu_bridge_repl_connect_timeout', {
      v2: true,
      elapsed_ms: cfg.connect_timeout_ms,
      cause:
        cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  
  
  
  
  
  
  const refresh = createTokenRefreshScheduler({
    refreshBufferMs: cfg.token_refresh_buffer_ms,
    getAccessToken: async () => {
      
      
      
      
      const stale = getAccessToken()
      if (onAuth401) await onAuth401(stale ?? '')
      return getAccessToken() ?? stale
    },
    onRefresh: (sid, oauthToken) => {
      void (async () => {
        
        
        
        
        if (authRecoveryInFlight || tornDown) {
          logForDebugging(
            '[remote-bridge] Recovery already in flight, skipping proactive refresh',
          )
          return
        }
        authRecoveryInFlight = true
        try {
          const fresh = await withRetry(
            () =>
              fetchRemoteCredentials(
                sid,
                baseUrl,
                oauthToken,
                cfg.http_timeout_ms,
              ),
            'fetchRemoteCredentials (proactive)',
            cfg,
          )
          if (!fresh || tornDown) return
          await rebuildTransport(fresh, 'proactive_refresh')
          logForDebugging(
            '[remote-bridge] Transport rebuilt (proactive refresh)',
          )
        } catch (err) {
          logForDebugging(
            `[remote-bridge] Proactive refresh rebuild failed: ${errorMessage(err)}`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII(
            'error',
            'bridge_repl_v2_proactive_refresh_failed',
          )
          if (!tornDown) {
            onStateChange?.('failed', `Refresh failed: ${errorMessage(err)}`)
          }
        } finally {
          authRecoveryInFlight = false
        }
      })()
    },
    label: 'remote',
  })
  refresh.scheduleFromExpiresIn(sessionId, credentials.expires_in)

  
  function wireTransportCallbacks(): void {
    transport.setOnConnect(() => {
      clearTimeout(connectDeadline)
      logForDebugging('[remote-bridge] v2 transport connected')
      logForDiagnosticsNoPII('info', 'bridge_repl_v2_transport_connected')
      logEvent('tengu_bridge_repl_ws_connected', {
        v2: true,
        cause:
          connectCause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })

      if (!initialFlushDone && initialMessages && initialMessages.length > 0) {
        initialFlushDone = true
        
        
        
        const flushTransport = transport
        void flushHistory(initialMessages)
          .catch(e =>
            logForDebugging(`[remote-bridge] flushHistory failed: ${e}`),
          )
          .finally(() => {
            
            
            
            
            
            if (
              transport !== flushTransport ||
              tornDown ||
              authRecoveryInFlight
            ) {
              return
            }
            drainFlushGate()
            onStateChange?.('connected')
          })
      } else if (!flushGate.active) {
        onStateChange?.('connected')
      }
    })

    transport.setOnData((data: string) => {
      handleIngressMessage(
        data,
        recentPostedUUIDs,
        recentInboundUUIDs,
        onInboundMessage,
        
        
        
        onPermissionResponse
          ? res => {
              transport.reportState('running')
              onPermissionResponse(res)
            }
          : undefined,
        req =>
          handleServerControlRequest(req, {
            transport,
            sessionId,
            onInterrupt,
            onSetModel,
            onSetMaxThinkingTokens,
            onSetPermissionMode,
            outboundOnly,
          }),
      )
    })

    transport.setOnClose((code?: number) => {
      clearTimeout(connectDeadline)
      if (tornDown) return
      logForDebugging(`[remote-bridge] v2 transport closed (code=${code})`)
      logEvent('tengu_bridge_repl_ws_closed', { code, v2: true })
      
      
      
      
      
      if (code === 401 && !authRecoveryInFlight) {
        void recoverFromAuthFailure()
        return
      }
      onStateChange?.('failed', `Transport closed (code ${code})`)
    })
  }

  
  
  
  
  
  
  
  
  
  async function rebuildTransport(
    fresh: RemoteCredentials,
    cause: Exclude<ConnectCause, 'initial'>,
  ): Promise<void> {
    connectCause = cause
    
    
    
    
    flushGate.start()
    try {
      const seq = transport.getLastSequenceNum()
      transport.close()
      transport = await createV2ReplTransport({
        sessionUrl: buildCCRv2SdkUrl(fresh.api_base_url, sessionId),
        ingressToken: fresh.worker_jwt,
        sessionId,
        epoch: fresh.worker_epoch,
        heartbeatIntervalMs: cfg.heartbeat_interval_ms,
        heartbeatJitterFraction: cfg.heartbeat_jitter_fraction,
        initialSequenceNum: seq,
        getAuthToken: () => fresh.worker_jwt,
        outboundOnly,
      })
      if (tornDown) {
        
        
        
        transport.close()
        return
      }
      wireTransportCallbacks()
      transport.connect()
      connectDeadline = setTimeout(
        onConnectTimeout,
        cfg.connect_timeout_ms,
        connectCause,
      )
      refresh.scheduleFromExpiresIn(sessionId, fresh.expires_in)
      
      
      
      
      
      drainFlushGate()
    } finally {
      
      
      flushGate.drop()
    }
  }

  
  async function recoverFromAuthFailure(): Promise<void> {
    
    
    
    if (authRecoveryInFlight) return
    authRecoveryInFlight = true
    onStateChange?.('reconnecting', 'JWT expired — refreshing')
    logForDebugging('[remote-bridge] 401 on SSE — attempting JWT refresh')
    try {
      
      
      
      
      const stale = getAccessToken()
      if (onAuth401) await onAuth401(stale ?? '')
      const oauthToken = getAccessToken() ?? stale
      if (!oauthToken || tornDown) {
        if (!tornDown) {
          onStateChange?.('failed', 'JWT refresh failed: no OAuth token')
        }
        return
      }

      const fresh = await withRetry(
        () =>
          fetchRemoteCredentials(
            sessionId,
            baseUrl,
            oauthToken,
            cfg.http_timeout_ms,
          ),
        'fetchRemoteCredentials (recovery)',
        cfg,
      )
      if (!fresh || tornDown) {
        if (!tornDown) {
          onStateChange?.('failed', 'JWT refresh failed after 401')
        }
        return
      }
      
      
      
      
      
      initialFlushDone = false
      await rebuildTransport(fresh, 'auth_401_recovery')
      logForDebugging('[remote-bridge] Transport rebuilt after 401')
    } catch (err) {
      logForDebugging(
        `[remote-bridge] 401 recovery failed: ${errorMessage(err)}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'bridge_repl_v2_jwt_refresh_failed')
      if (!tornDown) {
        onStateChange?.('failed', `JWT refresh failed: ${errorMessage(err)}`)
      }
    } finally {
      authRecoveryInFlight = false
    }
  }

  wireTransportCallbacks()

  
  
  if (initialMessages && initialMessages.length > 0) {
    flushGate.start()
  }
  transport.connect()
  connectDeadline = setTimeout(
    onConnectTimeout,
    cfg.connect_timeout_ms,
    connectCause,
  )

  
  function drainFlushGate(): void {
    const msgs = flushGate.end()
    if (msgs.length === 0) return
    for (const msg of msgs) recentPostedUUIDs.add(msg.uuid)
    const events = toSDKMessages(msgs).map(m => ({
      ...m,
      session_id: sessionId,
    }))
    if (msgs.some(m => m.type === 'user')) {
      transport.reportState('running')
    }
    logForDebugging(
      `[remote-bridge] Drained ${msgs.length} queued message(s) after flush`,
    )
    void transport.writeBatch(events)
  }

  async function flushHistory(msgs: Message[]): Promise<void> {
    
    
    
    
    const eligible = msgs.filter(isEligibleBridgeMessage)
    const capped =
      initialHistoryCap > 0 && eligible.length > initialHistoryCap
        ? eligible.slice(-initialHistoryCap)
        : eligible
    if (capped.length < eligible.length) {
      logForDebugging(
        `[remote-bridge] Capped initial flush: ${eligible.length} -> ${capped.length} (cap=${initialHistoryCap})`,
      )
    }
    const events = toSDKMessages(capped).map(m => ({
      ...m,
      session_id: sessionId,
    }))
    if (events.length === 0) return
    
    
    
    
    
    
    
    if (eligible.at(-1)?.type === 'user') {
      transport.reportState('running')
    }
    logForDebugging(`[remote-bridge] Flushing ${events.length} history events`)
    await transport.writeBatch(events)
  }

  
  
  
  
  
  
  async function teardown(): Promise<void> {
    if (tornDown) return
    tornDown = true
    refresh.cancelAll()
    clearTimeout(connectDeadline)
    flushGate.drop()

    
    
    
    
    
    
    transport.reportState('idle')
    void transport.write(makeResultMessage(sessionId))

    let token = getAccessToken()
    let status = await archiveSession(
      sessionId,
      baseUrl,
      token,
      orgUUID,
      cfg.teardown_archive_timeout_ms,
    )

    
    
    
    
    
    
    
    
    if (status === 401 && onAuth401) {
      try {
        await onAuth401(token ?? '')
        token = getAccessToken()
        status = await archiveSession(
          sessionId,
          baseUrl,
          token,
          orgUUID,
          cfg.teardown_archive_timeout_ms,
        )
      } catch (err) {
        logForDebugging(
          `[remote-bridge] Teardown 401 retry threw: ${errorMessage(err)}`,
          { level: 'error' },
        )
      }
    }

    transport.close()

    const archiveStatus: ArchiveTelemetryStatus =
      status === 'no_token'
        ? 'skipped_no_token'
        : status === 'timeout' || status === 'error'
          ? 'network_error'
          : status >= 500
            ? 'server_5xx'
            : status >= 400
              ? 'server_4xx'
              : 'ok'

    logForDebugging(`[remote-bridge] Torn down (archive=${status})`)
    logForDiagnosticsNoPII('info', 'bridge_repl_v2_teardown')
    logEvent(
      feature('CCR_MIRROR') && outboundOnly
        ? 'tengu_ccr_mirror_teardown'
        : 'tengu_bridge_repl_teardown',
      {
        v2: true,
        archive_status:
          archiveStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        archive_ok: typeof status === 'number' && status < 400,
        archive_http_status: typeof status === 'number' ? status : undefined,
        archive_timeout: status === 'timeout',
        archive_no_token: status === 'no_token',
      },
    )
  }
  const unregister = registerCleanup(teardown)

  if (feature('CCR_MIRROR') && outboundOnly) {
    logEvent('tengu_ccr_mirror_started', {
      v2: true,
      expires_in_s: credentials.expires_in,
    })
  } else {
    logEvent('tengu_bridge_repl_started', {
      has_initial_messages: !!(initialMessages && initialMessages.length > 0),
      v2: true,
      expires_in_s: credentials.expires_in,
      inProtectedNamespace: isInProtectedNamespace(),
    })
  }

  
  return {
    bridgeSessionId: sessionId,
    environmentId: '',
    sessionIngressUrl: credentials.api_base_url,
    writeMessages(messages) {
      const filtered = messages.filter(
        m =>
          isEligibleBridgeMessage(m) &&
          !initialMessageUUIDs.has(m.uuid) &&
          !recentPostedUUIDs.has(m.uuid),
      )
      if (filtered.length === 0) return

      
      
      
      
      if (!userMessageCallbackDone) {
        for (const m of filtered) {
          const text = extractTitleText(m)
          if (text !== undefined && onUserMessage?.(text, sessionId)) {
            userMessageCallbackDone = true
            break
          }
        }
      }

      if (flushGate.enqueue(...filtered)) {
        logForDebugging(
          `[remote-bridge] Queued ${filtered.length} message(s) during flush`,
        )
        return
      }

      for (const msg of filtered) recentPostedUUIDs.add(msg.uuid)
      const events = toSDKMessages(filtered).map(m => ({
        ...m,
        session_id: sessionId,
      }))
      
      
      
      
      
      if (filtered.some(m => m.type === 'user')) {
        transport.reportState('running')
      }
      logForDebugging(`[remote-bridge] Sending ${filtered.length} message(s)`)
      void transport.writeBatch(events)
    },
    writeSdkMessages(messages: SDKMessage[]) {
      const filtered = messages.filter(
        m => !m.uuid || !recentPostedUUIDs.has(m.uuid),
      )
      if (filtered.length === 0) return
      for (const msg of filtered) {
        if (msg.uuid) recentPostedUUIDs.add(msg.uuid)
      }
      const events = filtered.map(m => ({ ...m, session_id: sessionId }))
      void transport.writeBatch(events)
    },
    sendControlRequest(request: SDKControlRequest) {
      if (authRecoveryInFlight) {
        logForDebugging(
          `[remote-bridge] Dropping control_request during 401 recovery: ${request.request_id}`,
        )
        return
      }
      const event = { ...request, session_id: sessionId }
      if (request.request.subtype === 'can_use_tool') {
        transport.reportState('requires_action')
      }
      void transport.write(event)
      logForDebugging(
        `[remote-bridge] Sent control_request request_id=${request.request_id}`,
      )
    },
    sendControlResponse(response: SDKControlResponse) {
      if (authRecoveryInFlight) {
        logForDebugging(
          '[remote-bridge] Dropping control_response during 401 recovery',
        )
        return
      }
      const event = { ...response, session_id: sessionId }
      transport.reportState('running')
      void transport.write(event)
      logForDebugging('[remote-bridge] Sent control_response')
    },
    sendControlCancelRequest(requestId: string) {
      if (authRecoveryInFlight) {
        logForDebugging(
          `[remote-bridge] Dropping control_cancel_request during 401 recovery: ${requestId}`,
        )
        return
      }
      const event = {
        type: 'control_cancel_request' as const,
        request_id: requestId,
        session_id: sessionId,
      }
      
      
      
      transport.reportState('running')
      void transport.write(event)
      logForDebugging(
        `[remote-bridge] Sent control_cancel_request request_id=${requestId}`,
      )
    },
    sendResult() {
      if (authRecoveryInFlight) {
        logForDebugging('[remote-bridge] Dropping result during 401 recovery')
        return
      }
      transport.reportState('idle')
      void transport.write(makeResultMessage(sessionId))
      logForDebugging(`[remote-bridge] Sent result`)
    },
    async teardown() {
      unregister()
      await teardown()
    },
  }
}

async function withRetry<T>(
  fn: () => Promise<T | null>,
  label: string,
  cfg: EnvLessBridgeConfig,
): Promise<T | null> {
  const max = cfg.init_retry_max_attempts
  for (let attempt = 1; attempt <= max; attempt++) {
    const result = await fn()
    if (result !== null) return result
    if (attempt < max) {
      const base = cfg.init_retry_base_delay_ms * 2 ** (attempt - 1)
      const jitter =
        base * cfg.init_retry_jitter_fraction * (2 * Math.random() - 1)
      const delay = Math.min(base + jitter, cfg.init_retry_max_delay_ms)
      logForDebugging(
        `[remote-bridge] ${label} failed (attempt ${attempt}/${max}), retrying in ${Math.round(delay)}ms`,
      )
      await sleep(delay)
    }
  }
  return null
}

export {
  createCodeSession,
  type RemoteCredentials,
} from './codeSessionApi.js'
import {
  createCodeSession,
  fetchRemoteCredentials as fetchRemoteCredentialsRaw,
  type RemoteCredentials,
} from './codeSessionApi.js'
import { getBridgeBaseUrlOverride } from './bridgeConfig.js'

export async function fetchRemoteCredentials(
  sessionId: string,
  baseUrl: string,
  accessToken: string,
  timeoutMs: number,
): Promise<RemoteCredentials | null> {
  const creds = await fetchRemoteCredentialsRaw(
    sessionId,
    baseUrl,
    accessToken,
    timeoutMs,
    getTrustedDeviceToken(),
  )
  if (!creds) return null
  return getBridgeBaseUrlOverride()
    ? { ...creds, api_base_url: baseUrl }
    : creds
}

type ArchiveStatus = number | 'timeout' | 'error' | 'no_token'

type ArchiveTelemetryStatus =
  | 'ok'
  | 'skipped_no_token'
  | 'network_error'
  | 'server_4xx'
  | 'server_5xx'

async function archiveSession(
  sessionId: string,
  baseUrl: string,
  accessToken: string | undefined,
  orgUUID: string,
  timeoutMs: number,
): Promise<ArchiveStatus> {
  if (!accessToken) return 'no_token'
  
  
  
  
  
  
  
  
  
  
  
  const compatId = toCompatSessionId(sessionId)
  try {
    const response = await axios.post(
      `${baseUrl}/v1/sessions/${compatId}/archive`,
      {},
      {
        headers: {
          ...oauthHeaders(accessToken),
          'anthropic-beta': 'ccr-byoc-2025-07-29',
          'x-organization-uuid': orgUUID,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
      },
    )
    logForDebugging(
      `[remote-bridge] Archive ${compatId} status=${response.status}`,
    )
    return response.status
  } catch (err) {
    const msg = errorMessage(err)
    logForDebugging(`[remote-bridge] Archive failed: ${msg}`)
    return axios.isAxiosError(err) && err.code === 'ECONNABORTED'
      ? 'timeout'
      : 'error'
  }
}
