import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  createUserMessage,
  REJECT_MESSAGE,
  withMemoryCorrectionHint,
} from 'src/utils/messages.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type Tools, type ToolUseContext } from '../../Tool.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { createChildAbortController } from '../../utils/abortController.js'
import { runToolUse } from './toolExecution.js'

type MessageUpdate = {
  message?: Message
  newContext?: ToolUseContext
}

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

type TrackedTool = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  
  pendingProgress: Message[]
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
}

export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private hasErrored = false
  private erroredToolDescription = ''
  
  
  
  private siblingAbortController: AbortController
  private discarded = false
  
  private progressAvailableResolve?: () => void

  constructor(
    private readonly toolDefinitions: Tools,
    private readonly canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  

  discard(): void {
    this.discarded = true
  }

  

  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      this.tools.push({
        id: block.id,
        block,
        assistantMessage,
        status: 'completed',
        isConcurrencySafe: true,
        pendingProgress: [],
        results: [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: `Error: No such tool available: ${block.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        ],
      })
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false
    this.tools.push({
      id: block.id,
      block,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
    })

    void this.processQueue()
  }

  

  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  

  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else {
        
        if (!tool.isConcurrencySafe) break
      }
    }
  }

  private createSyntheticErrorMessage(
    toolUseId: string,
    reason: 'sibling_error' | 'user_interrupted' | 'streaming_fallback',
    assistantMessage: AssistantMessage,
  ): Message {
    
    
    if (reason === 'user_interrupted') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: withMemoryCorrectionHint(REJECT_MESSAGE),
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'User rejected tool use',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'streaming_fallback') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Streaming fallback - tool execution discarded',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    const desc = this.erroredToolDescription
    const msg = desc
      ? `Cancelled: parallel tool call ${desc} errored`
      : 'Cancelled: parallel tool call errored'
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>${msg}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: msg,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
  }

  

  private getAbortReason(
    tool: TrackedTool,
  ): 'sibling_error' | 'user_interrupted' | 'streaming_fallback' | null {
    if (this.discarded) {
      return 'streaming_fallback'
    }
    if (this.hasErrored) {
      return 'sibling_error'
    }
    if (this.toolUseContext.abortController.signal.aborted) {
      
      
      
      if (this.toolUseContext.abortController.signal.reason === 'interrupt') {
        return this.getToolInterruptBehavior(tool) === 'cancel'
          ? 'user_interrupted'
          : null
      }
      return 'user_interrupted'
    }
    return null
  }

  private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
    const definition = findToolByName(this.toolDefinitions, tool.block.name)
    if (!definition?.interruptBehavior) return 'block'
    try {
      return definition.interruptBehavior()
    } catch {
      return 'block'
    }
  }

  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown> | undefined
    const summary = input?.command ?? input?.file_path ?? input?.pattern ?? ''
    if (typeof summary === 'string' && summary.length > 0) {
      const truncated =
        summary.length > 40 ? summary.slice(0, 40) + '\u2026' : summary
      return `${tool.block.name}(${truncated})`
    }
    return tool.block.name
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(t => t.status === 'executing')
    this.toolUseContext.setHasInterruptibleToolInProgress?.(
      executing.length > 0 &&
        executing.every(t => this.getToolInterruptBehavior(t) === 'cancel'),
    )
  }

  

  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(tool.id),
    )
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []

    const collectResults = async () => {
      
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            initialAbortReason,
            tool.assistantMessage,
          ),
        )
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.updateInterruptibleState()
        return
      }

      
      
      
      
      
      
      
      const toolAbortController = createChildAbortController(
        this.siblingAbortController,
      )
      toolAbortController.signal.addEventListener(
        'abort',
        () => {
          if (
            toolAbortController.signal.reason !== 'sibling_error' &&
            !this.toolUseContext.abortController.signal.aborted &&
            !this.discarded
          ) {
            this.toolUseContext.abortController.abort(
              toolAbortController.signal.reason,
            )
          }
        },
        { once: true },
      )

      const generator = runToolUse(
        tool.block,
        tool.assistantMessage,
        this.canUseTool,
        { ...this.toolUseContext, abortController: toolAbortController },
      )

      
      
      
      let thisToolErrored = false

      for await (const update of generator) {
        
        
        const abortReason = this.getAbortReason(tool)
        if (abortReason && !thisToolErrored) {
          messages.push(
            this.createSyntheticErrorMessage(
              tool.id,
              abortReason,
              tool.assistantMessage,
            ),
          )
          break
        }

        const isErrorResult =
          update.message.type === 'user' &&
          Array.isArray(update.message.message.content) &&
          update.message.message.content.some(
            _ => _.type === 'tool_result' && _.is_error === true,
          )

        if (isErrorResult) {
          thisToolErrored = true
          
          
          
          if (tool.block.name === BASH_TOOL_NAME) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message) {
          
          if (update.message.type === 'progress') {
            tool.pendingProgress.push(update.message)
            
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          } else {
            messages.push(update.message)
          }
        }
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'
      this.updateInterruptibleState()

      
      
      
      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise

    
    void promise.finally(() => {
      void this.processQueue()
    })
  }

  

  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      
      while (tool.pendingProgress.length > 0) {
        const progressMessage = tool.pendingProgress.shift()!
        yield { message: progressMessage, newContext: this.toolUseContext }
      }

      if (tool.status === 'yielded') {
        continue
      }

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'

        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }

        markToolUseAsComplete(this.toolUseContext, tool.id)
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  

  private hasPendingProgress(): boolean {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  

  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const result of this.getCompletedResults()) {
        yield result
      }

      
      
      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        
        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  

  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  

  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  

  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  

  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
  }
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
