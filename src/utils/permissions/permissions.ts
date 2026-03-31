import { feature } from "../bundle-mock.ts"
import { APIUserAbortError } from '@anthropic-ai/sdk'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  getToolNameForPermissionCheck,
  mcpInfoFromString,
} from '../../services/mcp/mcpStringUtils.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { shouldUseSandbox } from '../../tools/BashTool/shouldUseSandbox.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { REPL_TOOL_NAME } from '../../tools/REPLTool/constants.js'
import type { AssistantMessage } from '../../types/message.js'
import { extractOutputRedirections } from '../bash/commands.js'
import { logForDebugging } from '../debug.js'
import { AbortError, toError } from '../errors.js'
import { logError } from '../log.js'
import { SandboxManager } from '../sandbox/sandbox-adapter.js'
import {
  getSettingSourceDisplayNameLowercase,
  SETTING_SOURCES,
} from '../settings/constants.js'
import { plural } from '../stringUtils.js'
import { permissionModeTitle } from './PermissionMode.js'
import type {
  PermissionAskDecision,
  PermissionDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
  PermissionResult,
} from './PermissionResult.js'
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
} from './PermissionRule.js'
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
  persistPermissionUpdates,
} from './PermissionUpdate.js'
import type {
  PermissionUpdate,
  PermissionUpdateDestination,
} from './PermissionUpdateSchema.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'
import {
  deletePermissionRuleFromSettings,
  type PermissionRuleFromEditableSettings,
  shouldAllowManagedPermissionRulesOnly,
} from './permissionsLoader.js'

const classifierDecisionModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('./classifierDecision.js') as typeof import('./classifierDecision.js'))
  : null
const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER')
  ? (require('./autoModeState.js') as typeof import('./autoModeState.js'))
  : null

import {
  addToTurnClassifierDuration,
  getTotalCacheCreationInputTokens,
  getTotalCacheReadInputTokens,
  getTotalInputTokens,
  getTotalOutputTokens,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import {
  clearClassifierChecking,
  setClassifierChecking,
} from '../classifierApprovals.js'
import { isInProtectedNamespace } from '../envUtils.js'
import { executePermissionRequestHooks } from '../hooks.js'
import {
  AUTO_REJECT_MESSAGE,
  buildClassifierUnavailableMessage,
  buildYoloRejectionMessage,
  DONT_ASK_REJECT_MESSAGE,
} from '../messages.js'
import { calculateCostFromTokens } from '../modelCost.js'

import { jsonStringify } from '../slowOperations.js'
import {
  createDenialTrackingState,
  DENIAL_LIMITS,
  type DenialTrackingState,
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
} from './denialTracking.js'
import {
  classifyYoloAction,
  formatActionForClassifier,
} from './yoloClassifier.js'

const CLASSIFIER_FAIL_CLOSED_REFRESH_MS = 30 * 60 * 1000 

const PERMISSION_RULE_SOURCES = [
  ...SETTING_SOURCES,
  'cliArg',
  'command',
  'session',
] as const satisfies readonly PermissionRuleSource[]

export function permissionRuleSourceDisplayString(
  source: PermissionRuleSource,
): string {
  return getSettingSourceDisplayNameLowercase(source)
}

export function getAllowRules(
  context: ToolPermissionContext,
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysAllowRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'allow',
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}

export function createPermissionRequestMessage(
  toolName: string,
  decisionReason?: PermissionDecisionReason,
): string {
  
  if (decisionReason) {
    if (
      (feature('BASH_CLASSIFIER') || feature('TRANSCRIPT_CLASSIFIER')) &&
      decisionReason.type === 'classifier'
    ) {
      return `Classifier '${decisionReason.classifier}' requires approval for this ${toolName} command: ${decisionReason.reason}`
    }
    switch (decisionReason.type) {
      case 'hook': {
        const hookMessage = decisionReason.reason
          ? `Hook '${decisionReason.hookName}' blocked this action: ${decisionReason.reason}`
          : `Hook '${decisionReason.hookName}' requires approval for this ${toolName} command`
        return hookMessage
      }
      case 'rule': {
        const ruleString = permissionRuleValueToString(
          decisionReason.rule.ruleValue,
        )
        const sourceString = permissionRuleSourceDisplayString(
          decisionReason.rule.source,
        )
        return `Permission rule '${ruleString}' from ${sourceString} requires approval for this ${toolName} command`
      }
      case 'subcommandResults': {
        const needsApproval: string[] = []
        for (const [cmd, result] of decisionReason.reasons) {
          if (result.behavior === 'ask' || result.behavior === 'passthrough') {
            
            
            if (toolName === 'Bash') {
              const { commandWithoutRedirections, redirections } =
                extractOutputRedirections(cmd)
              
              const displayCmd =
                redirections.length > 0 ? commandWithoutRedirections : cmd
              needsApproval.push(displayCmd)
            } else {
              needsApproval.push(cmd)
            }
          }
        }
        if (needsApproval.length > 0) {
          const n = needsApproval.length
          return `This ${toolName} command contains multiple operations. The following ${plural(n, 'part')} ${plural(n, 'requires', 'require')} approval: ${needsApproval.join(', ')}`
        }
        return `This ${toolName} command contains multiple operations that require approval`
      }
      case 'permissionPromptTool':
        return `Tool '${decisionReason.permissionPromptToolName}' requires approval for this ${toolName} command`
      case 'sandboxOverride':
        return 'Run outside of the sandbox'
      case 'workingDir':
        return decisionReason.reason
      case 'safetyCheck':
      case 'other':
        return decisionReason.reason
      case 'mode': {
        const modeTitle = permissionModeTitle(decisionReason.mode)
        return `Current permission mode (${modeTitle}) requires approval for this ${toolName} command`
      }
      case 'asyncAgent':
        return decisionReason.reason
    }
  }

  
  const message = `Claude requested permissions to use ${toolName}, but you haven't granted it yet.`

  return message
}

export function getDenyRules(context: ToolPermissionContext): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysDenyRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'deny',
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}

export function getAskRules(context: ToolPermissionContext): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysAskRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'ask',
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}

function toolMatchesRule(
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
  rule: PermissionRule,
): boolean {
  
  if (rule.ruleValue.ruleContent !== undefined) {
    return false
  }

  
  
  
  
  const nameForRuleMatch = getToolNameForPermissionCheck(tool)

  
  if (rule.ruleValue.toolName === nameForRuleMatch) {
    return true
  }

  
  
  const ruleInfo = mcpInfoFromString(rule.ruleValue.toolName)
  const toolInfo = mcpInfoFromString(nameForRuleMatch)

  return (
    ruleInfo !== null &&
    toolInfo !== null &&
    (ruleInfo.toolName === undefined || ruleInfo.toolName === '*') &&
    ruleInfo.serverName === toolInfo.serverName
  )
}

export function toolAlwaysAllowedRule(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): PermissionRule | null {
  return (
    getAllowRules(context).find(rule => toolMatchesRule(tool, rule)) || null
  )
}

export function getDenyRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): PermissionRule | null {
  return getDenyRules(context).find(rule => toolMatchesRule(tool, rule)) || null
}

export function getAskRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name' | 'mcpInfo'>,
): PermissionRule | null {
  return getAskRules(context).find(rule => toolMatchesRule(tool, rule)) || null
}

export function getDenyRuleForAgent(
  context: ToolPermissionContext,
  agentToolName: string,
  agentType: string,
): PermissionRule | null {
  return (
    getDenyRules(context).find(
      rule =>
        rule.ruleValue.toolName === agentToolName &&
        rule.ruleValue.ruleContent === agentType,
    ) || null
  )
}

export function filterDeniedAgents<T extends { agentType: string }>(
  agents: T[],
  context: ToolPermissionContext,
  agentToolName: string,
): T[] {
  
  
  
  const deniedAgentTypes = new Set<string>()
  for (const rule of getDenyRules(context)) {
    if (
      rule.ruleValue.toolName === agentToolName &&
      rule.ruleValue.ruleContent !== undefined
    ) {
      deniedAgentTypes.add(rule.ruleValue.ruleContent)
    }
  }
  return agents.filter(agent => !deniedAgentTypes.has(agent.agentType))
}

export function getRuleByContentsForTool(
  context: ToolPermissionContext,
  tool: Tool,
  behavior: PermissionBehavior,
): Map<string, PermissionRule> {
  return getRuleByContentsForToolName(
    context,
    getToolNameForPermissionCheck(tool),
    behavior,
  )
}

export function getRuleByContentsForToolName(
  context: ToolPermissionContext,
  toolName: string,
  behavior: PermissionBehavior,
): Map<string, PermissionRule> {
  const ruleByContents = new Map<string, PermissionRule>()
  let rules: PermissionRule[] = []
  switch (behavior) {
    case 'allow':
      rules = getAllowRules(context)
      break
    case 'deny':
      rules = getDenyRules(context)
      break
    case 'ask':
      rules = getAskRules(context)
      break
  }
  for (const rule of rules) {
    if (
      rule.ruleValue.toolName === toolName &&
      rule.ruleValue.ruleContent !== undefined &&
      rule.ruleBehavior === behavior
    ) {
      ruleByContents.set(rule.ruleValue.ruleContent, rule)
    }
  }
  return ruleByContents
}

async function runPermissionRequestHooksForHeadlessAgent(
  tool: Tool,
  input: { [key: string]: unknown },
  toolUseID: string,
  context: ToolUseContext,
  permissionMode: string | undefined,
  suggestions: PermissionUpdate[] | undefined,
): Promise<PermissionDecision | null> {
  try {
    for await (const hookResult of executePermissionRequestHooks(
      tool.name,
      toolUseID,
      input,
      context,
      permissionMode,
      suggestions,
      context.abortController.signal,
    )) {
      if (!hookResult.permissionRequestResult) {
        continue
      }
      const decision = hookResult.permissionRequestResult
      if (decision.behavior === 'allow') {
        const finalInput = decision.updatedInput ?? input
        
        if (decision.updatedPermissions?.length) {
          persistPermissionUpdates(decision.updatedPermissions)
          context.setAppState(prev => ({
            ...prev,
            toolPermissionContext: applyPermissionUpdates(
              prev.toolPermissionContext,
              decision.updatedPermissions!,
            ),
          }))
        }
        return {
          behavior: 'allow',
          updatedInput: finalInput,
          decisionReason: {
            type: 'hook',
            hookName: 'PermissionRequest',
          },
        }
      }
      if (decision.behavior === 'deny') {
        if (decision.interrupt) {
          logForDebugging(
            `Hook interrupt: tool=${tool.name} hookMessage=${decision.message}`,
          )
          context.abortController.abort()
        }
        return {
          behavior: 'deny',
          message: decision.message || 'Permission denied by hook',
          decisionReason: {
            type: 'hook',
            hookName: 'PermissionRequest',
            reason: decision.message,
          },
        }
      }
    }
  } catch (error) {
    
    logError(
      new Error('PermissionRequest hook failed for headless agent', {
        cause: toError(error),
      }),
    )
  }
  return null
}

export const hasPermissionsToUseTool: CanUseToolFn = async (
  tool,
  input,
  context,
  assistantMessage,
  toolUseID,
): Promise<PermissionDecision> => {
  const result = await hasPermissionsToUseToolInner(tool, input, context)

  
  
  
  if (result.behavior === 'allow') {
    const appState = context.getAppState()
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const currentDenialState =
        context.localDenialTracking ?? appState.denialTracking
      if (
        appState.toolPermissionContext.mode === 'auto' &&
        currentDenialState &&
        currentDenialState.consecutiveDenials > 0
      ) {
        const newDenialState = recordSuccess(currentDenialState)
        persistDenialState(context, newDenialState)
      }
    }
    return result
  }

  
  
  if (result.behavior === 'ask') {
    const appState = context.getAppState()

    if (appState.toolPermissionContext.mode === 'dontAsk') {
      return {
        behavior: 'deny',
        decisionReason: {
          type: 'mode',
          mode: 'dontAsk',
        },
        message: DONT_ASK_REJECT_MESSAGE(tool.name),
      }
    }
    
    
    if (
      feature('TRANSCRIPT_CLASSIFIER') &&
      (appState.toolPermissionContext.mode === 'auto' ||
        (appState.toolPermissionContext.mode === 'plan' &&
          (autoModeStateModule?.isAutoModeActive() ?? false)))
    ) {
      
      
      
      
      
      
      if (
        result.decisionReason?.type === 'safetyCheck' &&
        !result.decisionReason.classifierApprovable
      ) {
        if (appState.toolPermissionContext.shouldAvoidPermissionPrompts) {
          return {
            behavior: 'deny',
            message: result.message,
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'Safety check requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        return result
      }
      if (tool.requiresUserInteraction?.() && result.behavior === 'ask') {
        return result
      }

      
      
      const denialState =
        context.localDenialTracking ??
        appState.denialTracking ??
        createDenialTrackingState()

      
      
      
      
      
      
      
      
      
      
      
      
      if (
        tool.name === POWERSHELL_TOOL_NAME &&
        !feature('POWERSHELL_AUTO_MODE')
      ) {
        if (appState.toolPermissionContext.shouldAvoidPermissionPrompts) {
          return {
            behavior: 'deny',
            message: 'PowerShell tool requires interactive approval',
            decisionReason: {
              type: 'asyncAgent',
              reason:
                'PowerShell tool requires interactive approval and permission prompts are not available in this context',
            },
          }
        }
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: tool requires explicit user permission`,
        )
        return result
      }

      
      
      
      
      
      
      
      if (
        result.behavior === 'ask' &&
        tool.name !== AGENT_TOOL_NAME &&
        tool.name !== REPL_TOOL_NAME
      ) {
        try {
          const parsedInput = tool.inputSchema.parse(input)
          const acceptEditsResult = await tool.checkPermissions(parsedInput, {
            ...context,
            getAppState: () => {
              const state = context.getAppState()
              return {
                ...state,
                toolPermissionContext: {
                  ...state.toolPermissionContext,
                  mode: 'acceptEdits' as const,
                },
              }
            },
          })
          if (acceptEditsResult.behavior === 'allow') {
            const newDenialState = recordSuccess(denialState)
            persistDenialState(context, newDenialState)
            logForDebugging(
              `Skipping auto mode classifier for ${tool.name}: would be allowed in acceptEdits mode`,
            )
            logEvent('tengu_auto_mode_decision', {
              decision:
                'allowed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              toolName: sanitizeToolNameForAnalytics(tool.name),
              inProtectedNamespace: isInProtectedNamespace(),
              
              
              
              agentMsgId: assistantMessage.message
                .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              confidence:
                'high' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              fastPath:
                'acceptEdits' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            return {
              behavior: 'allow',
              updatedInput: acceptEditsResult.updatedInput ?? input,
              decisionReason: {
                type: 'mode',
                mode: 'auto',
              },
            }
          }
        } catch (e) {
          if (e instanceof AbortError || e instanceof APIUserAbortError) {
            throw e
          }
          
        }
      }

      
      
      if (classifierDecisionModule!.isAutoModeAllowlistedTool(tool.name)) {
        const newDenialState = recordSuccess(denialState)
        persistDenialState(context, newDenialState)
        logForDebugging(
          `Skipping auto mode classifier for ${tool.name}: tool is on the safe allowlist`,
        )
        logEvent('tengu_auto_mode_decision', {
          decision:
            'allowed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          inProtectedNamespace: isInProtectedNamespace(),
          agentMsgId: assistantMessage.message
            .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          confidence:
            'high' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fastPath:
            'allowlist' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {
          behavior: 'allow',
          updatedInput: input,
          decisionReason: {
            type: 'mode',
            mode: 'auto',
          },
        }
      }

      
      const action = formatActionForClassifier(tool.name, input)
      setClassifierChecking(toolUseID)
      let classifierResult
      try {
        classifierResult = await classifyYoloAction(
          context.messages,
          action,
          context.options.tools,
          appState.toolPermissionContext,
          context.abortController.signal,
        )
      } finally {
        clearClassifierChecking(toolUseID)
      }

      
      if (
        process.env.USER_TYPE === 'ant' &&
        classifierResult.errorDumpPath &&
        context.addNotification
      ) {
        context.addNotification({
          key: 'auto-mode-error-dump',
          text: `Auto mode classifier error — prompts dumped to ${classifierResult.errorDumpPath} (included in /share)`,
          priority: 'immediate',
          color: 'error',
        })
      }

      
      const yoloDecision = classifierResult.unavailable
        ? 'unavailable'
        : classifierResult.shouldBlock
          ? 'blocked'
          : 'allowed'

      
      const classifierCostUSD =
        classifierResult.usage && classifierResult.model
          ? calculateCostFromTokens(
              classifierResult.model,
              classifierResult.usage,
            )
          : undefined
      logEvent('tengu_auto_mode_decision', {
        decision:
          yoloDecision as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
        inProtectedNamespace: isInProtectedNamespace(),
        
        
        agentMsgId: assistantMessage.message
          .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierModel:
          classifierResult.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        consecutiveDenials: classifierResult.shouldBlock
          ? denialState.consecutiveDenials + 1
          : 0,
        totalDenials: classifierResult.shouldBlock
          ? denialState.totalDenials + 1
          : denialState.totalDenials,
        
        classifierInputTokens: classifierResult.usage?.inputTokens,
        classifierOutputTokens: classifierResult.usage?.outputTokens,
        classifierCacheReadInputTokens:
          classifierResult.usage?.cacheReadInputTokens,
        classifierCacheCreationInputTokens:
          classifierResult.usage?.cacheCreationInputTokens,
        classifierDurationMs: classifierResult.durationMs,
        
        classifierSystemPromptLength:
          classifierResult.promptLengths?.systemPrompt,
        classifierToolCallsLength: classifierResult.promptLengths?.toolCalls,
        classifierUserPromptsLength:
          classifierResult.promptLengths?.userPrompts,
        
        
        
        sessionInputTokens: getTotalInputTokens(),
        sessionOutputTokens: getTotalOutputTokens(),
        sessionCacheReadInputTokens: getTotalCacheReadInputTokens(),
        sessionCacheCreationInputTokens: getTotalCacheCreationInputTokens(),
        classifierCostUSD,
        classifierStage:
          classifierResult.stage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage1InputTokens: classifierResult.stage1Usage?.inputTokens,
        classifierStage1OutputTokens:
          classifierResult.stage1Usage?.outputTokens,
        classifierStage1CacheReadInputTokens:
          classifierResult.stage1Usage?.cacheReadInputTokens,
        classifierStage1CacheCreationInputTokens:
          classifierResult.stage1Usage?.cacheCreationInputTokens,
        classifierStage1DurationMs: classifierResult.stage1DurationMs,
        classifierStage1RequestId:
          classifierResult.stage1RequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage1MsgId:
          classifierResult.stage1MsgId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage1CostUSD:
          classifierResult.stage1Usage && classifierResult.model
            ? calculateCostFromTokens(
                classifierResult.model,
                classifierResult.stage1Usage,
              )
            : undefined,
        classifierStage2InputTokens: classifierResult.stage2Usage?.inputTokens,
        classifierStage2OutputTokens:
          classifierResult.stage2Usage?.outputTokens,
        classifierStage2CacheReadInputTokens:
          classifierResult.stage2Usage?.cacheReadInputTokens,
        classifierStage2CacheCreationInputTokens:
          classifierResult.stage2Usage?.cacheCreationInputTokens,
        classifierStage2DurationMs: classifierResult.stage2DurationMs,
        classifierStage2RequestId:
          classifierResult.stage2RequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage2MsgId:
          classifierResult.stage2MsgId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        classifierStage2CostUSD:
          classifierResult.stage2Usage && classifierResult.model
            ? calculateCostFromTokens(
                classifierResult.model,
                classifierResult.stage2Usage,
              )
            : undefined,
      })

      if (classifierResult.durationMs !== undefined) {
        addToTurnClassifierDuration(classifierResult.durationMs)
      }

      if (classifierResult.shouldBlock) {
        
        
        
        if (classifierResult.transcriptTooLong) {
          if (appState.toolPermissionContext.shouldAvoidPermissionPrompts) {
            
            
            throw new AbortError(
              'Agent aborted: auto mode classifier transcript exceeded context window in headless mode',
            )
          }
          logForDebugging(
            'Auto mode classifier transcript too long, falling back to normal permission handling',
            { level: 'warn' },
          )
          return {
            ...result,
            decisionReason: {
              type: 'other',
              reason:
                'Auto mode classifier transcript exceeded context window — falling back to manual approval',
            },
          }
        }
        
        
        if (classifierResult.unavailable) {
          if (
            getFeatureValue_CACHED_WITH_REFRESH(
              'tengu_iron_gate_closed',
              true,
              CLASSIFIER_FAIL_CLOSED_REFRESH_MS,
            )
          ) {
            logForDebugging(
              'Auto mode classifier unavailable, denying with retry guidance (fail closed)',
              { level: 'warn' },
            )
            return {
              behavior: 'deny',
              decisionReason: {
                type: 'classifier',
                classifier: 'auto-mode',
                reason: 'Classifier unavailable',
              },
              message: buildClassifierUnavailableMessage(
                tool.name,
                classifierResult.model,
              ),
            }
          }
          
          logForDebugging(
            'Auto mode classifier unavailable, falling back to normal permission handling (fail open)',
            { level: 'warn' },
          )
          return result
        }

        
        const newDenialState = recordDenial(denialState)
        persistDenialState(context, newDenialState)

        logForDebugging(
          `Auto mode classifier blocked action: ${classifierResult.reason}`,
          { level: 'warn' },
        )

        
        
        
        const denialLimitResult = handleDenialLimitExceeded(
          newDenialState,
          appState,
          classifierResult.reason,
          assistantMessage,
          tool,
          result,
          context,
        )
        if (denialLimitResult) {
          return denialLimitResult
        }

        return {
          behavior: 'deny',
          decisionReason: {
            type: 'classifier',
            classifier: 'auto-mode',
            reason: classifierResult.reason,
          },
          message: buildYoloRejectionMessage(classifierResult.reason),
        }
      }

      
      const newDenialState = recordSuccess(denialState)
      persistDenialState(context, newDenialState)

      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'classifier',
          classifier: 'auto-mode',
          reason: classifierResult.reason,
        },
      }
    }

    
    
    
    if (appState.toolPermissionContext.shouldAvoidPermissionPrompts) {
      const hookDecision = await runPermissionRequestHooksForHeadlessAgent(
        tool,
        input,
        toolUseID,
        context,
        appState.toolPermissionContext.mode,
        result.suggestions,
      )
      if (hookDecision) {
        return hookDecision
      }
      return {
        behavior: 'deny',
        decisionReason: {
          type: 'asyncAgent',
          reason: 'Permission prompts are not available in this context',
        },
        message: AUTO_REJECT_MESSAGE(tool.name),
      }
    }
  }

  return result
}

function persistDenialState(
  context: ToolUseContext,
  newState: DenialTrackingState,
): void {
  if (context.localDenialTracking) {
    Object.assign(context.localDenialTracking, newState)
  } else {
    context.setAppState(prev => {
      
      
      
      if (prev.denialTracking === newState) return prev
      return { ...prev, denialTracking: newState }
    })
  }
}

function handleDenialLimitExceeded(
  denialState: DenialTrackingState,
  appState: {
    toolPermissionContext: { shouldAvoidPermissionPrompts?: boolean }
  },
  classifierReason: string,
  assistantMessage: AssistantMessage,
  tool: Tool,
  result: PermissionDecision,
  context: ToolUseContext,
): PermissionDecision | null {
  if (!shouldFallbackToPrompting(denialState)) {
    return null
  }

  const hitTotalLimit = denialState.totalDenials >= DENIAL_LIMITS.maxTotal
  const isHeadless = appState.toolPermissionContext.shouldAvoidPermissionPrompts
  
  
  const totalCount = denialState.totalDenials
  const consecutiveCount = denialState.consecutiveDenials
  const warning = hitTotalLimit
    ? `${totalCount} actions were blocked this session. Please review the transcript before continuing.`
    : `${consecutiveCount} consecutive actions were blocked. Please review the transcript before continuing.`

  logEvent('tengu_auto_mode_denial_limit_exceeded', {
    limit: (hitTotalLimit
      ? 'total'
      : 'consecutive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    mode: (isHeadless
      ? 'headless'
      : 'cli') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    messageID: assistantMessage.message
      .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    consecutiveDenials: consecutiveCount,
    totalDenials: totalCount,
    toolName: sanitizeToolNameForAnalytics(tool.name),
  })

  if (isHeadless) {
    throw new AbortError(
      'Agent aborted: too many classifier denials in headless mode',
    )
  }

  logForDebugging(
    `Classifier denial limit exceeded, falling back to prompting: ${warning}`,
    { level: 'warn' },
  )

  if (hitTotalLimit) {
    persistDenialState(context, {
      ...denialState,
      totalDenials: 0,
      consecutiveDenials: 0,
    })
  }

  
  
  
  const originalClassifier =
    result.decisionReason?.type === 'classifier'
      ? result.decisionReason.classifier
      : 'auto-mode'

  return {
    ...result,
    decisionReason: {
      type: 'classifier',
      classifier: originalClassifier,
      reason: `${warning}\n\nLatest blocked action: ${classifierReason}`,
    },
  }
}

export async function checkRuleBasedPermissions(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): Promise<PermissionAskDecision | PermissionDenyDecision | null> {
  const appState = context.getAppState()

  
  const denyRule = getDenyRuleForTool(appState.toolPermissionContext, tool)
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
  }

  
  const askRule = getAskRuleForTool(appState.toolPermissionContext, tool)
  if (askRule) {
    const canSandboxAutoAllow =
      tool.name === BASH_TOOL_NAME &&
      SandboxManager.isSandboxingEnabled() &&
      SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
      shouldUseSandbox(input)

    if (!canSandboxAutoAllow) {
      return {
        behavior: 'ask',
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        message: createPermissionRequestMessage(tool.name),
      }
    }
    
  }

  
  let toolPermissionResult: PermissionResult = {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(tool.name),
  }
  try {
    const parsedInput = tool.inputSchema.parse(input)
    toolPermissionResult = await tool.checkPermissions(parsedInput, context)
  } catch (e) {
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e
    }
    logError(e)
  }

  
  
  if (toolPermissionResult?.behavior === 'deny') {
    return toolPermissionResult
  }

  
  
  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult.decisionReason?.type === 'rule' &&
    toolPermissionResult.decisionReason.rule.ruleBehavior === 'ask'
  ) {
    return toolPermissionResult
  }

  
  
  
  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult.decisionReason?.type === 'safetyCheck'
  ) {
    return toolPermissionResult
  }

  
  return null
}

async function hasPermissionsToUseToolInner(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): Promise<PermissionDecision> {
  if (context.abortController.signal.aborted) {
    throw new AbortError()
  }

  let appState = context.getAppState()

  
  
  const denyRule = getDenyRuleForTool(appState.toolPermissionContext, tool)
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
  }

  
  const askRule = getAskRuleForTool(appState.toolPermissionContext, tool)
  if (askRule) {
    
    
    
    const canSandboxAutoAllow =
      tool.name === BASH_TOOL_NAME &&
      SandboxManager.isSandboxingEnabled() &&
      SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
      shouldUseSandbox(input)

    if (!canSandboxAutoAllow) {
      return {
        behavior: 'ask',
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
        message: createPermissionRequestMessage(tool.name),
      }
    }
    
  }

  
  
  let toolPermissionResult: PermissionResult = {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(tool.name),
  }
  try {
    const parsedInput = tool.inputSchema.parse(input)
    toolPermissionResult = await tool.checkPermissions(parsedInput, context)
  } catch (e) {
    
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e
    }
    logError(e)
  }

  
  if (toolPermissionResult?.behavior === 'deny') {
    return toolPermissionResult
  }

  
  if (
    tool.requiresUserInteraction?.() &&
    toolPermissionResult?.behavior === 'ask'
  ) {
    return toolPermissionResult
  }

  
  
  
  
  
  
  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult.decisionReason?.type === 'rule' &&
    toolPermissionResult.decisionReason.rule.ruleBehavior === 'ask'
  ) {
    return toolPermissionResult
  }

  
  
  
  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult.decisionReason?.type === 'safetyCheck'
  ) {
    return toolPermissionResult
  }

  
  
  appState = context.getAppState()
  
  
  
  const shouldBypassPermissions =
    appState.toolPermissionContext.mode === 'bypassPermissions' ||
    (appState.toolPermissionContext.mode === 'plan' &&
      appState.toolPermissionContext.isBypassPermissionsModeAvailable)
  if (shouldBypassPermissions) {
    return {
      behavior: 'allow',
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: 'mode',
        mode: appState.toolPermissionContext.mode,
      },
    }
  }

  
  const alwaysAllowedRule = toolAlwaysAllowedRule(
    appState.toolPermissionContext,
    tool,
  )
  if (alwaysAllowedRule) {
    return {
      behavior: 'allow',
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: 'rule',
        rule: alwaysAllowedRule,
      },
    }
  }

  
  const result: PermissionDecision =
    toolPermissionResult.behavior === 'passthrough'
      ? {
          ...toolPermissionResult,
          behavior: 'ask' as const,
          message: createPermissionRequestMessage(
            tool.name,
            toolPermissionResult.decisionReason,
          ),
        }
      : toolPermissionResult

  if (result.behavior === 'ask' && result.suggestions) {
    logForDebugging(
      `Permission suggestions for ${tool.name}: ${jsonStringify(result.suggestions, null, 2)}`,
    )
  }

  return result
}

type EditPermissionRuleArgs = {
  initialContext: ToolPermissionContext
  setToolPermissionContext: (updatedContext: ToolPermissionContext) => void
}

export async function deletePermissionRule({
  rule,
  initialContext,
  setToolPermissionContext,
}: EditPermissionRuleArgs & { rule: PermissionRule }): Promise<void> {
  if (
    rule.source === 'policySettings' ||
    rule.source === 'flagSettings' ||
    rule.source === 'command'
  ) {
    throw new Error('Cannot delete permission rules from read-only settings')
  }

  const updatedContext = applyPermissionUpdate(initialContext, {
    type: 'removeRules',
    rules: [rule.ruleValue],
    behavior: rule.ruleBehavior,
    destination: rule.source as PermissionUpdateDestination,
  })

  
  const destination = rule.source
  switch (destination) {
    case 'localSettings':
    case 'userSettings':
    case 'projectSettings': {
      
      deletePermissionRuleFromSettings(
        rule as PermissionRuleFromEditableSettings,
      )
      break
    }
    case 'cliArg':
    case 'session': {
      
      break
    }
  }

  
  setToolPermissionContext(updatedContext)
}

function convertRulesToUpdates(
  rules: PermissionRule[],
  updateType: 'addRules' | 'replaceRules',
): PermissionUpdate[] {
  
  const grouped = new Map<string, PermissionRuleValue[]>()

  for (const rule of rules) {
    const key = `${rule.source}:${rule.ruleBehavior}`
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)!.push(rule.ruleValue)
  }

  
  const updates: PermissionUpdate[] = []
  for (const [key, ruleValues] of grouped) {
    const [source, behavior] = key.split(':')
    updates.push({
      type: updateType,
      rules: ruleValues,
      behavior: behavior as PermissionBehavior,
      destination: source as PermissionUpdateDestination,
    })
  }

  return updates
}

export function applyPermissionRulesToPermissionContext(
  toolPermissionContext: ToolPermissionContext,
  rules: PermissionRule[],
): ToolPermissionContext {
  const updates = convertRulesToUpdates(rules, 'addRules')
  return applyPermissionUpdates(toolPermissionContext, updates)
}

export function syncPermissionRulesFromDisk(
  toolPermissionContext: ToolPermissionContext,
  rules: PermissionRule[],
): ToolPermissionContext {
  let context = toolPermissionContext

  
  if (shouldAllowManagedPermissionRulesOnly()) {
    const sourcesToClear: PermissionUpdateDestination[] = [
      'userSettings',
      'projectSettings',
      'localSettings',
      'cliArg',
      'session',
    ]
    const behaviors: PermissionBehavior[] = ['allow', 'deny', 'ask']

    for (const source of sourcesToClear) {
      for (const behavior of behaviors) {
        context = applyPermissionUpdate(context, {
          type: 'replaceRules',
          rules: [],
          behavior,
          destination: source,
        })
      }
    }
  }

  
  
  
  
  
  const diskSources: PermissionUpdateDestination[] = [
    'userSettings',
    'projectSettings',
    'localSettings',
  ]
  for (const diskSource of diskSources) {
    for (const behavior of ['allow', 'deny', 'ask'] as PermissionBehavior[]) {
      context = applyPermissionUpdate(context, {
        type: 'replaceRules',
        rules: [],
        behavior,
        destination: diskSource,
      })
    }
  }

  const updates = convertRulesToUpdates(rules, 'replaceRules')
  return applyPermissionUpdates(context, updates)
}

function getUpdatedInputOrFallback(
  permissionResult: PermissionResult,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  return (
    ('updatedInput' in permissionResult
      ? permissionResult.updatedInput
      : undefined) ?? fallback
  )
}
