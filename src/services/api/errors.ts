import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from '@anthropic-ai/sdk'
import type {
  BetaMessage,
  BetaStopReason,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { AFK_MODE_BETA_HEADER } from 'src/constants/betas.js'
import type { SDKAssistantMessageError } from 'src/entrypoints/agentSdkTypes.js'
import type {
  AssistantMessage,
  Message,
  UserMessage,
} from 'src/types/message.js'
import {
  getAnthropicApiKeyWithSource,
  getClaudeAIOAuthTokens,
  getOauthAccountInfo,
  isClaudeAISubscriber,
} from 'src/utils/auth.js'
import {
  createAssistantAPIErrorMessage,
  NO_RESPONSE_REQUESTED,
} from 'src/utils/messages.js'
import {
  getDefaultMainLoopModelSetting,
  isNonCustomOpusModel,
} from 'src/utils/model/model.js'
import { getModelStrings } from 'src/utils/model/modelStrings.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import {
  API_PDF_MAX_PAGES,
  PDF_TARGET_RAW_SIZE,
} from '../../constants/apiLimits.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { formatFileSize } from '../../utils/format.js'
import { ImageResizeError } from '../../utils/imageResizer.js'
import { ImageSizeError } from '../../utils/imageValidation.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  type ClaudeAILimits,
  getRateLimitErrorMessage,
  type OverageDisabledReason,
} from '../claudeAiLimits.js'
import { shouldProcessRateLimits } from '../rateLimitMocking.js' 
import { extractConnectionErrorDetails, formatAPIError } from './errorUtils.js'

export const API_ERROR_MESSAGE_PREFIX = 'API Error'

export function startsWithApiErrorPrefix(text: string): boolean {
  return (
    text.startsWith(API_ERROR_MESSAGE_PREFIX) ||
    text.startsWith(`Please run /login · ${API_ERROR_MESSAGE_PREFIX}`)
  )
}
export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'

export function isPromptTooLongMessage(msg: AssistantMessage): boolean {
  if (!msg.isApiErrorMessage) {
    return false
  }
  const content = msg.message.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some(
    block =>
      block.type === 'text' &&
      block.text.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE),
  )
}

export function parsePromptTooLongTokenCounts(rawMessage: string): {
  actualTokens: number | undefined
  limitTokens: number | undefined
} {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
  )
  return {
    actualTokens: match ? parseInt(match[1]!, 10) : undefined,
    limitTokens: match ? parseInt(match[2]!, 10) : undefined,
  }
}

export function getPromptTooLongTokenGap(
  msg: AssistantMessage,
): number | undefined {
  if (!isPromptTooLongMessage(msg) || !msg.errorDetails) {
    return undefined
  }
  const { actualTokens, limitTokens } = parsePromptTooLongTokenCounts(
    msg.errorDetails,
  )
  if (actualTokens === undefined || limitTokens === undefined) {
    return undefined
  }
  const gap = actualTokens - limitTokens
  return gap > 0 ? gap : undefined
}

export function isMediaSizeError(raw: string): boolean {
  return (
    (raw.includes('image exceeds') && raw.includes('maximum')) ||
    (raw.includes('image dimensions exceed') && raw.includes('many-image')) ||
    /maximum of \d+ PDF pages/.test(raw)
  )
}

export function isMediaSizeErrorMessage(msg: AssistantMessage): boolean {
  return (
    msg.isApiErrorMessage === true &&
    msg.errorDetails !== undefined &&
    isMediaSizeError(msg.errorDetails)
  )
}
export const CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE = 'Credit balance is too low'
export const INVALID_API_KEY_ERROR_MESSAGE = 'Not logged in · Please run /login'
export const INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL =
  'Invalid API key · Fix external API key'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH =
  'Your ANTHROPIC_API_KEY belongs to a disabled organization · Unset the environment variable to use your subscription instead'
export const ORG_DISABLED_ERROR_MESSAGE_ENV_KEY =
  'Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable'
export const TOKEN_REVOKED_ERROR_MESSAGE =
  'OAuth token revoked · Please run /login'
export const CCR_AUTH_ERROR_MESSAGE =
  'Authentication error · This may be a temporary network issue, please try again'
export const REPEATED_529_ERROR_MESSAGE = 'Repeated 529 Overloaded errors'
export const CUSTOM_OFF_SWITCH_MESSAGE =
  'Opus is experiencing high load, please use /model to switch to Sonnet'
export const API_TIMEOUT_ERROR_MESSAGE = 'Request timed out'
export function getPdfTooLargeErrorMessage(): string {
  const limits = `max ${API_PDF_MAX_PAGES} pages, ${formatFileSize(PDF_TARGET_RAW_SIZE)}`
  return getIsNonInteractiveSession()
    ? `PDF too large (${limits}). Try reading the file a different way (e.g., extract text with pdftotext).`
    : `PDF too large (${limits}). Double press esc to go back and try again, or use pdftotext to convert to text first.`
}
export function getPdfPasswordProtectedErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'PDF is password protected. Try using a CLI tool to extract or convert the PDF.'
    : 'PDF is password protected. Please double press esc to edit your message and try again.'
}
export function getPdfInvalidErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'The PDF file was not valid. Try converting it to text first (e.g., pdftotext).'
    : 'The PDF file was not valid. Double press esc to go back and try again with a different file.'
}
export function getImageTooLargeErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'Image was too large. Try resizing the image or using a different approach.'
    : 'Image was too large. Double press esc to go back and try again with a smaller image.'
}
export function getRequestTooLargeErrorMessage(): string {
  const limits = `max ${formatFileSize(PDF_TARGET_RAW_SIZE)}`
  return getIsNonInteractiveSession()
    ? `Request too large (${limits}). Try with a smaller file.`
    : `Request too large (${limits}). Double press esc to go back and try with a smaller file.`
}
export const OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE =
  'Your account does not have access to Claude Code Next. Please run /login.'

export function getTokenRevokedErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'Your account does not have access to Claude. Please login again or contact your administrator.'
    : TOKEN_REVOKED_ERROR_MESSAGE
}

export function getOauthOrgNotAllowedErrorMessage(): string {
  return getIsNonInteractiveSession()
    ? 'Your organization does not have access to Claude. Please login again or contact your administrator.'
    : OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE
}

function isCCRMode(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE)
}

function logToolUseToolResultMismatch(
  toolUseId: string,
  messages: Message[],
  messagesForAPI: (UserMessage | AssistantMessage)[],
): void {
  try {
    
    let normalizedIndex = -1
    for (let i = 0; i < messagesForAPI.length; i++) {
      const msg = messagesForAPI[i]
      if (!msg) continue
      const content = msg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            'id' in block &&
            block.id === toolUseId
          ) {
            normalizedIndex = i
            break
          }
        }
      }
      if (normalizedIndex !== -1) break
    }

    
    let originalIndex = -1
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue
      if (msg.type === 'assistant' && 'message' in msg) {
        const content = msg.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block.type === 'tool_use' &&
              'id' in block &&
              block.id === toolUseId
            ) {
              originalIndex = i
              break
            }
          }
        }
      }
      if (originalIndex !== -1) break
    }

    
    const normalizedSeq: string[] = []
    for (let i = normalizedIndex + 1; i < messagesForAPI.length; i++) {
      const msg = messagesForAPI[i]
      if (!msg) continue
      const content = msg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const role = msg.message.role
          if (block.type === 'tool_use' && 'id' in block) {
            normalizedSeq.push(`${role}:tool_use:${block.id}`)
          } else if (block.type === 'tool_result' && 'tool_use_id' in block) {
            normalizedSeq.push(`${role}:tool_result:${block.tool_use_id}`)
          } else if (block.type === 'text') {
            normalizedSeq.push(`${role}:text`)
          } else if (block.type === 'thinking') {
            normalizedSeq.push(`${role}:thinking`)
          } else if (block.type === 'image') {
            normalizedSeq.push(`${role}:image`)
          } else {
            normalizedSeq.push(`${role}:${block.type}`)
          }
        }
      } else if (typeof content === 'string') {
        normalizedSeq.push(`${msg.message.role}:string_content`)
      }
    }

    
    const preNormalizedSeq: string[] = []
    for (let i = originalIndex + 1; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg) continue

      switch (msg.type) {
        case 'user':
        case 'assistant': {
          if ('message' in msg) {
            const content = msg.message.content
            if (Array.isArray(content)) {
              for (const block of content) {
                const role = msg.message.role
                if (block.type === 'tool_use' && 'id' in block) {
                  preNormalizedSeq.push(`${role}:tool_use:${block.id}`)
                } else if (
                  block.type === 'tool_result' &&
                  'tool_use_id' in block
                ) {
                  preNormalizedSeq.push(
                    `${role}:tool_result:${block.tool_use_id}`,
                  )
                } else if (block.type === 'text') {
                  preNormalizedSeq.push(`${role}:text`)
                } else if (block.type === 'thinking') {
                  preNormalizedSeq.push(`${role}:thinking`)
                } else if (block.type === 'image') {
                  preNormalizedSeq.push(`${role}:image`)
                } else {
                  preNormalizedSeq.push(`${role}:${block.type}`)
                }
              }
            } else if (typeof content === 'string') {
              preNormalizedSeq.push(`${msg.message.role}:string_content`)
            }
          }
          break
        }
        case 'attachment':
          if ('attachment' in msg) {
            preNormalizedSeq.push(`attachment:${msg.attachment.type}`)
          }
          break
        case 'system':
          if ('subtype' in msg) {
            preNormalizedSeq.push(`system:${msg.subtype}`)
          }
          break
        case 'progress':
          if (
            'progress' in msg &&
            msg.progress &&
            typeof msg.progress === 'object' &&
            'type' in msg.progress
          ) {
            preNormalizedSeq.push(`progress:${msg.progress.type ?? 'unknown'}`)
          } else {
            preNormalizedSeq.push('progress:unknown')
          }
          break
      }
    }

    
    logEvent('tengu_tool_use_tool_result_mismatch_error', {
      toolUseId:
        toolUseId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      normalizedSequence: normalizedSeq.join(
        ', ',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      preNormalizedSequence: preNormalizedSeq.join(
        ', ',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      normalizedMessageCount: messagesForAPI.length,
      originalMessageCount: messages.length,
      normalizedToolUseIndex: normalizedIndex,
      originalToolUseIndex: originalIndex,
    })
  } catch (_) {
    
  }
}

export function isValidAPIMessage(value: unknown): value is BetaMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    'model' in value &&
    'usage' in value &&
    Array.isArray((value as BetaMessage).content) &&
    typeof (value as BetaMessage).model === 'string' &&
    typeof (value as BetaMessage).usage === 'object'
  )
}

type AmazonError = {
  Output?: {
    __type?: string
  }
  Version?: string
}

export function extractUnknownErrorFormat(value: unknown): string | undefined {
  
  if (!value || typeof value !== 'object') {
    return undefined
  }

  
  if ((value as AmazonError).Output?.__type) {
    return (value as AmazonError).Output!.__type
  }

  return undefined
}

export function getAssistantMessageFromError(
  error: unknown,
  model: string,
  options?: {
    messages?: Message[]
    messagesForAPI?: (UserMessage | AssistantMessage)[]
  },
): AssistantMessage {
  
  if (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof APIConnectionError &&
      error.message.toLowerCase().includes('timeout'))
  ) {
    return createAssistantAPIErrorMessage({
      content: API_TIMEOUT_ERROR_MESSAGE,
      error: 'unknown',
    })
  }

  
  
  
  if (error instanceof ImageSizeError || error instanceof ImageResizeError) {
    return createAssistantAPIErrorMessage({
      content: getImageTooLargeErrorMessage(),
    })
  }

  
  if (
    error instanceof Error &&
    error.message.includes(CUSTOM_OFF_SWITCH_MESSAGE)
  ) {
    return createAssistantAPIErrorMessage({
      content: CUSTOM_OFF_SWITCH_MESSAGE,
      error: 'rate_limit',
    })
  }

  if (
    error instanceof APIError &&
    error.status === 429 &&
    shouldProcessRateLimits(isClaudeAISubscriber())
  ) {
    
    const rateLimitType = error.headers?.get?.(
      'anthropic-ratelimit-unified-representative-claim',
    ) as 'five_hour' | 'seven_day' | 'seven_day_opus' | null

    const overageStatus = error.headers?.get?.(
      'anthropic-ratelimit-unified-overage-status',
    ) as 'allowed' | 'allowed_warning' | 'rejected' | null

    
    if (rateLimitType || overageStatus) {
      
      const limits: ClaudeAILimits = {
        status: 'rejected',
        unifiedRateLimitFallbackAvailable: false,
        isUsingOverage: false,
      }

      
      const resetHeader = error.headers?.get?.(
        'anthropic-ratelimit-unified-reset',
      )
      if (resetHeader) {
        limits.resetsAt = Number(resetHeader)
      }

      if (rateLimitType) {
        limits.rateLimitType = rateLimitType
      }

      if (overageStatus) {
        limits.overageStatus = overageStatus
      }

      const overageResetHeader = error.headers?.get?.(
        'anthropic-ratelimit-unified-overage-reset',
      )
      if (overageResetHeader) {
        limits.overageResetsAt = Number(overageResetHeader)
      }

      const overageDisabledReason = error.headers?.get?.(
        'anthropic-ratelimit-unified-overage-disabled-reason',
      ) as OverageDisabledReason | null
      if (overageDisabledReason) {
        limits.overageDisabledReason = overageDisabledReason
      }

      
      const specificErrorMessage = getRateLimitErrorMessage(limits, model)
      if (specificErrorMessage) {
        return createAssistantAPIErrorMessage({
          content: specificErrorMessage,
          error: 'rate_limit',
        })
      }

      
      
      
      
      return createAssistantAPIErrorMessage({
        content: NO_RESPONSE_REQUESTED,
        error: 'rate_limit',
      })
    }

    
    
    
    if (error.message.includes('Extra usage is required for long context')) {
      const hint = getIsNonInteractiveSession()
        ? 'enable extra usage at claude.ai/settings/usage, or use --model to switch to standard context'
        : 'run /extra-usage to enable, or /model to switch to standard context'
      return createAssistantAPIErrorMessage({
        content: `${API_ERROR_MESSAGE_PREFIX}: Extra usage is required for 1M context · ${hint}`,
        error: 'rate_limit',
      })
    }
    
    
    const stripped = error.message.replace(/^429\s+/, '')
    const innerMessage = stripped.match(/"message"\s*:\s*"([^"]*)"/)?.[1]
    const detail = innerMessage || stripped
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: Request rejected (429) · ${detail || 'this may be a temporary capacity issue — check status.anthropic.com'}`,
      error: 'rate_limit',
    })
  }

  
  
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('prompt is too long')
  ) {
    
    
    
    return createAssistantAPIErrorMessage({
      content: PROMPT_TOO_LONG_ERROR_MESSAGE,
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  
  if (
    error instanceof Error &&
    /maximum of \d+ PDF pages/.test(error.message)
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfTooLargeErrorMessage(),
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  
  if (
    error instanceof Error &&
    error.message.includes('The PDF specified is password protected')
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfPasswordProtectedErrorMessage(),
      error: 'invalid_request',
    })
  }

  
  
  
  if (
    error instanceof Error &&
    error.message.includes('The PDF specified was not valid')
  ) {
    return createAssistantAPIErrorMessage({
      content: getPdfInvalidErrorMessage(),
      error: 'invalid_request',
    })
  }

  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image exceeds') &&
    error.message.includes('maximum')
  ) {
    return createAssistantAPIErrorMessage({
      content: getImageTooLargeErrorMessage(),
      errorDetails: error.message,
    })
  }

  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image dimensions exceed') &&
    error.message.includes('many-image')
  ) {
    return createAssistantAPIErrorMessage({
      content: getIsNonInteractiveSession()
        ? 'An image in the conversation exceeds the dimension limit for many-image requests (2000px). Start a new session with fewer images.'
        : 'An image in the conversation exceeds the dimension limit for many-image requests (2000px). Run /compact to remove old images from context, or start a new session.',
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  
  
  
  if (
    AFK_MODE_BETA_HEADER &&
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes(AFK_MODE_BETA_HEADER) &&
    error.message.includes('anthropic-beta')
  ) {
    return createAssistantAPIErrorMessage({
      content: 'Auto mode is unavailable for your plan',
      error: 'invalid_request',
    })
  }

  
  
  if (error instanceof APIError && error.status === 413) {
    return createAssistantAPIErrorMessage({
      content: getRequestTooLargeErrorMessage(),
      error: 'invalid_request',
    })
  }

  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes(
      '`tool_use` ids were found without `tool_result` blocks immediately after',
    )
  ) {
    
    if (options?.messages && options?.messagesForAPI) {
      const toolUseIdMatch = error.message.match(/toolu_[a-zA-Z0-9]+/)
      const toolUseId = toolUseIdMatch ? toolUseIdMatch[0] : null
      if (toolUseId) {
        logToolUseToolResultMismatch(
          toolUseId,
          options.messages,
          options.messagesForAPI,
        )
      }
    }

    if (process.env.USER_TYPE === 'ant') {
      const baseMessage = `API Error: 400 ${error.message}\n\nRun /share and post the JSON file to ${MACRO.FEEDBACK_CHANNEL}.`
      const rewindInstruction = getIsNonInteractiveSession()
        ? ''
        : ' Then, use /rewind to recover the conversation.'
      return createAssistantAPIErrorMessage({
        content: baseMessage + rewindInstruction,
        error: 'invalid_request',
      })
    } else {
      const baseMessage = 'API Error: 400 due to tool use concurrency issues.'
      const rewindInstruction = getIsNonInteractiveSession()
        ? ''
        : ' Run /rewind to recover the conversation.'
      return createAssistantAPIErrorMessage({
        content: baseMessage + rewindInstruction,
        error: 'invalid_request',
      })
    }
  }

  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('unexpected `tool_use_id` found in `tool_result`')
  ) {
    logEvent('tengu_unexpected_tool_result', {})
  }

  
  
  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('`tool_use` ids must be unique')
  ) {
    logEvent('tengu_duplicate_tool_use_id', {})
    const rewindInstruction = getIsNonInteractiveSession()
      ? ''
      : ' Run /rewind to recover the conversation.'
    return createAssistantAPIErrorMessage({
      content: `API Error: 400 duplicate tool_use ID in conversation history.${rewindInstruction}`,
      error: 'invalid_request',
      errorDetails: error.message,
    })
  }

  
  if (
    isClaudeAISubscriber() &&
    error instanceof APIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('invalid model name') &&
    (isNonCustomOpusModel(model) || model === 'opus')
  ) {
    return createAssistantAPIErrorMessage({
      content:
        'Claude Opus is not available with the Claude Pro plan. If you have updated your subscription plan recently, run /logout and /login for the plan to take effect.',
      error: 'invalid_request',
    })
  }

  
  
  
  if (
    process.env.USER_TYPE === 'ant' &&
    !process.env.ANTHROPIC_MODEL &&
    error instanceof Error &&
    error.message.toLowerCase().includes('invalid model name')
  ) {
    
    const orgId = getOauthAccountInfo()?.organizationUuid
    const baseMsg = `[ANT-ONLY] Your org isn't gated into the \`${model}\` model. Either run \`claude\` with \`ANTHROPIC_MODEL=${getDefaultMainLoopModelSetting()}\``
    const msg = orgId
      ? `${baseMsg} or share your orgId (${orgId}) in ${MACRO.FEEDBACK_CHANNEL} for help getting access.`
      : `${baseMsg} or reach out in ${MACRO.FEEDBACK_CHANNEL} for help getting access.`

    return createAssistantAPIErrorMessage({
      content: msg,
      error: 'invalid_request',
    })
  }

  if (
    error instanceof Error &&
    error.message.includes('Your credit balance is too low')
  ) {
    return createAssistantAPIErrorMessage({
      content: CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE,
      error: 'billing_error',
    })
  }
  
  
  
  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('organization has been disabled')
  ) {
    const { source } = getAnthropicApiKeyWithSource()
    
    
    
    
    if (
      source === 'ANTHROPIC_API_KEY' &&
      process.env.ANTHROPIC_API_KEY &&
      !isClaudeAISubscriber()
    ) {
      const hasStoredOAuth = getClaudeAIOAuthTokens()?.accessToken != null
      
      
      
      return createAssistantAPIErrorMessage({
        error: 'invalid_request',
        content: hasStoredOAuth
          ? ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH
          : ORG_DISABLED_ERROR_MESSAGE_ENV_KEY,
      })
    }
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('x-api-key')
  ) {
    
    if (isCCRMode()) {
      return createAssistantAPIErrorMessage({
        error: 'authentication_failed',
        content: CCR_AUTH_ERROR_MESSAGE,
      })
    }

    
    const { source } = getAnthropicApiKeyWithSource()
    const isExternalSource =
      source === 'ANTHROPIC_API_KEY' || source === 'apiKeyHelper'

    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: isExternalSource
        ? INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL
        : INVALID_API_KEY_ERROR_MESSAGE,
    })
  }

  
  if (
    error instanceof APIError &&
    error.status === 403 &&
    error.message.includes('OAuth token has been revoked')
  ) {
    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getTokenRevokedErrorMessage(),
    })
  }

  
  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403) &&
    error.message.includes(
      'OAuth authentication is currently not allowed for this organization',
    )
  ) {
    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getOauthOrgNotAllowedErrorMessage(),
    })
  }

  
  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403)
  ) {
    
    if (isCCRMode()) {
      return createAssistantAPIErrorMessage({
        error: 'authentication_failed',
        content: CCR_AUTH_ERROR_MESSAGE,
      })
    }

    return createAssistantAPIErrorMessage({
      error: 'authentication_failed',
      content: getIsNonInteractiveSession()
        ? `Failed to authenticate. ${API_ERROR_MESSAGE_PREFIX}: ${error.message}`
        : `Please run /login · ${API_ERROR_MESSAGE_PREFIX}: ${error.message}`,
    })
  }

  
  
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_BEDROCK) &&
    error instanceof Error &&
    error.message.toLowerCase().includes('model id')
  ) {
    const switchCmd = getIsNonInteractiveSession() ? '--model' : '/model'
    const fallbackSuggestion = get3PModelFallbackSuggestion(model)
    return createAssistantAPIErrorMessage({
      content: fallbackSuggestion
        ? `${API_ERROR_MESSAGE_PREFIX} (${model}): ${error.message}. Try ${switchCmd} to switch to ${fallbackSuggestion}.`
        : `${API_ERROR_MESSAGE_PREFIX} (${model}): ${error.message}. Run ${switchCmd} to pick a different model.`,
      error: 'invalid_request',
    })
  }

  
  
  
  if (error instanceof APIError && error.status === 404) {
    const switchCmd = getIsNonInteractiveSession() ? '--model' : '/model'
    const fallbackSuggestion = get3PModelFallbackSuggestion(model)
    return createAssistantAPIErrorMessage({
      content: fallbackSuggestion
        ? `The model ${model} is not available on your ${getAPIProvider()} deployment. Try ${switchCmd} to switch to ${fallbackSuggestion}, or ask your admin to enable this model.`
        : `There's an issue with the selected model (${model}). It may not exist or you may not have access to it. Run ${switchCmd} to pick a different model.`,
      error: 'invalid_request',
    })
  }

  
  if (error instanceof APIConnectionError) {
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: ${formatAPIError(error)}`,
      error: 'unknown',
    })
  }

  if (error instanceof Error) {
    return createAssistantAPIErrorMessage({
      content: `${API_ERROR_MESSAGE_PREFIX}: ${error.message}`,
      error: 'unknown',
    })
  }
  return createAssistantAPIErrorMessage({
    content: API_ERROR_MESSAGE_PREFIX,
    error: 'unknown',
  })
}

function get3PModelFallbackSuggestion(model: string): string | undefined {
  if (getAPIProvider() === 'firstParty') {
    return undefined
  }
  
  const m = model.toLowerCase()
  
  if (m.includes('opus-4-6') || m.includes('opus_4_6')) {
    return getModelStrings().opus41
  }
  
  if (m.includes('sonnet-4-6') || m.includes('sonnet_4_6')) {
    return getModelStrings().sonnet45
  }
  
  if (m.includes('sonnet-4-5') || m.includes('sonnet_4_5')) {
    return getModelStrings().sonnet40
  }
  return undefined
}

export function classifyAPIError(error: unknown): string {
  
  if (error instanceof Error && error.message === 'Request was aborted.') {
    return 'aborted'
  }

  
  if (
    error instanceof APIConnectionTimeoutError ||
    (error instanceof APIConnectionError &&
      error.message.toLowerCase().includes('timeout'))
  ) {
    return 'api_timeout'
  }

  
  if (
    error instanceof Error &&
    error.message.includes(REPEATED_529_ERROR_MESSAGE)
  ) {
    return 'repeated_529'
  }

  
  if (
    error instanceof Error &&
    error.message.includes(CUSTOM_OFF_SWITCH_MESSAGE)
  ) {
    return 'capacity_off_switch'
  }

  
  if (error instanceof APIError && error.status === 429) {
    return 'rate_limit'
  }

  
  if (
    error instanceof APIError &&
    (error.status === 529 ||
      error.message?.includes('"type":"overloaded_error"'))
  ) {
    return 'server_overload'
  }

  
  if (
    error instanceof Error &&
    error.message
      .toLowerCase()
      .includes(PROMPT_TOO_LONG_ERROR_MESSAGE.toLowerCase())
  ) {
    return 'prompt_too_long'
  }

  
  if (
    error instanceof Error &&
    /maximum of \d+ PDF pages/.test(error.message)
  ) {
    return 'pdf_too_large'
  }

  if (
    error instanceof Error &&
    error.message.includes('The PDF specified is password protected')
  ) {
    return 'pdf_password_protected'
  }

  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image exceeds') &&
    error.message.includes('maximum')
  ) {
    return 'image_too_large'
  }

  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('image dimensions exceed') &&
    error.message.includes('many-image')
  ) {
    return 'image_too_large'
  }

  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes(
      '`tool_use` ids were found without `tool_result` blocks immediately after',
    )
  ) {
    return 'tool_use_mismatch'
  }

  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('unexpected `tool_use_id` found in `tool_result`')
  ) {
    return 'unexpected_tool_result'
  }

  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.includes('`tool_use` ids must be unique')
  ) {
    return 'duplicate_tool_use_id'
  }

  
  if (
    error instanceof APIError &&
    error.status === 400 &&
    error.message.toLowerCase().includes('invalid model name')
  ) {
    return 'invalid_model'
  }

  
  if (
    error instanceof Error &&
    error.message
      .toLowerCase()
      .includes(CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE.toLowerCase())
  ) {
    return 'credit_balance_low'
  }

  
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('x-api-key')
  ) {
    return 'invalid_api_key'
  }

  if (
    error instanceof APIError &&
    error.status === 403 &&
    error.message.includes('OAuth token has been revoked')
  ) {
    return 'token_revoked'
  }

  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403) &&
    error.message.includes(
      'OAuth authentication is currently not allowed for this organization',
    )
  ) {
    return 'oauth_org_not_allowed'
  }

  
  if (
    error instanceof APIError &&
    (error.status === 401 || error.status === 403)
  ) {
    return 'auth_error'
  }

  
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_BEDROCK) &&
    error instanceof Error &&
    error.message.toLowerCase().includes('model id')
  ) {
    return 'bedrock_model_access'
  }

  
  if (error instanceof APIError) {
    const status = error.status
    if (status >= 500) return 'server_error'
    if (status >= 400) return 'client_error'
  }

  
  if (error instanceof APIConnectionError) {
    const connectionDetails = extractConnectionErrorDetails(error)
    if (connectionDetails?.isSSLError) {
      return 'ssl_cert_error'
    }
    return 'connection_error'
  }

  return 'unknown'
}

export function categorizeRetryableAPIError(
  error: APIError,
): SDKAssistantMessageError {
  if (
    error.status === 529 ||
    error.message?.includes('"type":"overloaded_error"')
  ) {
    return 'rate_limit'
  }
  if (error.status === 429) {
    return 'rate_limit'
  }
  if (error.status === 401 || error.status === 403) {
    return 'authentication_failed'
  }
  if (error.status !== undefined && error.status >= 408) {
    return 'server_error'
  }
  return 'unknown'
}

export function getErrorMessageIfRefusal(
  stopReason: BetaStopReason | null,
  model: string,
): AssistantMessage | undefined {
  if (stopReason !== 'refusal') {
    return
  }

  logEvent('tengu_refusal_api_response', {})

  const baseMessage = getIsNonInteractiveSession()
    ? `${API_ERROR_MESSAGE_PREFIX}: Claude Code Next is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/usage-policy)`
    : `${API_ERROR_MESSAGE_PREFIX}: Claude Code Next is unable to respond to this request, which appears to violate our Usage Policy (https://www.anthropic.com/usage-policy)`

  const modelSuggestion =
    model !== 'claude-sonnet-4-20250514'
      ? ' If you are seeing this refusal repeatedly, try running /model claude-sonnet-4-20250514 to switch models.'
      : ''

  return createAssistantAPIErrorMessage({
    content: baseMessage + modelSuggestion,
    error: 'invalid_request',
  })
}
