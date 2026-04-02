import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  AssistantMessage,
  StreamEvent,
  UserMessage,
} from '../../types/message.js'
import type { ThinkingConfig } from '../../utils/thinking.js'

/**
 * Common parameters for streaming messages
 */
export interface StreamMessagesParams {
  /** Model to use for the request */
  model: string

  /** Messages to send */
  messages: MessageParam[]

  /** System prompt */
  system: string

  /** Tools available for the model */
  tools?: BetaToolUnion[]

  /** Tool choice - auto means let the model decide */
  toolChoice?: 'auto' | 'any' | { type: 'tool'; name: string }

  /** Maximum tokens to generate */
  maxTokens: number

  /** Thinking configuration (may not be supported by all providers) */
  thinkingConfig?: ThinkingConfig

  /** Whether to enable prompt caching (Anthropic-specific) */
  enableCaching?: boolean

  /** Abort signal for cancellation */
  signal?: AbortSignal

  /** Session ID for tracking */
  sessionId?: string

  /** Beta headers to include (Anthropic-specific) */
  betaHeaders?: string[]

  /** Additional metadata for analytics */
  metadata?: {
    querySource?: string
    agentId?: string
  }
}

/**
 * Usage statistics from an API response
 */
export interface UsageStats {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

/**
 * Result of a streaming message request
 */
export interface StreamResult {
  /** The complete assistant message */
  message: AssistantMessage

  /** Usage statistics */
  usage: UsageStats

  /** Stop reason */
  stopReason: string

  /** Provider-specific raw response (for debugging) */
  rawResponse?: unknown
}

/**
 * Base interface for LLM clients
 * Both Anthropic and OpenAI clients implement this interface
 */
export interface LLMClient {
  /**
   * Stream messages from the LLM
   * Yields partial results as they arrive
   */
  streamMessages(
    params: StreamMessagesParams,
  ): AsyncGenerator<StreamEvent, StreamResult, void>

  /**
   * Get information about the client/provider
   */
  getProviderInfo(): ProviderInfo

  /**
   * Check if a feature is supported by this provider
   */
  supportsFeature(feature: ProviderFeature): boolean
}

/**
 * Information about the LLM provider
 */
export interface ProviderInfo {
  name: string
  type: 'anthropic' | 'openai' | 'bedrock' | 'vertex' | 'foundry'
  baseUrl?: string
  defaultModel: string
  availableModels: string[]
}

/**
 * Features that may or may not be supported by different providers
 */
export type ProviderFeature =
  | 'thinking' // Extended thinking mode
  | 'promptCaching' // Prompt caching
  | 'toolUse' // Function calling
  | 'streaming' // Streaming responses
  | 'vision' // Image input
  | 'jsonMode' // JSON mode
  | 'systemPrompt' // System prompt support

/**
 * Provider configuration
 */
export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  maxRetries?: number
  timeout?: number
}

/**
 * Error types specific to LLM operations
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

export class LLMRateLimitError extends LLMError {
  constructor(message: string, public retryAfter?: number) {
    super(message, 'rate_limit')
    this.name = 'LLMRateLimitError'
  }
}

export class LLMAuthenticationError extends LLMError {
  constructor(message: string) {
    super(message, 'authentication', 401)
    this.name = 'LLMAuthenticationError'
  }
}

export class LLMContextWindowExceededError extends LLMError {
  constructor(message: string) {
    super(message, 'context_window_exceeded', 400)
    this.name = 'LLMContextWindowExceededError'
  }
}
