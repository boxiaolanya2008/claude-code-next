import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { toError } from '../errors.js'
import { logError } from '../log.js'
import type { SystemPrompt } from '../systemPromptType.js'

export type REPLHookContext = {
  messages: Message[] 
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  querySource?: QuerySource
}

export type PostSamplingHook = (
  context: REPLHookContext,
) => Promise<void> | void

const postSamplingHooks: PostSamplingHook[] = []

export function registerPostSamplingHook(hook: PostSamplingHook): void {
  postSamplingHooks.push(hook)
}

export function clearPostSamplingHooks(): void {
  postSamplingHooks.length = 0
}

export async function executePostSamplingHooks(
  messages: Message[],
  systemPrompt: SystemPrompt,
  userContext: { [k: string]: string },
  systemContext: { [k: string]: string },
  toolUseContext: ToolUseContext,
  querySource?: QuerySource,
): Promise<void> {
  const context: REPLHookContext = {
    messages,
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    querySource,
  }

  for (const hook of postSamplingHooks) {
    try {
      await hook(context)
    } catch (error) {
      
      logError(toError(error))
    }
  }
}
