

import type { Span } from '@opentelemetry/api'
import { createHash } from 'crypto'
import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import { isEnvTruthy } from '../envUtils.js'
import { jsonParse, jsonStringify } from '../slowOperations.js'
import { logOTelEvent } from './events.js'

type APIMessage = UserMessage | AssistantMessage

const seenHashes = new Set<string>()

const lastReportedMessageHash = new Map<string, string>()

export function clearBetaTracingState(): void {
  seenHashes.clear()
  lastReportedMessageHash.clear()
}

const MAX_CONTENT_SIZE = 60 * 1024 

export function isBetaTracingEnabled(): boolean {
  const baseEnabled =
    isEnvTruthy(process.env.ENABLE_BETA_TRACING_DETAILED) &&
    Boolean(process.env.BETA_TRACING_ENDPOINT)

  if (!baseEnabled) {
    return false
  }

  // For external users, enable in SDK/headless mode OR when org is allowlisted.
  
  // works from second run onward (same behavior as enhanced_telemetry_beta).
  if (process.env.USER_TYPE !== 'ant') {
    return (
      getIsNonInteractiveSession() ||
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_trace_lantern', false)
    )
  }

  return true
}

/**
 * Truncate content to fit within Honeycomb limits.
 */
export function truncateContent(
  content: string,
  maxSize: number = MAX_CONTENT_SIZE,
): { content: string; truncated: boolean } {
  if (content.length <= maxSize) {
    return { content, truncated: false }
  }

  return {
    content:
      content.slice(0, maxSize) +
      '\n\n[TRUNCATED - Content exceeds 60KB limit]',
    truncated: true,
  }
}

/**
 * Generate a short hash (first 12 hex chars of SHA-256).
 */
function shortHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

/**
 * Generate a hash for a system prompt.
 */
function hashSystemPrompt(systemPrompt: string): string {
  return `sp_${shortHash(systemPrompt)}`
}

/**
 * Generate a hash for a message based on its content.
 */
function hashMessage(message: APIMessage): string {
  const content = jsonStringify(message.message.content)
  return `msg_${shortHash(content)}`
}

// Regex to detect content wrapped in <system-reminder> tags
const SYSTEM_REMINDER_REGEX =
  /^<system-reminder>\n?([\s\S]*?)\n?<\/system-reminder>$/

function extractSystemReminderContent(text: string): string | null {
  const match = text.trim().match(SYSTEM_REMINDER_REGEX)
  return match && match[1] ? match[1].trim() : null
}

/**
 * Result of formatting messages - separates regular content from system reminders.
 */
interface FormattedMessages {
  contextParts: string[]
  systemReminders: string[]
}

/**
 * Format user messages for new_context display, separating system reminders.
 * Only handles user messages (assistant messages are filtered out before this is called).
 */
function formatMessagesForContext(messages: UserMessage[]): FormattedMessages {
  const contextParts: string[] = []
  const systemReminders: string[] = []

  for (const message of messages) {
    const content = message.message.content
    if (typeof content === 'string') {
      const reminderContent = extractSystemReminderContent(content)
      if (reminderContent) {
        systemReminders.push(reminderContent)
      } else {
        contextParts.push(`[USER]\n${content}`)
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text') {
          const reminderContent = extractSystemReminderContent(block.text)
          if (reminderContent) {
            systemReminders.push(reminderContent)
          } else {
            contextParts.push(`[USER]\n${block.text}`)
          }
        } else if (block.type === 'tool_result') {
          const resultContent =
            typeof block.content === 'string'
              ? block.content
              : jsonStringify(block.content)
          
          const reminderContent = extractSystemReminderContent(resultContent)
          if (reminderContent) {
            systemReminders.push(reminderContent)
          } else {
            contextParts.push(
              `[TOOL RESULT: ${block.tool_use_id}]\n${resultContent}`,
            )
          }
        }
      }
    }
  }

  return { contextParts, systemReminders }
}

export interface LLMRequestNewContext {
  /** System prompt (typically only on first request or if changed) */
  systemPrompt?: string
  
  querySource?: string
  
  tools?: string
}

/**
 * Add beta attributes to an interaction span.
 * Adds new_context with the user prompt.
 */
export function addBetaInteractionAttributes(
  span: Span,
  userPrompt: string,
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const { content: truncatedPrompt, truncated } = truncateContent(
    `[USER PROMPT]\n${userPrompt}`,
  )
  span.setAttributes({
    new_context: truncatedPrompt,
    ...(truncated && {
      new_context_truncated: true,
      new_context_original_length: userPrompt.length,
    }),
  })
}

/**
 * Add beta attributes to an LLM request span.
 * Handles system prompt logging and new_context computation.
 */
export function addBetaLLMRequestAttributes(
  span: Span,
  newContext?: LLMRequestNewContext,
  messagesForAPI?: APIMessage[],
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  // Add system prompt info to the span
  if (newContext?.systemPrompt) {
    const promptHash = hashSystemPrompt(newContext.systemPrompt)
    const preview = newContext.systemPrompt.slice(0, 500)

    
    span.setAttribute('system_prompt_hash', promptHash)
    span.setAttribute('system_prompt_preview', preview)
    span.setAttribute('system_prompt_length', newContext.systemPrompt.length)

    
    if (!seenHashes.has(promptHash)) {
      seenHashes.add(promptHash)

      
      const { content: truncatedPrompt, truncated } = truncateContent(
        newContext.systemPrompt,
      )

      void logOTelEvent('system_prompt', {
        system_prompt_hash: promptHash,
        system_prompt: truncatedPrompt,
        system_prompt_length: String(newContext.systemPrompt.length),
        ...(truncated && { system_prompt_truncated: 'true' }),
      })
    }
  }

  // Add tools info to the span
  if (newContext?.tools) {
    try {
      const toolsArray = jsonParse(newContext.tools) as Record<
        string,
        unknown
      >[]

      
      const toolsWithHashes = toolsArray.map(tool => {
        const toolJson = jsonStringify(tool)
        const toolHash = shortHash(toolJson)
        return {
          name: typeof tool.name === 'string' ? tool.name : 'unknown',
          hash: toolHash,
          json: toolJson,
        }
      })

      
      span.setAttribute(
        'tools',
        jsonStringify(
          toolsWithHashes.map(({ name, hash }) => ({ name, hash })),
        ),
      )
      span.setAttribute('tools_count', toolsWithHashes.length)

      
      for (const { name, hash, json } of toolsWithHashes) {
        if (!seenHashes.has(`tool_${hash}`)) {
          seenHashes.add(`tool_${hash}`)

          const { content: truncatedTool, truncated } = truncateContent(json)

          void logOTelEvent('tool', {
            tool_name: sanitizeToolNameForAnalytics(name),
            tool_hash: hash,
            tool: truncatedTool,
            ...(truncated && { tool_truncated: 'true' }),
          })
        }
      }
    } catch {
      // If parsing fails, log the raw tools string
      span.setAttribute('tools_parse_error', true)
    }
  }

  // Add new_context using hash-based tracking (visible to all users)
  if (messagesForAPI && messagesForAPI.length > 0 && newContext?.querySource) {
    const querySource = newContext.querySource
    const lastHash = lastReportedMessageHash.get(querySource)

    
    let startIndex = 0
    if (lastHash) {
      for (let i = 0; i < messagesForAPI.length; i++) {
        const msg = messagesForAPI[i]
        if (msg && hashMessage(msg) === lastHash) {
          startIndex = i + 1 
          break
        }
      }
      // If lastHash not found, startIndex stays 0 (send everything)
    }

    // Get new messages (filter out assistant messages - we only want user input/tool results)
    const newMessages = messagesForAPI
      .slice(startIndex)
      .filter((m): m is UserMessage => m.type === 'user')

    if (newMessages.length > 0) {
      // Format new messages, separating system reminders from regular content
      const { contextParts, systemReminders } =
        formatMessagesForContext(newMessages)

      
      if (contextParts.length > 0) {
        const fullContext = contextParts.join('\n\n---\n\n')
        const { content: truncatedContext, truncated } =
          truncateContent(fullContext)

        span.setAttributes({
          new_context: truncatedContext,
          new_context_message_count: newMessages.length,
          ...(truncated && {
            new_context_truncated: true,
            new_context_original_length: fullContext.length,
          }),
        })
      }

      // Set system_reminders as a separate attribute
      if (systemReminders.length > 0) {
        const fullReminders = systemReminders.join('\n\n---\n\n')
        const { content: truncatedReminders, truncated: remindersTruncated } =
          truncateContent(fullReminders)

        span.setAttributes({
          system_reminders: truncatedReminders,
          system_reminders_count: systemReminders.length,
          ...(remindersTruncated && {
            system_reminders_truncated: true,
            system_reminders_original_length: fullReminders.length,
          }),
        })
      }

      // Update last reported hash to the last message in the array
      const lastMessage = messagesForAPI[messagesForAPI.length - 1]
      if (lastMessage) {
        lastReportedMessageHash.set(querySource, hashMessage(lastMessage))
      }
    }
  }
}

/**
 * Add beta attributes to endLLMRequestSpan.
 * Handles model_output and thinking_output truncation.
 */
export function addBetaLLMResponseAttributes(
  endAttributes: Record<string, string | number | boolean>,
  metadata?: {
    modelOutput?: string
    thinkingOutput?: string
  },
): void {
  if (!isBetaTracingEnabled() || !metadata) {
    return
  }

  // Add model_output (text content) - visible to all users
  if (metadata.modelOutput !== undefined) {
    const { content: modelOutput, truncated: outputTruncated } =
      truncateContent(metadata.modelOutput)
    endAttributes['response.model_output'] = modelOutput
    if (outputTruncated) {
      endAttributes['response.model_output_truncated'] = true
      endAttributes['response.model_output_original_length'] =
        metadata.modelOutput.length
    }
  }

  // Add thinking_output - ant-only
  if (
    process.env.USER_TYPE === 'ant' &&
    metadata.thinkingOutput !== undefined
  ) {
    const { content: thinkingOutput, truncated: thinkingTruncated } =
      truncateContent(metadata.thinkingOutput)
    endAttributes['response.thinking_output'] = thinkingOutput
    if (thinkingTruncated) {
      endAttributes['response.thinking_output_truncated'] = true
      endAttributes['response.thinking_output_original_length'] =
        metadata.thinkingOutput.length
    }
  }
}

/**
 * Add beta attributes to startToolSpan.
 * Adds tool_input with the serialized tool input.
 */
export function addBetaToolInputAttributes(
  span: Span,
  toolName: string,
  toolInput: string,
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const { content: truncatedInput, truncated } = truncateContent(
    `[TOOL INPUT: ${toolName}]\n${toolInput}`,
  )
  span.setAttributes({
    tool_input: truncatedInput,
    ...(truncated && {
      tool_input_truncated: true,
      tool_input_original_length: toolInput.length,
    }),
  })
}

/**
 * Add beta attributes to endToolSpan.
 * Adds new_context with the tool result.
 */
export function addBetaToolResultAttributes(
  endAttributes: Record<string, string | number | boolean>,
  toolName: string | number | boolean,
  toolResult: string,
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const { content: truncatedResult, truncated } = truncateContent(
    `[TOOL RESULT: ${toolName}]\n${toolResult}`,
  )
  endAttributes['new_context'] = truncatedResult
  if (truncated) {
    endAttributes['new_context_truncated'] = true
    endAttributes['new_context_original_length'] = toolResult.length
  }
}
