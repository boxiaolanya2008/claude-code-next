import { feature } from "../utils/bundle-mock.ts"
import type { Anthropic } from '@anthropic-ai/sdk'
import {
  getSystemPrompt,
  SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from 'src/constants/prompts.js'
import { microcompactMessages } from 'src/services/compact/microCompact.js'
import { getSdkBetas } from '../bootstrap/state.js'
import { getCommandName } from '../commands.js'
import { getSystemContext } from '../context.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
  MANUAL_COMPACT_BUFFER_TOKENS,
} from '../services/compact/autoCompact.js'
import {
  countMessagesTokensWithAPI,
  countTokensViaHaikuFallback,
  roughTokenCountEstimation,
} from '../services/tokenEstimation.js'
import { estimateSkillFrontmatterTokens } from '../skills/loadSkillsDir.js'
import {
  findToolByName,
  type Tool,
  type ToolPermissionContext,
  type Tools,
  type ToolUseContext,
  toolMatchesName,
} from '../Tool.js'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
} from '../tools/AgentTool/loadAgentsDir.js'
import { SKILL_TOOL_NAME } from '../tools/SkillTool/constants.js'
import {
  getLimitedSkillToolCommands,
  getSkillToolInfo as getSlashCommandInfo,
} from '../tools/SkillTool/prompt.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  NormalizedAssistantMessage,
  NormalizedUserMessage,
  UserMessage,
} from '../types/message.js'
import { toolToAPISchema } from './api.js'
import { filterInjectedMemoryFiles, getMemoryFiles } from './claudemd.js'
import { getContextWindowForModel } from './context.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { errorMessage, toError } from './errors.js'
import { logError } from './log.js'
import { normalizeMessagesForAPI } from './messages.js'
import { getRuntimeMainLoopModel } from './model/model.js'
import type { SettingSource } from './settings/constants.js'
import { jsonStringify } from './slowOperations.js'
import { buildEffectiveSystemPrompt } from './systemPrompt.js'
import type { Theme } from './theme.js'
import { getCurrentUsage } from './tokens.js'

const RESERVED_CATEGORY_NAME = 'Autocompact buffer'
const MANUAL_COMPACT_BUFFER_NAME = 'Compact buffer'

export const TOOL_TOKEN_COUNT_OVERHEAD = 500

async function countTokensWithFallback(
  messages: Anthropic.Beta.Messages.BetaMessageParam[],
  tools: Anthropic.Beta.Messages.BetaToolUnion[],
): Promise<number | null> {
  try {
    const result = await countMessagesTokensWithAPI(messages, tools)
    if (result !== null) {
      return result
    }
    logForDebugging(
      `countTokensWithFallback: API returned null, trying haiku fallback (${tools.length} tools)`,
    )
  } catch (err) {
    logForDebugging(`countTokensWithFallback: API failed: ${errorMessage(err)}`)
    logError(err)
  }

  try {
    const fallbackResult = await countTokensViaHaikuFallback(messages, tools)
    if (fallbackResult === null) {
      logForDebugging(
        `countTokensWithFallback: haiku fallback also returned null (${tools.length} tools)`,
      )
    }
    return fallbackResult
  } catch (err) {
    logForDebugging(
      `countTokensWithFallback: haiku fallback failed: ${errorMessage(err)}`,
    )
    logError(err)
    return null
  }
}

interface ContextCategory {
  name: string
  tokens: number
  color: keyof Theme
  
  isDeferred?: boolean
}

interface GridSquare {
  color: keyof Theme
  isFilled: boolean
  categoryName: string
  tokens: number
  percentage: number
  squareFullness: number 
}

interface MemoryFile {
  path: string
  type: string
  tokens: number
}

interface McpTool {
  name: string
  serverName: string
  tokens: number
  isLoaded?: boolean
}

export interface DeferredBuiltinTool {
  name: string
  tokens: number
  isLoaded: boolean
}

export interface SystemToolDetail {
  name: string
  tokens: number
}

export interface SystemPromptSectionDetail {
  name: string
  tokens: number
}

interface Agent {
  agentType: string
  source: SettingSource | 'built-in' | 'plugin'
  tokens: number
}

interface SlashCommandInfo {
  readonly totalCommands: number
  readonly includedCommands: number
  readonly tokens: number
}

interface SkillFrontmatter {
  name: string
  source: SettingSource | 'plugin'
  tokens: number
}

interface SkillInfo {
  
  readonly totalSkills: number
  
  readonly includedSkills: number
  
  readonly tokens: number
  
  readonly skillFrontmatter: SkillFrontmatter[]
}

export interface ContextData {
  readonly categories: ContextCategory[]
  readonly totalTokens: number
  readonly maxTokens: number
  readonly rawMaxTokens: number
  readonly percentage: number
  readonly gridRows: GridSquare[][]
  readonly model: string
  readonly memoryFiles: MemoryFile[]
  readonly mcpTools: McpTool[]
  
  readonly deferredBuiltinTools?: DeferredBuiltinTool[]
  
  readonly systemTools?: SystemToolDetail[]
  
  readonly systemPromptSections?: SystemPromptSectionDetail[]
  readonly agents: Agent[]
  readonly slashCommands?: SlashCommandInfo
  
  readonly skills?: SkillInfo
  readonly autoCompactThreshold?: number
  readonly isAutoCompactEnabled: boolean
  messageBreakdown?: {
    toolCallTokens: number
    toolResultTokens: number
    attachmentTokens: number
    assistantMessageTokens: number
    userMessageTokens: number
    toolCallsByType: Array<{
      name: string
      callTokens: number
      resultTokens: number
    }>
    attachmentsByType: Array<{ name: string; tokens: number }>
  }
  
  readonly apiUsage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null
}

export async function countToolDefinitionTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
  model?: string,
): Promise<number> {
  const toolSchemas = await Promise.all(
    tools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext,
        tools,
        agents: agentInfo?.activeAgents ?? [],
        model,
      }),
    ),
  )
  const result = await countTokensWithFallback([], toolSchemas)
  if (result === null || result === 0) {
    const toolNames = tools.map(t => t.name).join(', ')
    logForDebugging(
      `countToolDefinitionTokens returned ${result} for ${tools.length} tools: ${toolNames.slice(0, 100)}${toolNames.length > 100 ? '...' : ''}`,
    )
  }
  return result ?? 0
}

function extractSectionName(content: string): string {
  
  const headingMatch = content.match(/^#+\s+(.+)$/m)
  if (headingMatch) {
    return headingMatch[1]!.trim()
  }
  
  const firstLine = content.split('\n').find(l => l.trim().length > 0) ?? ''
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine
}

async function countSystemTokens(
  effectiveSystemPrompt: readonly string[],
): Promise<{
  systemPromptTokens: number
  systemPromptSections: SystemPromptSectionDetail[]
}> {
  
  const systemContext = await getSystemContext()

  
  
  const namedEntries: Array<{ name: string; content: string }> = [
    ...effectiveSystemPrompt
      .filter(
        content =>
          content.length > 0 && content !== SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      )
      .map(content => ({ name: extractSectionName(content), content })),
    ...Object.entries(systemContext)
      .filter(([, content]) => content.length > 0)
      .map(([name, content]) => ({ name, content })),
  ]

  if (namedEntries.length < 1) {
    return { systemPromptTokens: 0, systemPromptSections: [] }
  }

  const systemTokenCounts = await Promise.all(
    namedEntries.map(({ content }) =>
      countTokensWithFallback([{ role: 'user', content }], []),
    ),
  )

  const systemPromptSections: SystemPromptSectionDetail[] = namedEntries.map(
    (entry, i) => ({
      name: entry.name,
      tokens: systemTokenCounts[i] || 0,
    }),
  )

  const systemPromptTokens = systemTokenCounts.reduce(
    (sum: number, tokens) => sum + (tokens || 0),
    0,
  )

  return { systemPromptTokens, systemPromptSections }
}

async function countMemoryFileTokens(): Promise<{
  memoryFileDetails: MemoryFile[]
  claudeMdTokens: number
}> {
  
  if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SIMPLE)) {
    return { memoryFileDetails: [], claudeMdTokens: 0 }
  }

  const memoryFilesData = filterInjectedMemoryFiles(await getMemoryFiles())
  const memoryFileDetails: MemoryFile[] = []
  let claudeMdTokens = 0

  if (memoryFilesData.length < 1) {
    return {
      memoryFileDetails: [],
      claudeMdTokens: 0,
    }
  }

  const claudeMdTokenCounts = await Promise.all(
    memoryFilesData.map(async file => {
      const tokens = await countTokensWithFallback(
        [{ role: 'user', content: file.content }],
        [],
      )

      return { file, tokens: tokens || 0 }
    }),
  )

  for (const { file, tokens } of claudeMdTokenCounts) {
    claudeMdTokens += tokens
    memoryFileDetails.push({
      path: file.path,
      type: file.type,
      tokens,
    })
  }

  return { claudeMdTokens, memoryFileDetails }
}

async function countBuiltInToolTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
  model?: string,
  messages?: Message[],
): Promise<{
  builtInToolTokens: number
  deferredBuiltinDetails: DeferredBuiltinTool[]
  deferredBuiltinTokens: number
  systemToolDetails: SystemToolDetail[]
}> {
  const builtInTools = tools.filter(tool => !tool.isMcp)
  if (builtInTools.length < 1) {
    return {
      builtInToolTokens: 0,
      deferredBuiltinDetails: [],
      deferredBuiltinTokens: 0,
      systemToolDetails: [],
    }
  }

  
  const { isToolSearchEnabled } = await import('./toolSearch.js')
  const { isDeferredTool } = await import('../tools/ToolSearchTool/prompt.js')
  const isDeferred = await isToolSearchEnabled(
    model ?? '',
    tools,
    getToolPermissionContext,
    agentInfo?.activeAgents ?? [],
    'analyzeBuiltIn',
  )

  
  const alwaysLoadedTools = builtInTools.filter(t => !isDeferredTool(t))
  const deferredBuiltinTools = builtInTools.filter(t => isDeferredTool(t))

  
  const alwaysLoadedTokens =
    alwaysLoadedTools.length > 0
      ? await countToolDefinitionTokens(
          alwaysLoadedTools,
          getToolPermissionContext,
          agentInfo,
          model,
        )
      : 0

  
  
  
  let systemToolDetails: SystemToolDetail[] = []
  if (process.env.USER_TYPE === 'ant') {
    const toolsForBreakdown = alwaysLoadedTools.filter(
      t => !toolMatchesName(t, SKILL_TOOL_NAME),
    )
    if (toolsForBreakdown.length > 0) {
      const estimates = toolsForBreakdown.map(t =>
        roughTokenCountEstimation(jsonStringify(t.inputSchema ?? {})),
      )
      const estimateTotal = estimates.reduce((s, e) => s + e, 0) || 1
      const distributable = Math.max(
        0,
        alwaysLoadedTokens - TOOL_TOKEN_COUNT_OVERHEAD,
      )
      systemToolDetails = toolsForBreakdown
        .map((t, i) => ({
          name: t.name,
          tokens: Math.round((estimates[i]! / estimateTotal) * distributable),
        }))
        .sort((a, b) => b.tokens - a.tokens)
    }
  }

  
  const deferredBuiltinDetails: DeferredBuiltinTool[] = []
  let loadedDeferredTokens = 0
  let totalDeferredTokens = 0

  if (deferredBuiltinTools.length > 0 && isDeferred) {
    
    const loadedToolNames = new Set<string>()
    if (messages) {
      const deferredToolNameSet = new Set(deferredBuiltinTools.map(t => t.name))
      for (const msg of messages) {
        if (msg.type === 'assistant') {
          for (const block of msg.message.content) {
            if (
              'type' in block &&
              block.type === 'tool_use' &&
              'name' in block &&
              typeof block.name === 'string' &&
              deferredToolNameSet.has(block.name)
            ) {
              loadedToolNames.add(block.name)
            }
          }
        }
      }
    }

    
    const tokensByTool = await Promise.all(
      deferredBuiltinTools.map(t =>
        countToolDefinitionTokens(
          [t],
          getToolPermissionContext,
          agentInfo,
          model,
        ),
      ),
    )

    for (const [i, tool] of deferredBuiltinTools.entries()) {
      const tokens = Math.max(
        0,
        (tokensByTool[i] || 0) - TOOL_TOKEN_COUNT_OVERHEAD,
      )
      const isLoaded = loadedToolNames.has(tool.name)
      deferredBuiltinDetails.push({
        name: tool.name,
        tokens,
        isLoaded,
      })
      totalDeferredTokens += tokens
      if (isLoaded) {
        loadedDeferredTokens += tokens
      }
    }
  } else if (deferredBuiltinTools.length > 0) {
    
    const deferredTokens = await countToolDefinitionTokens(
      deferredBuiltinTools,
      getToolPermissionContext,
      agentInfo,
      model,
    )
    return {
      builtInToolTokens: alwaysLoadedTokens + deferredTokens,
      deferredBuiltinDetails: [],
      deferredBuiltinTokens: 0,
      systemToolDetails,
    }
  }

  return {
    
    builtInToolTokens: alwaysLoadedTokens + loadedDeferredTokens,
    deferredBuiltinDetails,
    deferredBuiltinTokens: totalDeferredTokens - loadedDeferredTokens,
    systemToolDetails,
  }
}

function findSkillTool(tools: Tools): Tool | undefined {
  return findToolByName(tools, SKILL_TOOL_NAME)
}

async function countSlashCommandTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
): Promise<{
  slashCommandTokens: number
  commandInfo: { totalCommands: number; includedCommands: number }
}> {
  const info = await getSlashCommandInfo(getCwd())

  const slashCommandTool = findSkillTool(tools)
  if (!slashCommandTool) {
    return {
      slashCommandTokens: 0,
      commandInfo: { totalCommands: 0, includedCommands: 0 },
    }
  }

  const slashCommandTokens = await countToolDefinitionTokens(
    [slashCommandTool],
    getToolPermissionContext,
    agentInfo,
  )

  return {
    slashCommandTokens,
    commandInfo: {
      totalCommands: info.totalCommands,
      includedCommands: info.includedCommands,
    },
  }
}

async function countSkillTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
): Promise<{
  skillTokens: number
  skillInfo: {
    totalSkills: number
    includedSkills: number
    skillFrontmatter: SkillFrontmatter[]
  }
}> {
  try {
    const skills = await getLimitedSkillToolCommands(getCwd())

    const slashCommandTool = findSkillTool(tools)
    if (!slashCommandTool) {
      return {
        skillTokens: 0,
        skillInfo: { totalSkills: 0, includedSkills: 0, skillFrontmatter: [] },
      }
    }

    
    
    
    
    const skillTokens = await countToolDefinitionTokens(
      [slashCommandTool],
      getToolPermissionContext,
      agentInfo,
    )

    
    
    const skillFrontmatter: SkillFrontmatter[] = skills.map(skill => ({
      name: getCommandName(skill),
      source: (skill.type === 'prompt' ? skill.source : 'plugin') as
        | SettingSource
        | 'plugin',
      tokens: estimateSkillFrontmatterTokens(skill),
    }))

    return {
      skillTokens,
      skillInfo: {
        totalSkills: skills.length,
        includedSkills: skills.length,
        skillFrontmatter,
      },
    }
  } catch (error) {
    logError(toError(error))

    
    return {
      skillTokens: 0,
      skillInfo: { totalSkills: 0, includedSkills: 0, skillFrontmatter: [] },
    }
  }
}

export async function countMcpToolTokens(
  tools: Tools,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  agentInfo: AgentDefinitionsResult | null,
  model: string,
  messages?: Message[],
): Promise<{
  mcpToolTokens: number
  mcpToolDetails: McpTool[]
  deferredToolTokens: number
  loadedMcpToolNames: Set<string>
}> {
  const mcpTools = tools.filter(tool => tool.isMcp)
  const mcpToolDetails: McpTool[] = []
  
  const totalTokensRaw = await countToolDefinitionTokens(
    mcpTools,
    getToolPermissionContext,
    agentInfo,
    model,
  )
  
  const totalTokens = Math.max(
    0,
    (totalTokensRaw || 0) - TOOL_TOKEN_COUNT_OVERHEAD,
  )

  
  
  
  
  const estimates = await Promise.all(
    mcpTools.map(async t =>
      roughTokenCountEstimation(
        jsonStringify({
          name: t.name,
          description: await t.prompt({
            getToolPermissionContext,
            tools,
            agents: agentInfo?.activeAgents ?? [],
          }),
          input_schema: t.inputJSONSchema ?? {},
        }),
      ),
    ),
  )
  const estimateTotal = estimates.reduce((s, e) => s + e, 0) || 1
  const mcpToolTokensByTool = estimates.map(e =>
    Math.round((e / estimateTotal) * totalTokens),
  )

  
  
  const { isToolSearchEnabled } = await import('./toolSearch.js')
  const { isDeferredTool } = await import('../tools/ToolSearchTool/prompt.js')

  const isDeferred = await isToolSearchEnabled(
    model,
    tools,
    getToolPermissionContext,
    agentInfo?.activeAgents ?? [],
    'analyzeMcp',
  )

  
  const loadedMcpToolNames = new Set<string>()
  if (isDeferred && messages) {
    const mcpToolNameSet = new Set(mcpTools.map(t => t.name))
    for (const msg of messages) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (
            'type' in block &&
            block.type === 'tool_use' &&
            'name' in block &&
            typeof block.name === 'string' &&
            mcpToolNameSet.has(block.name)
          ) {
            loadedMcpToolNames.add(block.name)
          }
        }
      }
    }
  }

  
  for (const [i, tool] of mcpTools.entries()) {
    mcpToolDetails.push({
      name: tool.name,
      serverName: tool.name.split('__')[1] || 'unknown',
      tokens: mcpToolTokensByTool[i]!,
      isLoaded: loadedMcpToolNames.has(tool.name) || !isDeferredTool(tool),
    })
  }

  
  let loadedTokens = 0
  let deferredTokens = 0
  for (const detail of mcpToolDetails) {
    if (detail.isLoaded) {
      loadedTokens += detail.tokens
    } else if (isDeferred) {
      deferredTokens += detail.tokens
    }
  }

  return {
    
    mcpToolTokens: isDeferred ? loadedTokens : totalTokens,
    mcpToolDetails,
    
    deferredToolTokens: deferredTokens,
    loadedMcpToolNames,
  }
}

async function countCustomAgentTokens(agentDefinitions: {
  activeAgents: AgentDefinition[]
}): Promise<{
  agentTokens: number
  agentDetails: Agent[]
}> {
  const customAgents = agentDefinitions.activeAgents.filter(
    a => a.source !== 'built-in',
  )
  const agentDetails: Agent[] = []
  let agentTokens = 0

  const tokenCounts = await Promise.all(
    customAgents.map(agent =>
      countTokensWithFallback(
        [
          {
            role: 'user',
            content: [agent.agentType, agent.whenToUse].join(' '),
          },
        ],
        [],
      ),
    ),
  )

  for (const [i, agent] of customAgents.entries()) {
    const tokens = tokenCounts[i] || 0
    agentTokens += tokens || 0
    agentDetails.push({
      agentType: agent.agentType,
      source: agent.source,
      tokens: tokens || 0,
    })
  }
  return { agentTokens, agentDetails }
}

type MessageBreakdown = {
  totalTokens: number
  toolCallTokens: number
  toolResultTokens: number
  attachmentTokens: number
  assistantMessageTokens: number
  userMessageTokens: number
  toolCallsByType: Map<string, number>
  toolResultsByType: Map<string, number>
  attachmentsByType: Map<string, number>
}

function processAssistantMessage(
  msg: AssistantMessage | NormalizedAssistantMessage,
  breakdown: MessageBreakdown,
): void {
  
  for (const block of msg.message.content) {
    const blockStr = jsonStringify(block)
    const blockTokens = roughTokenCountEstimation(blockStr)

    if ('type' in block && block.type === 'tool_use') {
      breakdown.toolCallTokens += blockTokens
      const toolName = ('name' in block ? block.name : undefined) || 'unknown'
      breakdown.toolCallsByType.set(
        toolName,
        (breakdown.toolCallsByType.get(toolName) || 0) + blockTokens,
      )
    } else {
      
      breakdown.assistantMessageTokens += blockTokens
    }
  }
}

function processUserMessage(
  msg: UserMessage | NormalizedUserMessage,
  breakdown: MessageBreakdown,
  toolUseIdToName: Map<string, string>,
): void {
  
  if (typeof msg.message.content === 'string') {
    
    const tokens = roughTokenCountEstimation(msg.message.content)
    breakdown.userMessageTokens += tokens
    return
  }

  
  for (const block of msg.message.content) {
    const blockStr = jsonStringify(block)
    const blockTokens = roughTokenCountEstimation(blockStr)

    if ('type' in block && block.type === 'tool_result') {
      breakdown.toolResultTokens += blockTokens
      const toolUseId = 'tool_use_id' in block ? block.tool_use_id : undefined
      const toolName =
        (toolUseId ? toolUseIdToName.get(toolUseId) : undefined) || 'unknown'
      breakdown.toolResultsByType.set(
        toolName,
        (breakdown.toolResultsByType.get(toolName) || 0) + blockTokens,
      )
    } else {
      
      breakdown.userMessageTokens += blockTokens
    }
  }
}

function processAttachment(
  msg: AttachmentMessage,
  breakdown: MessageBreakdown,
): void {
  const contentStr = jsonStringify(msg.attachment)
  const tokens = roughTokenCountEstimation(contentStr)
  breakdown.attachmentTokens += tokens
  const attachType = msg.attachment.type || 'unknown'
  breakdown.attachmentsByType.set(
    attachType,
    (breakdown.attachmentsByType.get(attachType) || 0) + tokens,
  )
}

async function approximateMessageTokens(
  messages: Message[],
): Promise<MessageBreakdown> {
  const microcompactResult = await microcompactMessages(messages)

  
  const breakdown: MessageBreakdown = {
    totalTokens: 0,
    toolCallTokens: 0,
    toolResultTokens: 0,
    attachmentTokens: 0,
    assistantMessageTokens: 0,
    userMessageTokens: 0,
    toolCallsByType: new Map<string, number>(),
    toolResultsByType: new Map<string, number>(),
    attachmentsByType: new Map<string, number>(),
  }

  
  const toolUseIdToName = new Map<string, string>()
  for (const msg of microcompactResult.messages) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if ('type' in block && block.type === 'tool_use') {
          const toolUseId = 'id' in block ? block.id : undefined
          const toolName =
            ('name' in block ? block.name : undefined) || 'unknown'
          if (toolUseId) {
            toolUseIdToName.set(toolUseId, toolName)
          }
        }
      }
    }
  }

  
  for (const msg of microcompactResult.messages) {
    if (msg.type === 'assistant') {
      processAssistantMessage(msg, breakdown)
    } else if (msg.type === 'user') {
      processUserMessage(msg, breakdown, toolUseIdToName)
    } else if (msg.type === 'attachment') {
      processAttachment(msg, breakdown)
    }
  }

  
  const approximateMessageTokens = await countTokensWithFallback(
    normalizeMessagesForAPI(microcompactResult.messages).map(_ => {
      if (_.type === 'assistant') {
        return {
          
          role: 'assistant',
          content: _.message.content,
        }
      }
      return _.message
    }),
    [],
  )

  breakdown.totalTokens = approximateMessageTokens ?? 0
  return breakdown
}

export async function analyzeContextUsage(
  messages: Message[],
  model: string,
  getToolPermissionContext: () => Promise<ToolPermissionContext>,
  tools: Tools,
  agentDefinitions: AgentDefinitionsResult,
  terminalWidth?: number,
  toolUseContext?: Pick<ToolUseContext, 'options'>,
  mainThreadAgentDefinition?: AgentDefinition,
  
  originalMessages?: Message[],
): Promise<ContextData> {
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode: (await getToolPermissionContext()).mode,
    mainLoopModel: model,
  })
  
  const contextWindow = getContextWindowForModel(runtimeModel, getSdkBetas())

  
  const defaultSystemPrompt = await getSystemPrompt(tools, runtimeModel)
  const effectiveSystemPrompt = buildEffectiveSystemPrompt({
    mainThreadAgentDefinition,
    toolUseContext: toolUseContext ?? {
      options: {} as ToolUseContext['options'],
    },
    customSystemPrompt: toolUseContext?.options.customSystemPrompt,
    defaultSystemPrompt,
    appendSystemPrompt: toolUseContext?.options.appendSystemPrompt,
  })

  
  const [
    { systemPromptTokens, systemPromptSections },
    { claudeMdTokens, memoryFileDetails },
    {
      builtInToolTokens,
      deferredBuiltinDetails,
      deferredBuiltinTokens,
      systemToolDetails,
    },
    { mcpToolTokens, mcpToolDetails, deferredToolTokens },
    { agentTokens, agentDetails },
    { slashCommandTokens, commandInfo },
    messageBreakdown,
  ] = await Promise.all([
    countSystemTokens(effectiveSystemPrompt),
    countMemoryFileTokens(),
    countBuiltInToolTokens(
      tools,
      getToolPermissionContext,
      agentDefinitions,
      runtimeModel,
      messages,
    ),
    countMcpToolTokens(
      tools,
      getToolPermissionContext,
      agentDefinitions,
      runtimeModel,
      messages,
    ),
    countCustomAgentTokens(agentDefinitions),
    countSlashCommandTokens(tools, getToolPermissionContext, agentDefinitions),
    approximateMessageTokens(messages),
  ])

  
  const skillResult = await countSkillTokens(
    tools,
    getToolPermissionContext,
    agentDefinitions,
  )
  const skillInfo = skillResult.skillInfo
  
  
  const skillFrontmatterTokens = skillInfo.skillFrontmatter.reduce(
    (sum, skill) => sum + skill.tokens,
    0,
  )

  const messageTokens = messageBreakdown.totalTokens

  
  const isAutoCompact = isAutoCompactEnabled()
  const autoCompactThreshold = isAutoCompact
    ? getEffectiveContextWindowSize(model) - AUTOCOMPACT_BUFFER_TOKENS
    : undefined

  
  const cats: ContextCategory[] = []

  
  if (systemPromptTokens > 0) {
    cats.push({
      name: 'System prompt',
      tokens: systemPromptTokens,
      color: 'promptBorder',
    })
  }

  
  
  const systemToolsTokens = builtInToolTokens - skillFrontmatterTokens
  if (systemToolsTokens > 0) {
    cats.push({
      name:
        process.env.USER_TYPE === 'ant'
          ? '[ANT-ONLY] System tools'
          : 'System tools',
      tokens: systemToolsTokens,
      color: 'inactive',
    })
  }

  
  if (mcpToolTokens > 0) {
    cats.push({
      name: 'MCP tools',
      tokens: mcpToolTokens,
      color: 'cyan_FOR_SUBAGENTS_ONLY',
    })
  }

  
  
  if (deferredToolTokens > 0) {
    cats.push({
      name: 'MCP tools (deferred)',
      tokens: deferredToolTokens,
      color: 'inactive',
      isDeferred: true,
    })
  }

  
  if (deferredBuiltinTokens > 0) {
    cats.push({
      name: 'System tools (deferred)',
      tokens: deferredBuiltinTokens,
      color: 'inactive',
      isDeferred: true,
    })
  }

  
  if (agentTokens > 0) {
    cats.push({
      name: 'Custom agents',
      tokens: agentTokens,
      color: 'permission',
    })
  }

  
  if (claudeMdTokens > 0) {
    cats.push({
      name: 'Memory files',
      tokens: claudeMdTokens,
      color: 'claude',
    })
  }

  
  if (skillFrontmatterTokens > 0) {
    cats.push({
      name: 'Skills',
      tokens: skillFrontmatterTokens,
      color: 'warning',
    })
  }

  if (messageTokens !== null && messageTokens > 0) {
    cats.push({
      name: 'Messages',
      tokens: messageTokens,
      color: 'purple_FOR_SUBAGENTS_ONLY',
    })
  }

  
  
  const actualUsage = cats.reduce(
    (sum, cat) => sum + (cat.isDeferred ? 0 : cat.tokens),
    0,
  )

  
  
  
  
  
  
  
  let reservedTokens = 0
  let skipReservedBuffer = false
  if (feature('REACTIVE_COMPACT')) {
    if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)) {
      skipReservedBuffer = true
    }
  }
  if (feature('CONTEXT_COLLAPSE')) {
    
    const { isContextCollapseEnabled } =
      require('../services/contextCollapse/index.js') as typeof import('../services/contextCollapse/index.js')
    
    if (isContextCollapseEnabled()) {
      skipReservedBuffer = true
    }
  }
  if (skipReservedBuffer) {
    
    
  } else if (isAutoCompact && autoCompactThreshold !== undefined) {
    
    reservedTokens = contextWindow - autoCompactThreshold
    cats.push({
      name: RESERVED_CATEGORY_NAME,
      tokens: reservedTokens,
      color: 'inactive',
    })
  } else if (!isAutoCompact) {
    
    reservedTokens = MANUAL_COMPACT_BUFFER_TOKENS
    cats.push({
      name: MANUAL_COMPACT_BUFFER_NAME,
      tokens: reservedTokens,
      color: 'inactive',
    })
  }

  
  const freeTokens = Math.max(0, contextWindow - actualUsage - reservedTokens)

  cats.push({
    name: 'Free space',
    tokens: freeTokens,
    color: 'promptBorder',
  })

  
  const totalIncludingReserved = actualUsage

  
  
  const apiUsage = getCurrentUsage(originalMessages ?? messages)

  
  
  const totalFromAPI = apiUsage
    ? apiUsage.input_tokens +
      apiUsage.cache_creation_input_tokens +
      apiUsage.cache_read_input_tokens
    : null

  
  const finalTotalTokens = totalFromAPI ?? totalIncludingReserved

  
  
  
  const isNarrowScreen = terminalWidth && terminalWidth < 80
  const GRID_WIDTH =
    contextWindow >= 1000000
      ? isNarrowScreen
        ? 5
        : 20
      : isNarrowScreen
        ? 5
        : 10
  const GRID_HEIGHT = contextWindow >= 1000000 ? 10 : isNarrowScreen ? 5 : 10
  const TOTAL_SQUARES = GRID_WIDTH * GRID_HEIGHT

  
  
  const nonDeferredCats = cats.filter(cat => !cat.isDeferred)

  
  const categorySquares = nonDeferredCats.map(cat => ({
    ...cat,
    squares:
      cat.name === 'Free space'
        ? Math.round((cat.tokens / contextWindow) * TOTAL_SQUARES)
        : Math.max(1, Math.round((cat.tokens / contextWindow) * TOTAL_SQUARES)),
    percentageOfTotal: Math.round((cat.tokens / contextWindow) * 100),
  }))

  
  function createCategorySquares(
    category: (typeof categorySquares)[0],
  ): GridSquare[] {
    const squares: GridSquare[] = []
    const exactSquares = (category.tokens / contextWindow) * TOTAL_SQUARES
    const wholeSquares = Math.floor(exactSquares)
    const fractionalPart = exactSquares - wholeSquares

    for (let i = 0; i < category.squares; i++) {
      
      let squareFullness = 1.0
      if (i === wholeSquares && fractionalPart > 0) {
        
        squareFullness = fractionalPart
      }

      squares.push({
        color: category.color,
        isFilled: true,
        categoryName: category.name,
        tokens: category.tokens,
        percentage: category.percentageOfTotal,
        squareFullness,
      })
    }

    return squares
  }

  
  const gridSquares: GridSquare[] = []

  
  const reservedCategory = categorySquares.find(
    cat =>
      cat.name === RESERVED_CATEGORY_NAME ||
      cat.name === MANUAL_COMPACT_BUFFER_NAME,
  )
  const nonReservedCategories = categorySquares.filter(
    cat =>
      cat.name !== RESERVED_CATEGORY_NAME &&
      cat.name !== MANUAL_COMPACT_BUFFER_NAME &&
      cat.name !== 'Free space',
  )

  
  for (const cat of nonReservedCategories) {
    const squares = createCategorySquares(cat)
    for (const square of squares) {
      if (gridSquares.length < TOTAL_SQUARES) {
        gridSquares.push(square)
      }
    }
  }

  
  const reservedSquareCount = reservedCategory ? reservedCategory.squares : 0

  
  const freeSpaceCat = cats.find(c => c.name === 'Free space')
  const freeSpaceTarget = TOTAL_SQUARES - reservedSquareCount

  while (gridSquares.length < freeSpaceTarget) {
    gridSquares.push({
      color: 'promptBorder',
      isFilled: true,
      categoryName: 'Free space',
      tokens: freeSpaceCat?.tokens || 0,
      percentage: freeSpaceCat
        ? Math.round((freeSpaceCat.tokens / contextWindow) * 100)
        : 0,
      squareFullness: 1.0, 
    })
  }

  
  if (reservedCategory) {
    const squares = createCategorySquares(reservedCategory)
    for (const square of squares) {
      if (gridSquares.length < TOTAL_SQUARES) {
        gridSquares.push(square)
      }
    }
  }

  
  const gridRows: GridSquare[][] = []
  for (let i = 0; i < GRID_HEIGHT; i++) {
    gridRows.push(gridSquares.slice(i * GRID_WIDTH, (i + 1) * GRID_WIDTH))
  }

  
  
  const toolsMap = new Map<
    string,
    { callTokens: number; resultTokens: number }
  >()

  
  for (const [name, tokens] of messageBreakdown.toolCallsByType.entries()) {
    const existing = toolsMap.get(name) || { callTokens: 0, resultTokens: 0 }
    toolsMap.set(name, { ...existing, callTokens: tokens })
  }

  
  for (const [name, tokens] of messageBreakdown.toolResultsByType.entries()) {
    const existing = toolsMap.get(name) || { callTokens: 0, resultTokens: 0 }
    toolsMap.set(name, { ...existing, resultTokens: tokens })
  }

  
  const toolsByTypeArray = Array.from(toolsMap.entries())
    .map(([name, { callTokens, resultTokens }]) => ({
      name,
      callTokens,
      resultTokens,
    }))
    .sort(
      (a, b) => b.callTokens + b.resultTokens - (a.callTokens + a.resultTokens),
    )

  const attachmentsByTypeArray = Array.from(
    messageBreakdown.attachmentsByType.entries(),
  )
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens)

  const formattedMessageBreakdown = {
    toolCallTokens: messageBreakdown.toolCallTokens,
    toolResultTokens: messageBreakdown.toolResultTokens,
    attachmentTokens: messageBreakdown.attachmentTokens,
    assistantMessageTokens: messageBreakdown.assistantMessageTokens,
    userMessageTokens: messageBreakdown.userMessageTokens,
    toolCallsByType: toolsByTypeArray,
    attachmentsByType: attachmentsByTypeArray,
  }

  return {
    categories: cats,
    totalTokens: finalTotalTokens,
    maxTokens: contextWindow,
    rawMaxTokens: contextWindow,
    percentage: Math.round((finalTotalTokens / contextWindow) * 100),
    gridRows,
    model: runtimeModel,
    memoryFiles: memoryFileDetails,
    mcpTools: mcpToolDetails,
    deferredBuiltinTools:
      process.env.USER_TYPE === 'ant' ? deferredBuiltinDetails : undefined,
    systemTools:
      process.env.USER_TYPE === 'ant' ? systemToolDetails : undefined,
    systemPromptSections:
      process.env.USER_TYPE === 'ant' ? systemPromptSections : undefined,
    agents: agentDetails,
    slashCommands:
      slashCommandTokens > 0
        ? {
            totalCommands: commandInfo.totalCommands,
            includedCommands: commandInfo.includedCommands,
            tokens: slashCommandTokens,
          }
        : undefined,
    skills:
      skillFrontmatterTokens > 0
        ? {
            totalSkills: skillInfo.totalSkills,
            includedSkills: skillInfo.includedSkills,
            tokens: skillFrontmatterTokens,
            skillFrontmatter: skillInfo.skillFrontmatter,
          }
        : undefined,
    autoCompactThreshold,
    isAutoCompactEnabled: isAutoCompact,
    messageBreakdown: formattedMessageBreakdown,
    apiUsage,
  }
}
