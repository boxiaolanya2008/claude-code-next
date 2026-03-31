import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import last from 'lodash-es/last.js'
import {
  getSessionId,
  isSessionPersistenceDisabled,
} from 'src/bootstrap/state.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { runTools } from '../services/tools/toolOrchestration.js'
import { findToolByName, type Tool, type Tools } from '../Tool.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import type { Input as FileReadInput } from '../tools/FileReadTool/FileReadTool.js'
import {
  FILE_READ_TOOL_NAME,
  FILE_UNCHANGED_STUB,
} from '../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'
import type { Message } from '../types/message.js'
import type { OrphanedPermission } from '../types/textInputTypes.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { isFsInaccessible } from './errors.js'
import { getFileModificationTime, stripLineNumberPrefix } from './file.js'
import { readFileSyncWithMetadata } from './fileRead.js'
import {
  createFileStateCacheWithSizeLimit,
  type FileStateCache,
} from './fileStateCache.js'
import { isNotEmptyMessage, normalizeMessages } from './messages.js'
import { expandPath } from './path.js'
import type {
  inputSchema as permissionToolInputSchema,
  outputSchema as permissionToolOutputSchema,
} from './permissions/PermissionPromptToolResultSchema.js'
import type { ProcessUserInputContext } from './processUserInput/processUserInput.js'
import { recordTranscript } from './sessionStorage.js'

export type PermissionPromptTool = Tool<
  ReturnType<typeof permissionToolInputSchema>,
  ReturnType<typeof permissionToolOutputSchema>
>

const ASK_READ_FILE_STATE_CACHE_SIZE = 10

export function isResultSuccessful(
  message: Message | undefined,
  stopReason: string | null = null,
): message is Message {
  if (!message) return false

  if (message.type === 'assistant') {
    const lastContent = last(message.message.content)
    return (
      lastContent?.type === 'text' ||
      lastContent?.type === 'thinking' ||
      lastContent?.type === 'redacted_thinking'
    )
  }

  if (message.type === 'user') {
    
    const content = message.message.content
    if (
      Array.isArray(content) &&
      content.length > 0 &&
      content.every(block => 'type' in block && block.type === 'tool_result')
    ) {
      return true
    }
  }

  
  
  
  
  
  
  
  
  
  
  return stopReason === 'end_turn'
}

const MAX_TOOL_PROGRESS_TRACKING_ENTRIES = 100
const TOOL_PROGRESS_THROTTLE_MS = 30000
const toolProgressLastSentTime = new Map<string, number>()

export function* normalizeMessage(message: Message): Generator<SDKMessage> {
  switch (message.type) {
    case 'assistant':
      for (const _ of normalizeMessages([message])) {
        
        if (!isNotEmptyMessage(_)) {
          continue
        }
        yield {
          type: 'assistant',
          message: _.message,
          parent_tool_use_id: null,
          session_id: getSessionId(),
          uuid: _.uuid,
          error: _.error,
        }
      }
      return
    case 'progress':
      if (
        message.data.type === 'agent_progress' ||
        message.data.type === 'skill_progress'
      ) {
        for (const _ of normalizeMessages([message.data.message])) {
          switch (_.type) {
            case 'assistant':
              
              if (!isNotEmptyMessage(_)) {
                break
              }
              yield {
                type: 'assistant',
                message: _.message,
                parent_tool_use_id: message.parentToolUseID,
                session_id: getSessionId(),
                uuid: _.uuid,
                error: _.error,
              }
              break
            case 'user':
              yield {
                type: 'user',
                message: _.message,
                parent_tool_use_id: message.parentToolUseID,
                session_id: getSessionId(),
                uuid: _.uuid,
                timestamp: _.timestamp,
                isSynthetic: _.isMeta || _.isVisibleInTranscriptOnly,
                tool_use_result: _.mcpMeta
                  ? { content: _.toolUseResult, ..._.mcpMeta }
                  : _.toolUseResult,
              }
              break
          }
        }
      } else if (
        message.data.type === 'bash_progress' ||
        message.data.type === 'powershell_progress'
      ) {
        
        
        if (
          !isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE) &&
          !process.env.CLAUDE_CODE_NEXT_CONTAINER_ID
        ) {
          break
        }

        
        const trackingKey = message.parentToolUseID
        const now = Date.now()
        const lastSent = toolProgressLastSentTime.get(trackingKey) || 0
        const timeSinceLastSent = now - lastSent

        
        if (timeSinceLastSent >= TOOL_PROGRESS_THROTTLE_MS) {
          
          if (
            toolProgressLastSentTime.size >= MAX_TOOL_PROGRESS_TRACKING_ENTRIES
          ) {
            const firstKey = toolProgressLastSentTime.keys().next().value
            if (firstKey !== undefined) {
              toolProgressLastSentTime.delete(firstKey)
            }
          }

          toolProgressLastSentTime.set(trackingKey, now)
          yield {
            type: 'tool_progress',
            tool_use_id: message.toolUseID,
            tool_name:
              message.data.type === 'bash_progress' ? 'Bash' : 'PowerShell',
            parent_tool_use_id: message.parentToolUseID,
            elapsed_time_seconds: message.data.elapsedTimeSeconds,
            task_id: message.data.taskId,
            session_id: getSessionId(),
            uuid: message.uuid,
          }
        }
      }
      break
    case 'user':
      for (const _ of normalizeMessages([message])) {
        yield {
          type: 'user',
          message: _.message,
          parent_tool_use_id: null,
          session_id: getSessionId(),
          uuid: _.uuid,
          timestamp: _.timestamp,
          isSynthetic: _.isMeta || _.isVisibleInTranscriptOnly,
          tool_use_result: _.mcpMeta
            ? { content: _.toolUseResult, ..._.mcpMeta }
            : _.toolUseResult,
        }
      }
      return
    default:
    
  }
}

export async function* handleOrphanedPermission(
  orphanedPermission: OrphanedPermission,
  tools: Tools,
  mutableMessages: Message[],
  processUserInputContext: ProcessUserInputContext,
): AsyncGenerator<SDKMessage, void, unknown> {
  const persistSession = !isSessionPersistenceDisabled()
  const { permissionResult, assistantMessage } = orphanedPermission
  const { toolUseID } = permissionResult

  if (!toolUseID) {
    return
  }

  const content = assistantMessage.message.content
  let toolUseBlock: ToolUseBlock | undefined
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'tool_use' && block.id === toolUseID) {
        toolUseBlock = block as ToolUseBlock
        break
      }
    }
  }

  if (!toolUseBlock) {
    return
  }

  const toolName = toolUseBlock.name
  const toolInput = toolUseBlock.input

  const toolDefinition = findToolByName(tools, toolName)
  if (!toolDefinition) {
    return
  }

  
  let finalInput = toolInput
  if (permissionResult.behavior === 'allow') {
    if (permissionResult.updatedInput !== undefined) {
      finalInput = permissionResult.updatedInput
    } else {
      logForDebugging(
        `Orphaned permission for ${toolName}: updatedInput is undefined, falling back to original tool input`,
        { level: 'warn' },
      )
    }
  }
  const finalToolUseBlock: ToolUseBlock = {
    ...toolUseBlock,
    input: finalInput,
  }

  const canUseTool: CanUseToolFn = async () => ({
    ...permissionResult,
    decisionReason: {
      type: 'mode',
      mode: 'default' as const,
    },
  })

  
  
  
  
  
  
  
  
  
  
  
  
  
  const alreadyPresent = mutableMessages.some(
    m =>
      m.type === 'assistant' &&
      Array.isArray(m.message.content) &&
      m.message.content.some(
        b => b.type === 'tool_use' && 'id' in b && b.id === toolUseID,
      ),
  )
  if (!alreadyPresent) {
    mutableMessages.push(assistantMessage)
    if (persistSession) {
      await recordTranscript(mutableMessages)
    }
  }

  const sdkAssistantMessage: SDKMessage = {
    ...assistantMessage,
    session_id: getSessionId(),
    parent_tool_use_id: null,
  } as SDKMessage
  yield sdkAssistantMessage

  
  for await (const update of runTools(
    [finalToolUseBlock],
    [assistantMessage],
    canUseTool,
    processUserInputContext,
  )) {
    if (update.message) {
      mutableMessages.push(update.message)
      if (persistSession) {
        await recordTranscript(mutableMessages)
      }

      const sdkMessage: SDKMessage = {
        ...update.message,
        session_id: getSessionId(),
        parent_tool_use_id: null,
      } as SDKMessage

      yield sdkMessage
    }
  }
}

export function extractReadFilesFromMessages(
  messages: Message[],
  cwd: string,
  maxSize: number = ASK_READ_FILE_STATE_CACHE_SIZE,
): FileStateCache {
  const cache = createFileStateCacheWithSizeLimit(maxSize)

  
  const fileReadToolUseIds = new Map<string, string>() 
  const fileWriteToolUseIds = new Map<
    string,
    { filePath: string; content: string }
  >() 
  const fileEditToolUseIds = new Map<string, string>() 

  for (const message of messages) {
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message.content)
    ) {
      for (const content of message.message.content) {
        if (
          content.type === 'tool_use' &&
          content.name === FILE_READ_TOOL_NAME
        ) {
          
          const input = content.input as FileReadInput | undefined
          
          if (
            input?.file_path &&
            input?.offset === undefined &&
            input?.limit === undefined
          ) {
            
            const absolutePath = expandPath(input.file_path, cwd)
            fileReadToolUseIds.set(content.id, absolutePath)
          }
        } else if (
          content.type === 'tool_use' &&
          content.name === FILE_WRITE_TOOL_NAME
        ) {
          
          const input = content.input as
            | { file_path?: string; content?: string }
            | undefined
          if (input?.file_path && input?.content) {
            
            const absolutePath = expandPath(input.file_path, cwd)
            fileWriteToolUseIds.set(content.id, {
              filePath: absolutePath,
              content: input.content,
            })
          }
        } else if (
          content.type === 'tool_use' &&
          content.name === FILE_EDIT_TOOL_NAME
        ) {
          
          
          const input = content.input as { file_path?: string } | undefined
          if (input?.file_path) {
            const absolutePath = expandPath(input.file_path, cwd)
            fileEditToolUseIds.set(content.id, absolutePath)
          }
        }
      }
    }
  }

  
  for (const message of messages) {
    if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const content of message.message.content) {
        if (content.type === 'tool_result' && content.tool_use_id) {
          
          const readFilePath = fileReadToolUseIds.get(content.tool_use_id)
          if (
            readFilePath &&
            typeof content.content === 'string' &&
            
            
            
            !content.content.startsWith(FILE_UNCHANGED_STUB)
          ) {
            
            const processedContent = content.content.replace(
              /<system-reminder>[\s\S]*?<\/system-reminder>/g,
              '',
            )

            
            
            const fileContent = processedContent
              .split('\n')
              .map(stripLineNumberPrefix)
              .join('\n')
              .trim()

            
            if (message.timestamp) {
              const timestamp = new Date(message.timestamp).getTime()
              cache.set(readFilePath, {
                content: fileContent,
                timestamp,
                offset: undefined,
                limit: undefined,
              })
            }
          }

          
          const writeToolData = fileWriteToolUseIds.get(content.tool_use_id)
          if (writeToolData && message.timestamp) {
            const timestamp = new Date(message.timestamp).getTime()
            cache.set(writeToolData.filePath, {
              content: writeToolData.content,
              timestamp,
              offset: undefined,
              limit: undefined,
            })
          }

          
          
          
          
          
          
          
          
          
          const editFilePath = fileEditToolUseIds.get(content.tool_use_id)
          if (editFilePath && content.is_error !== true) {
            try {
              const { content: diskContent } =
                readFileSyncWithMetadata(editFilePath)
              cache.set(editFilePath, {
                content: diskContent,
                timestamp: getFileModificationTime(editFilePath),
                offset: undefined,
                limit: undefined,
              })
            } catch (e: unknown) {
              if (!isFsInaccessible(e)) {
                throw e
              }
              
            }
          }
        }
      }
    }
  }

  return cache
}

export function extractBashToolsFromMessages(messages: Message[]): Set<string> {
  const tools = new Set<string>()
  for (const message of messages) {
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message.content)
    ) {
      for (const content of message.message.content) {
        if (content.type === 'tool_use' && content.name === BASH_TOOL_NAME) {
          const { input } = content
          if (
            typeof input !== 'object' ||
            input === null ||
            !('command' in input)
          )
            continue
          const cmd = extractCliName(
            typeof input.command === 'string' ? input.command : undefined,
          )
          if (cmd) {
            tools.add(cmd)
          }
        }
      }
    }
  }
  return tools
}

const STRIPPED_COMMANDS = new Set(['sudo'])

function extractCliName(command: string | undefined): string | undefined {
  if (!command) return undefined
  const tokens = command.trim().split(/\s+/)
  for (const token of tokens) {
    if (/^[A-Za-z_]\w*=/.test(token)) continue
    if (STRIPPED_COMMANDS.has(token)) continue
    return token
  }
  return undefined
}
