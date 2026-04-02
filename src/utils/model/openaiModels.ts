/**
 * OpenAI model configurations and utilities
 */

export type OpenAIModel =
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-4-turbo-preview'
  | 'gpt-4'
  | 'gpt-4-32k'
  | 'gpt-3.5-turbo'
  | 'gpt-3.5-turbo-16k'

/**
 * OpenAI model configurations
 */
export interface OpenAIModelConfig {
  name: string
  contextWindow: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsVision: boolean
  supportsJsonMode: boolean
  inputPricePer1K: number // in USD
  outputPricePer1K: number // in USD
}

/**
 * Model configurations for OpenAI models
 */
export const OPENAI_MODEL_CONFIGS: Record<OpenAIModel, OpenAIModelConfig> = {
  'gpt-4o': {
    name: 'GPT-4o',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    inputPricePer1K: 0.0025,
    outputPricePer1K: 0.01,
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    inputPricePer1K: 0.00015,
    outputPricePer1K: 0.0006,
  },
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    inputPricePer1K: 0.01,
    outputPricePer1K: 0.03,
  },
  'gpt-4-turbo-preview': {
    name: 'GPT-4 Turbo Preview',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    inputPricePer1K: 0.01,
    outputPricePer1K: 0.03,
  },
  'gpt-4': {
    name: 'GPT-4',
    contextWindow: 8192,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    inputPricePer1K: 0.03,
    outputPricePer1K: 0.06,
  },
  'gpt-4-32k': {
    name: 'GPT-4 32k',
    contextWindow: 32_768,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    inputPricePer1K: 0.06,
    outputPricePer1K: 0.12,
  },
  'gpt-3.5-turbo': {
    name: 'GPT-3.5 Turbo',
    contextWindow: 16_385,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    inputPricePer1K: 0.0005,
    outputPricePer1K: 0.0015,
  },
  'gpt-3.5-turbo-16k': {
    name: 'GPT-3.5 Turbo 16k',
    contextWindow: 16_385,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    inputPricePer1K: 0.003,
    outputPricePer1K: 0.004,
  },
}

/**
 * List of all supported OpenAI models
 */
export const OPENAI_MODELS = Object.keys(OPENAI_MODEL_CONFIGS) as OpenAIModel[]

/**
 * Default model to use when none is specified
 */
export const DEFAULT_OPENAI_MODEL: OpenAIModel = 'gpt-4o'

/**
 * Small/fast model for quick operations
 */
export const OPENAI_SMALL_FAST_MODEL: OpenAIModel = 'gpt-4o-mini'

/**
 * Get the configuration for a specific OpenAI model
 */
export function getOpenAIModelConfig(
  model: string,
): OpenAIModelConfig | undefined {
  return OPENAI_MODEL_CONFIGS[model as OpenAIModel]
}

/**
 * Check if a model name is a valid OpenAI model
 */
export function isOpenAIModel(model: string): boolean {
  return model in OPENAI_MODEL_CONFIGS
}

/**
 * Get the OpenAI model from config or default.
 * Priority: Environment variable > Settings.json > Default
 */
export function getOpenAIModel(): string {
  // Import here to avoid circular dependency
  const { getOpenAIModelFromConfig } = require('../../services/api/openai-client.js') as typeof import('../../services/api/openai-client.js')
  return getOpenAIModelFromConfig() || DEFAULT_OPENAI_MODEL
}

/**
 * Get the small/fast OpenAI model.
 * Priority: Environment variable > Default
 */
export function getOpenAISmallFastModel(): string {
  return process.env.OPENAI_SMALL_FAST_MODEL || OPENAI_SMALL_FAST_MODEL
}

/**
 * Get context window size for an OpenAI model
 */
export function getOpenAIContextWindow(model: string): number {
  const config = getOpenAIModelConfig(model)
  return config?.contextWindow || 128_000
}

/**
 * Get max output tokens for an OpenAI model
 */
export function getOpenAIMaxOutputTokens(model: string): number {
  const config = getOpenAIModelConfig(model)
  return config?.maxOutputTokens || 4096
}

/**
 * Check if an OpenAI model supports function calling/tools
 */
export function openAIModelSupportsTools(model: string): boolean {
  const config = getOpenAIModelConfig(model)
  return config?.supportsTools ?? true
}

/**
 * Check if an OpenAI model supports vision
 */
export function openAIModelSupportsVision(model: string): boolean {
  const config = getOpenAIModelConfig(model)
  return config?.supportsVision ?? false
}

/**
 * Get pricing information for an OpenAI model
 */
export function getOpenAIModelPricing(model: string): {
  input: number
  output: number
} {
  const config = getOpenAIModelConfig(model)
  return {
    input: config?.inputPricePer1K ?? 0,
    output: config?.outputPricePer1K ?? 0,
  }
}

/**
 * Calculate estimated cost for OpenAI API usage
 */
export function calculateOpenAICost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getOpenAIModelPricing(model)
  const inputCost = (inputTokens / 1000) * pricing.input
  const outputCost = (outputTokens / 1000) * pricing.output
  return inputCost + outputCost
}
