import type { PermissionMode } from '../permissions/PermissionMode.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_ALIASES, type ModelAlias } from './aliases.js'
import { applyBedrockRegionPrefix, getBedrockRegionPrefix } from './bedrock.js'
import {
  getCanonicalName,
  getRuntimeMainLoopModel,
  parseUserSpecifiedModel,
} from './model.js'
import { getAPIProvider } from './providers.js'

export const AGENT_MODEL_OPTIONS = [...MODEL_ALIASES, 'inherit'] as const
export type AgentModelAlias = (typeof AGENT_MODEL_OPTIONS)[number]

export type AgentModelOption = {
  value: AgentModelAlias
  label: string
  description: string
}

export function getDefaultSubagentModel(): string {
  return 'inherit'
}

export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: ModelAlias,
  permissionMode?: PermissionMode,
): string {
  if (process.env.CLAUDE_CODE_NEXT_SUBAGENT_MODEL) {
    return parseUserSpecifiedModel(process.env.CLAUDE_CODE_NEXT_SUBAGENT_MODEL)
  }

  
  
  
  const parentRegionPrefix = getBedrockRegionPrefix(parentModel)

  
  
  
  
  
  
  const applyParentRegionPrefix = (
    resolvedModel: string,
    originalSpec: string,
  ): string => {
    if (parentRegionPrefix && getAPIProvider() === 'bedrock') {
      if (getBedrockRegionPrefix(originalSpec)) return resolvedModel
      return applyBedrockRegionPrefix(resolvedModel, parentRegionPrefix)
    }
    return resolvedModel
  }

  
  if (toolSpecifiedModel) {
    if (aliasMatchesParentTier(toolSpecifiedModel, parentModel)) {
      return parentModel
    }
    const model = parseUserSpecifiedModel(toolSpecifiedModel)
    return applyParentRegionPrefix(model, toolSpecifiedModel)
  }

  const agentModelWithExp = agentModel ?? getDefaultSubagentModel()

  if (agentModelWithExp === 'inherit') {
    
    
    return getRuntimeMainLoopModel({
      permissionMode: permissionMode ?? 'default',
      mainLoopModel: parentModel,
      exceeds200kTokens: false,
    })
  }

  if (aliasMatchesParentTier(agentModelWithExp, parentModel)) {
    return parentModel
  }
  const model = parseUserSpecifiedModel(agentModelWithExp)
  return applyParentRegionPrefix(model, agentModelWithExp)
}

function aliasMatchesParentTier(alias: string, parentModel: string): boolean {
  const canonical = getCanonicalName(parentModel)
  switch (alias.toLowerCase()) {
    case 'opus':
      return canonical.includes('opus')
    case 'sonnet':
      return canonical.includes('sonnet')
    case 'haiku':
      return canonical.includes('haiku')
    default:
      return false
  }
}

export function getAgentModelDisplay(model: string | undefined): string {
  
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return capitalize(model)
}

export function getAgentModelOptions(): AgentModelOption[] {
  return [
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Balanced performance - best for most agents',
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Most capable for complex reasoning tasks',
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fast and efficient for simple tasks',
    },
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]
}
