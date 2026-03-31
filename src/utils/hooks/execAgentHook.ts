import { randomUUID } from 'crypto'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { query } from '../../query.js'
import { logEvent } from '../../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/metadata.js'
import type { ToolUseContext } from '../../Tool.js'
import { type Tool, toolMatchesName } from '../../Tool.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../../tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { ALL_AGENT_DISALLOWED_TOOLS } from '../../tools.js'
import { asAgentId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'
import { createAbortController } from '../abortController.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import type { HookResult } from '../hooks.js'
import { createUserMessage, handleMessageFromStream } from '../messages.js'
import { getSmallFastModel } from '../model/model.js'
import { hasPermissionsToUseTool } from '../permissions/permissions.js'
import { getAgentTranscriptPath, getTranscriptPath } from '../sessionStorage.js'
import type { AgentHook } from '../settings/types.js'
import { jsonStringify } from '../slowOperations.js'
import { asSystemPrompt } from '../systemPromptType.js'
import {
  addArgumentsToPrompt,
  createStructuredOutputTool,
  hookResponseSchema,
  registerStructuredOutputEnforcement,
} from './hookHelpers.js'
import { clearSessionHooks } from './sessionHooks.js'

export async function execAgentHook(
  hook: AgentHook,
  hookName: string,
  hookEvent: HookEvent,
  jsonInput: string,
  signal: AbortSignal,
  toolUseContext: ToolUseContext,
  toolUseID: string | undefined,
  
  
  
  
  _messages: Message[],
  agentName?: string,
): Promise<HookResult> {
  const effectiveToolUseID = toolUseID || `hook-${randomUUID()}`

  
  const transcriptPath = toolUseContext.agentId
    ? getAgentTranscriptPath(toolUseContext.agentId)
    : getTranscriptPath()
  const hookStartTime = Date.now()
  try {
    
    const processedPrompt = addArgumentsToPrompt(hook.prompt, jsonInput)
    logForDebugging(
      `Hooks: Processing agent hook with prompt: ${processedPrompt}`,
    )

    
    
    const userMessage = createUserMessage({ content: processedPrompt })
    const agentMessages = [userMessage]

    logForDebugging(
      `Hooks: Starting agent query with ${agentMessages.length} messages`,
    )

    
    const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 60000
    const hookAbortController = createAbortController()

    
    const { signal: parentTimeoutSignal, cleanup: cleanupCombinedSignal } =
      createCombinedAbortSignal(signal, { timeoutMs: hookTimeoutMs })
    const onParentTimeout = () => hookAbortController.abort()
    parentTimeoutSignal.addEventListener('abort', onParentTimeout)

    
    const combinedSignal = hookAbortController.signal

    try {
      
      const structuredOutputTool = createStructuredOutputTool()

      
      
      const filteredTools = toolUseContext.options.tools.filter(
        tool => !toolMatchesName(tool, SYNTHETIC_OUTPUT_TOOL_NAME),
      )

      
      
      
      const tools: Tool[] = [
        ...filteredTools.filter(
          tool => !ALL_AGENT_DISALLOWED_TOOLS.has(tool.name),
        ),
        structuredOutputTool,
      ]

      const systemPrompt = asSystemPrompt([
        `You are verifying a stop condition in Claude Code Next. Your task is to verify that the agent completed the given plan. The conversation transcript is available at: ${transcriptPath}\nYou can read this file to analyze the conversation history if needed.

Use the available tools to inspect the codebase and verify the condition.
Use as few steps as possible - be efficient and direct.

When done, return your result using the ${SYNTHETIC_OUTPUT_TOOL_NAME} tool with:
- ok: true if the condition is met
- ok: false with reason if the condition is not met`,
      ])

      const model = hook.model ?? getSmallFastModel()
      const MAX_AGENT_TURNS = 50

      
      const hookAgentId = asAgentId(`hook-agent-${randomUUID()}`)

      
      const agentToolUseContext: ToolUseContext = {
        ...toolUseContext,
        agentId: hookAgentId,
        abortController: hookAbortController,
        options: {
          ...toolUseContext.options,
          tools,
          mainLoopModel: model,
          isNonInteractiveSession: true,
          thinkingConfig: { type: 'disabled' as const },
        },
        setInProgressToolUseIDs: () => {},
        getAppState() {
          const appState = toolUseContext.getAppState()
          
          const existingSessionRules =
            appState.toolPermissionContext.alwaysAllowRules.session ?? []
          return {
            ...appState,
            toolPermissionContext: {
              ...appState.toolPermissionContext,
              mode: 'dontAsk' as const,
              alwaysAllowRules: {
                ...appState.toolPermissionContext.alwaysAllowRules,
                session: [...existingSessionRules, `Read(/${transcriptPath})`],
              },
            },
          }
        },
      }

      
      registerStructuredOutputEnforcement(
        toolUseContext.setAppState,
        hookAgentId,
      )

      let structuredOutputResult: { ok: boolean; reason?: string } | null = null
      let turnCount = 0
      let hitMaxTurns = false

      
      for await (const message of query({
        messages: agentMessages,
        systemPrompt,
        userContext: {},
        systemContext: {},
        canUseTool: hasPermissionsToUseTool,
        toolUseContext: agentToolUseContext,
        querySource: 'hook_agent',
      })) {
        
        handleMessageFromStream(
          message,
          () => {}, 
          newContent =>
            toolUseContext.setResponseLength(
              length => length + newContent.length,
            ),
          toolUseContext.setStreamMode ?? (() => {}),
          () => {}, 
        )

        
        if (
          message.type === 'stream_event' ||
          message.type === 'stream_request_start'
        ) {
          continue
        }

        
        if (message.type === 'assistant') {
          turnCount++

          
          if (turnCount >= MAX_AGENT_TURNS) {
            hitMaxTurns = true
            logForDebugging(
              `Hooks: Agent turn ${turnCount} hit max turns, aborting`,
            )
            hookAbortController.abort()
            break
          }
        }

        
        if (
          message.type === 'attachment' &&
          message.attachment.type === 'structured_output'
        ) {
          const parsed = hookResponseSchema().safeParse(message.attachment.data)
          if (parsed.success) {
            structuredOutputResult = parsed.data
            logForDebugging(
              `Hooks: Got structured output: ${jsonStringify(structuredOutputResult)}`,
            )
            
            hookAbortController.abort()
            break
          }
        }
      }

      parentTimeoutSignal.removeEventListener('abort', onParentTimeout)
      cleanupCombinedSignal()

      
      clearSessionHooks(toolUseContext.setAppState, hookAgentId)

      
      if (!structuredOutputResult) {
        
        if (hitMaxTurns) {
          logForDebugging(
            `Hooks: Agent hook did not complete within ${MAX_AGENT_TURNS} turns`,
          )
          logEvent('tengu_agent_stop_hook_max_turns', {
            durationMs: Date.now() - hookStartTime,
            turnCount,
            agentName:
              agentName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return {
            hook,
            outcome: 'cancelled',
          }
        }

        
        
        logForDebugging(`Hooks: Agent hook did not return structured output`)
        logEvent('tengu_agent_stop_hook_error', {
          durationMs: Date.now() - hookStartTime,
          turnCount,
          errorType: 1, 
          agentName:
            agentName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          hook,
          outcome: 'cancelled',
        }
      }

      
      if (!structuredOutputResult.ok) {
        logForDebugging(
          `Hooks: Agent hook condition was not met: ${structuredOutputResult.reason}`,
        )
        return {
          hook,
          outcome: 'blocking',
          blockingError: {
            blockingError: `Agent hook condition was not met: ${structuredOutputResult.reason}`,
            command: hook.prompt,
          },
        }
      }

      
      logForDebugging(`Hooks: Agent hook condition was met`)
      logEvent('tengu_agent_stop_hook_success', {
        durationMs: Date.now() - hookStartTime,
        turnCount,
        agentName:
          agentName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return {
        hook,
        outcome: 'success',
        message: createAttachmentMessage({
          type: 'hook_success',
          hookName,
          toolUseID: effectiveToolUseID,
          hookEvent,
          content: '',
        }),
      }
    } catch (error) {
      parentTimeoutSignal.removeEventListener('abort', onParentTimeout)
      cleanupCombinedSignal()

      if (combinedSignal.aborted) {
        return {
          hook,
          outcome: 'cancelled',
        }
      }
      throw error
    }
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Hooks: Agent hook error: ${errorMsg}`)
    logEvent('tengu_agent_stop_hook_error', {
      durationMs: Date.now() - hookStartTime,
      errorType: 2, 
      agentName:
        agentName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      hook,
      outcome: 'non_blocking_error',
      message: createAttachmentMessage({
        type: 'hook_non_blocking_error',
        hookName,
        toolUseID: effectiveToolUseID,
        hookEvent,
        stderr: `Error executing agent hook: ${errorMsg}`,
        stdout: '',
        exitCode: 1,
      }),
    }
  }
}
