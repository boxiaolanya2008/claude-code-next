import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions.mjs'
import type {
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AssistantMessage,
  UserMessage,
} from '../../types/message.js'
import { randomUUID } from 'crypto'

/**
 * Converts Anthropic message format to OpenAI message format
 */
export function anthropicMessagesToOpenAI(
  messages: MessageParam[],
  systemPrompt?: string,
): {
  messages: ChatCompletionMessageParam[]
  system?: string
} {
  const openAIMessages: ChatCompletionMessageParam[] = []

  for (const msg of messages) {
    const converted = convertSingleMessage(msg)
    if (converted) {
      openAIMessages.push(converted)
    }
  }

  return {
    messages: openAIMessages,
    system: systemPrompt,
  }
}

function convertSingleMessage(
  msg: MessageParam,
): ChatCompletionMessageParam | null {
  if (msg.role === 'user') {
    return convertUserMessage(msg)
  } else if (msg.role === 'assistant') {
    return convertAssistantMessage(msg)
  }
  return null
}

function convertUserMessage(msg: MessageParam): ChatCompletionMessageParam {
  const content = msg.content

  // Handle string content
  if (typeof content === 'string') {
    return {
      role: 'user',
      content,
    }
  }

  // Handle array content
  const parts: OpenAI.ChatCompletionContentPart[] = []
  const toolResults: ChatCompletionToolMessageParam[] = []

  for (const block of content) {
    if (block.type === 'text') {
      parts.push({
        type: 'text',
        text: block.text,
      })
    } else if (block.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: {
          url: block.source.type === 'base64'
            ? `data:${block.source.media_type};base64,${block.source.data}`
            : block.source.url || '',
        },
      })
    } else if (block.type === 'tool_result') {
      // Tool results become separate tool messages in OpenAI
      const toolResult = convertToolResultBlock(block)
      if (toolResult) {
        toolResults.push(toolResult)
      }
    }
    // thinking and redacted_thinking blocks are skipped for OpenAI
  }

  // If we have tool results, we need to return them separately
  // But since we can only return one message, we'll append them as a special format
  // The caller should handle splitting these
  if (toolResults.length > 0) {
    // Return first tool result as the main message, others need to be handled separately
    // This is handled by the caller
    return toolResults[0]!
  }

  return {
    role: 'user',
    content: parts.length > 0 ? parts : '',
  }
}

function convertToolResultBlock(
  block: ToolResultBlockParam,
): ChatCompletionToolMessageParam | null {
  const content = block.content
  let textContent = ''

  if (typeof content === 'string') {
    textContent = content
  } else if (Array.isArray(content)) {
    textContent = content
      .map(c => {
        if (typeof c === 'string') return c
        if (c.type === 'text') return c.text
        if (c.type === 'image') {
          // Images in tool results need special handling
          return '[Image content]'
        }
        return ''
      })
      .join('\n')
  }

  return {
    role: 'tool',
    tool_call_id: block.tool_use_id,
    content: textContent,
  }
}

function convertAssistantMessage(
  msg: MessageParam,
): ChatCompletionMessageParam {
  const content = msg.content

  // Handle string content (shouldn't happen in practice with Anthropic)
  if (typeof content === 'string') {
    return {
      role: 'assistant',
      content,
    }
  }

  const textParts: string[] = []
  const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = []

  for (const block of content) {
    if (block.type === 'text') {
      textParts.push(block.text)
    } else if (block.type === 'tool_use') {
      toolCalls.push(convertToolUseBlock(block))
    }
    // thinking and redacted_thinking blocks are skipped
  }

  const result: ChatCompletionMessageParam = {
    role: 'assistant',
  }

  if (textParts.length > 0) {
    result.content = textParts.join('\n')
  }

  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls
  }

  return result
}

function convertToolUseBlock(
  block: ToolUseBlockParam,
): OpenAI.ChatCompletionMessageToolCall {
  return {
    id: block.id,
    type: 'function',
    function: {
      name: block.name,
      arguments: JSON.stringify(block.input),
    },
  }
}

/**
 * Converts OpenAI response to Anthropic message format
 */
export function openAIResponseToAnthropic(
  response: OpenAI.ChatCompletion,
): AssistantMessage {
  const choice = response.choices[0]
  if (!choice) {
    throw new Error('No choices in OpenAI response')
  }

  const message = choice.message
  const content: ContentBlockParam[] = []

  // Add text content if present
  if (message.content) {
    content.push({
      type: 'text',
      text: message.content,
    })
  }

  // Add tool calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const toolCall of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.function.name,
        input: parseToolArguments(toolCall.function.arguments),
      })
    }
  }

  return {
    uuid: randomUUID(),
    message: {
      role: 'assistant',
      content,
    },
    type: 'assistant',
  } as AssistantMessage
}

function parseToolArguments(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>
  } catch {
    return { raw: args }
  }
}

/**
 * Converts OpenAI streaming chunk to Anthropic-style delta
 */
export function openAIStreamChunkToAnthropic(
  chunk: OpenAI.ChatCompletionChunk,
): {
  type: 'text' | 'tool_use' | 'finish'
  text?: string
  toolUse?: {
    id: string
    name: string
    input: string // partial JSON
  }
  finishReason?: string
  usage?: {
    input_tokens: number
    output_tokens: number
  }
} | null {
  const delta = chunk.choices[0]?.delta
  const finishReason = chunk.choices[0]?.finish_reason

  if (!delta && !finishReason) {
    return null
  }

  // Check for finish
  if (finishReason) {
    return {
      type: 'finish',
      finishReason,
      usage: chunk.usage
        ? {
            input_tokens: chunk.usage.prompt_tokens,
            output_tokens: chunk.usage.completion_tokens,
          }
        : undefined,
    }
  }

  // Handle text content
  if (delta?.content) {
    return {
      type: 'text',
      text: delta.content,
    }
  }

  // Handle tool calls
  if (delta?.tool_calls && delta.tool_calls.length > 0) {
    const toolCall = delta.tool_calls[0]
    if (toolCall) {
      return {
        type: 'tool_use',
        toolUse: {
          id: toolCall.id || '',
          name: toolCall.function?.name || '',
          input: toolCall.function?.arguments || '',
        },
      }
    }
  }

  return null
}

/**
 * Build user message from tool results for OpenAI
 */
export function buildToolResultMessages(
  toolResults: ToolResultBlockParam[],
): ChatCompletionToolMessageParam[] {
  return toolResults
    .map(result => convertToolResultBlock(result))
    .filter((msg): msg is ChatCompletionToolMessageParam => msg !== null)
}

/**
 * Convert internal UserMessage to OpenAI format
 */
export function userMessageToOpenAI(
  message: UserMessage,
): ChatCompletionMessageParam | ChatCompletionMessageParam[] {
  const content = message.message.content

  // Handle tool results specially
  const toolResults: ToolResultBlockParam[] = []
  const otherContent: ContentBlockParam[] = []

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'tool_result') {
        toolResults.push(block)
      } else {
        otherContent.push(block)
      }
    }
  }

  const resultMessages: ChatCompletionMessageParam[] = []

  // Add non-tool content as user message
  if (otherContent.length > 0) {
    const tempMsg: MessageParam = {
      role: 'user',
      content: otherContent,
    }
    const converted = convertUserMessage(tempMsg)
    if (converted) {
      resultMessages.push(converted)
    }
  }

  // Add tool results as separate tool messages
  for (const toolResult of toolResults) {
    const converted = convertToolResultBlock(toolResult)
    if (converted) {
      resultMessages.push(converted)
    }
  }

  return resultMessages.length === 1 ? resultMessages[0]! : resultMessages
}
