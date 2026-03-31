import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { createHash } from 'crypto'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from 'src/constants/prompts.js'
import { getSystemContext, getUserContext } from 'src/context.js'
import { isAnalyticsDisabled } from 'src/services/analytics/config.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from 'src/services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { prefetchAllMcpResources } from 'src/services/mcp/client.js'
import type { ScopedMcpServerConfig } from 'src/services/mcp/types.js'
import { BashTool } from 'src/tools/BashTool/BashTool.js'
import { FileEditTool } from 'src/tools/FileEditTool/FileEditTool.js'
import {
  normalizeFileEditInput,
  stripTrailingWhitespace,
} from 'src/tools/FileEditTool/utils.js'
import { FileWriteTool } from 'src/tools/FileWriteTool/FileWriteTool.js'
import { getTools } from 'src/tools.js'
import type { AgentId } from 'src/types/ids.js'
import type { z } from 'zod/v4'
import { CLI_SYSPROMPT_PREFIXES } from '../constants/system.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { Tool, ToolPermissionContext, Tools } from '../Tool.js'
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../tools/ExitPlanModeTool/constants.js'
import { TASK_OUTPUT_TOOL_NAME } from '../tools/TaskOutputTool/constants.js'
import type { Message } from '../types/message.js'
import { isAgentSwarmsEnabled } from './agentSwarmsEnabled.js'
import {
  modelSupportsStructuredOutputs,
  shouldUseGlobalCacheScope,
} from './betas.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { createUserMessage } from './messages.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from './model/providers.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import {
  getPlan,
  getPlanFilePath,
  persistFileSnapshotIfRemote,
} from './plans.js'
import { getPlatform } from './platform.js'
import { countFilesRoundedRg } from './ripgrep.js'
import { jsonStringify } from './slowOperations.js'
import type { SystemPrompt } from './systemPromptType.js'
import { getToolSchemaCache } from './toolSchemaCache.js'
import { windowsPathToPosixPath } from './windowsPaths.js'
import { zodToJsonSchema } from './zodToJsonSchema.js'

type BetaToolWithExtras = BetaTool & {
  strict?: boolean
  defer_loading?: boolean
  cache_control?: {
    type: 'ephemeral'
    scope?: 'global' | 'org'
    ttl?: '5m' | '1h'
  }
  eager_input_streaming?: boolean
}

export type CacheScope = 'global' | 'org'
export type SystemPromptBlock = {
  text: string
  cacheScope: CacheScope | null
}

const SWARM_FIELDS_BY_TOOL: Record<string, string[]> = {
  [EXIT_PLAN_MODE_V2_TOOL_NAME]: ['launchSwarm', 'teammateCount'],
  [AGENT_TOOL_NAME]: ['name', 'team_name', 'mode'],
}

function filterSwarmFieldsFromSchema(
  toolName: string,
  schema: Anthropic.Tool.InputSchema,
): Anthropic.Tool.InputSchema {
  const fieldsToRemove = SWARM_FIELDS_BY_TOOL[toolName]
  if (!fieldsToRemove || fieldsToRemove.length === 0) {
    return schema
  }

  
  const filtered = { ...schema }
  const props = filtered.properties
  if (props && typeof props === 'object') {
    const filteredProps = { ...(props as Record<string, unknown>) }
    for (const field of fieldsToRemove) {
      delete filteredProps[field]
    }
    filtered.properties = filteredProps
  }

  return filtered
}

export async function toolToAPISchema(
  tool: Tool,
  options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
    model?: string
    
    deferLoading?: boolean
    cacheControl?: {
      type: 'ephemeral'
      scope?: 'global' | 'org'
      ttl?: '5m' | '1h'
    }
  },
): Promise<BetaToolUnion> {
  
  
  
  
  
  
  
  
  
  
  
  const cacheKey =
    'inputJSONSchema' in tool && tool.inputJSONSchema
      ? `${tool.name}:${jsonStringify(tool.inputJSONSchema)}`
      : tool.name
  const cache = getToolSchemaCache()
  let base = cache.get(cacheKey)
  if (!base) {
    const strictToolsEnabled =
      checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_tool_pear')
    
    let input_schema = (
      'inputJSONSchema' in tool && tool.inputJSONSchema
        ? tool.inputJSONSchema
        : zodToJsonSchema(tool.inputSchema)
    ) as Anthropic.Tool.InputSchema

    
    
    if (!isAgentSwarmsEnabled()) {
      input_schema = filterSwarmFieldsFromSchema(tool.name, input_schema)
    }

    base = {
      name: tool.name,
      description: await tool.prompt({
        getToolPermissionContext: options.getToolPermissionContext,
        tools: options.tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
      }),
      input_schema,
    }

    
    
    
    
    
    if (
      strictToolsEnabled &&
      tool.strict === true &&
      options.model &&
      modelSupportsStructuredOutputs(options.model)
    ) {
      base.strict = true
    }

    
    
    
    
    
    if (
      getAPIProvider() === 'firstParty' &&
      isFirstPartyAnthropicBaseUrl() &&
      (getFeatureValue_CACHED_MAY_BE_STALE('tengu_fgts', false) ||
        isEnvTruthy(process.env.CLAUDE_CODE_NEXT_ENABLE_FINE_GRAINED_TOOL_STREAMING))
    ) {
      base.eager_input_streaming = true
    }

    cache.set(cacheKey, base)
  }

  
  
  
  
  const schema: BetaToolWithExtras = {
    name: base.name,
    description: base.description,
    input_schema: base.input_schema,
    ...(base.strict && { strict: true }),
    ...(base.eager_input_streaming && { eager_input_streaming: true }),
  }

  
  if (options.deferLoading) {
    schema.defer_loading = true
  }

  if (options.cacheControl) {
    schema.cache_control = options.cacheControl
  }

  
  
  
  
  
  
  
  
  
  
  
  if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_EXPERIMENTAL_BETAS)) {
    const allowed = new Set([
      'name',
      'description',
      'input_schema',
      'cache_control',
    ])
    const stripped = Object.keys(schema).filter(k => !allowed.has(k))
    if (stripped.length > 0) {
      logStripOnce(stripped)
      return {
        name: schema.name,
        description: schema.description,
        input_schema: schema.input_schema,
        ...(schema.cache_control && { cache_control: schema.cache_control }),
      }
    }
  }

  
  
  
  return schema as BetaTool
}

let loggedStrip = false
function logStripOnce(stripped: string[]): void {
  if (loggedStrip) return
  loggedStrip = true
  logForDebugging(
    `[betas] Stripped from tool schemas: [${stripped.join(', ')}] (CLAUDE_CODE_NEXT_DISABLE_EXPERIMENTAL_BETAS=1)`,
  )
}

export function logAPIPrefix(systemPrompt: SystemPrompt): void {
  const [firstSyspromptBlock] = splitSysPromptPrefix(systemPrompt)
  const firstSystemPrompt = firstSyspromptBlock?.text
  logEvent('tengu_sysprompt_block', {
    snippet: firstSystemPrompt?.slice(
      0,
      20,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    length: firstSystemPrompt?.length ?? 0,
    hash: (firstSystemPrompt
      ? createHash('sha256').update(firstSystemPrompt).digest('hex')
      : '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export function splitSysPromptPrefix(
  systemPrompt: SystemPrompt,
  options?: { skipGlobalCacheForSystemPrompt?: boolean },
): SystemPromptBlock[] {
  const useGlobalCacheFeature = shouldUseGlobalCacheScope()
  if (useGlobalCacheFeature && options?.skipGlobalCacheForSystemPrompt) {
    logEvent('tengu_sysprompt_using_tool_based_cache', {
      promptBlockCount: systemPrompt.length,
    })

    
    let attributionHeader: string | undefined
    let systemPromptPrefix: string | undefined
    const rest: string[] = []

    for (const prompt of systemPrompt) {
      if (!prompt) continue
      if (prompt === SYSTEM_PROMPT_DYNAMIC_BOUNDARY) continue 
      if (prompt.startsWith('x-anthropic-billing-header')) {
        attributionHeader = prompt
      } else if (CLI_SYSPROMPT_PREFIXES.has(prompt)) {
        systemPromptPrefix = prompt
      } else {
        rest.push(prompt)
      }
    }

    const result: SystemPromptBlock[] = []
    if (attributionHeader) {
      result.push({ text: attributionHeader, cacheScope: null })
    }
    if (systemPromptPrefix) {
      result.push({ text: systemPromptPrefix, cacheScope: 'org' })
    }
    const restJoined = rest.join('\n\n')
    if (restJoined) {
      result.push({ text: restJoined, cacheScope: 'org' })
    }
    return result
  }

  if (useGlobalCacheFeature) {
    const boundaryIndex = systemPrompt.findIndex(
      s => s === SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    )
    if (boundaryIndex !== -1) {
      let attributionHeader: string | undefined
      let systemPromptPrefix: string | undefined
      const staticBlocks: string[] = []
      const dynamicBlocks: string[] = []

      for (let i = 0; i < systemPrompt.length; i++) {
        const block = systemPrompt[i]
        if (!block || block === SYSTEM_PROMPT_DYNAMIC_BOUNDARY) continue

        if (block.startsWith('x-anthropic-billing-header')) {
          attributionHeader = block
        } else if (CLI_SYSPROMPT_PREFIXES.has(block)) {
          systemPromptPrefix = block
        } else if (i < boundaryIndex) {
          staticBlocks.push(block)
        } else {
          dynamicBlocks.push(block)
        }
      }

      const result: SystemPromptBlock[] = []
      if (attributionHeader)
        result.push({ text: attributionHeader, cacheScope: null })
      if (systemPromptPrefix)
        result.push({ text: systemPromptPrefix, cacheScope: null })
      const staticJoined = staticBlocks.join('\n\n')
      if (staticJoined)
        result.push({ text: staticJoined, cacheScope: 'global' })
      const dynamicJoined = dynamicBlocks.join('\n\n')
      if (dynamicJoined) result.push({ text: dynamicJoined, cacheScope: null })

      logEvent('tengu_sysprompt_boundary_found', {
        blockCount: result.length,
        staticBlockLength: staticJoined.length,
        dynamicBlockLength: dynamicJoined.length,
      })

      return result
    } else {
      logEvent('tengu_sysprompt_missing_boundary_marker', {
        promptBlockCount: systemPrompt.length,
      })
    }
  }
  let attributionHeader: string | undefined
  let systemPromptPrefix: string | undefined
  const rest: string[] = []

  for (const block of systemPrompt) {
    if (!block) continue

    if (block.startsWith('x-anthropic-billing-header')) {
      attributionHeader = block
    } else if (CLI_SYSPROMPT_PREFIXES.has(block)) {
      systemPromptPrefix = block
    } else {
      rest.push(block)
    }
  }

  const result: SystemPromptBlock[] = []
  if (attributionHeader)
    result.push({ text: attributionHeader, cacheScope: null })
  if (systemPromptPrefix)
    result.push({ text: systemPromptPrefix, cacheScope: 'org' })
  const restJoined = rest.join('\n\n')
  if (restJoined) result.push({ text: restJoined, cacheScope: 'org' })
  return result
}

export function appendSystemContext(
  systemPrompt: SystemPrompt,
  context: { [k: string]: string },
): string[] {
  return [
    ...systemPrompt,
    Object.entries(context)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
  ].filter(Boolean)
}

export function prependUserContext(
  messages: Message[],
  context: { [k: string]: string },
): Message[] {
  if (process.env.NODE_ENV === 'test') {
    return messages
  }

  if (Object.entries(context).length === 0) {
    return messages
  }

  return [
    createUserMessage({
      content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n${Object.entries(
        context,
      )
        .map(([key, value]) => `# ${key}\n${value}`)
        .join('\n')}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n`,
      isMeta: true,
    }),
    ...messages,
  ]
}

export async function logContextMetrics(
  mcpConfigs: Record<string, ScopedMcpServerConfig>,
  toolPermissionContext: ToolPermissionContext,
): Promise<void> {
  
  if (isAnalyticsDisabled()) {
    return
  }
  const [{ tools: mcpTools }, tools, userContext, systemContext] =
    await Promise.all([
      prefetchAllMcpResources(mcpConfigs),
      getTools(toolPermissionContext),
      getUserContext(),
      getSystemContext(),
    ])
  
  const gitStatusSize = systemContext.gitStatus?.length ?? 0
  const claudeMdSize = userContext.claudeMd?.length ?? 0

  
  const totalContextSize = gitStatusSize + claudeMdSize

  
  const currentDir = getCwd()
  const ignorePatternsByRoot = getFileReadIgnorePatterns(toolPermissionContext)
  const normalizedIgnorePatterns = normalizePatternsToPath(
    ignorePatternsByRoot,
    currentDir,
  )
  const fileCount = await countFilesRoundedRg(
    currentDir,
    AbortSignal.timeout(1000),
    normalizedIgnorePatterns,
  )

  
  let mcpToolsCount = 0
  let mcpServersCount = 0
  let mcpToolsTokens = 0
  let nonMcpToolsCount = 0
  let nonMcpToolsTokens = 0

  const nonMcpTools = tools.filter(tool => !tool.isMcp)
  mcpToolsCount = mcpTools.length
  nonMcpToolsCount = nonMcpTools.length

  
  const serverNames = new Set<string>()
  for (const tool of mcpTools) {
    const parts = tool.name.split('__')
    if (parts.length >= 3 && parts[1]) {
      serverNames.add(parts[1])
    }
  }
  mcpServersCount = serverNames.size

  
  
  for (const tool of mcpTools) {
    const schema =
      'inputJSONSchema' in tool && tool.inputJSONSchema
        ? tool.inputJSONSchema
        : zodToJsonSchema(tool.inputSchema)
    mcpToolsTokens += roughTokenCountEstimation(jsonStringify(schema))
  }
  for (const tool of nonMcpTools) {
    const schema =
      'inputJSONSchema' in tool && tool.inputJSONSchema
        ? tool.inputJSONSchema
        : zodToJsonSchema(tool.inputSchema)
    nonMcpToolsTokens += roughTokenCountEstimation(jsonStringify(schema))
  }

  logEvent('tengu_context_size', {
    git_status_size: gitStatusSize,
    claude_md_size: claudeMdSize,
    total_context_size: totalContextSize,
    project_file_count_rounded: fileCount,
    mcp_tools_count: mcpToolsCount,
    mcp_servers_count: mcpServersCount,
    mcp_tools_tokens: mcpToolsTokens,
    non_mcp_tools_count: nonMcpToolsCount,
    non_mcp_tools_tokens: nonMcpToolsTokens,
  })
}

export function normalizeToolInput<T extends Tool>(
  tool: T,
  input: z.infer<T['inputSchema']>,
  agentId?: AgentId,
): z.infer<T['inputSchema']> {
  switch (tool.name) {
    case EXIT_PLAN_MODE_V2_TOOL_NAME: {
      
      
      const plan = getPlan(agentId)
      const planFilePath = getPlanFilePath(agentId)
      
      void persistFileSnapshotIfRemote()
      return plan !== null ? { ...input, plan, planFilePath } : input
    }
    case BashTool.name: {
      
      const parsed = BashTool.inputSchema.parse(input)
      const { command, timeout, description } = parsed
      const cwd = getCwd()
      let normalizedCommand = command.replace(`cd ${cwd} && `, '')
      if (getPlatform() === 'windows') {
        normalizedCommand = normalizedCommand.replace(
          `cd ${windowsPathToPosixPath(cwd)} && `,
          '',
        )
      }

      
      normalizedCommand = normalizedCommand.replace(/\\\\;/g, '\\;')

      
      if (/^echo\s+["']?[^|&;><]*["']?$/i.test(normalizedCommand.trim())) {
        logEvent('tengu_bash_tool_simple_echo', {})
      }

      const run_in_background =
        'run_in_background' in parsed ? parsed.run_in_background : undefined

      
      
      return {
        command: normalizedCommand,
        description,
        ...(timeout !== undefined && { timeout }),
        ...(description !== undefined && { description }),
        ...(run_in_background !== undefined && { run_in_background }),
        ...('dangerouslyDisableSandbox' in parsed &&
          parsed.dangerouslyDisableSandbox !== undefined && {
            dangerouslyDisableSandbox: parsed.dangerouslyDisableSandbox,
          }),
      } as z.infer<T['inputSchema']>
    }
    case FileEditTool.name: {
      
      const parsedInput = FileEditTool.inputSchema.parse(input)

      
      const { file_path, edits } = normalizeFileEditInput({
        file_path: parsedInput.file_path,
        edits: [
          {
            old_string: parsedInput.old_string,
            new_string: parsedInput.new_string,
            replace_all: parsedInput.replace_all,
          },
        ],
      })

      
      return {
        replace_all: edits[0]!.replace_all,
        file_path,
        old_string: edits[0]!.old_string,
        new_string: edits[0]!.new_string,
      } as z.infer<T['inputSchema']>
    }
    case FileWriteTool.name: {
      
      const parsedInput = FileWriteTool.inputSchema.parse(input)

      
      const isMarkdown = /\.(md|mdx)$/i.test(parsedInput.file_path)

      
      return {
        file_path: parsedInput.file_path,
        content: isMarkdown
          ? parsedInput.content
          : stripTrailingWhitespace(parsedInput.content),
      } as z.infer<T['inputSchema']>
    }
    case TASK_OUTPUT_TOOL_NAME: {
      
      const legacyInput = input as Record<string, unknown>
      const taskId =
        legacyInput.task_id ?? legacyInput.agentId ?? legacyInput.bash_id
      const timeout =
        legacyInput.timeout ??
        (typeof legacyInput.wait_up_to === 'number'
          ? legacyInput.wait_up_to * 1000
          : undefined)
      
      return {
        task_id: taskId ?? '',
        block: legacyInput.block ?? true,
        timeout: timeout ?? 30000,
      } as z.infer<T['inputSchema']>
    }
    default:
      return input
  }
}

export function normalizeToolInputForAPI<T extends Tool>(
  tool: T,
  input: z.infer<T['inputSchema']>,
): z.infer<T['inputSchema']> {
  switch (tool.name) {
    case EXIT_PLAN_MODE_V2_TOOL_NAME: {
      
      if (
        input &&
        typeof input === 'object' &&
        ('plan' in input || 'planFilePath' in input)
      ) {
        const { plan, planFilePath, ...rest } = input as Record<string, unknown>
        return rest as z.infer<T['inputSchema']>
      }
      return input
    }
    case FileEditTool.name: {
      
      
      
      
      
      if (input && typeof input === 'object' && 'edits' in input) {
        const { old_string, new_string, replace_all, ...rest } =
          input as Record<string, unknown>
        return rest as z.infer<T['inputSchema']>
      }
      return input
    }
    default:
      return input
  }
}
