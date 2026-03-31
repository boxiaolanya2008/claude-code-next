

import { writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { getIsRemoteMode } from '../../bootstrap/state.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import {
  FileReadTool,
  type Output as FileReadToolOutput,
} from '../../tools/FileReadTool/FileReadTool.js'
import type { Message } from '../../types/message.js'
import { count } from '../../utils/array.js'
import {
  createCacheSafeParams,
  createSubagentContext,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import {
  type REPLHookContext,
  registerPostSamplingHook,
} from '../../utils/hooks/postSamplingHooks.js'
import {
  createUserMessage,
  hasToolCallsInLastAssistantTurn,
} from '../../utils/messages.js'
import {
  getSessionMemoryDir,
  getSessionMemoryPath,
} from '../../utils/permissions/filesystem.js'
import { sequential } from '../../utils/sequential.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { getTokenUsage, tokenCountWithEstimation } from '../../utils/tokens.js'
import { logEvent } from '../analytics/index.js'
import { isAutoCompactEnabled } from '../compact/autoCompact.js'
import {
  buildSessionMemoryUpdatePrompt,
  loadSessionMemoryTemplate,
} from './prompts.js'
import {
  DEFAULT_SESSION_MEMORY_CONFIG,
  getSessionMemoryConfig,
  getToolCallsBetweenUpdates,
  hasMetInitializationThreshold,
  hasMetUpdateThreshold,
  isSessionMemoryInitialized,
  markExtractionCompleted,
  markExtractionStarted,
  markSessionMemoryInitialized,
  recordExtractionTokenCount,
  type SessionMemoryConfig,
  setLastSummarizedMessageId,
  setSessionMemoryConfig,
} from './sessionMemoryUtils.js'

import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import {
  getDynamicConfig_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../analytics/growthbook.js'

function isSessionMemoryGateEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_session_memory', false)
}

function getSessionMemoryRemoteConfig(): Partial<SessionMemoryConfig> {
  return getDynamicConfig_CACHED_MAY_BE_STALE<Partial<SessionMemoryConfig>>(
    'tengu_sm_config',
    {},
  )
}

let lastMemoryMessageUuid: string | undefined

export function resetLastMemoryMessageUuid(): void {
  lastMemoryMessageUuid = undefined
}

function countToolCallsSince(
  messages: Message[],
  sinceUuid: string | undefined,
): number {
  let toolCallCount = 0
  let foundStart = sinceUuid === null || sinceUuid === undefined

  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }

    if (message.type === 'assistant') {
      const content = message.message.content
      if (Array.isArray(content)) {
        toolCallCount += count(content, block => block.type === 'tool_use')
      }
    }
  }

  return toolCallCount
}

export function shouldExtractMemory(messages: Message[]): boolean {
  
  
  const currentTokenCount = tokenCountWithEstimation(messages)
  if (!isSessionMemoryInitialized()) {
    if (!hasMetInitializationThreshold(currentTokenCount)) {
      return false
    }
    markSessionMemoryInitialized()
  }

  
  
  const hasMetTokenThreshold = hasMetUpdateThreshold(currentTokenCount)

  
  const toolCallsSinceLastUpdate = countToolCallsSince(
    messages,
    lastMemoryMessageUuid,
  )
  const hasMetToolCallThreshold =
    toolCallsSinceLastUpdate >= getToolCallsBetweenUpdates()

  
  const hasToolCallsInLastTurn = hasToolCallsInLastAssistantTurn(messages)

  
  
  
  
  
  
  
  
  const shouldExtract =
    (hasMetTokenThreshold && hasMetToolCallThreshold) ||
    (hasMetTokenThreshold && !hasToolCallsInLastTurn)

  if (shouldExtract) {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.uuid) {
      lastMemoryMessageUuid = lastMessage.uuid
    }
    return true
  }

  return false
}

async function setupSessionMemoryFile(
  toolUseContext: ToolUseContext,
): Promise<{ memoryPath: string; currentMemory: string }> {
  const fs = getFsImplementation()

  
  const sessionMemoryDir = getSessionMemoryDir()
  await fs.mkdir(sessionMemoryDir, { mode: 0o700 })

  const memoryPath = getSessionMemoryPath()

  
  try {
    await writeFile(memoryPath, '', {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    })
    
    const template = await loadSessionMemoryTemplate()
    await writeFile(memoryPath, template, {
      encoding: 'utf-8',
      mode: 0o600,
    })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'EEXIST') {
      throw e
    }
  }

  
  
  toolUseContext.readFileState.delete(memoryPath)
  const result = await FileReadTool.call(
    { file_path: memoryPath },
    toolUseContext,
  )
  let currentMemory = ''

  const output = result.data as FileReadToolOutput
  if (output.type === 'text') {
    currentMemory = output.file.content
  }

  logEvent('tengu_session_memory_file_read', {
    content_length: currentMemory.length,
  })

  return { memoryPath, currentMemory }
}

const initSessionMemoryConfigIfNeeded = memoize((): void => {
  
  const remoteConfig = getSessionMemoryRemoteConfig()

  
  
  const config: SessionMemoryConfig = {
    minimumMessageTokensToInit:
      remoteConfig.minimumMessageTokensToInit &&
      remoteConfig.minimumMessageTokensToInit > 0
        ? remoteConfig.minimumMessageTokensToInit
        : DEFAULT_SESSION_MEMORY_CONFIG.minimumMessageTokensToInit,
    minimumTokensBetweenUpdate:
      remoteConfig.minimumTokensBetweenUpdate &&
      remoteConfig.minimumTokensBetweenUpdate > 0
        ? remoteConfig.minimumTokensBetweenUpdate
        : DEFAULT_SESSION_MEMORY_CONFIG.minimumTokensBetweenUpdate,
    toolCallsBetweenUpdates:
      remoteConfig.toolCallsBetweenUpdates &&
      remoteConfig.toolCallsBetweenUpdates > 0
        ? remoteConfig.toolCallsBetweenUpdates
        : DEFAULT_SESSION_MEMORY_CONFIG.toolCallsBetweenUpdates,
  }
  setSessionMemoryConfig(config)
})

let hasLoggedGateFailure = false

const extractSessionMemory = sequential(async function (
  context: REPLHookContext,
): Promise<void> {
  const { messages, toolUseContext, querySource } = context

  
  if (querySource !== 'repl_main_thread') {
    
    return
  }

  
  if (!isSessionMemoryGateEnabled()) {
    
    if (process.env.USER_TYPE === 'ant' && !hasLoggedGateFailure) {
      hasLoggedGateFailure = true
      logEvent('tengu_session_memory_gate_disabled', {})
    }
    return
  }

  
  initSessionMemoryConfigIfNeeded()

  if (!shouldExtractMemory(messages)) {
    return
  }

  markExtractionStarted()

  
  const setupContext = createSubagentContext(toolUseContext)

  
  const { memoryPath, currentMemory } =
    await setupSessionMemoryFile(setupContext)

  
  const userPrompt = await buildSessionMemoryUpdatePrompt(
    currentMemory,
    memoryPath,
  )

  
  
  
  await runForkedAgent({
    promptMessages: [createUserMessage({ content: userPrompt })],
    cacheSafeParams: createCacheSafeParams(context),
    canUseTool: createMemoryFileCanUseTool(memoryPath),
    querySource: 'session_memory',
    forkLabel: 'session_memory',
    overrides: { readFileState: setupContext.readFileState },
  })

  
  
  const lastMessage = messages[messages.length - 1]
  const usage = lastMessage ? getTokenUsage(lastMessage) : undefined
  const config = getSessionMemoryConfig()
  logEvent('tengu_session_memory_extraction', {
    input_tokens: usage?.input_tokens,
    output_tokens: usage?.output_tokens,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens:
      usage?.cache_creation_input_tokens ?? undefined,
    config_min_message_tokens_to_init: config.minimumMessageTokensToInit,
    config_min_tokens_between_update: config.minimumTokensBetweenUpdate,
    config_tool_calls_between_updates: config.toolCallsBetweenUpdates,
  })

  
  recordExtractionTokenCount(tokenCountWithEstimation(messages))

  
  updateLastSummarizedMessageIdIfSafe(messages)

  markExtractionCompleted()
})

export function initSessionMemory(): void {
  if (getIsRemoteMode()) return
  
  const autoCompactEnabled = isAutoCompactEnabled()

  
  if (process.env.USER_TYPE === 'ant') {
    logEvent('tengu_session_memory_init', {
      auto_compact_enabled: autoCompactEnabled,
    })
  }

  if (!autoCompactEnabled) {
    return
  }

  
  registerPostSamplingHook(extractSessionMemory)
}

export type ManualExtractionResult = {
  success: boolean
  memoryPath?: string
  error?: string
}

export async function manuallyExtractSessionMemory(
  messages: Message[],
  toolUseContext: ToolUseContext,
): Promise<ManualExtractionResult> {
  if (messages.length === 0) {
    return { success: false, error: 'No messages to summarize' }
  }
  markExtractionStarted()

  try {
    
    const setupContext = createSubagentContext(toolUseContext)

    
    const { memoryPath, currentMemory } =
      await setupSessionMemoryFile(setupContext)

    
    const userPrompt = await buildSessionMemoryUpdatePrompt(
      currentMemory,
      memoryPath,
    )

    
    const { tools, mainLoopModel } = toolUseContext.options
    const [rawSystemPrompt, userContext, systemContext] = await Promise.all([
      getSystemPrompt(tools, mainLoopModel),
      getUserContext(),
      getSystemContext(),
    ])
    const systemPrompt = asSystemPrompt(rawSystemPrompt)

    
    await runForkedAgent({
      promptMessages: [createUserMessage({ content: userPrompt })],
      cacheSafeParams: {
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext: setupContext,
        forkContextMessages: messages,
      },
      canUseTool: createMemoryFileCanUseTool(memoryPath),
      querySource: 'session_memory',
      forkLabel: 'session_memory_manual',
      overrides: { readFileState: setupContext.readFileState },
    })

    
    logEvent('tengu_session_memory_manual_extraction', {})

    
    recordExtractionTokenCount(tokenCountWithEstimation(messages))

    
    updateLastSummarizedMessageIdIfSafe(messages)

    return { success: true, memoryPath }
  } catch (error) {
    return {
      success: false,
      error: errorMessage(error),
    }
  } finally {
    markExtractionCompleted()
  }
}

export function createMemoryFileCanUseTool(memoryPath: string): CanUseToolFn {
  return async (tool: Tool, input: unknown) => {
    if (
      tool.name === FILE_EDIT_TOOL_NAME &&
      typeof input === 'object' &&
      input !== null &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && filePath === memoryPath) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }
    return {
      behavior: 'deny' as const,
      message: `only ${FILE_EDIT_TOOL_NAME} on ${memoryPath} is allowed`,
      decisionReason: {
        type: 'other' as const,
        reason: `only ${FILE_EDIT_TOOL_NAME} on ${memoryPath} is allowed`,
      },
    }
  }
}

function updateLastSummarizedMessageIdIfSafe(messages: Message[]): void {
  if (!hasToolCallsInLastAssistantTurn(messages)) {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.uuid) {
      setLastSummarizedMessageId(lastMessage.uuid)
    }
  }
}
