import { getMainThreadAgentType } from '../bootstrap/state.js'
import type { HookResultMessage } from '../types/message.js'
import { createAttachmentMessage } from './attachments.js'
import { logForDebugging } from './debug.js'
import { withDiagnosticsTiming } from './diagLogs.js'
import { isBareMode } from './envUtils.js'
import { updateWatchPaths } from './hooks/fileChangedWatcher.js'
import { shouldAllowManagedHooksOnly } from './hooks/hooksConfigSnapshot.js'
import { executeSessionStartHooks, executeSetupHooks } from './hooks.js'
import { logError } from './log.js'
import { loadPluginHooks } from './plugins/loadPluginHooks.js'

type SessionStartHooksOptions = {
  sessionId?: string
  agentType?: string
  model?: string
  forceSyncExecution?: boolean
}

let pendingInitialUserMessage: string | undefined

export function takeInitialUserMessage(): string | undefined {
  const v = pendingInitialUserMessage
  pendingInitialUserMessage = undefined
  return v
}

export async function processSessionStartHooks(
  source: 'startup' | 'resume' | 'clear' | 'compact',
  {
    sessionId,
    agentType,
    model,
    forceSyncExecution,
  }: SessionStartHooksOptions = {},
): Promise<HookResultMessage[]> {
  
  
  
  if (isBareMode()) {
    return []
  }
  const hookMessages: HookResultMessage[] = []
  const additionalContexts: string[] = []
  const allWatchPaths: string[] = []

  
  
  if (shouldAllowManagedHooksOnly()) {
    logForDebugging('Skipping plugin hooks - allowManagedHooksOnly is enabled')
  } else {
    
    
    
    
    
    try {
      await withDiagnosticsTiming('load_plugin_hooks', () => loadPluginHooks())
    } catch (error) {
      
      
      const enhancedError =
        error instanceof Error
          ? new Error(
              `Failed to load plugin hooks during ${source}: ${error.message}`,
            )
          : new Error(
              `Failed to load plugin hooks during ${source}: ${String(error)}`,
            )
      

      if (error instanceof Error && error.stack) {
        enhancedError.stack = error.stack
      }

      logError(enhancedError)

      
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      let userGuidance = ''

      if (
        errorMessage.includes('Failed to clone') ||
        errorMessage.includes('network') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ENOTFOUND')
      ) {
        userGuidance =
          'This appears to be a network issue. Check your internet connection and try again.'
      } else if (
        errorMessage.includes('Permission denied') ||
        errorMessage.includes('EACCES') ||
        errorMessage.includes('EPERM')
      ) {
        userGuidance =
          'This appears to be a permissions issue. Check file permissions on ~/.claude/plugins/'
      } else if (
        errorMessage.includes('Invalid') ||
        errorMessage.includes('parse') ||
        errorMessage.includes('JSON') ||
        errorMessage.includes('schema')
      ) {
        userGuidance =
          'This appears to be a configuration issue. Check your plugin settings in .claude/settings.json'
      } else {
        userGuidance =
          'Please fix the plugin configuration or remove problematic plugins from your settings.'
      }

      logForDebugging(
        `Warning: Failed to load plugin hooks. SessionStart hooks from plugins will not execute. ` +
          `Error: ${errorMessage}. ${userGuidance}`,
        { level: 'warn' },
      )

      
      
    }
  }

  
  
  const resolvedAgentType = agentType ?? getMainThreadAgentType()
  for await (const hookResult of executeSessionStartHooks(
    source,
    sessionId,
    resolvedAgentType,
    model,
    undefined,
    undefined,
    forceSyncExecution,
  )) {
    if (hookResult.message) {
      hookMessages.push(hookResult.message)
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      additionalContexts.push(...hookResult.additionalContexts)
    }
    if (hookResult.initialUserMessage) {
      pendingInitialUserMessage = hookResult.initialUserMessage
    }
    if (hookResult.watchPaths && hookResult.watchPaths.length > 0) {
      allWatchPaths.push(...hookResult.watchPaths)
    }
  }

  if (allWatchPaths.length > 0) {
    updateWatchPaths(allWatchPaths)
  }

  
  if (additionalContexts.length > 0) {
    const contextMessage = createAttachmentMessage({
      type: 'hook_additional_context',
      content: additionalContexts,
      hookName: 'SessionStart',
      toolUseID: 'SessionStart',
      hookEvent: 'SessionStart',
    })
    hookMessages.push(contextMessage)
  }

  return hookMessages
}

export async function processSetupHooks(
  trigger: 'init' | 'maintenance',
  { forceSyncExecution }: { forceSyncExecution?: boolean } = {},
): Promise<HookResultMessage[]> {
  
  if (isBareMode()) {
    return []
  }
  const hookMessages: HookResultMessage[] = []
  const additionalContexts: string[] = []

  if (shouldAllowManagedHooksOnly()) {
    logForDebugging('Skipping plugin hooks - allowManagedHooksOnly is enabled')
  } else {
    try {
      await loadPluginHooks()
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logForDebugging(
        `Warning: Failed to load plugin hooks. Setup hooks from plugins will not execute. Error: ${errorMessage}`,
        { level: 'warn' },
      )
    }
  }

  for await (const hookResult of executeSetupHooks(
    trigger,
    undefined,
    undefined,
    forceSyncExecution,
  )) {
    if (hookResult.message) {
      hookMessages.push(hookResult.message)
    }
    if (
      hookResult.additionalContexts &&
      hookResult.additionalContexts.length > 0
    ) {
      additionalContexts.push(...hookResult.additionalContexts)
    }
  }

  if (additionalContexts.length > 0) {
    const contextMessage = createAttachmentMessage({
      type: 'hook_additional_context',
      content: additionalContexts,
      hookName: 'Setup',
      toolUseID: 'Setup',
      hookEvent: 'Setup',
    })
    hookMessages.push(contextMessage)
  }

  return hookMessages
}
