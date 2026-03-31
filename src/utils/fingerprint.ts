import { createHash } from 'crypto'
import type { AssistantMessage, UserMessage } from '../types/message.js'

export const FINGERPRINT_SALT = '59cf53e54c78'

export function extractFirstMessageText(
  messages: (UserMessage | AssistantMessage)[],
): string {
  const firstUserMessage = messages.find(msg => msg.type === 'user')
  if (!firstUserMessage) {
    return ''
  }

  const content = firstUserMessage.message.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const textBlock = content.find(block => block.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      return textBlock.text
    }
  }

  return ''
}

export function computeFingerprint(
  messageText: string,
  version: string,
): string {
  
  const indices = [4, 7, 20]
  const chars = indices.map(i => messageText[i] || '0').join('')

  const fingerprintInput = `${FINGERPRINT_SALT}${chars}${version}`

  
  const hash = createHash('sha256').update(fingerprintInput).digest('hex')
  return hash.slice(0, 3)
}

export function computeFingerprintFromMessages(
  messages: (UserMessage | AssistantMessage)[],
): string {
  const firstMessageText = extractFirstMessageText(messages)
  return computeFingerprint(firstMessageText, MACRO.VERSION)
}
