

import { type APIProvider, getAPIProvider } from './providers.js'

type DeprecatedModelInfo = {
  isDeprecated: true
  modelName: string
  retirementDate: string
}

type NotDeprecatedInfo = {
  isDeprecated: false
}

type DeprecationInfo = DeprecatedModelInfo | NotDeprecatedInfo

type DeprecationEntry = {
  
  modelName: string
  
  retirementDates: Record<APIProvider, string | null>
}

const DEPRECATED_MODELS: Record<string, DeprecationEntry> = {
  'claude-3-opus': {
    modelName: 'Claude 3 Opus',
    retirementDates: {
      firstParty: 'January 5, 2026',
      bedrock: 'January 15, 2026',
      vertex: 'January 5, 2026',
      foundry: 'January 5, 2026',
    },
  },
  'claude-3-7-sonnet': {
    modelName: 'Claude 3.7 Sonnet',
    retirementDates: {
      firstParty: 'February 19, 2026',
      bedrock: 'April 28, 2026',
      vertex: 'May 11, 2026',
      foundry: 'February 19, 2026',
    },
  },
  'claude-3-5-haiku': {
    modelName: 'Claude 3.5 Haiku',
    retirementDates: {
      firstParty: 'February 19, 2026',
      bedrock: null,
      vertex: null,
      foundry: null,
    },
  },
}

function getDeprecatedModelInfo(modelId: string): DeprecationInfo {
  const lowercaseModelId = modelId.toLowerCase()
  const provider = getAPIProvider()

  for (const [key, value] of Object.entries(DEPRECATED_MODELS)) {
    const retirementDate = value.retirementDates[provider]
    if (!lowercaseModelId.includes(key) || !retirementDate) {
      continue
    }
    return {
      isDeprecated: true,
      modelName: value.modelName,
      retirementDate,
    }
  }

  return { isDeprecated: false }
}

export function getModelDeprecationWarning(
  modelId: string | null,
): string | null {
  if (!modelId) {
    return null
  }

  const info = getDeprecatedModelInfo(modelId)
  if (!info.isDeprecated) {
    return null
  }

  return `⚠ ${info.modelName} will be retired on ${info.retirementDate}. Consider switching to a newer model.`
}
