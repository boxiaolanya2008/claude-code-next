import { feature } from 'bun:bundle'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from '../../tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from '../../tools/WebSearchTool/prompt.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { SHELL_TOOL_NAMES } from '../../utils/shell/shellToolUtils.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { notifyCacheDeletion } from '../api/promptCacheBreakDetection.js'
import { roughTokenCountEstimation } from '../tokenEstimation.js'
import {
  clearCompactWarningSuppression,
  suppressCompactWarning,
} from './compactWarningState.js'
import {
  getTimeBasedMCConfig,
  type TimeBasedMCConfig,
} from './timeBasedMCConfig.js'

export const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]'

const IMAGE_MAX_TOKEN_SIZE = 2000

const COMPACTABLE_TOOLS = new Set<string>([
  FILE_READ_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
])

let cachedMCModule: typeof import('./cachedMicrocompact.js') | null = null
let cachedMCState: import('./cachedMicrocompact.js').CachedMCState | null = null
let pendingCacheEdits:
  | import('./cachedMicrocompact.js').CacheEditsBlock
  | null = null

async function getCachedMCModule(): Promise<
  typeof import('./cachedMicrocompact.js')
> {
  if (!cachedMCModule) {
    cachedMCModule = await import('./cachedMicrocompact.js')
  }
  return cachedMCModule
}

function ensureCachedMCState(): import('./cachedMicrocompact.js').CachedMCState {
  if (!cachedMCState && cachedMCModule) {
    cachedMCState = cachedMCModule.createCachedMCState()
  }
  if (!cachedMCState) {
    throw new Error(
      'cachedMCState not initialized — getCachedMCModule() must be called first',
    )
  }
  return cachedMCState
}

export function consumePendingCacheEdits():
  | import('./cachedMicrocompact.js').CacheEditsBlock
  | null {
  const edits = pendingCacheEdits
  pendingCacheEdits = null
  return edits
}

export function getPinnedCacheEdits(): import('./cachedMicrocompact.js').PinnedCacheEdits[] {
  if (!cachedMCState) {
    return []
  }
  return cachedMCState.pinnedEdits
}

export function pinCacheEdits(
  userMessageIndex: number,
  block: import('./cachedMicrocompact.js').CacheEditsBlock,
): void {
  if (cachedMCState) {
    cachedMCState.pinnedEdits.push({ userMessageIndex, block })
  }
}

export function markToolsSentToAPIState(): void {
  if (cachedMCState && cachedMCModule) {
    cachedMCModule.markToolsSentToAPI(cachedMCState)
  }
}

export function resetMicrocompactState(): void {
  if (cachedMCState && cachedMCModule) {
    cachedMCModule.resetCachedMCState(cachedMCState)
  }
  pendingCacheEdits = null
}

function calculateToolResultTokens(block: ToolResultBlockParam): number {
  if (!block.content) {
    return 0
  }

  if (typeof block.content === 'string') {
    return roughTokenCountEstimation(block.content)
  }

  
  return block.content.reduce((sum, item) => {
    if (item.type === 'text') {
      return sum + roughTokenCountEstimation(item.text)
    } else if (item.type === 'image' || item.type === 'document') {
      
      return sum + IMAGE_MAX_TOKEN_SIZE
    }
    return sum
  }, 0)
}

export function estimateMessageTokens(messages: Message[]): number {
  let totalTokens = 0

  for (const message of messages) {
    if (message.type !== 'user' && message.type !== 'assistant') {
      continue
    }

    if (!Array.isArray(message.message.content)) {
      continue
    }

    for (const block of message.message.content) {
      if (block.type === 'text') {
        totalTokens += roughTokenCountEstimation(block.text)
      } else if (block.type === 'tool_result') {
        totalTokens += calculateToolResultTokens(block)
      } else if (block.type === 'image' || block.type === 'document') {
        totalTokens += IMAGE_MAX_TOKEN_SIZE
      } else if (block.type === 'thinking') {
        
        
        
        totalTokens += roughTokenCountEstimation(block.thinking)
      } else if (block.type === 'redacted_thinking') {
        totalTokens += roughTokenCountEstimation(block.data)
      } else if (block.type === 'tool_use') {
        
        
        totalTokens += roughTokenCountEstimation(
          block.name + jsonStringify(block.input ?? {}),
        )
      } else {
        
        totalTokens += roughTokenCountEstimation(jsonStringify(block))
      }
    }
  }

  
  return Math.ceil(totalTokens * (4 / 3))
}

export type PendingCacheEdits = {
  trigger: 'auto'
  deletedToolIds: string[]
  
  
  baselineCacheDeletedTokens: number
}

export type MicrocompactResult = {
  messages: Message[]
  compactionInfo?: {
    pendingCacheEdits?: PendingCacheEdits
  }
}

function collectCompactableToolIds(messages: Message[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message.content)
    ) {
      for (const block of message.message.content) {
        if (block.type === 'tool_use' && COMPACTABLE_TOOLS.has(block.name)) {
          ids.push(block.id)
        }
      }
    }
  }
  return ids
}

function isMainThreadSource(querySource: QuerySource | undefined): boolean {
  return !querySource || querySource.startsWith('repl_main_thread')
}

export async function microcompactMessages(
  messages: Message[],
  toolUseContext?: ToolUseContext,
  querySource?: QuerySource,
): Promise<MicrocompactResult> {
  
  clearCompactWarningSuppression()

  
  
  
  
  
  
  const timeBasedResult = maybeTimeBasedMicrocompact(messages, querySource)
  if (timeBasedResult) {
    return timeBasedResult
  }

  
  
  
  
  if (feature('CACHED_MICROCOMPACT')) {
    const mod = await getCachedMCModule()
    const model = toolUseContext?.options.mainLoopModel ?? getMainLoopModel()
    if (
      mod.isCachedMicrocompactEnabled() &&
      mod.isModelSupportedForCacheEditing(model) &&
      isMainThreadSource(querySource)
    ) {
      return await cachedMicrocompactPath(messages, querySource)
    }
  }

  
  
  
  
  return { messages }
}

async function cachedMicrocompactPath(
  messages: Message[],
  querySource: QuerySource | undefined,
): Promise<MicrocompactResult> {
  const mod = await getCachedMCModule()
  const state = ensureCachedMCState()
  const config = mod.getCachedMCConfig()

  const compactableToolIds = new Set(collectCompactableToolIds(messages))
  
  for (const message of messages) {
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      const groupIds: string[] = []
      for (const block of message.message.content) {
        if (
          block.type === 'tool_result' &&
          compactableToolIds.has(block.tool_use_id) &&
          !state.registeredTools.has(block.tool_use_id)
        ) {
          mod.registerToolResult(state, block.tool_use_id)
          groupIds.push(block.tool_use_id)
        }
      }
      mod.registerToolMessage(state, groupIds)
    }
  }

  const toolsToDelete = mod.getToolResultsToDelete(state)

  if (toolsToDelete.length > 0) {
    
    const cacheEdits = mod.createCacheEditsBlock(state, toolsToDelete)
    if (cacheEdits) {
      pendingCacheEdits = cacheEdits
    }

    logForDebugging(
      `Cached MC deleting ${toolsToDelete.length} tool(s): ${toolsToDelete.join(', ')}`,
    )

    
    logEvent('tengu_cached_microcompact', {
      toolsDeleted: toolsToDelete.length,
      deletedToolIds: toolsToDelete.join(
        ',',
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      activeToolCount: state.toolOrder.length - state.deletedRefs.size,
      triggerType:
        'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      threshold: config.triggerThreshold,
      keepRecent: config.keepRecent,
    })

    
    suppressCompactWarning()

    
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      
      
      
      notifyCacheDeletion(querySource ?? 'repl_main_thread')
    }

    
    
    
    
    
    const lastAsst = messages.findLast(m => m.type === 'assistant')
    const baseline =
      lastAsst?.type === 'assistant'
        ? ((
            lastAsst.message.usage as unknown as Record<
              string,
              number | undefined
            >
          )?.cache_deleted_input_tokens ?? 0)
        : 0

    return {
      messages,
      compactionInfo: {
        pendingCacheEdits: {
          trigger: 'auto',
          deletedToolIds: toolsToDelete,
          baselineCacheDeletedTokens: baseline,
        },
      },
    }
  }

  
  return { messages }
}

export function evaluateTimeBasedTrigger(
  messages: Message[],
  querySource: QuerySource | undefined,
): { gapMinutes: number; config: TimeBasedMCConfig } | null {
  const config = getTimeBasedMCConfig()
  
  
  
  
  if (!config.enabled || !querySource || !isMainThreadSource(querySource)) {
    return null
  }
  const lastAssistant = messages.findLast(m => m.type === 'assistant')
  if (!lastAssistant) {
    return null
  }
  const gapMinutes =
    (Date.now() - new Date(lastAssistant.timestamp).getTime()) / 60_000
  if (!Number.isFinite(gapMinutes) || gapMinutes < config.gapThresholdMinutes) {
    return null
  }
  return { gapMinutes, config }
}

function maybeTimeBasedMicrocompact(
  messages: Message[],
  querySource: QuerySource | undefined,
): MicrocompactResult | null {
  const trigger = evaluateTimeBasedTrigger(messages, querySource)
  if (!trigger) {
    return null
  }
  const { gapMinutes, config } = trigger

  const compactableIds = collectCompactableToolIds(messages)

  
  
  
  const keepRecent = Math.max(1, config.keepRecent)
  const keepSet = new Set(compactableIds.slice(-keepRecent))
  const clearSet = new Set(compactableIds.filter(id => !keepSet.has(id)))

  if (clearSet.size === 0) {
    return null
  }

  let tokensSaved = 0
  const result: Message[] = messages.map(message => {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      return message
    }
    let touched = false
    const newContent = message.message.content.map(block => {
      if (
        block.type === 'tool_result' &&
        clearSet.has(block.tool_use_id) &&
        block.content !== TIME_BASED_MC_CLEARED_MESSAGE
      ) {
        tokensSaved += calculateToolResultTokens(block)
        touched = true
        return { ...block, content: TIME_BASED_MC_CLEARED_MESSAGE }
      }
      return block
    })
    if (!touched) return message
    return {
      ...message,
      message: { ...message.message, content: newContent },
    }
  })

  if (tokensSaved === 0) {
    return null
  }

  logEvent('tengu_time_based_microcompact', {
    gapMinutes: Math.round(gapMinutes),
    gapThresholdMinutes: config.gapThresholdMinutes,
    toolsCleared: clearSet.size,
    toolsKept: keepSet.size,
    keepRecent: config.keepRecent,
    tokensSaved,
  })

  logForDebugging(
    `[TIME-BASED MC] gap ${Math.round(gapMinutes)}min > ${config.gapThresholdMinutes}min, cleared ${clearSet.size} tool results (~${tokensSaved} tokens), kept last ${keepSet.size}`,
  )

  suppressCompactWarning()
  
  
  
  
  
  resetMicrocompactState()
  
  
  
  
  
  
  
  if (feature('PROMPT_CACHE_BREAK_DETECTION') && querySource) {
    notifyCacheDeletion(querySource)
  }

  return { messages: result }
}
