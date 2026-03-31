import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs'
import type { Tools } from '../Tool.js'
import type {
  GroupedToolUseMessage,
  NormalizedAssistantMessage,
  NormalizedMessage,
  NormalizedUserMessage,
  ProgressMessage,
  RenderableMessage,
} from '../types/message.js'

export type MessageWithoutProgress = Exclude<NormalizedMessage, ProgressMessage>

export type GroupingResult = {
  messages: RenderableMessage[]
}

const GROUPING_CACHE = new WeakMap<Tools, Set<string>>()

function getToolsWithGrouping(tools: Tools): Set<string> {
  let cached = GROUPING_CACHE.get(tools)
  if (!cached) {
    cached = new Set(tools.filter(t => t.renderGroupedToolUse).map(t => t.name))
    GROUPING_CACHE.set(tools, cached)
  }
  return cached
}

function getToolUseInfo(
  msg: MessageWithoutProgress,
): { messageId: string; toolUseId: string; toolName: string } | null {
  if (msg.type === 'assistant' && msg.message.content[0]?.type === 'tool_use') {
    const content = msg.message.content[0]
    return {
      messageId: msg.message.id,
      toolUseId: content.id,
      toolName: content.name,
    }
  }
  return null
}

export function applyGrouping(
  messages: MessageWithoutProgress[],
  tools: Tools,
  verbose: boolean = false,
): GroupingResult {
  
  if (verbose) {
    return {
      messages: messages,
    }
  }
  const toolsWithGrouping = getToolsWithGrouping(tools)

  
  const groups = new Map<
    string,
    NormalizedAssistantMessage<BetaToolUseBlock>[]
  >()

  for (const msg of messages) {
    const info = getToolUseInfo(msg)
    if (info && toolsWithGrouping.has(info.toolName)) {
      const key = `${info.messageId}:${info.toolName}`
      const group = groups.get(key) ?? []
      group.push(msg as NormalizedAssistantMessage<BetaToolUseBlock>)
      groups.set(key, group)
    }
  }

  
  const validGroups = new Map<
    string,
    NormalizedAssistantMessage<BetaToolUseBlock>[]
  >()
  const groupedToolUseIds = new Set<string>()

  for (const [key, group] of groups) {
    if (group.length >= 2) {
      validGroups.set(key, group)
      for (const msg of group) {
        const info = getToolUseInfo(msg)
        if (info) {
          groupedToolUseIds.add(info.toolUseId)
        }
      }
    }
  }

  
  
  const resultsByToolUseId = new Map<string, NormalizedUserMessage>()

  for (const msg of messages) {
    if (msg.type === 'user') {
      for (const content of msg.message.content) {
        if (
          content.type === 'tool_result' &&
          groupedToolUseIds.has(content.tool_use_id)
        ) {
          resultsByToolUseId.set(content.tool_use_id, msg)
        }
      }
    }
  }

  
  const result: RenderableMessage[] = []
  const emittedGroups = new Set<string>()

  for (const msg of messages) {
    const info = getToolUseInfo(msg)

    if (info) {
      const key = `${info.messageId}:${info.toolName}`
      const group = validGroups.get(key)

      if (group) {
        if (!emittedGroups.has(key)) {
          emittedGroups.add(key)
          const firstMsg = group[0]!

          
          const results: NormalizedUserMessage[] = []
          for (const assistantMsg of group) {
            const toolUseId = (
              assistantMsg.message.content[0] as { id: string }
            ).id
            const resultMsg = resultsByToolUseId.get(toolUseId)
            if (resultMsg) {
              results.push(resultMsg)
            }
          }

          const groupedMessage: GroupedToolUseMessage = {
            type: 'grouped_tool_use',
            toolName: info.toolName,
            messages: group,
            results,
            displayMessage: firstMsg,
            uuid: `grouped-${firstMsg.uuid}`,
            timestamp: firstMsg.timestamp,
            messageId: info.messageId,
          }
          result.push(groupedMessage)
        }
        continue
      }
    }

    
    if (msg.type === 'user') {
      const toolResults = msg.message.content.filter(
        (c): c is ToolResultBlockParam => c.type === 'tool_result',
      )
      if (toolResults.length > 0) {
        const allGrouped = toolResults.every(tr =>
          groupedToolUseIds.has(tr.tool_use_id),
        )
        if (allGrouped) {
          continue
        }
      }
    }

    result.push(msg)
  }

  return { messages: result }
}
