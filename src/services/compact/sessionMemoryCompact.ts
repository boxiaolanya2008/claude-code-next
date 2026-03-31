

import type { AgentId } from '../../types/ids.js'
import type { HookResultMessage, Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
  isCompactBoundaryMessage,
} from '../../utils/messages.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { processSessionStartHooks } from '../../utils/sessionStart.js'
import { getTranscriptPath } from '../../utils/sessionStorage.js'
import { tokenCountFromLastAPIResponse } from '../../utils/tokens.js'
import { extractDiscoveredToolNames } from '../../utils/toolSearch.js'
import {
  getDynamicConfig_BLOCKS_ON_INIT,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'
import { logEvent } from '../analytics/index.js'
import {
  isSessionMemoryEmpty,
  truncateSessionMemoryForCompact,
} from '../SessionMemory/prompts.js'
import {
  getLastSummarizedMessageId,
  getSessionMemoryContent,
  waitForSessionMemoryExtraction,
} from '../SessionMemory/sessionMemoryUtils.js'
import {
  annotateBoundaryWithPreservedSegment,
  buildPostCompactMessages,
  type CompactionResult,
  createPlanAttachmentIfNeeded,
} from './compact.js'
import { estimateMessageTokens } from './microCompact.js'
import { getCompactUserSummaryMessage } from './prompt.js'

export type SessionMemoryCompactConfig = {
  
  minTokens: number
  
  minTextBlockMessages: number
  
  maxTokens: number
}

export const DEFAULT_SM_COMPACT_CONFIG: SessionMemoryCompactConfig = {
  minTokens: 10_000,
  minTextBlockMessages: 5,
  maxTokens: 40_000,
}

let smCompactConfig: SessionMemoryCompactConfig = {
  ...DEFAULT_SM_COMPACT_CONFIG,
}

let configInitialized = false

export function setSessionMemoryCompactConfig(
  config: Partial<SessionMemoryCompactConfig>,
): void {
  smCompactConfig = {
    ...smCompactConfig,
    ...config,
  }
}

export function getSessionMemoryCompactConfig(): SessionMemoryCompactConfig {
  return { ...smCompactConfig }
}

export function resetSessionMemoryCompactConfig(): void {
  smCompactConfig = { ...DEFAULT_SM_COMPACT_CONFIG }
  configInitialized = false
}

async function initSessionMemoryCompactConfig(): Promise<void> {
  if (configInitialized) {
    return
  }
  configInitialized = true

  
  const remoteConfig = await getDynamicConfig_BLOCKS_ON_INIT<
    Partial<SessionMemoryCompactConfig>
  >('tengu_sm_compact_config', {})

  
  
  const config: SessionMemoryCompactConfig = {
    minTokens:
      remoteConfig.minTokens && remoteConfig.minTokens > 0
        ? remoteConfig.minTokens
        : DEFAULT_SM_COMPACT_CONFIG.minTokens,
    minTextBlockMessages:
      remoteConfig.minTextBlockMessages && remoteConfig.minTextBlockMessages > 0
        ? remoteConfig.minTextBlockMessages
        : DEFAULT_SM_COMPACT_CONFIG.minTextBlockMessages,
    maxTokens:
      remoteConfig.maxTokens && remoteConfig.maxTokens > 0
        ? remoteConfig.maxTokens
        : DEFAULT_SM_COMPACT_CONFIG.maxTokens,
  }
  setSessionMemoryCompactConfig(config)
}

export function hasTextBlocks(message: Message): boolean {
  if (message.type === 'assistant') {
    const content = message.message.content
    return content.some(block => block.type === 'text')
  }
  if (message.type === 'user') {
    const content = message.message.content
    if (typeof content === 'string') {
      return content.length > 0
    }
    if (Array.isArray(content)) {
      return content.some(block => block.type === 'text')
    }
  }
  return false
}

function getToolResultIds(message: Message): string[] {
  if (message.type !== 'user') {
    return []
  }
  const content = message.message.content
  if (!Array.isArray(content)) {
    return []
  }
  const ids: string[] = []
  for (const block of content) {
    if (block.type === 'tool_result') {
      ids.push(block.tool_use_id)
    }
  }
  return ids
}

function hasToolUseWithIds(message: Message, toolUseIds: Set<string>): boolean {
  if (message.type !== 'assistant') {
    return false
  }
  const content = message.message.content
  if (!Array.isArray(content)) {
    return false
  }
  return content.some(
    block => block.type === 'tool_use' && toolUseIds.has(block.id),
  )
}

export function adjustIndexToPreserveAPIInvariants(
  messages: Message[],
  startIndex: number,
): number {
  if (startIndex <= 0 || startIndex >= messages.length) {
    return startIndex
  }

  let adjustedIndex = startIndex

  
  
  const allToolResultIds: string[] = []
  for (let i = startIndex; i < messages.length; i++) {
    allToolResultIds.push(...getToolResultIds(messages[i]!))
  }

  if (allToolResultIds.length > 0) {
    
    const toolUseIdsInKeptRange = new Set<string>()
    for (let i = adjustedIndex; i < messages.length; i++) {
      const msg = messages[i]!
      if (msg.type === 'assistant' && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_use') {
            toolUseIdsInKeptRange.add(block.id)
          }
        }
      }
    }

    
    const neededToolUseIds = new Set(
      allToolResultIds.filter(id => !toolUseIdsInKeptRange.has(id)),
    )

    
    for (let i = adjustedIndex - 1; i >= 0 && neededToolUseIds.size > 0; i--) {
      const message = messages[i]!
      if (hasToolUseWithIds(message, neededToolUseIds)) {
        adjustedIndex = i
        
        if (
          message.type === 'assistant' &&
          Array.isArray(message.message.content)
        ) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use' && neededToolUseIds.has(block.id)) {
              neededToolUseIds.delete(block.id)
            }
          }
        }
      }
    }
  }

  
  
  const messageIdsInKeptRange = new Set<string>()
  for (let i = adjustedIndex; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.type === 'assistant' && msg.message.id) {
      messageIdsInKeptRange.add(msg.message.id)
    }
  }

  
  
  for (let i = adjustedIndex - 1; i >= 0; i--) {
    const message = messages[i]!
    if (
      message.type === 'assistant' &&
      message.message.id &&
      messageIdsInKeptRange.has(message.message.id)
    ) {
      
      
      adjustedIndex = i
    }
  }

  return adjustedIndex
}

export function calculateMessagesToKeepIndex(
  messages: Message[],
  lastSummarizedIndex: number,
): number {
  if (messages.length === 0) {
    return 0
  }

  const config = getSessionMemoryCompactConfig()

  
  
  
  let startIndex =
    lastSummarizedIndex >= 0 ? lastSummarizedIndex + 1 : messages.length

  
  let totalTokens = 0
  let textBlockMessageCount = 0
  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i]!
    totalTokens += estimateMessageTokens([msg])
    if (hasTextBlocks(msg)) {
      textBlockMessageCount++
    }
  }

  
  if (totalTokens >= config.maxTokens) {
    return adjustIndexToPreserveAPIInvariants(messages, startIndex)
  }

  
  if (
    totalTokens >= config.minTokens &&
    textBlockMessageCount >= config.minTextBlockMessages
  ) {
    return adjustIndexToPreserveAPIInvariants(messages, startIndex)
  }

  
  
  
  
  
  
  const idx = messages.findLastIndex(m => isCompactBoundaryMessage(m))
  const floor = idx === -1 ? 0 : idx + 1
  for (let i = startIndex - 1; i >= floor; i--) {
    const msg = messages[i]!
    const msgTokens = estimateMessageTokens([msg])
    totalTokens += msgTokens
    if (hasTextBlocks(msg)) {
      textBlockMessageCount++
    }
    startIndex = i

    
    if (totalTokens >= config.maxTokens) {
      break
    }

    
    if (
      totalTokens >= config.minTokens &&
      textBlockMessageCount >= config.minTextBlockMessages
    ) {
      break
    }
  }

  
  return adjustIndexToPreserveAPIInvariants(messages, startIndex)
}

export function shouldUseSessionMemoryCompaction(): boolean {
  
  if (isEnvTruthy(process.env.ENABLE_CLAUDE_CODE_NEXT_SM_COMPACT)) {
    return true
  }
  if (isEnvTruthy(process.env.DISABLE_CLAUDE_CODE_NEXT_SM_COMPACT)) {
    return false
  }

  const sessionMemoryFlag = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_session_memory',
    false,
  )
  const smCompactFlag = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_sm_compact',
    false,
  )
  const shouldUse = sessionMemoryFlag && smCompactFlag

  
  if (process.env.USER_TYPE === 'ant') {
    logEvent('tengu_sm_compact_flag_check', {
      tengu_session_memory: sessionMemoryFlag,
      tengu_sm_compact: smCompactFlag,
      should_use: shouldUse,
    })
  }

  return shouldUse
}

function createCompactionResultFromSessionMemory(
  messages: Message[],
  sessionMemory: string,
  messagesToKeep: Message[],
  hookResults: HookResultMessage[],
  transcriptPath: string,
  agentId?: AgentId,
): CompactionResult {
  const preCompactTokenCount = tokenCountFromLastAPIResponse(messages)

  const boundaryMarker = createCompactBoundaryMessage(
    'auto',
    preCompactTokenCount ?? 0,
    messages[messages.length - 1]?.uuid,
  )
  const preCompactDiscovered = extractDiscoveredToolNames(messages)
  if (preCompactDiscovered.size > 0) {
    boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
      ...preCompactDiscovered,
    ].sort()
  }

  
  
  const { truncatedContent, wasTruncated } =
    truncateSessionMemoryForCompact(sessionMemory)

  let summaryContent = getCompactUserSummaryMessage(
    truncatedContent,
    true,
    transcriptPath,
    true,
  )

  if (wasTruncated) {
    const memoryPath = getSessionMemoryPath()
    summaryContent += `\n\nSome session memory sections were truncated for length. The full session memory can be viewed at: ${memoryPath}`
  }

  const summaryMessages = [
    createUserMessage({
      content: summaryContent,
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    }),
  ]

  const planAttachment = createPlanAttachmentIfNeeded(agentId)
  const attachments = planAttachment ? [planAttachment] : []

  return {
    boundaryMarker: annotateBoundaryWithPreservedSegment(
      boundaryMarker,
      summaryMessages[summaryMessages.length - 1]!.uuid,
      messagesToKeep,
    ),
    summaryMessages,
    attachments,
    hookResults,
    messagesToKeep,
    preCompactTokenCount,
    
    
    postCompactTokenCount: estimateMessageTokens(summaryMessages),
    truePostCompactTokenCount: estimateMessageTokens(summaryMessages),
  }
}

export async function trySessionMemoryCompaction(
  messages: Message[],
  agentId?: AgentId,
  autoCompactThreshold?: number,
): Promise<CompactionResult | null> {
  if (!shouldUseSessionMemoryCompaction()) {
    return null
  }

  
  await initSessionMemoryCompactConfig()

  
  await waitForSessionMemoryExtraction()

  const lastSummarizedMessageId = getLastSummarizedMessageId()
  const sessionMemory = await getSessionMemoryContent()

  
  if (!sessionMemory) {
    logEvent('tengu_sm_compact_no_session_memory', {})
    return null
  }

  
  
  if (await isSessionMemoryEmpty(sessionMemory)) {
    logEvent('tengu_sm_compact_empty_template', {})
    return null
  }

  try {
    let lastSummarizedIndex: number

    if (lastSummarizedMessageId) {
      
      lastSummarizedIndex = messages.findIndex(
        msg => msg.uuid === lastSummarizedMessageId,
      )

      if (lastSummarizedIndex === -1) {
        
        
        
        logEvent('tengu_sm_compact_summarized_id_not_found', {})
        return null
      }
    } else {
      
      
      lastSummarizedIndex = messages.length - 1
      logEvent('tengu_sm_compact_resumed_session', {})
    }

    
    
    
    const startIndex = calculateMessagesToKeepIndex(
      messages,
      lastSummarizedIndex,
    )
    
    
    
    
    const messagesToKeep = messages
      .slice(startIndex)
      .filter(m => !isCompactBoundaryMessage(m))

    
    const hookResults = await processSessionStartHooks('compact', {
      model: getMainLoopModel(),
    })

    
    const transcriptPath = getTranscriptPath()

    const compactionResult = createCompactionResultFromSessionMemory(
      messages,
      sessionMemory,
      messagesToKeep,
      hookResults,
      transcriptPath,
      agentId,
    )

    const postCompactMessages = buildPostCompactMessages(compactionResult)

    const postCompactTokenCount = estimateMessageTokens(postCompactMessages)

    
    if (
      autoCompactThreshold !== undefined &&
      postCompactTokenCount >= autoCompactThreshold
    ) {
      logEvent('tengu_sm_compact_threshold_exceeded', {
        postCompactTokenCount,
        autoCompactThreshold,
      })
      return null
    }

    return {
      ...compactionResult,
      postCompactTokenCount,
      truePostCompactTokenCount: postCompactTokenCount,
    }
  } catch (error) {
    
    
    logEvent('tengu_sm_compact_error', {})
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(`Session memory compaction error: ${errorMessage(error)}`)
    }
    return null
  }
}
