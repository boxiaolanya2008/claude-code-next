import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { roughTokenCountEstimationForMessages } from '../services/tokenEstimation.js'
import type { AssistantMessage, Message } from '../types/message.js'
import { SYNTHETIC_MESSAGES, SYNTHETIC_MODEL } from './messages.js'
import { jsonStringify } from './slowOperations.js'

export function getTokenUsage(message: Message): Usage | undefined {
  if (
    message?.type === 'assistant' &&
    'usage' in message.message &&
    !(
      message.message.content[0]?.type === 'text' &&
      SYNTHETIC_MESSAGES.has(message.message.content[0].text)
    ) &&
    message.message.model !== SYNTHETIC_MODEL
  ) {
    return message.message.usage
  }
  return undefined
}

function getAssistantMessageId(message: Message): string | undefined {
  if (
    message?.type === 'assistant' &&
    'id' in message.message &&
    message.message.model !== SYNTHETIC_MODEL
  ) {
    return message.message.id
  }
  return undefined
}

export function getTokenCountFromUsage(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    usage.output_tokens
  )
}

export function tokenCountFromLastAPIResponse(messages: Message[]): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      return getTokenCountFromUsage(usage)
    }
    i--
  }
  return 0
}

export function finalContextTokensFromLastResponse(
  messages: Message[],
): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      
      const iterations = (
        usage as {
          iterations?: Array<{
            input_tokens: number
            output_tokens: number
          }> | null
        }
      ).iterations
      if (iterations && iterations.length > 0) {
        const last = iterations.at(-1)!
        return last.input_tokens + last.output_tokens
      }
      
      
      
      
      
      
      
      return usage.input_tokens + usage.output_tokens
    }
    i--
  }
  return 0
}

export function messageTokenCountFromLastAPIResponse(
  messages: Message[],
): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      return usage.output_tokens
    }
    i--
  }
  return 0
}

export function getCurrentUsage(messages: Message[]): {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (usage) {
      return {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      }
    }
  }
  return null
}

export function doesMostRecentAssistantMessageExceed200k(
  messages: Message[],
): boolean {
  const THRESHOLD = 200_000

  const lastAsst = messages.findLast(m => m.type === 'assistant')
  if (!lastAsst) return false
  const usage = getTokenUsage(lastAsst)
  return usage ? getTokenCountFromUsage(usage) > THRESHOLD : false
}

export function getAssistantMessageContentLength(
  message: AssistantMessage,
): number {
  let contentLength = 0
  for (const block of message.message.content) {
    if (block.type === 'text') {
      contentLength += block.text.length
    } else if (block.type === 'thinking') {
      contentLength += block.thinking.length
    } else if (block.type === 'redacted_thinking') {
      contentLength += block.data.length
    } else if (block.type === 'tool_use') {
      contentLength += jsonStringify(block.input).length
    }
  }
  return contentLength
}

export function tokenCountWithEstimation(messages: readonly Message[]): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined
    if (message && usage) {
      
      
      
      const responseId = getAssistantMessageId(message)
      if (responseId) {
        let j = i - 1
        while (j >= 0) {
          const prior = messages[j]
          const priorId = prior ? getAssistantMessageId(prior) : undefined
          if (priorId === responseId) {
            
            i = j
          } else if (priorId !== undefined) {
            
            break
          }
          
          
          j--
        }
      }
      return (
        getTokenCountFromUsage(usage) +
        roughTokenCountEstimationForMessages(messages.slice(i + 1))
      )
    }
    i--
  }
  return roughTokenCountEstimationForMessages(messages)
}
