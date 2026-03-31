

import { randomUUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { SDKResultSuccess } from '../entrypoints/sdk/coreTypes.js'
import { logEvent } from '../services/analytics/index.js'
import { EMPTY_USAGE } from '../services/api/emptyUsage.js'
import type { Message } from '../types/message.js'
import { normalizeControlMessageKeys } from '../utils/controlMessageCompat.js'
import { logForDebugging } from '../utils/debug.js'
import { stripDisplayTagsAllowEmpty } from '../utils/displayTags.js'
import { errorMessage } from '../utils/errors.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import { jsonParse } from '../utils/slowOperations.js'
import type { ReplBridgeTransport } from './replBridgeTransport.js'

export function isSDKMessage(value: unknown): value is SDKMessage {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string'
  )
}

export function isSDKControlResponse(
  value: unknown,
): value is SDKControlResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'control_response' &&
    'response' in value
  )
}

export function isSDKControlRequest(
  value: unknown,
): value is SDKControlRequest {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'control_request' &&
    'request_id' in value &&
    'request' in value
  )
}

export function isEligibleBridgeMessage(m: Message): boolean {
  
  
  if ((m.type === 'user' || m.type === 'assistant') && m.isVirtual) {
    return false
  }
  return (
    m.type === 'user' ||
    m.type === 'assistant' ||
    (m.type === 'system' && m.subtype === 'local_command')
  )
}

export function extractTitleText(m: Message): string | undefined {
  if (m.type !== 'user' || m.isMeta || m.toolUseResult || m.isCompactSummary)
    return undefined
  if (m.origin && m.origin.kind !== 'human') return undefined
  const content = m.message.content
  let raw: string | undefined
  if (typeof content === 'string') {
    raw = content
  } else {
    for (const block of content) {
      if (block.type === 'text') {
        raw = block.text
        break
      }
    }
  }
  if (!raw) return undefined
  const clean = stripDisplayTagsAllowEmpty(raw)
  return clean || undefined
}

export function handleIngressMessage(
  data: string,
  recentPostedUUIDs: BoundedUUIDSet,
  recentInboundUUIDs: BoundedUUIDSet,
  onInboundMessage: ((msg: SDKMessage) => void | Promise<void>) | undefined,
  onPermissionResponse?: ((response: SDKControlResponse) => void) | undefined,
  onControlRequest?: ((request: SDKControlRequest) => void) | undefined,
): void {
  try {
    const parsed: unknown = normalizeControlMessageKeys(jsonParse(data))

    
    if (isSDKControlResponse(parsed)) {
      logForDebugging('[bridge:repl] Ingress message type=control_response')
      onPermissionResponse?.(parsed)
      return
    }

    
    
    if (isSDKControlRequest(parsed)) {
      logForDebugging(
        `[bridge:repl] Inbound control_request subtype=${parsed.request.subtype}`,
      )
      onControlRequest?.(parsed)
      return
    }

    if (!isSDKMessage(parsed)) return

    
    const uuid =
      'uuid' in parsed && typeof parsed.uuid === 'string'
        ? parsed.uuid
        : undefined

    if (uuid && recentPostedUUIDs.has(uuid)) {
      logForDebugging(
        `[bridge:repl] Ignoring echo: type=${parsed.type} uuid=${uuid}`,
      )
      return
    }

    
    
    
    
    
    if (uuid && recentInboundUUIDs.has(uuid)) {
      logForDebugging(
        `[bridge:repl] Ignoring re-delivered inbound: type=${parsed.type} uuid=${uuid}`,
      )
      return
    }

    logForDebugging(
      `[bridge:repl] Ingress message type=${parsed.type}${uuid ? ` uuid=${uuid}` : ''}`,
    )

    if (parsed.type === 'user') {
      if (uuid) recentInboundUUIDs.add(uuid)
      logEvent('tengu_bridge_message_received', {
        is_repl: true,
      })
      
      void onInboundMessage?.(parsed)
    } else {
      logForDebugging(
        `[bridge:repl] Ignoring non-user inbound message: type=${parsed.type}`,
      )
    }
  } catch (err) {
    logForDebugging(
      `[bridge:repl] Failed to parse ingress message: ${errorMessage(err)}`,
    )
  }
}

export type ServerControlRequestHandlers = {
  transport: ReplBridgeTransport | null
  sessionId: string
  

  outboundOnly?: boolean
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
}

const OUTBOUND_ONLY_ERROR =
  'This session is outbound-only. Enable Remote Control locally to allow inbound control.'

export function handleServerControlRequest(
  request: SDKControlRequest,
  handlers: ServerControlRequestHandlers,
): void {
  const {
    transport,
    sessionId,
    outboundOnly,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
  } = handlers
  if (!transport) {
    logForDebugging(
      '[bridge:repl] Cannot respond to control_request: transport not configured',
    )
    return
  }

  let response: SDKControlResponse

  
  
  
  if (outboundOnly && request.request.subtype !== 'initialize') {
    response = {
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: request.request_id,
        error: OUTBOUND_ONLY_ERROR,
      },
    }
    const event = { ...response, session_id: sessionId }
    void transport.write(event)
    logForDebugging(
      `[bridge:repl] Rejected ${request.request.subtype} (outbound-only) request_id=${request.request_id}`,
    )
    return
  }

  switch (request.request.subtype) {
    case 'initialize':
      
      
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
          response: {
            commands: [],
            output_style: 'normal',
            available_output_styles: ['normal'],
            models: [],
            account: {},
            pid: process.pid,
          },
        },
      }
      break

    case 'set_model':
      onSetModel?.(request.request.model)
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

    case 'set_max_thinking_tokens':
      onSetMaxThinkingTokens?.(request.request.max_thinking_tokens)
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

    case 'set_permission_mode': {
      
      
      
      
      
      
      
      const verdict = onSetPermissionMode?.(request.request.mode) ?? {
        ok: false,
        error:
          'set_permission_mode is not supported in this context (onSetPermissionMode callback not registered)',
      }
      if (verdict.ok) {
        response = {
          type: 'control_response',
          response: {
            subtype: 'success',
            request_id: request.request_id,
          },
        }
      } else {
        response = {
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: request.request_id,
            error: verdict.error,
          },
        }
      }
      break
    }

    case 'interrupt':
      onInterrupt?.()
      response = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.request_id,
        },
      }
      break

    default:
      
      
      response = {
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: request.request_id,
          error: `REPL bridge does not handle control_request subtype: ${request.request.subtype}`,
        },
      }
  }

  const event = { ...response, session_id: sessionId }
  void transport.write(event)
  logForDebugging(
    `[bridge:repl] Sent control_response for ${request.request.subtype} request_id=${request.request_id} result=${response.response.subtype}`,
  )
}

export function makeResultMessage(sessionId: string): SDKResultSuccess {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: false,
    num_turns: 0,
    result: '',
    stop_reason: null,
    total_cost_usd: 0,
    usage: { ...EMPTY_USAGE },
    modelUsage: {},
    permission_denials: [],
    session_id: sessionId,
    uuid: randomUUID(),
  }
}

export class BoundedUUIDSet {
  private readonly capacity: number
  private readonly ring: (string | undefined)[]
  private readonly set = new Set<string>()
  private writeIdx = 0

  constructor(capacity: number) {
    this.capacity = capacity
    this.ring = new Array<string | undefined>(capacity)
  }

  add(uuid: string): void {
    if (this.set.has(uuid)) return
    
    const evicted = this.ring[this.writeIdx]
    if (evicted !== undefined) {
      this.set.delete(evicted)
    }
    this.ring[this.writeIdx] = uuid
    this.set.add(uuid)
    this.writeIdx = (this.writeIdx + 1) % this.capacity
  }

  has(uuid: string): boolean {
    return this.set.has(uuid)
  }

  clear(): void {
    this.set.clear()
    this.ring.fill(undefined)
    this.writeIdx = 0
  }
}
