import OpenAI from 'openai'
import { getProxyFetchOptions } from 'src/utils/proxy.js'
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import { getUserAgent } from '../../utils/http.js'
import { isDebugToStdErr } from '../../utils/debug.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'

/**
 * Environment variables for OpenAI client:
 *
 * Direct API:
 * - OPENAI_API_KEY: Required for OpenAI API access (similar to ANTHROPIC_API_KEY)
 * - OPENAI_BASE_URL: Optional. Custom API endpoint for OpenAI-compatible services
 *                    (e.g., 'https://api.groq.com/openai/v1', 'https://api.deepseek.com')
 * - OPENAI_ORG_ID: Optional. Organization ID for OpenAI API
 *
 * Model selection (similar to ANTHROPIC_MODEL):
 * - OPENAI_MODEL: Default model name (e.g., 'gpt-4o', 'gpt-4o-mini')
 * - OPENAI_SMALL_FAST_MODEL: Small/fast model for quick operations
 *
 * Compatible providers:
 * - Groq: Set OPENAI_BASE_URL=https://api.groq.com/openai/v1
 * - DeepSeek: Set OPENAI_BASE_URL=https://api.deepseek.com
 * - Together: Set OPENAI_BASE_URL=https://api.together.xyz/v1
 * - Any other OpenAI-compatible endpoint
 */

function createStderrLogger(): OpenAI.Logger {
  return {
    error: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[OpenAI SDK ERROR]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    warn: (msg, ...args) => console.error('[OpenAI SDK WARN]', msg, ...args),
    // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
    info: (msg, ...args) => console.error('[OpenAI SDK INFO]', msg, ...args),
    debug: (msg, ...args) =>
      // biome-ignore lint/suspicious/noConsole:: intentional console output -- SDK logger must use console
      console.error('[OpenAI SDK DEBUG]', msg, ...args),
  }
}

/**
 * Get the OpenAI API key.
 * Priority: Environment variable > Settings.json env section
 * Similar to how Anthropic API key is retrieved.
 */
export function getOpenAIApiKey(): string | undefined {
  // Priority 1: Environment variable
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY
  }
  
  // Priority 2: Settings.json env section (similar to ANTHROPIC_API_KEY handling)
  const settings = getSettings_DEPRECATED()
  if (settings?.env?.OPENAI_API_KEY) {
    return settings.env.OPENAI_API_KEY
  }
  
  // Alternative: For compatibility with some OpenAI-compatible services
  if (process.env.OPENAI_AUTH_TOKEN) {
    return process.env.OPENAI_AUTH_TOKEN
  }
  
  return undefined
}

/**
 * Get the OpenAI base URL.
 * Priority: Environment variable > Settings.json env section
 */
export function getOpenAIBaseUrl(): string | undefined {
  // Priority 1: Environment variable
  if (process.env.OPENAI_BASE_URL) {
    return process.env.OPENAI_BASE_URL
  }
  
  // Priority 2: Settings.json env section
  const settings = getSettings_DEPRECATED()
  if (settings?.env?.OPENAI_BASE_URL) {
    return settings.env.OPENAI_BASE_URL
  }
  
  return undefined
}

/**
 * Get the OpenAI organization ID.
 * Priority: Environment variable > Settings.json env section
 */
export function getOpenAIOrgId(): string | undefined {
  // Priority 1: Environment variable
  if (process.env.OPENAI_ORG_ID) {
    return process.env.OPENAI_ORG_ID
  }
  
  // Priority 2: Settings.json env section
  const settings = getSettings_DEPRECATED()
  if (settings?.env?.OPENAI_ORG_ID) {
    return settings.env.OPENAI_ORG_ID
  }
  
  return undefined
}

/**
 * Get the OpenAI model from settings.
 * Priority: Environment variable > Settings.json env section
 */
export function getOpenAIModelFromConfig(): string | undefined {
  // Priority 1: Environment variable
  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL
  }
  
  // Priority 2: Settings.json env section
  const settings = getSettings_DEPRECATED()
  if (settings?.env?.OPENAI_MODEL) {
    return settings.env.OPENAI_MODEL
  }
  
  return undefined
}

/**
 * Check if OpenAI is configured (API key is present).
 * Similar to checking if Anthropic API key is present.
 */
export function isOpenAIConfigured(): boolean {
  return !!getOpenAIApiKey()
}

/**
 * Get custom headers for OpenAI requests
 */
function getCustomHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Claude-Code-Session-Id': getSessionId(),
  }

  // Add container/remote session headers if present
  const containerId = process.env.CLAUDE_CODE_CONTAINER_ID
  const remoteSessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP

  if (containerId) {
    headers['x-claude-remote-container-id'] = containerId
  }
  if (remoteSessionId) {
    headers['x-claude-remote-session-id'] = remoteSessionId
  }
  if (clientApp) {
    headers['x-client-app'] = clientApp
  }

  return headers
}

export interface OpenAIClientOptions {
  apiKey?: string
  baseURL?: string
  maxRetries?: number
  timeout?: number
}

/**
 * Create an OpenAI client instance
 */
export async function getOpenAIClient({
  apiKey,
  maxRetries = 2,
  timeout = parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
}: OpenAIClientOptions = {}): Promise<OpenAI> {
  const resolvedApiKey = apiKey || getOpenAIApiKey()

  if (!resolvedApiKey) {
    throw new Error(
      'OpenAI API key is required. Set OPENAI_API_KEY environment variable.',
    )
  }

  const baseURL = getOpenAIBaseUrl()
  const orgId = getOpenAIOrgId()
  const defaultHeaders = getCustomHeaders()

  const args: OpenAI.ClientOptions = {
    apiKey: resolvedApiKey,
    maxRetries,
    timeout,
    defaultHeaders,
    ...(baseURL && { baseURL }),
    ...(orgId && { organization: orgId }),
    ...(isDebugToStdErr() && { logger: createStderrLogger() }),
  }

  // Add proxy support
  const proxyOptions = getProxyFetchOptions({ forAnthropicAPI: false })
  if (proxyOptions.agent) {
    // OpenAI SDK doesn't support agent directly, but we can use fetch override
    // This is a placeholder - actual proxy support may need custom fetch implementation
  }

  return new OpenAI(args)
}
