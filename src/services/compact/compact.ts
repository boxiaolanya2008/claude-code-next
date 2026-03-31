import { feature } from "../utils/bundle-mock.ts"
import type { UUID } from 'crypto'
import uniqBy from 'lodash-es/uniqBy.js'

const sessionTranscriptModule = feature('KAIROS')
  ? (require('../sessionTranscript/sessionTranscript.js') as typeof import('../sessionTranscript/sessionTranscript.js'))
  : null

import { APIUserAbortError } from '@anthropic-ai/sdk'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getInvokedSkillsForAgent } from '../../bootstrap/state.js'
import type { QuerySource } from '../../constants/querySource.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import {
  FILE_READ_TOOL_NAME,
  FILE_UNCHANGED_STUB,
} from '../../tools/FileReadTool/prompt.js'
import { ToolSearchTool } from '../../tools/ToolSearchTool/ToolSearchTool.js'
import type { AgentId } from '../../types/ids.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  HookResultMessage,
  Message,
  PartialCompactDirection,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from '../../types/message.js'
import {
  createAttachmentMessage,
  generateFileAttachment,
  getAgentListingDeltaAttachment,
  getDeferredToolsDeltaAttachment,
  getMcpInstructionsDeltaAttachment,
} from '../../utils/attachments.js'
import { getMemoryPath } from '../../utils/config.js'
import { COMPACT_MAX_OUTPUT_TOKENS } from '../../utils/context.js'
import {
  analyzeContext,
  tokenStatsToStatsigMetrics,
} from '../../utils/contextAnalysis.js'
import { logForDebugging } from '../../utils/debug.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import { cacheToObject } from '../../utils/fileStateCache.js'
import {
  type CacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  executePostCompactHooks,
  executePreCompactHooks,
} from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import { MEMORY_TYPE_VALUES } from '../../utils/memory/types.js'
import {
  createCompactBoundaryMessage,
  createUserMessage,
  getAssistantMessageText,
  getLastAssistantMessage,
  getMessagesAfterCompactBoundary,
  isCompactBoundaryMessage,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import { expandPath } from '../../utils/path.js'
import { getPlan, getPlanFilePath } from '../../utils/plans.js'
import {
  isSessionActivityTrackingActive,
  sendSessionActivitySignal,
} from '../../utils/sessionActivity.js'
import { processSessionStartHooks } from '../../utils/sessionStart.js'
import {
  getTranscriptPath,
  reAppendSessionMetadata,
} from '../../utils/sessionStorage.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'

import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getTaskOutputPath } from '../../utils/task/diskOutput.js'
import {
  getTokenUsage,
  tokenCountFromLastAPIResponse,
  tokenCountWithEstimation,
} from '../../utils/tokens.js'
import {
  extractDiscoveredToolNames,
  isToolSearchEnabled,
} from '../../utils/toolSearch.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  getMaxOutputTokensForModel,
  queryModelWithStreaming,
} from '../api/claude.js'
import {
  getPromptTooLongTokenGap,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  startsWithApiErrorPrefix,
} from '../api/errors.js'
import { notifyCompaction } from '../api/promptCacheBreakDetection.js'
import { getRetryDelay } from '../api/withRetry.js'
import { logPermissionContextForAnts } from '../internalLogging.js'
import {
  roughTokenCountEstimation,
  roughTokenCountEstimationForMessages,
} from '../tokenEstimation.js'
import { groupMessagesByApiRound } from './grouping.js'
import {
  getCompactPrompt,
  getCompactUserSummaryMessage,
  getPartialCompactPrompt,
} from './prompt.js'

export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5
export const POST_COMPACT_TOKEN_BUDGET = 50_000
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000

export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
const MAX_COMPACT_STREAMING_RETRIES = 2

export function stripImagesFromMessages(messages: Message[]): Message[] {
  return messages.map(message => {
    if (message.type !== 'user') {
      return message
    }

    const content = message.message.content
    if (!Array.isArray(content)) {
      return message
    }

    let hasMediaBlock = false
    const newContent = content.flatMap(block => {
      if (block.type === 'image') {
        hasMediaBlock = true
        return [{ type: 'text' as const, text: '[image]' }]
      }
      if (block.type === 'document') {
        hasMediaBlock = true
        return [{ type: 'text' as const, text: '[document]' }]
      }
      
      if (block.type === 'tool_result' && Array.isArray(block.content)) {
        let toolHasMedia = false
        const newToolContent = block.content.map(item => {
          if (item.type === 'image') {
            toolHasMedia = true
            return { type: 'text' as const, text: '[image]' }
          }
          if (item.type === 'document') {
            toolHasMedia = true
            return { type: 'text' as const, text: '[document]' }
          }
          return item
        })
        if (toolHasMedia) {
          hasMediaBlock = true
          return [{ ...block, content: newToolContent }]
        }
      }
      return [block]
    })

    if (!hasMediaBlock) {
      return message
    }

    return {
      ...message,
      message: {
        ...message.message,
        content: newContent,
      },
    } as typeof message
  })
}

export function stripReinjectedAttachments(messages: Message[]): Message[] {
  if (feature('EXPERIMENTAL_SKILL_SEARCH')) {
    return messages.filter(
      m =>
        !(
          m.type === 'attachment' &&
          (m.attachment.type === 'skill_discovery' ||
            m.attachment.type === 'skill_listing')
        ),
    )
  }
  return messages
}

export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
  'Not enough messages to compact.'
const MAX_PTL_RETRIES = 3
const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]'

export function truncateHeadForPTLRetry(
  messages: Message[],
  ptlResponse: AssistantMessage,
): Message[] | null {
  
  
  
  const input =
    messages[0]?.type === 'user' &&
    messages[0].isMeta &&
    messages[0].message.content === PTL_RETRY_MARKER
      ? messages.slice(1)
      : messages

  const groups = groupMessagesByApiRound(input)
  if (groups.length < 2) return null

  const tokenGap = getPromptTooLongTokenGap(ptlResponse)
  let dropCount: number
  if (tokenGap !== undefined) {
    let acc = 0
    dropCount = 0
    for (const g of groups) {
      acc += roughTokenCountEstimationForMessages(g)
      dropCount++
      if (acc >= tokenGap) break
    }
  } else {
    dropCount = Math.max(1, Math.floor(groups.length * 0.2))
  }

  
  dropCount = Math.min(dropCount, groups.length - 1)
  if (dropCount < 1) return null

  const sliced = groups.slice(dropCount).flat()
  
  
  
  
  
  if (sliced[0]?.type === 'assistant') {
    return [
      createUserMessage({ content: PTL_RETRY_MARKER, isMeta: true }),
      ...sliced,
    ]
  }
  return sliced
}

export const ERROR_MESSAGE_PROMPT_TOO_LONG =
  'Conversation too long. Press esc twice to go up a few messages and try again.'
export const ERROR_MESSAGE_USER_ABORT = 'API Error: Request was aborted.'
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  'Compaction interrupted · This may be due to network issues — please try again.'

export interface CompactionResult {
  boundaryMarker: SystemMessage
  summaryMessages: UserMessage[]
  attachments: AttachmentMessage[]
  hookResults: HookResultMessage[]
  messagesToKeep?: Message[]
  userDisplayMessage?: string
  preCompactTokenCount?: number
  postCompactTokenCount?: number
  truePostCompactTokenCount?: number
  compactionUsage?: ReturnType<typeof getTokenUsage>
}

export type RecompactionInfo = {
  isRecompactionInChain: boolean
  turnsSincePreviousCompact: number
  previousCompactTurnId?: string
  autoCompactThreshold: number
  querySource?: QuerySource
}

export function buildPostCompactMessages(result: CompactionResult): Message[] {
  return [
    result.boundaryMarker,
    ...result.summaryMessages,
    ...(result.messagesToKeep ?? []),
    ...result.attachments,
    ...result.hookResults,
  ]
}

export function annotateBoundaryWithPreservedSegment(
  boundary: SystemCompactBoundaryMessage,
  anchorUuid: UUID,
  messagesToKeep: readonly Message[] | undefined,
): SystemCompactBoundaryMessage {
  const keep = messagesToKeep ?? []
  if (keep.length === 0) return boundary
  return {
    ...boundary,
    compactMetadata: {
      ...boundary.compactMetadata,
      preservedSegment: {
        headUuid: keep[0]!.uuid,
        anchorUuid,
        tailUuid: keep.at(-1)!.uuid,
      },
    },
  }
}

export function mergeHookInstructions(
  userInstructions: string | undefined,
  hookInstructions: string | undefined,
): string | undefined {
  if (!hookInstructions) return userInstructions || undefined
  if (!userInstructions) return hookInstructions
  return `${userInstructions}\n\n${hookInstructions}`
}

export async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  suppressFollowUpQuestions: boolean,
  customInstructions?: string,
  isAutoCompact: boolean = false,
  recompactionInfo?: RecompactionInfo,
): Promise<CompactionResult> {
  try {
    if (messages.length === 0) {
      throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
    }

    const preCompactTokenCount = tokenCountWithEstimation(messages)

    const appState = context.getAppState()
    void logPermissionContextForAnts(appState.toolPermissionContext, 'summary')

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'pre_compact',
    })

    
    context.setSDKStatus?.('compacting')
    const hookResult = await executePreCompactHooks(
      {
        trigger: isAutoCompact ? 'auto' : 'manual',
        customInstructions: customInstructions ?? null,
      },
      context.abortController.signal,
    )
    customInstructions = mergeHookInstructions(
      customInstructions,
      hookResult.newCustomInstructions,
    )
    const userDisplayMessage = hookResult.userDisplayMessage

    
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_start' })

    
    
    
    
    const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_compact_cache_prefix',
      true,
    )

    const compactPrompt = getCompactPrompt(customInstructions)
    const summaryRequest = createUserMessage({
      content: compactPrompt,
    })

    let messagesToSummarize = messages
    let retryCacheSafeParams = cacheSafeParams
    let summaryResponse: AssistantMessage
    let summary: string | null
    let ptlAttempts = 0
    for (;;) {
      summaryResponse = await streamCompactSummary({
        messages: messagesToSummarize,
        summaryRequest,
        appState,
        context,
        preCompactTokenCount,
        cacheSafeParams: retryCacheSafeParams,
      })
      summary = getAssistantMessageText(summaryResponse)
      if (!summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) break

      
      
      ptlAttempts++
      const truncated =
        ptlAttempts <= MAX_PTL_RETRIES
          ? truncateHeadForPTLRetry(messagesToSummarize, summaryResponse)
          : null
      if (!truncated) {
        logEvent('tengu_compact_failed', {
          reason:
            'prompt_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
          promptCacheSharingEnabled,
          ptlAttempts,
        })
        throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
      }
      logEvent('tengu_compact_ptl_retry', {
        attempt: ptlAttempts,
        droppedMessages: messagesToSummarize.length - truncated.length,
        remainingMessages: truncated.length,
      })
      messagesToSummarize = truncated
      
      
      retryCacheSafeParams = {
        ...retryCacheSafeParams,
        forkContextMessages: truncated,
      }
    }

    if (!summary) {
      logForDebugging(
        `Compact failed: no summary text in response. Response: ${jsonStringify(summaryResponse)}`,
        { level: 'error' },
      )
      logEvent('tengu_compact_failed', {
        reason:
          'no_summary' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        promptCacheSharingEnabled,
      })
      throw new Error(
        `Failed to generate conversation summary - response did not contain valid text content`,
      )
    } else if (startsWithApiErrorPrefix(summary)) {
      logEvent('tengu_compact_failed', {
        reason:
          'api_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        promptCacheSharingEnabled,
      })
      throw new Error(summary)
    }

    
    const preCompactReadFileState = cacheToObject(context.readFileState)

    
    context.readFileState.clear()
    context.loadedNestedMemoryPaths?.clear()

    
    
    
    
    
    

    
    const [fileAttachments, asyncAgentAttachments] = await Promise.all([
      createPostCompactFileAttachments(
        preCompactReadFileState,
        context,
        POST_COMPACT_MAX_FILES_TO_RESTORE,
      ),
      createAsyncAgentAttachmentsIfNeeded(context),
    ])

    const postCompactFileAttachments: AttachmentMessage[] = [
      ...fileAttachments,
      ...asyncAgentAttachments,
    ]
    const planAttachment = createPlanAttachmentIfNeeded(context.agentId)
    if (planAttachment) {
      postCompactFileAttachments.push(planAttachment)
    }

    
    
    const planModeAttachment = await createPlanModeAttachmentIfNeeded(context)
    if (planModeAttachment) {
      postCompactFileAttachments.push(planModeAttachment)
    }

    
    const skillAttachment = createSkillAttachmentIfNeeded(context.agentId)
    if (skillAttachment) {
      postCompactFileAttachments.push(skillAttachment)
    }

    
    
    
    
    for (const att of getDeferredToolsDeltaAttachment(
      context.options.tools,
      context.options.mainLoopModel,
      [],
      { callSite: 'compact_full' },
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getAgentListingDeltaAttachment(context, [])) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getMcpInstructionsDeltaAttachment(
      context.options.mcpClients,
      context.options.tools,
      context.options.mainLoopModel,
      [],
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'session_start',
    })
    
    const hookMessages = await processSessionStartHooks('compact', {
      model: context.options.mainLoopModel,
    })

    
    
    const boundaryMarker = createCompactBoundaryMessage(
      isAutoCompact ? 'auto' : 'manual',
      preCompactTokenCount ?? 0,
      messages.at(-1)?.uuid,
    )
    
    
    
    const preCompactDiscovered = extractDiscoveredToolNames(messages)
    if (preCompactDiscovered.size > 0) {
      boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
        ...preCompactDiscovered,
      ].sort()
    }

    const transcriptPath = getTranscriptPath()
    const summaryMessages: UserMessage[] = [
      createUserMessage({
        content: getCompactUserSummaryMessage(
          summary,
          suppressFollowUpQuestions,
          transcriptPath,
        ),
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
      }),
    ]

    
    
    
    const compactionCallTotalTokens = tokenCountFromLastAPIResponse([
      summaryResponse,
    ])

    
    
    
    
    const truePostCompactTokenCount = roughTokenCountEstimationForMessages([
      boundaryMarker,
      ...summaryMessages,
      ...postCompactFileAttachments,
      ...hookMessages,
    ])

    
    const compactionUsage = getTokenUsage(summaryResponse)

    const querySourceForEvent =
      recompactionInfo?.querySource ?? context.options.querySource ?? 'unknown'

    logEvent('tengu_compact', {
      preCompactTokenCount,
      
      postCompactTokenCount: compactionCallTotalTokens,
      truePostCompactTokenCount,
      autoCompactThreshold: recompactionInfo?.autoCompactThreshold ?? -1,
      willRetriggerNextTurn:
        recompactionInfo !== undefined &&
        truePostCompactTokenCount >= recompactionInfo.autoCompactThreshold,
      isAutoCompact,
      querySource:
        querySourceForEvent as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryChainId: (context.queryTracking?.chainId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: context.queryTracking?.depth ?? -1,
      isRecompactionInChain: recompactionInfo?.isRecompactionInChain ?? false,
      turnsSincePreviousCompact:
        recompactionInfo?.turnsSincePreviousCompact ?? -1,
      previousCompactTurnId: (recompactionInfo?.previousCompactTurnId ??
        '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      compactionInputTokens: compactionUsage?.input_tokens,
      compactionOutputTokens: compactionUsage?.output_tokens,
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens:
        compactionUsage?.cache_creation_input_tokens ?? 0,
      compactionTotalTokens: compactionUsage
        ? compactionUsage.input_tokens +
          (compactionUsage.cache_creation_input_tokens ?? 0) +
          (compactionUsage.cache_read_input_tokens ?? 0) +
          compactionUsage.output_tokens
        : 0,
      promptCacheSharingEnabled,
      
      
      
      
      
      ...(() => {
        try {
          return tokenStatsToStatsigMetrics(analyzeContext(messages))
        } catch (error) {
          logError(error as Error)
          return {}
        }
      })(),
    })

    
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(
        context.options.querySource ?? 'compact',
        context.agentId,
      )
    }
    markPostCompaction()

    
    
    
    
    
    reAppendSessionMetadata()

    
    
    if (feature('KAIROS')) {
      void sessionTranscriptModule?.writeSessionTranscriptSegment(messages)
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'post_compact',
    })
    const postCompactHookResult = await executePostCompactHooks(
      {
        trigger: isAutoCompact ? 'auto' : 'manual',
        compactSummary: summary,
      },
      context.abortController.signal,
    )

    const combinedUserDisplayMessage = [
      userDisplayMessage,
      postCompactHookResult.userDisplayMessage,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      boundaryMarker,
      summaryMessages,
      attachments: postCompactFileAttachments,
      hookResults: hookMessages,
      userDisplayMessage: combinedUserDisplayMessage || undefined,
      preCompactTokenCount,
      postCompactTokenCount: compactionCallTotalTokens,
      truePostCompactTokenCount,
      compactionUsage,
    }
  } catch (error) {
    
    
    
    if (!isAutoCompact) {
      addErrorNotificationIfNeeded(error, context)
    }
    throw error
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })
    context.setSDKStatus?.(null)
  }
}

export async function partialCompactConversation(
  allMessages: Message[],
  pivotIndex: number,
  context: ToolUseContext,
  cacheSafeParams: CacheSafeParams,
  userFeedback?: string,
  direction: PartialCompactDirection = 'from',
): Promise<CompactionResult> {
  try {
    const messagesToSummarize =
      direction === 'up_to'
        ? allMessages.slice(0, pivotIndex)
        : allMessages.slice(pivotIndex)
    
    
    
    
    
    const messagesToKeep =
      direction === 'up_to'
        ? allMessages
            .slice(pivotIndex)
            .filter(
              m =>
                m.type !== 'progress' &&
                !isCompactBoundaryMessage(m) &&
                !(m.type === 'user' && m.isCompactSummary),
            )
        : allMessages.slice(0, pivotIndex).filter(m => m.type !== 'progress')

    if (messagesToSummarize.length === 0) {
      throw new Error(
        direction === 'up_to'
          ? 'Nothing to summarize before the selected message.'
          : 'Nothing to summarize after the selected message.',
      )
    }

    const preCompactTokenCount = tokenCountWithEstimation(allMessages)

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'pre_compact',
    })

    context.setSDKStatus?.('compacting')
    const hookResult = await executePreCompactHooks(
      {
        trigger: 'manual',
        customInstructions: null,
      },
      context.abortController.signal,
    )

    
    let customInstructions: string | undefined
    if (hookResult.newCustomInstructions && userFeedback) {
      customInstructions = `${hookResult.newCustomInstructions}\n\nUser context: ${userFeedback}`
    } else if (hookResult.newCustomInstructions) {
      customInstructions = hookResult.newCustomInstructions
    } else if (userFeedback) {
      customInstructions = `User context: ${userFeedback}`
    }

    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_start' })

    const compactPrompt = getPartialCompactPrompt(customInstructions, direction)
    const summaryRequest = createUserMessage({
      content: compactPrompt,
    })

    const failureMetadata = {
      preCompactTokenCount,
      direction:
        direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messagesSummarized: messagesToSummarize.length,
    }

    
    
    let apiMessages = direction === 'up_to' ? messagesToSummarize : allMessages
    let retryCacheSafeParams =
      direction === 'up_to'
        ? { ...cacheSafeParams, forkContextMessages: messagesToSummarize }
        : cacheSafeParams
    let summaryResponse: AssistantMessage
    let summary: string | null
    let ptlAttempts = 0
    for (;;) {
      summaryResponse = await streamCompactSummary({
        messages: apiMessages,
        summaryRequest,
        appState: context.getAppState(),
        context,
        preCompactTokenCount,
        cacheSafeParams: retryCacheSafeParams,
      })
      summary = getAssistantMessageText(summaryResponse)
      if (!summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) break

      ptlAttempts++
      const truncated =
        ptlAttempts <= MAX_PTL_RETRIES
          ? truncateHeadForPTLRetry(apiMessages, summaryResponse)
          : null
      if (!truncated) {
        logEvent('tengu_partial_compact_failed', {
          reason:
            'prompt_too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...failureMetadata,
          ptlAttempts,
        })
        throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
      }
      logEvent('tengu_compact_ptl_retry', {
        attempt: ptlAttempts,
        droppedMessages: apiMessages.length - truncated.length,
        remainingMessages: truncated.length,
        path: 'partial' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      apiMessages = truncated
      retryCacheSafeParams = {
        ...retryCacheSafeParams,
        forkContextMessages: truncated,
      }
    }
    if (!summary) {
      logEvent('tengu_partial_compact_failed', {
        reason:
          'no_summary' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...failureMetadata,
      })
      throw new Error(
        'Failed to generate conversation summary - response did not contain valid text content',
      )
    } else if (startsWithApiErrorPrefix(summary)) {
      logEvent('tengu_partial_compact_failed', {
        reason:
          'api_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...failureMetadata,
      })
      throw new Error(summary)
    }

    
    const preCompactReadFileState = cacheToObject(context.readFileState)
    context.readFileState.clear()
    context.loadedNestedMemoryPaths?.clear()
    
    

    const [fileAttachments, asyncAgentAttachments] = await Promise.all([
      createPostCompactFileAttachments(
        preCompactReadFileState,
        context,
        POST_COMPACT_MAX_FILES_TO_RESTORE,
        messagesToKeep,
      ),
      createAsyncAgentAttachmentsIfNeeded(context),
    ])

    const postCompactFileAttachments: AttachmentMessage[] = [
      ...fileAttachments,
      ...asyncAgentAttachments,
    ]
    const planAttachment = createPlanAttachmentIfNeeded(context.agentId)
    if (planAttachment) {
      postCompactFileAttachments.push(planAttachment)
    }

    
    const planModeAttachment = await createPlanModeAttachmentIfNeeded(context)
    if (planModeAttachment) {
      postCompactFileAttachments.push(planModeAttachment)
    }

    const skillAttachment = createSkillAttachmentIfNeeded(context.agentId)
    if (skillAttachment) {
      postCompactFileAttachments.push(skillAttachment)
    }

    
    
    for (const att of getDeferredToolsDeltaAttachment(
      context.options.tools,
      context.options.mainLoopModel,
      messagesToKeep,
      { callSite: 'compact_partial' },
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getAgentListingDeltaAttachment(context, messagesToKeep)) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }
    for (const att of getMcpInstructionsDeltaAttachment(
      context.options.mcpClients,
      context.options.tools,
      context.options.mainLoopModel,
      messagesToKeep,
    )) {
      postCompactFileAttachments.push(createAttachmentMessage(att))
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'session_start',
    })
    const hookMessages = await processSessionStartHooks('compact', {
      model: context.options.mainLoopModel,
    })

    const postCompactTokenCount = tokenCountFromLastAPIResponse([
      summaryResponse,
    ])
    const compactionUsage = getTokenUsage(summaryResponse)

    logEvent('tengu_partial_compact', {
      preCompactTokenCount,
      postCompactTokenCount,
      messagesKept: messagesToKeep.length,
      messagesSummarized: messagesToSummarize.length,
      direction:
        direction as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      hasUserFeedback: !!userFeedback,
      trigger:
        'message_selector' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      compactionInputTokens: compactionUsage?.input_tokens,
      compactionOutputTokens: compactionUsage?.output_tokens,
      compactionCacheReadTokens: compactionUsage?.cache_read_input_tokens ?? 0,
      compactionCacheCreationTokens:
        compactionUsage?.cache_creation_input_tokens ?? 0,
    })

    
    
    const lastPreCompactUuid =
      direction === 'up_to'
        ? allMessages.slice(0, pivotIndex).findLast(m => m.type !== 'progress')
            ?.uuid
        : messagesToKeep.at(-1)?.uuid
    const boundaryMarker = createCompactBoundaryMessage(
      'manual',
      preCompactTokenCount ?? 0,
      lastPreCompactUuid,
      userFeedback,
      messagesToSummarize.length,
    )
    
    
    const preCompactDiscovered = extractDiscoveredToolNames(allMessages)
    if (preCompactDiscovered.size > 0) {
      boundaryMarker.compactMetadata.preCompactDiscoveredTools = [
        ...preCompactDiscovered,
      ].sort()
    }

    const transcriptPath = getTranscriptPath()
    const summaryMessages: UserMessage[] = [
      createUserMessage({
        content: getCompactUserSummaryMessage(summary, false, transcriptPath),
        isCompactSummary: true,
        ...(messagesToKeep.length > 0
          ? {
              summarizeMetadata: {
                messagesSummarized: messagesToSummarize.length,
                userContext: userFeedback,
                direction,
              },
            }
          : { isVisibleInTranscriptOnly: true as const }),
      }),
    ]

    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(
        context.options.querySource ?? 'compact',
        context.agentId,
      )
    }
    markPostCompaction()

    
    
    reAppendSessionMetadata()

    if (feature('KAIROS')) {
      void sessionTranscriptModule?.writeSessionTranscriptSegment(
        messagesToSummarize,
      )
    }

    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'post_compact',
    })
    const postCompactHookResult = await executePostCompactHooks(
      {
        trigger: 'manual',
        compactSummary: summary,
      },
      context.abortController.signal,
    )

    
    const anchorUuid =
      direction === 'up_to'
        ? (summaryMessages.at(-1)?.uuid ?? boundaryMarker.uuid)
        : boundaryMarker.uuid
    return {
      boundaryMarker: annotateBoundaryWithPreservedSegment(
        boundaryMarker,
        anchorUuid,
        messagesToKeep,
      ),
      summaryMessages,
      messagesToKeep,
      attachments: postCompactFileAttachments,
      hookResults: hookMessages,
      userDisplayMessage: postCompactHookResult.userDisplayMessage,
      preCompactTokenCount,
      postCompactTokenCount,
      compactionUsage,
    }
  } catch (error) {
    addErrorNotificationIfNeeded(error, context)
    throw error
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })
    context.setSDKStatus?.(null)
  }
}

function addErrorNotificationIfNeeded(
  error: unknown,
  context: Pick<ToolUseContext, 'addNotification'>,
) {
  if (
    !hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT) &&
    !hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
  ) {
    context.addNotification?.({
      key: 'error-compacting-conversation',
      text: 'Error compacting conversation',
      priority: 'immediate',
      color: 'error',
    })
  }
}

export function createCompactCanUseTool(): CanUseToolFn {
  return async () => ({
    behavior: 'deny' as const,
    message: 'Tool use is not allowed during compaction',
    decisionReason: {
      type: 'other' as const,
      reason: 'compaction agent should only produce text summary',
    },
  })
}

async function streamCompactSummary({
  messages,
  summaryRequest,
  appState,
  context,
  preCompactTokenCount,
  cacheSafeParams,
}: {
  messages: Message[]
  summaryRequest: UserMessage
  appState: Awaited<ReturnType<ToolUseContext['getAppState']>>
  context: ToolUseContext
  preCompactTokenCount: number
  cacheSafeParams: CacheSafeParams
}): Promise<AssistantMessage> {
  
  
  
  
  const promptCacheSharingEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_compact_cache_prefix',
    true,
  )
  
  
  
  
  
  
  
  
  const activityInterval = isSessionActivityTrackingActive()
    ? setInterval(
        (statusSetter?: (status: 'compacting' | null) => void) => {
          sendSessionActivitySignal()
          statusSetter?.('compacting')
        },
        30_000,
        context.setSDKStatus,
      )
    : undefined

  try {
    if (promptCacheSharingEnabled) {
      try {
        
        
        
        
        
        
        
        const result = await runForkedAgent({
          promptMessages: [summaryRequest],
          cacheSafeParams,
          canUseTool: createCompactCanUseTool(),
          querySource: 'compact',
          forkLabel: 'compact',
          maxTurns: 1,
          skipCacheWrite: true,
          
          
          
          overrides: { abortController: context.abortController },
        })
        const assistantMsg = getLastAssistantMessage(result.messages)
        const assistantText = assistantMsg
          ? getAssistantMessageText(assistantMsg)
          : null
        
        
        
        
        
        if (assistantMsg && assistantText && !assistantMsg.isApiErrorMessage) {
          
          
          if (!assistantText.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) {
            logEvent('tengu_compact_cache_sharing_success', {
              preCompactTokenCount,
              outputTokens: result.totalUsage.output_tokens,
              cacheReadInputTokens: result.totalUsage.cache_read_input_tokens,
              cacheCreationInputTokens:
                result.totalUsage.cache_creation_input_tokens,
              cacheHitRate:
                result.totalUsage.cache_read_input_tokens > 0
                  ? result.totalUsage.cache_read_input_tokens /
                    (result.totalUsage.cache_read_input_tokens +
                      result.totalUsage.cache_creation_input_tokens +
                      result.totalUsage.input_tokens)
                  : 0,
            })
          }
          return assistantMsg
        }
        logForDebugging(
          `Compact cache sharing: no text in response, falling back. Response: ${jsonStringify(assistantMsg)}`,
          { level: 'warn' },
        )
        logEvent('tengu_compact_cache_sharing_fallback', {
          reason:
            'no_text_response' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
        })
      } catch (error) {
        logError(error)
        logEvent('tengu_compact_cache_sharing_fallback', {
          reason:
            'error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          preCompactTokenCount,
        })
      }
    }

    
    const retryEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_compact_streaming_retry',
      false,
    )
    const maxAttempts = retryEnabled ? MAX_COMPACT_STREAMING_RETRIES : 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      
      let hasStartedStreaming = false
      let response: AssistantMessage | undefined
      context.setResponseLength?.(() => 0)

      
      
      const useToolSearch = await isToolSearchEnabled(
        context.options.mainLoopModel,
        context.options.tools,
        async () => appState.toolPermissionContext,
        context.options.agentDefinitions.activeAgents,
        'compact',
      )

      
      
      
      
      
      
      
      
      const tools: Tool[] = useToolSearch
        ? uniqBy(
            [
              FileReadTool,
              ToolSearchTool,
              ...context.options.tools.filter(t => t.isMcp),
            ],
            'name',
          )
        : [FileReadTool]

      const streamingGen = queryModelWithStreaming({
        messages: normalizeMessagesForAPI(
          stripImagesFromMessages(
            stripReinjectedAttachments([
              ...getMessagesAfterCompactBoundary(messages),
              summaryRequest,
            ]),
          ),
          context.options.tools,
        ),
        systemPrompt: asSystemPrompt([
          'You are a helpful AI assistant tasked with summarizing conversations.',
        ]),
        thinkingConfig: { type: 'disabled' as const },
        tools,
        signal: context.abortController.signal,
        options: {
          async getToolPermissionContext() {
            const appState = context.getAppState()
            return appState.toolPermissionContext
          },
          model: context.options.mainLoopModel,
          toolChoice: undefined,
          isNonInteractiveSession: context.options.isNonInteractiveSession,
          hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
          maxOutputTokensOverride: Math.min(
            COMPACT_MAX_OUTPUT_TOKENS,
            getMaxOutputTokensForModel(context.options.mainLoopModel),
          ),
          querySource: 'compact',
          agents: context.options.agentDefinitions.activeAgents,
          mcpTools: [],
          effortValue: appState.effortValue,
        },
      })
      const streamIter = streamingGen[Symbol.asyncIterator]()
      let next = await streamIter.next()

      while (!next.done) {
        const event = next.value

        if (
          !hasStartedStreaming &&
          event.type === 'stream_event' &&
          event.event.type === 'content_block_start' &&
          event.event.content_block.type === 'text'
        ) {
          hasStartedStreaming = true
          context.setStreamMode?.('responding')
        }

        if (
          event.type === 'stream_event' &&
          event.event.type === 'content_block_delta' &&
          event.event.delta.type === 'text_delta'
        ) {
          const charactersStreamed = event.event.delta.text.length
          context.setResponseLength?.(length => length + charactersStreamed)
        }

        if (event.type === 'assistant') {
          response = event
        }

        next = await streamIter.next()
      }

      if (response) {
        return response
      }

      if (attempt < maxAttempts) {
        logEvent('tengu_compact_streaming_retry', {
          attempt,
          preCompactTokenCount,
          hasStartedStreaming,
        })
        await sleep(getRetryDelay(attempt), context.abortController.signal, {
          abortError: () => new APIUserAbortError(),
        })
        continue
      }

      logForDebugging(
        `Compact streaming failed after ${attempt} attempts. hasStartedStreaming=${hasStartedStreaming}`,
        { level: 'error' },
      )
      logEvent('tengu_compact_failed', {
        reason:
          'no_streaming_response' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        preCompactTokenCount,
        hasStartedStreaming,
        retryEnabled,
        attempts: attempt,
        promptCacheSharingEnabled,
      })
      throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
    }

    
    throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
  } finally {
    clearInterval(activityInterval)
  }
}

export async function createPostCompactFileAttachments(
  readFileState: Record<string, { content: string; timestamp: number }>,
  toolUseContext: ToolUseContext,
  maxFiles: number,
  preservedMessages: Message[] = [],
): Promise<AttachmentMessage[]> {
  const preservedReadPaths = collectReadToolFilePaths(preservedMessages)
  const recentFiles = Object.entries(readFileState)
    .map(([filename, state]) => ({ filename, ...state }))
    .filter(
      file =>
        !shouldExcludeFromPostCompactRestore(
          file.filename,
          toolUseContext.agentId,
        ) && !preservedReadPaths.has(expandPath(file.filename)),
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxFiles)

  const results = await Promise.all(
    recentFiles.map(async file => {
      const attachment = await generateFileAttachment(
        file.filename,
        {
          ...toolUseContext,
          fileReadingLimits: {
            maxTokens: POST_COMPACT_MAX_TOKENS_PER_FILE,
          },
        },
        'tengu_post_compact_file_restore_success',
        'tengu_post_compact_file_restore_error',
        'compact',
      )
      return attachment ? createAttachmentMessage(attachment) : null
    }),
  )

  let usedTokens = 0
  return results.filter((result): result is AttachmentMessage => {
    if (result === null) {
      return false
    }
    const attachmentTokens = roughTokenCountEstimation(jsonStringify(result))
    if (usedTokens + attachmentTokens <= POST_COMPACT_TOKEN_BUDGET) {
      usedTokens += attachmentTokens
      return true
    }
    return false
  })
}

export function createPlanAttachmentIfNeeded(
  agentId?: AgentId,
): AttachmentMessage | null {
  const planContent = getPlan(agentId)

  if (!planContent) {
    return null
  }

  const planFilePath = getPlanFilePath(agentId)

  return createAttachmentMessage({
    type: 'plan_file_reference',
    planFilePath,
    planContent,
  })
}

export function createSkillAttachmentIfNeeded(
  agentId?: string,
): AttachmentMessage | null {
  const invokedSkills = getInvokedSkillsForAgent(agentId)

  if (invokedSkills.size === 0) {
    return null
  }

  
  
  
  let usedTokens = 0
  const skills = Array.from(invokedSkills.values())
    .sort((a, b) => b.invokedAt - a.invokedAt)
    .map(skill => ({
      name: skill.skillName,
      path: skill.skillPath,
      content: truncateToTokens(
        skill.content,
        POST_COMPACT_MAX_TOKENS_PER_SKILL,
      ),
    }))
    .filter(skill => {
      const tokens = roughTokenCountEstimation(skill.content)
      if (usedTokens + tokens > POST_COMPACT_SKILLS_TOKEN_BUDGET) {
        return false
      }
      usedTokens += tokens
      return true
    })

  if (skills.length === 0) {
    return null
  }

  return createAttachmentMessage({
    type: 'invoked_skills',
    skills,
  })
}

export async function createPlanModeAttachmentIfNeeded(
  context: ToolUseContext,
): Promise<AttachmentMessage | null> {
  const appState = context.getAppState()
  if (appState.toolPermissionContext.mode !== 'plan') {
    return null
  }

  const planFilePath = getPlanFilePath(context.agentId)
  const planExists = getPlan(context.agentId) !== null

  return createAttachmentMessage({
    type: 'plan_mode',
    reminderType: 'full',
    isSubAgent: !!context.agentId,
    planFilePath,
    planExists,
  })
}

export async function createAsyncAgentAttachmentsIfNeeded(
  context: ToolUseContext,
): Promise<AttachmentMessage[]> {
  const appState = context.getAppState()
  const asyncAgents = Object.values(appState.tasks).filter(
    (task): task is LocalAgentTaskState => task.type === 'local_agent',
  )

  return asyncAgents.flatMap(agent => {
    if (
      agent.retrieved ||
      agent.status === 'pending' ||
      agent.agentId === context.agentId
    ) {
      return []
    }
    return [
      createAttachmentMessage({
        type: 'task_status',
        taskId: agent.agentId,
        taskType: 'local_agent',
        description: agent.description,
        status: agent.status,
        deltaSummary:
          agent.status === 'running'
            ? (agent.progress?.summary ?? null)
            : (agent.error ?? null),
        outputFilePath: getTaskOutputPath(agent.agentId),
      }),
    ]
  })
}

function collectReadToolFilePaths(messages: Message[]): Set<string> {
  const stubIds = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'user' || !Array.isArray(message.message.content)) {
      continue
    }
    for (const block of message.message.content) {
      if (
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.startsWith(FILE_UNCHANGED_STUB)
      ) {
        stubIds.add(block.tool_use_id)
      }
    }
  }

  const paths = new Set<string>()
  for (const message of messages) {
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message.content)
    ) {
      continue
    }
    for (const block of message.message.content) {
      if (
        block.type !== 'tool_use' ||
        block.name !== FILE_READ_TOOL_NAME ||
        stubIds.has(block.id)
      ) {
        continue
      }
      const input = block.input
      if (
        input &&
        typeof input === 'object' &&
        'file_path' in input &&
        typeof input.file_path === 'string'
      ) {
        paths.add(expandPath(input.file_path))
      }
    }
  }
  return paths
}

const SKILL_TRUNCATION_MARKER =
  '\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]'

function truncateToTokens(content: string, maxTokens: number): string {
  if (roughTokenCountEstimation(content) <= maxTokens) {
    return content
  }
  const charBudget = maxTokens * 4 - SKILL_TRUNCATION_MARKER.length
  return content.slice(0, charBudget) + SKILL_TRUNCATION_MARKER
}

function shouldExcludeFromPostCompactRestore(
  filename: string,
  agentId?: AgentId,
): boolean {
  const normalizedFilename = expandPath(filename)
  
  try {
    const planFilePath = expandPath(getPlanFilePath(agentId))
    if (normalizedFilename === planFilePath) {
      return true
    }
  } catch {
    
  }

  
  
  
  try {
    const normalizedMemoryPaths = new Set(
      MEMORY_TYPE_VALUES.map(type => expandPath(getMemoryPath(type))),
    )

    if (normalizedMemoryPaths.has(normalizedFilename)) {
      return true
    }
  } catch {
    
  }

  return false
}
