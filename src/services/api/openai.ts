import OpenAI from 'openai'
import { randomUUID } from 'crypto'
import type {
  AssistantMessage,
  StreamEvent,
} from '../../types/message.js'
import type { Tool } from '../../Tool.js'
import { logError } from '../../utils/log.js'
import { errorMessage } from '../../utils/errors.js'
import { isDebugToStdErr, logForDebugging } from '../../utils/debug.js'
import {
  getOpenAIClient,
  getOpenAIBaseUrl,
  type OpenAIClientOptions,
} from './openai-client.js'
import {
  anthropicMessagesToOpenAI,
  openAIStreamChunkToAnthropic,
  userMessageToOpenAI,
} from './message-adapter.js'
import {
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
  modelSupportsTools,
} from './tool-adapter.js'
import type {
  LLMClient,
  StreamMessagesParams,
  StreamResult,
  ProviderInfo,
  ProviderFeature,
  LLMError,
} from './base-client.js'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * Default models for OpenAI provider
 */
const DEFAULT_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
]

/**
 * OpenAI API client implementing the LLMClient interface
 */
export class OpenAIClient implements LLMClient {
  private client: OpenAI | null = null
  private config: OpenAIClientOptions

  constructor(config: OpenAIClientOptions = {}) {
    this.config = {
      maxRetries: 2,
      timeout: 600000, // 10 minutes
      ...config,
    }
  }

  /**
   * Initialize the OpenAI client
   */
  private async initClient(): Promise<OpenAI> {
    if (!this.client) {
      this.client = await getOpenAIClient(this.config)
    }
    return this.client
  }

  /**
   * Stream messages from OpenAI API
   */
  async* streamMessages(
    params: StreamMessagesParams,
  ): AsyncGenerator<StreamEvent, StreamResult, void> {
    const client = await this.initClient()

    const {
      model,
      messages,
      system,
      tools,
      toolChoice,
      maxTokens,
      signal,
    } = params

    logForDebugging(`[OpenAI] Starting stream with model: ${model}`)

    try {
      // Convert messages to OpenAI format
      const { messages: openAIMessages, system: openAISystem } =
        anthropicMessagesToOpenAI(messages, system)

      // Handle system message
      const systemMessage = openAISystem
        ? { role: 'system' as const, content: openAISystem }
        : null

      const allMessages = systemMessage
        ? [systemMessage, ...openAIMessages]
        : openAIMessages

      // Convert tools to OpenAI format
      const openAITools = tools && tools.length > 0 && modelSupportsTools(model)
        ? anthropicToolsToOpenAI(tools)
        : undefined

      // Convert tool choice
      const openAIToolChoice =
        openAITools && toolChoice
          ? anthropicToolChoiceToOpenAI(toolChoice)
          : undefined

      // Create the streaming request
      const stream = await client.chat.completions.create(
        {
          model,
          messages: allMessages,
          max_tokens: maxTokens,
          tools: openAITools,
          tool_choice: openAIToolChoice,
          stream: true,
          stream_options: {
            include_usage: true,
          },
        },
        {
          signal,
        },
      )

      // Accumulate the response
      let fullContent = ''
      const toolUses: Array<{
        id: string
        name: string
        input: string
      }> = []
      let currentToolUse: {
        id: string
        name: string
        input: string
      } | null = null

      let inputTokens = 0
      let outputTokens = 0
      let stopReason = 'end_turn'

      // Yield start event
      yield {
        type: 'request_start',
        requestId: randomUUID(),
        timestamp: new Date().toISOString(),
      } as StreamEvent

      // Process the stream
      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw new Error('Request aborted')
        }

        const delta = openAIStreamChunkToAnthropic(chunk)

        if (!delta) continue

        if (delta.type === 'finish') {
          stopReason = delta.finishReason || 'end_turn'
          if (delta.usage) {
            inputTokens = delta.usage.input_tokens
            outputTokens = delta.usage.output_tokens
          }
          break
        }

        if (delta.type === 'text' && delta.text) {
          fullContent += delta.text

          yield {
            type: 'content_block_delta',
            delta: {
              type: 'text_delta',
              text: delta.text,
            },
          } as StreamEvent
        }

        if (delta.type === 'tool_use' && delta.toolUse) {
          if (delta.toolUse.id && delta.toolUse.name) {
            // New tool use started
            if (currentToolUse) {
              toolUses.push(currentToolUse)
            }
            currentToolUse = {
              id: delta.toolUse.id,
              name: delta.toolUse.name,
              input: delta.toolUse.input || '',
            }

            yield {
              type: 'content_block_start',
              content_block: {
                type: 'tool_use',
                id: delta.toolUse.id,
                name: delta.toolUse.name,
                input: {},
              },
            } as StreamEvent
          } else if (currentToolUse && delta.toolUse.input) {
            // Continuation of current tool use
            currentToolUse.input += delta.toolUse.input

            yield {
              type: 'content_block_delta',
              delta: {
                type: 'input_json_delta',
                partial_json: delta.toolUse.input,
              },
            } as StreamEvent
          }
        }
      }

      // Add the last tool use
      if (currentToolUse) {
        toolUses.push(currentToolUse)
      }

      // Build the complete message
      const content: Array<{
        type: 'text' | 'tool_use'
        text?: string
        id?: string
        name?: string
        input?: Record<string, unknown>
      }> = []

      if (fullContent) {
        content.push({ type: 'text', text: fullContent })
      }

      for (const toolUse of toolUses) {
        try {
          const input = JSON.parse(toolUse.input)
          content.push({
            type: 'tool_use',
            id: toolUse.id,
            name: toolUse.name,
            input,
          })
        } catch {
          // If JSON parsing fails, use raw string
          content.push({
            type: 'tool_use',
            id: toolUse.id,
            name: toolUse.name,
            input: { _raw: toolUse.input },
          })
        }
      }

      // Map OpenAI stop reason to Anthropic-style
      const mappedStopReason = mapStopReason(stopReason)

      const assistantMessage: AssistantMessage = {
        uuid: randomUUID(),
        type: 'assistant',
        message: {
          role: 'assistant',
          content: content as unknown as AssistantMessage['message']['content'],
        },
        stop_reason: mappedStopReason as AssistantMessage['stop_reason'],
      }

      logForDebugging(
        `[OpenAI] Stream complete. Tokens: ${inputTokens} in, ${outputTokens} out`,
      )

      return {
        message: assistantMessage,
        usage: {
          inputTokens,
          outputTokens,
        },
        stopReason: mappedStopReason,
      }
    } catch (error) {
      logForDebugging(`[OpenAI] Error: ${errorMessage(error)}`)
      throw error
    }
  }

  /**
   * Get provider information
   */
  getProviderInfo(): ProviderInfo {
    const baseUrl = getOpenAIBaseUrl()
    return {
      name: 'OpenAI',
      type: 'openai',
      baseUrl: baseUrl || 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o',
      availableModels: DEFAULT_MODELS,
    }
  }

  /**
   * Check if a feature is supported
   */
  supportsFeature(feature: ProviderFeature): boolean {
    const supportedFeatures: ProviderFeature[] = [
      'toolUse',
      'streaming',
      'vision',
      'systemPrompt',
      'jsonMode',
    ]
    return supportedFeatures.includes(feature)
  }
}

/**
 * Map OpenAI stop reason to Anthropic-style
 */
function mapStopReason(openAIReason: string): string {
  const reasonMap: Record<string, string> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    content_filter: 'content_filter',
  }

  return reasonMap[openAIReason] || openAIReason
}

/**
 * Create a new OpenAI client instance
 */
export function createOpenAIClient(
  config?: OpenAIClientOptions,
): OpenAIClient {
  return new OpenAIClient(config)
}
