import { randomUUID } from 'crypto'
import type { QuerySource } from '../../constants/querySource.js'
import { queryModelWithoutStreaming } from '../../services/api/claude.js'
import type { Message } from '../../types/message.js'
import { createAbortController } from '../../utils/abortController.js'
import { logError } from '../../utils/log.js'
import { toError } from '../errors.js'
import { extractTextContent } from '../messages.js'
import { asSystemPrompt } from '../systemPromptType.js'
import type { REPLHookContext } from './postSamplingHooks.js'

export type ApiQueryHookContext = REPLHookContext & {
  queryMessageCount?: number
}

export type ApiQueryHookConfig<TResult> = {
  name: QuerySource
  shouldRun: (context: ApiQueryHookContext) => Promise<boolean>

  
  buildMessages: (context: ApiQueryHookContext) => Message[]

  
  systemPrompt?: string

  
  
  useTools?: boolean

  parseResponse: (content: string, context: ApiQueryHookContext) => TResult
  logResult: (
    result: ApiQueryResult<TResult>,
    context: ApiQueryHookContext,
  ) => void
  
  
  getModel: (context: ApiQueryHookContext) => string
}

export type ApiQueryResult<TResult> =
  | {
      type: 'success'
      queryName: string
      result: TResult
      messageId: string
      model: string
      uuid: string
    }
  | {
      type: 'error'
      queryName: string
      error: Error
      uuid: string
    }

export function createApiQueryHook<TResult>(
  config: ApiQueryHookConfig<TResult>,
) {
  return async (context: ApiQueryHookContext): Promise<void> => {
    try {
      const shouldRun = await config.shouldRun(context)
      if (!shouldRun) {
        return
      }

      const uuid = randomUUID()

      
      const messages = config.buildMessages(context)
      context.queryMessageCount = messages.length

      
      const systemPrompt = config.systemPrompt
        ? asSystemPrompt([config.systemPrompt])
        : context.systemPrompt

      
      const useTools = config.useTools ?? true
      const tools = useTools ? context.toolUseContext.options.tools : []

      
      const model = config.getModel(context)

      
      const response = await queryModelWithoutStreaming({
        messages,
        systemPrompt,
        thinkingConfig: { type: 'disabled' as const },
        tools,
        signal: createAbortController().signal,
        options: {
          getToolPermissionContext: async () => {
            const appState = context.toolUseContext.getAppState()
            return appState.toolPermissionContext
          },
          model,
          toolChoice: undefined,
          isNonInteractiveSession:
            context.toolUseContext.options.isNonInteractiveSession,
          hasAppendSystemPrompt:
            !!context.toolUseContext.options.appendSystemPrompt,
          temperatureOverride: 0,
          agents: context.toolUseContext.options.agentDefinitions.activeAgents,
          querySource: config.name,
          mcpTools: [],
          agentId: context.toolUseContext.agentId,
        },
      })

      
      const content = extractTextContent(response.message.content).trim()

      try {
        const result = config.parseResponse(content, context)
        config.logResult(
          {
            type: 'success',
            queryName: config.name,
            result,
            messageId: response.message.id,
            model,
            uuid,
          },
          context,
        )
      } catch (error) {
        config.logResult(
          {
            type: 'error',
            queryName: config.name,
            error: error as Error,
            uuid,
          },
          context,
        )
      }
    } catch (error) {
      logError(toError(error))
    }
  }
}
