

import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import type { PromptCommand } from '../commands.js'
import type { QuerySource } from '../constants/querySource.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { query } from '../query.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { accumulateUsage, updateUsage } from '../services/api/claude.js'
import { EMPTY_USAGE, type NonNullableUsage } from '../services/api/logging.js'
import type { ToolUseContext } from '../Tool.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import type { AgentId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import { createChildAbortController } from './abortController.js'
import { logForDebugging } from './debug.js'
import { cloneFileStateCache } from './fileStateCache.js'
import type { REPLHookContext } from './hooks/postSamplingHooks.js'
import {
  createUserMessage,
  extractTextContent,
  getLastAssistantMessage,
} from './messages.js'
import { createDenialTrackingState } from './permissions/denialTracking.js'
import { parseToolListFromCLI } from './permissions/permissionSetup.js'
import { recordSidechainTranscript } from './sessionStorage.js'
import type { SystemPrompt } from './systemPromptType.js'
import {
  type ContentReplacementState,
  cloneContentReplacementState,
} from './toolResultStorage.js'
import { createAgentId } from './uuid.js'

export type CacheSafeParams = {
  
  systemPrompt: SystemPrompt
  
  userContext: { [k: string]: string }
  
  systemContext: { [k: string]: string }
  
  toolUseContext: ToolUseContext
  
  forkContextMessages: Message[]
}

let lastCacheSafeParams: CacheSafeParams | null = null

export function saveCacheSafeParams(params: CacheSafeParams | null): void {
  lastCacheSafeParams = params
}

export function getLastCacheSafeParams(): CacheSafeParams | null {
  return lastCacheSafeParams
}

export type ForkedAgentParams = {
  
  promptMessages: Message[]
  
  cacheSafeParams: CacheSafeParams
  
  canUseTool: CanUseToolFn
  
  querySource: QuerySource
  
  forkLabel: string
  
  overrides?: SubagentContextOverrides
  

  maxOutputTokens?: number
  
  maxTurns?: number
  
  onMessage?: (message: Message) => void
  
  skipTranscript?: boolean
  

  skipCacheWrite?: boolean
}

export type ForkedAgentResult = {
  
  messages: Message[]
  
  totalUsage: NonNullableUsage
}

export function createCacheSafeParams(
  context: REPLHookContext,
): CacheSafeParams {
  return {
    systemPrompt: context.systemPrompt,
    userContext: context.userContext,
    systemContext: context.systemContext,
    toolUseContext: context.toolUseContext,
    forkContextMessages: context.messages,
  }
}

export function createGetAppStateWithAllowedTools(
  baseGetAppState: ToolUseContext['getAppState'],
  allowedTools: string[],
): ToolUseContext['getAppState'] {
  if (allowedTools.length === 0) return baseGetAppState
  return () => {
    const appState = baseGetAppState()
    return {
      ...appState,
      toolPermissionContext: {
        ...appState.toolPermissionContext,
        alwaysAllowRules: {
          ...appState.toolPermissionContext.alwaysAllowRules,
          command: [
            ...new Set([
              ...(appState.toolPermissionContext.alwaysAllowRules.command ||
                []),
              ...allowedTools,
            ]),
          ],
        },
      },
    }
  }
}

export type PreparedForkedContext = {
  
  skillContent: string
  
  modifiedGetAppState: ToolUseContext['getAppState']
  
  baseAgent: AgentDefinition
  
  promptMessages: Message[]
}

export async function prepareForkedCommandContext(
  command: PromptCommand,
  args: string,
  context: ToolUseContext,
): Promise<PreparedForkedContext> {
  
  const skillPrompt = await command.getPromptForCommand(args, context)
  const skillContent = skillPrompt
    .map(block => (block.type === 'text' ? block.text : ''))
    .join('\n')

  
  const allowedTools = parseToolListFromCLI(command.allowedTools ?? [])

  
  const modifiedGetAppState = createGetAppStateWithAllowedTools(
    context.getAppState,
    allowedTools,
  )

  
  const agentTypeName = command.agent ?? 'general-purpose'
  const agents = context.options.agentDefinitions.activeAgents
  const baseAgent =
    agents.find(a => a.agentType === agentTypeName) ??
    agents.find(a => a.agentType === 'general-purpose') ??
    agents[0]

  if (!baseAgent) {
    throw new Error('No agent available for forked execution')
  }

  
  const promptMessages = [createUserMessage({ content: skillContent })]

  return {
    skillContent,
    modifiedGetAppState,
    baseAgent,
    promptMessages,
  }
}

export function extractResultText(
  agentMessages: Message[],
  defaultText = 'Execution completed',
): string {
  const lastAssistantMessage = getLastAssistantMessage(agentMessages)
  if (!lastAssistantMessage) return defaultText

  const textContent = extractTextContent(
    lastAssistantMessage.message.content,
    '\n',
  )

  return textContent || defaultText
}

export type SubagentContextOverrides = {
  
  options?: ToolUseContext['options']
  
  agentId?: AgentId
  
  agentType?: string
  
  messages?: Message[]
  
  readFileState?: ToolUseContext['readFileState']
  
  abortController?: AbortController
  
  getAppState?: ToolUseContext['getAppState']

  

  shareSetAppState?: boolean
  

  shareSetResponseLength?: boolean
  

  shareAbortController?: boolean
  
  criticalSystemReminder_EXPERIMENTAL?: string
  

  requireCanUseTool?: boolean
  

  contentReplacementState?: ContentReplacementState
}

export function createSubagentContext(
  parentContext: ToolUseContext,
  overrides?: SubagentContextOverrides,
): ToolUseContext {
  
  const abortController =
    overrides?.abortController ??
    (overrides?.shareAbortController
      ? parentContext.abortController
      : createChildAbortController(parentContext.abortController))

  
  
  const getAppState: ToolUseContext['getAppState'] = overrides?.getAppState
    ? overrides.getAppState
    : overrides?.shareAbortController
      ? parentContext.getAppState
      : () => {
          const state = parentContext.getAppState()
          if (state.toolPermissionContext.shouldAvoidPermissionPrompts) {
            return state
          }
          return {
            ...state,
            toolPermissionContext: {
              ...state.toolPermissionContext,
              shouldAvoidPermissionPrompts: true,
            },
          }
        }

  return {
    
    
    readFileState: cloneFileStateCache(
      overrides?.readFileState ?? parentContext.readFileState,
    ),
    nestedMemoryAttachmentTriggers: new Set<string>(),
    loadedNestedMemoryPaths: new Set<string>(),
    dynamicSkillDirTriggers: new Set<string>(),
    
    discoveredSkillNames: new Set<string>(),
    toolDecisions: undefined,
    
    
    
    
    
    
    
    
    
    
    
    contentReplacementState:
      overrides?.contentReplacementState ??
      (parentContext.contentReplacementState
        ? cloneContentReplacementState(parentContext.contentReplacementState)
        : undefined),

    
    abortController,

    
    getAppState,
    setAppState: overrides?.shareSetAppState
      ? parentContext.setAppState
      : () => {},
    
    
    
    setAppStateForTasks:
      parentContext.setAppStateForTasks ?? parentContext.setAppState,
    
    
    localDenialTracking: overrides?.shareSetAppState
      ? parentContext.localDenialTracking
      : createDenialTrackingState(),

    
    setInProgressToolUseIDs: () => {},
    setResponseLength: overrides?.shareSetResponseLength
      ? parentContext.setResponseLength
      : () => {},
    pushApiMetricsEntry: overrides?.shareSetResponseLength
      ? parentContext.pushApiMetricsEntry
      : undefined,
    updateFileHistoryState: () => {},
    
    
    updateAttributionState: parentContext.updateAttributionState,

    
    addNotification: undefined,
    setToolJSX: undefined,
    setStreamMode: undefined,
    setSDKStatus: undefined,
    openMessageSelector: undefined,

    
    options: overrides?.options ?? parentContext.options,
    messages: overrides?.messages ?? parentContext.messages,
    
    agentId: overrides?.agentId ?? createAgentId(),
    agentType: overrides?.agentType,

    
    queryTracking: {
      chainId: randomUUID(),
      depth: (parentContext.queryTracking?.depth ?? -1) + 1,
    },
    fileReadingLimits: parentContext.fileReadingLimits,
    userModified: parentContext.userModified,
    criticalSystemReminder_EXPERIMENTAL:
      overrides?.criticalSystemReminder_EXPERIMENTAL,
    requireCanUseTool: overrides?.requireCanUseTool,
  }
}

export async function runForkedAgent({
  promptMessages,
  cacheSafeParams,
  canUseTool,
  querySource,
  forkLabel,
  overrides,
  maxOutputTokens,
  maxTurns,
  onMessage,
  skipTranscript,
  skipCacheWrite,
}: ForkedAgentParams): Promise<ForkedAgentResult> {
  const startTime = Date.now()
  const outputMessages: Message[] = []
  let totalUsage: NonNullableUsage = { ...EMPTY_USAGE }

  const {
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    forkContextMessages,
  } = cacheSafeParams

  
  const isolatedToolUseContext = createSubagentContext(
    toolUseContext,
    overrides,
  )

  
  
  
  
  const initialMessages: Message[] = [...forkContextMessages, ...promptMessages]

  
  
  const agentId = skipTranscript ? undefined : createAgentId(forkLabel)
  let lastRecordedUuid: UUID | null = null
  if (agentId) {
    await recordSidechainTranscript(initialMessages, agentId).catch(err =>
      logForDebugging(
        `Forked agent [${forkLabel}] failed to record initial transcript: ${err}`,
      ),
    )
    
    lastRecordedUuid =
      initialMessages.length > 0
        ? initialMessages[initialMessages.length - 1]!.uuid
        : null
  }

  
  try {
    for await (const message of query({
      messages: initialMessages,
      systemPrompt,
      userContext,
      systemContext,
      canUseTool,
      toolUseContext: isolatedToolUseContext,
      querySource,
      maxOutputTokensOverride: maxOutputTokens,
      maxTurns,
      skipCacheWrite,
    })) {
      
      if (message.type === 'stream_event') {
        if (
          'event' in message &&
          message.event?.type === 'message_delta' &&
          message.event.usage
        ) {
          const turnUsage = updateUsage({ ...EMPTY_USAGE }, message.event.usage)
          totalUsage = accumulateUsage(totalUsage, turnUsage)
        }
        continue
      }
      if (message.type === 'stream_request_start') {
        continue
      }

      logForDebugging(
        `Forked agent [${forkLabel}] received message: type=${message.type}`,
      )

      outputMessages.push(message as Message)
      onMessage?.(message as Message)

      
      const msg = message as Message
      if (
        agentId &&
        (msg.type === 'assistant' ||
          msg.type === 'user' ||
          msg.type === 'progress')
      ) {
        await recordSidechainTranscript([msg], agentId, lastRecordedUuid).catch(
          err =>
            logForDebugging(
              `Forked agent [${forkLabel}] failed to record transcript: ${err}`,
            ),
        )
        if (msg.type !== 'progress') {
          lastRecordedUuid = msg.uuid
        }
      }
    }
  } finally {
    
    isolatedToolUseContext.readFileState.clear()
    
    initialMessages.length = 0
  }

  logForDebugging(
    `Forked agent [${forkLabel}] finished: ${outputMessages.length} messages, types=[${outputMessages.map(m => m.type).join(', ')}], totalUsage: input=${totalUsage.input_tokens} output=${totalUsage.output_tokens} cacheRead=${totalUsage.cache_read_input_tokens} cacheCreate=${totalUsage.cache_creation_input_tokens}`,
  )

  const durationMs = Date.now() - startTime

  
  logForkAgentQueryEvent({
    forkLabel,
    querySource,
    durationMs,
    messageCount: outputMessages.length,
    totalUsage,
    queryTracking: toolUseContext.queryTracking,
  })

  return {
    messages: outputMessages,
    totalUsage,
  }
}

function logForkAgentQueryEvent({
  forkLabel,
  querySource,
  durationMs,
  messageCount,
  totalUsage,
  queryTracking,
}: {
  forkLabel: string
  querySource: QuerySource
  durationMs: number
  messageCount: number
  totalUsage: NonNullableUsage
  queryTracking?: { chainId: string; depth: number }
}): void {
  
  const totalInputTokens =
    totalUsage.input_tokens +
    totalUsage.cache_creation_input_tokens +
    totalUsage.cache_read_input_tokens
  const cacheHitRate =
    totalInputTokens > 0
      ? totalUsage.cache_read_input_tokens / totalInputTokens
      : 0

  logEvent('tengu_fork_agent_query', {
    
    forkLabel:
      forkLabel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    durationMs,
    messageCount,

    
    inputTokens: totalUsage.input_tokens,
    outputTokens: totalUsage.output_tokens,
    cacheReadInputTokens: totalUsage.cache_read_input_tokens,
    cacheCreationInputTokens: totalUsage.cache_creation_input_tokens,
    serviceTier:
      totalUsage.service_tier as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    cacheCreationEphemeral1hTokens:
      totalUsage.cache_creation.ephemeral_1h_input_tokens,
    cacheCreationEphemeral5mTokens:
      totalUsage.cache_creation.ephemeral_5m_input_tokens,

    
    cacheHitRate,

    
    ...(queryTracking
      ? {
          queryChainId:
            queryTracking.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: queryTracking.depth,
        }
      : {}),
  })
}
