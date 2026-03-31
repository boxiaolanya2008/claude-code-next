import { feature } from 'bun:bundle'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import uniqBy from 'lodash-es/uniqBy.js'
import { dirname } from 'path'
import { getProjectRoot } from 'src/bootstrap/state.js'
import {
  builtInCommandNames,
  findCommand,
  getCommands,
  type PromptCommand,
} from 'src/commands.js'
import type {
  Tool,
  ToolCallProgress,
  ToolResult,
  ToolUseContext,
  ValidationResult,
} from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import type { Command } from 'src/types/command.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  SystemMessage,
  UserMessage,
} from 'src/types/message.js'
import { logForDebugging } from 'src/utils/debug.js'
import type { PermissionDecision } from 'src/utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from 'src/utils/permissions/permissions.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from 'src/utils/plugins/pluginIdentifier.js'
import { buildPluginCommandTelemetryFields } from 'src/utils/telemetry/pluginTelemetry.js'
import { z } from 'zod/v4'
import {
  addInvokedSkill,
  clearInvokedSkillsForAgent,
  getSessionId,
} from '../../bootstrap/state.js'
import { COMMAND_MESSAGE_TAG } from '../../constants/xml.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import { getAgentContext } from '../../utils/agentContext.js'
import { errorMessage } from '../../utils/errors.js'
import {
  extractResultText,
  prepareForkedCommandContext,
} from '../../utils/forkedAgent.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createUserMessage, normalizeMessages } from '../../utils/messages.js'
import type { ModelAlias } from '../../utils/model/aliases.js'
import { resolveSkillModelOverride } from '../../utils/model/model.js'
import { recordSkillUsage } from '../../utils/suggestions/skillUsageTracking.js'
import { createAgentId } from '../../utils/uuid.js'
import { runAgent } from '../AgentTool/runAgent.js'
import {
  getToolUseIDFromParentMessage,
  tagMessagesWithToolUseID,
} from '../utils.js'
import { SKILL_TOOL_NAME } from './constants.js'
import { getPrompt } from './prompt.js'
import {
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
} from './UI.js'

async function getAllCommands(context: ToolUseContext): Promise<Command[]> {
  
  
  
  
  const mcpSkills = context
    .getAppState()
    .mcp.commands.filter(
      cmd => cmd.type === 'prompt' && cmd.loadedFrom === 'mcp',
    )
  if (mcpSkills.length === 0) return getCommands(getProjectRoot())
  const localCommands = await getCommands(getProjectRoot())
  return uniqBy([...localCommands, ...mcpSkills], 'name')
}

export type { SkillToolProgress as Progress } from '../../types/tools.js'

import type { SkillToolProgress as Progress } from '../../types/tools.js'

const remoteSkillModules = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? {
      ...(require('../../services/skillSearch/remoteSkillState.js') as typeof import('../../services/skillSearch/remoteSkillState.js')),
      ...(require('../../services/skillSearch/remoteSkillLoader.js') as typeof import('../../services/skillSearch/remoteSkillLoader.js')),
      ...(require('../../services/skillSearch/telemetry.js') as typeof import('../../services/skillSearch/telemetry.js')),
      ...(require('../../services/skillSearch/featureCheck.js') as typeof import('../../services/skillSearch/featureCheck.js')),
    }
  : null

async function executeForkedSkill(
  command: Command & { type: 'prompt' },
  commandName: string,
  args: string | undefined,
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  parentMessage: AssistantMessage,
  onProgress?: ToolCallProgress<Progress>,
): Promise<ToolResult<Output>> {
  const startTime = Date.now()
  const agentId = createAgentId()
  const isBuiltIn = builtInCommandNames().has(commandName)
  const isOfficialSkill = isOfficialMarketplaceSkill(command)
  const isBundled = command.source === 'bundled'
  const forkedSanitizedName =
    isBuiltIn || isBundled || isOfficialSkill ? commandName : 'custom'

  const wasDiscoveredField =
    feature('EXPERIMENTAL_SKILL_SEARCH') &&
    remoteSkillModules!.isSkillSearchEnabled()
      ? {
          was_discovered:
            context.discoveredSkillNames?.has(commandName) ?? false,
        }
      : {}
  const pluginMarketplace = command.pluginInfo
    ? parsePluginIdentifier(command.pluginInfo.repository).marketplace
    : undefined
  const queryDepth = context.queryTracking?.depth ?? 0
  const parentAgentId = getAgentContext()?.agentId
  logEvent('tengu_skill_tool_invocation', {
    command_name:
      forkedSanitizedName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    
    
    
    _PROTO_skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    execution_context:
      'fork' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: (queryDepth > 0
      ? 'nested-skill'
      : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    query_depth: queryDepth,
    ...(parentAgentId && {
      parent_agent_id:
        parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...wasDiscoveredField,
    ...(process.env.USER_TYPE === 'ant' && {
      skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_source:
        command.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(command.loadedFrom && {
        skill_loaded_from:
          command.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(command.kind && {
        skill_kind:
          command.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    }),
    ...(command.pluginInfo && {
      
      
      
      _PROTO_plugin_name: command.pluginInfo.pluginManifest
        .name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(pluginMarketplace && {
        _PROTO_marketplace_name:
          pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      plugin_name: (isOfficialSkill
        ? command.pluginInfo.pluginManifest.name
        : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      plugin_repository: (isOfficialSkill
        ? command.pluginInfo.repository
        : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...buildPluginCommandTelemetryFields(command.pluginInfo),
    }),
  })

  const { modifiedGetAppState, baseAgent, promptMessages, skillContent } =
    await prepareForkedCommandContext(command, args || '', context)

  
  const agentDefinition =
    command.effort !== undefined
      ? { ...baseAgent, effort: command.effort }
      : baseAgent

  
  const agentMessages: Message[] = []

  logForDebugging(
    `SkillTool executing forked skill ${commandName} with agent ${agentDefinition.agentType}`,
  )

  try {
    
    for await (const message of runAgent({
      agentDefinition,
      promptMessages,
      toolUseContext: {
        ...context,
        getAppState: modifiedGetAppState,
      },
      canUseTool,
      isAsync: false,
      querySource: 'agent:custom',
      model: command.model as ModelAlias | undefined,
      availableTools: context.options.tools,
      override: { agentId },
    })) {
      agentMessages.push(message)

      
      if (
        (message.type === 'assistant' || message.type === 'user') &&
        onProgress
      ) {
        const normalizedNew = normalizeMessages([message])
        for (const m of normalizedNew) {
          const hasToolContent = m.message.content.some(
            c => c.type === 'tool_use' || c.type === 'tool_result',
          )
          if (hasToolContent) {
            onProgress({
              toolUseID: `skill_${parentMessage.message.id}`,
              data: {
                message: m,
                type: 'skill_progress',
                prompt: skillContent,
                agentId,
              },
            })
          }
        }
      }
    }

    const resultText = extractResultText(
      agentMessages,
      'Skill execution completed',
    )
    
    agentMessages.length = 0

    const durationMs = Date.now() - startTime
    logForDebugging(
      `SkillTool forked skill ${commandName} completed in ${durationMs}ms`,
    )

    return {
      data: {
        success: true,
        commandName,
        status: 'forked',
        agentId,
        result: resultText,
      },
    }
  } finally {
    
    clearInvokedSkillsForAgent(agentId)
  }
}

export const inputSchema = lazySchema(() =>
  z.object({
    skill: z
      .string()
      .describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
    args: z.string().optional().describe('Optional arguments for the skill'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() => {
  
  const inlineOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill is valid'),
    commandName: z.string().describe('The name of the skill'),
    allowedTools: z
      .array(z.string())
      .optional()
      .describe('Tools allowed by this skill'),
    model: z.string().optional().describe('Model override if specified'),
    status: z.literal('inline').optional().describe('Execution status'),
  })

  
  const forkedOutputSchema = z.object({
    success: z.boolean().describe('Whether the skill completed successfully'),
    commandName: z.string().describe('The name of the skill'),
    status: z.literal('forked').describe('Execution status'),
    agentId: z
      .string()
      .describe('The ID of the sub-agent that executed the skill'),
    result: z.string().describe('The result from the forked skill execution'),
  })

  return z.union([inlineOutputSchema, forkedOutputSchema])
})
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.input<OutputSchema>

export const SkillTool: Tool<InputSchema, Output, Progress> = buildTool({
  name: SKILL_TOOL_NAME,
  searchHint: 'invoke a slash-command skill',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  description: async ({ skill }) => `Execute skill: ${skill}`,

  prompt: async () => getPrompt(getProjectRoot()),

  
  
  
  
  
  
  toAutoClassifierInput: ({ skill }) => skill ?? '',

  async validateInput({ skill }, context): Promise<ValidationResult> {
    
    const trimmed = skill.trim()
    if (!trimmed) {
      return {
        result: false,
        message: `Invalid skill format: ${skill}`,
        errorCode: 1,
      }
    }

    
    const hasLeadingSlash = trimmed.startsWith('/')
    if (hasLeadingSlash) {
      logEvent('tengu_skill_tool_slash_prefix', {})
    }
    const normalizedCommandName = hasLeadingSlash
      ? trimmed.substring(1)
      : trimmed

    
    
    
    if (
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      process.env.USER_TYPE === 'ant'
    ) {
      const slug = remoteSkillModules!.stripCanonicalPrefix(
        normalizedCommandName,
      )
      if (slug !== null) {
        const meta = remoteSkillModules!.getDiscoveredRemoteSkill(slug)
        if (!meta) {
          return {
            result: false,
            message: `Remote skill ${slug} was not discovered in this session. Use DiscoverSkills to find remote skills first.`,
            errorCode: 6,
          }
        }
        
        return { result: true }
      }
    }

    
    const commands = await getAllCommands(context)

    
    const foundCommand = findCommand(normalizedCommandName, commands)
    if (!foundCommand) {
      return {
        result: false,
        message: `Unknown skill: ${normalizedCommandName}`,
        errorCode: 2,
      }
    }

    
    if (foundCommand.disableModelInvocation) {
      return {
        result: false,
        message: `Skill ${normalizedCommandName} cannot be used with ${SKILL_TOOL_NAME} tool due to disable-model-invocation`,
        errorCode: 4,
      }
    }

    
    if (foundCommand.type !== 'prompt') {
      return {
        result: false,
        message: `Skill ${normalizedCommandName} is not a prompt-based skill`,
        errorCode: 5,
      }
    }

    return { result: true }
  },

  async checkPermissions(
    { skill, args },
    context,
  ): Promise<PermissionDecision> {
    
    const trimmed = skill.trim()

    
    const commandName = trimmed.startsWith('/') ? trimmed.substring(1) : trimmed

    const appState = context.getAppState()
    const permissionContext = appState.toolPermissionContext

    
    const commands = await getAllCommands(context)
    const commandObj = findCommand(commandName, commands)

    
    
    const ruleMatches = (ruleContent: string): boolean => {
      
      const normalizedRule = ruleContent.startsWith('/')
        ? ruleContent.substring(1)
        : ruleContent

      
      if (normalizedRule === commandName) {
        return true
      }
      
      if (normalizedRule.endsWith(':*')) {
        const prefix = normalizedRule.slice(0, -2) 
        return commandName.startsWith(prefix)
      }
      return false
    }

    
    const denyRules = getRuleByContentsForTool(
      permissionContext,
      SkillTool as Tool,
      'deny',
    )
    for (const [ruleContent, rule] of denyRules.entries()) {
      if (ruleMatches(ruleContent)) {
        return {
          behavior: 'deny',
          message: `Skill execution blocked by permission rules`,
          decisionReason: {
            type: 'rule',
            rule,
          },
        }
      }
    }

    
    
    
    
    if (
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      process.env.USER_TYPE === 'ant'
    ) {
      const slug = remoteSkillModules!.stripCanonicalPrefix(commandName)
      if (slug !== null) {
        return {
          behavior: 'allow',
          updatedInput: { skill, args },
          decisionReason: undefined,
        }
      }
    }

    
    const allowRules = getRuleByContentsForTool(
      permissionContext,
      SkillTool as Tool,
      'allow',
    )
    for (const [ruleContent, rule] of allowRules.entries()) {
      if (ruleMatches(ruleContent)) {
        return {
          behavior: 'allow',
          updatedInput: { skill, args },
          decisionReason: {
            type: 'rule',
            rule,
          },
        }
      }
    }

    
    
    
    
    if (
      commandObj?.type === 'prompt' &&
      skillHasOnlySafeProperties(commandObj)
    ) {
      return {
        behavior: 'allow',
        updatedInput: { skill, args },
        decisionReason: undefined,
      }
    }

    
    
    const suggestions = [
      
      {
        type: 'addRules' as const,
        rules: [
          {
            toolName: SKILL_TOOL_NAME,
            ruleContent: commandName,
          },
        ],
        behavior: 'allow' as const,
        destination: 'localSettings' as const,
      },
      
      {
        type: 'addRules' as const,
        rules: [
          {
            toolName: SKILL_TOOL_NAME,
            ruleContent: `${commandName}:*`,
          },
        ],
        behavior: 'allow' as const,
        destination: 'localSettings' as const,
      },
    ]

    
    return {
      behavior: 'ask',
      message: `Execute skill: ${commandName}`,
      decisionReason: undefined,
      suggestions,
      updatedInput: { skill, args },
      metadata: commandObj ? { command: commandObj } : undefined,
    }
  },

  async call(
    { skill, args },
    context,
    canUseTool,
    parentMessage,
    onProgress?,
  ): Promise<ToolResult<Output>> {
    
    
    
    
    
    

    
    const trimmed = skill.trim()

    
    const commandName = trimmed.startsWith('/') ? trimmed.substring(1) : trimmed

    
    
    
    
    
    if (
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      process.env.USER_TYPE === 'ant'
    ) {
      const slug = remoteSkillModules!.stripCanonicalPrefix(commandName)
      if (slug !== null) {
        return executeRemoteSkill(slug, commandName, parentMessage, context)
      }
    }

    const commands = await getAllCommands(context)
    const command = findCommand(commandName, commands)

    
    recordSkillUsage(commandName)

    
    if (command?.type === 'prompt' && command.context === 'fork') {
      return executeForkedSkill(
        command,
        commandName,
        args,
        context,
        canUseTool,
        parentMessage,
        onProgress,
      )
    }

    
    const { processPromptSlashCommand } = await import(
      'src/utils/processUserInput/processSlashCommand.js'
    )
    const processedCommand = await processPromptSlashCommand(
      commandName,
      args || '', 
      commands,
      context,
    )

    if (!processedCommand.shouldQuery) {
      throw new Error('Command processing failed')
    }

    
    const allowedTools = processedCommand.allowedTools || []
    const model = processedCommand.model
    const effort = command?.type === 'prompt' ? command.effort : undefined

    const isBuiltIn = builtInCommandNames().has(commandName)
    const isBundled = command?.type === 'prompt' && command.source === 'bundled'
    const isOfficialSkill =
      command?.type === 'prompt' && isOfficialMarketplaceSkill(command)
    const sanitizedCommandName =
      isBuiltIn || isBundled || isOfficialSkill ? commandName : 'custom'

    const wasDiscoveredField =
      feature('EXPERIMENTAL_SKILL_SEARCH') &&
      remoteSkillModules!.isSkillSearchEnabled()
        ? {
            was_discovered:
              context.discoveredSkillNames?.has(commandName) ?? false,
          }
        : {}
    const pluginMarketplace =
      command?.type === 'prompt' && command.pluginInfo
        ? parsePluginIdentifier(command.pluginInfo.repository).marketplace
        : undefined
    const queryDepth = context.queryTracking?.depth ?? 0
    const parentAgentId = getAgentContext()?.agentId
    logEvent('tengu_skill_tool_invocation', {
      command_name:
        sanitizedCommandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      
      
      
      _PROTO_skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      execution_context:
        'inline' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      invocation_trigger: (queryDepth > 0
        ? 'nested-skill'
        : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      query_depth: queryDepth,
      ...(parentAgentId && {
        parent_agent_id:
          parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...wasDiscoveredField,
      ...(process.env.USER_TYPE === 'ant' && {
        skill_name:
          commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(command?.type === 'prompt' && {
          skill_source:
            command.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(command?.loadedFrom && {
          skill_loaded_from:
            command.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
        ...(command?.kind && {
          skill_kind:
            command.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      }),
      ...(command?.type === 'prompt' &&
        command.pluginInfo && {
          _PROTO_plugin_name: command.pluginInfo.pluginManifest
            .name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          ...(pluginMarketplace && {
            _PROTO_marketplace_name:
              pluginMarketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
          }),
          plugin_name: (isOfficialSkill
            ? command.pluginInfo.pluginManifest.name
            : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          plugin_repository: (isOfficialSkill
            ? command.pluginInfo.repository
            : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...buildPluginCommandTelemetryFields(command.pluginInfo),
        }),
    })

    
    const toolUseID = getToolUseIDFromParentMessage(
      parentMessage,
      SKILL_TOOL_NAME,
    )

    
    const newMessages = tagMessagesWithToolUseID(
      processedCommand.messages.filter(
        (m): m is UserMessage | AttachmentMessage | SystemMessage => {
          if (m.type === 'progress') {
            return false
          }
          
          if (m.type === 'user' && 'message' in m) {
            const content = m.message.content
            if (
              typeof content === 'string' &&
              content.includes(`<${COMMAND_MESSAGE_TAG}>`)
            ) {
              return false
            }
          }
          return true
        },
      ),
      toolUseID,
    )

    logForDebugging(
      `SkillTool returning ${newMessages.length} newMessages for skill ${commandName}`,
    )

    
    
    
    

    
    return {
      data: {
        success: true,
        commandName,
        allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
        model,
      },
      newMessages,
      contextModifier(ctx) {
        let modifiedContext = ctx

        
        if (allowedTools.length > 0) {
          
          const previousGetAppState = modifiedContext.getAppState
          modifiedContext = {
            ...modifiedContext,
            getAppState() {
              
              
              const appState = previousGetAppState()
              return {
                ...appState,
                toolPermissionContext: {
                  ...appState.toolPermissionContext,
                  alwaysAllowRules: {
                    ...appState.toolPermissionContext.alwaysAllowRules,
                    command: [
                      ...new Set([
                        ...(appState.toolPermissionContext.alwaysAllowRules
                          .command || []),
                        ...allowedTools,
                      ]),
                    ],
                  },
                },
              }
            },
          }
        }

        
        
        if (model) {
          modifiedContext = {
            ...modifiedContext,
            options: {
              ...modifiedContext.options,
              mainLoopModel: resolveSkillModelOverride(
                model,
                ctx.options.mainLoopModel,
              ),
            },
          }
        }

        
        if (effort !== undefined) {
          const previousGetAppState = modifiedContext.getAppState
          modifiedContext = {
            ...modifiedContext,
            getAppState() {
              const appState = previousGetAppState()
              return {
                ...appState,
                effortValue: effort,
              }
            },
          }
        }

        return modifiedContext
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    result: Output,
    toolUseID: string,
  ): ToolResultBlockParam {
    
    if ('status' in result && result.status === 'forked') {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUseID,
        content: `Skill "${result.commandName}" completed (forked execution).\n\nResult:\n${result.result}`,
      }
    }

    
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUseID,
      content: `Launching skill: ${result.commandName}`,
    }
  },

  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
} satisfies ToolDef<InputSchema, Output, Progress>)

const SAFE_SKILL_PROPERTIES = new Set([
  
  'type',
  'progressMessage',
  'contentLength',
  'argNames',
  'model',
  'effort',
  'source',
  'pluginInfo',
  'disableNonInteractive',
  'skillRoot',
  'context',
  'agent',
  'getPromptForCommand',
  'frontmatterKeys',
  
  'name',
  'description',
  'hasUserSpecifiedDescription',
  'isEnabled',
  'isHidden',
  'aliases',
  'isMcp',
  'argumentHint',
  'whenToUse',
  'paths',
  'version',
  'disableModelInvocation',
  'userInvocable',
  'loadedFrom',
  'immediate',
  'userFacingName',
])

function skillHasOnlySafeProperties(command: Command): boolean {
  for (const key of Object.keys(command)) {
    if (SAFE_SKILL_PROPERTIES.has(key)) {
      continue
    }
    
    const value = (command as Record<string, unknown>)[key]
    if (value === undefined || value === null) {
      continue
    }
    if (Array.isArray(value) && value.length === 0) {
      continue
    }
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue
    }
    return false
  }
  return true
}

function isOfficialMarketplaceSkill(command: PromptCommand): boolean {
  if (command.source !== 'plugin' || !command.pluginInfo?.repository) {
    return false
  }
  return isOfficialMarketplaceName(
    parsePluginIdentifier(command.pluginInfo.repository).marketplace,
  )
}

function extractUrlScheme(url: string): 'gs' | 'http' | 'https' | 's3' {
  if (url.startsWith('gs://')) return 'gs'
  if (url.startsWith('https://')) return 'https'
  if (url.startsWith('http://')) return 'http'
  if (url.startsWith('s3://')) return 's3'
  return 'gs'
}

async function executeRemoteSkill(
  slug: string,
  commandName: string,
  parentMessage: AssistantMessage,
  context: ToolUseContext,
): Promise<ToolResult<Output>> {
  const { getDiscoveredRemoteSkill, loadRemoteSkill, logRemoteSkillLoaded } =
    remoteSkillModules!

  
  
  
  const meta = getDiscoveredRemoteSkill(slug)
  if (!meta) {
    throw new Error(
      `Remote skill ${slug} was not discovered in this session. Use DiscoverSkills to find remote skills first.`,
    )
  }

  const urlScheme = extractUrlScheme(meta.url)
  let loadResult
  try {
    loadResult = await loadRemoteSkill(slug, meta.url)
  } catch (e) {
    const msg = errorMessage(e)
    logRemoteSkillLoaded({
      slug,
      cacheHit: false,
      latencyMs: 0,
      urlScheme,
      error: msg,
    })
    throw new Error(`Failed to load remote skill ${slug}: ${msg}`)
  }

  const {
    cacheHit,
    latencyMs,
    skillPath,
    content,
    fileCount,
    totalBytes,
    fetchMethod,
  } = loadResult

  logRemoteSkillLoaded({
    slug,
    cacheHit,
    latencyMs,
    urlScheme,
    fileCount,
    totalBytes,
    fetchMethod,
  })

  
  
  
  const queryDepth = context.queryTracking?.depth ?? 0
  const parentAgentId = getAgentContext()?.agentId
  logEvent('tengu_skill_tool_invocation', {
    command_name:
      'remote_skill' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    
    
    
    _PROTO_skill_name:
      commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    execution_context:
      'remote' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    invocation_trigger: (queryDepth > 0
      ? 'nested-skill'
      : 'claude-proactive') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    query_depth: queryDepth,
    ...(parentAgentId && {
      parent_agent_id:
        parentAgentId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    was_discovered: true,
    is_remote: true,
    remote_cache_hit: cacheHit,
    remote_load_latency_ms: latencyMs,
    ...(process.env.USER_TYPE === 'ant' && {
      skill_name:
        commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      remote_slug:
        slug as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })

  recordSkillUsage(commandName)

  logForDebugging(
    `SkillTool loaded remote skill ${slug} (cacheHit=${cacheHit}, ${latencyMs}ms, ${content.length} chars)`,
  )

  
  
  
  const { content: bodyContent } = parseFrontmatter(content, skillPath)

  
  
  
  const skillDir = dirname(skillPath)
  const normalizedDir =
    process.platform === 'win32' ? skillDir.replace(/\\/g, '/') : skillDir
  let finalContent = `Base directory for this skill: ${normalizedDir}\n\n${bodyContent}`
  finalContent = finalContent.replace(/\$\{CLAUDE_SKILL_DIR\}/g, normalizedDir)
  finalContent = finalContent.replace(
    /\$\{CLAUDE_SESSION_ID\}/g,
    getSessionId(),
  )

  
  
  
  
  
  addInvokedSkill(
    commandName,
    skillPath,
    finalContent,
    getAgentContext()?.agentId ?? null,
  )

  
  
  const toolUseID = getToolUseIDFromParentMessage(
    parentMessage,
    SKILL_TOOL_NAME,
  )
  return {
    data: { success: true, commandName, status: 'inline' },
    newMessages: tagMessagesWithToolUseID(
      [createUserMessage({ content: finalContent, isMeta: true })],
      toolUseID,
    ),
  }
}
