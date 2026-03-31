

import { formatAPIError } from '../services/api/errorUtils.js'
import type { NonNullableUsage } from '../services/api/logging.js'
import type { Message, SystemAPIErrorMessage } from '../types/message.js'
import { type CacheSafeParams, runForkedAgent } from './forkedAgent.js'
import { createUserMessage, extractTextContent } from './messages.js'

const BTW_PATTERN = /^\/btw\b/gi

export function findBtwTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  const matches = text.matchAll(BTW_PATTERN)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

export type SideQuestionResult = {
  response: string | null
  usage: NonNullableUsage
}

export async function runSideQuestion({
  question,
  cacheSafeParams,
}: {
  question: string
  cacheSafeParams: CacheSafeParams
}): Promise<SideQuestionResult> {
  
  const wrappedQuestion = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>

${question}`

  const agentResult = await runForkedAgent({
    promptMessages: [createUserMessage({ content: wrappedQuestion })],
    
    
    
    cacheSafeParams,
    canUseTool: async () => ({
      behavior: 'deny' as const,
      message: 'Side questions cannot use tools',
      decisionReason: { type: 'other' as const, reason: 'side_question' },
    }),
    querySource: 'side_question',
    forkLabel: 'side_question',
    maxTurns: 1, 
    
    skipCacheWrite: true,
  })

  return {
    response: extractSideQuestionResponse(agentResult.messages),
    usage: agentResult.totalUsage,
  }
}

function extractSideQuestionResponse(messages: Message[]): string | null {
  
  const assistantBlocks = messages.flatMap(m =>
    m.type === 'assistant' ? m.message.content : [],
  )

  if (assistantBlocks.length > 0) {
    
    const text = extractTextContent(assistantBlocks, '\n\n').trim()
    if (text) return text

    
    const toolUse = assistantBlocks.find(b => b.type === 'tool_use')
    if (toolUse) {
      const toolName = 'name' in toolUse ? toolUse.name : 'a tool'
      return `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`
    }
  }

  
  
  const apiErr = messages.find(
    (m): m is SystemAPIErrorMessage =>
      m.type === 'system' && 'subtype' in m && m.subtype === 'api_error',
  )
  if (apiErr) {
    return `(API error: ${formatAPIError(apiErr.error)})`
  }

  return null
}
