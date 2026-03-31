import type Anthropic from '@anthropic-ai/sdk'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages.js'
import {
  getLastApiCompletionTimestamp,
  setLastApiCompletionTimestamp,
} from '../bootstrap/state.js'
import { STRUCTURED_OUTPUTS_BETA_HEADER } from '../constants/betas.js'
import type { QuerySource } from '../constants/querySource.js'
import {
  getAttributionHeader,
  getCLISyspromptPrefix,
} from '../constants/system.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/metadata.js'
import { getAPIMetadata } from '../services/api/claude.js'
import { getAnthropicClient } from '../services/api/client.js'
import { getModelBetas, modelSupportsStructuredOutputs } from './betas.js'
import { computeFingerprint } from './fingerprint.js'
import { normalizeModelStringForAPI } from './model/model.js'

type MessageParam = Anthropic.MessageParam
type TextBlockParam = Anthropic.TextBlockParam
type Tool = Anthropic.Tool
type ToolChoice = Anthropic.ToolChoice
type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaJSONOutputFormat = Anthropic.Beta.Messages.BetaJSONOutputFormat
type BetaThinkingConfigParam = Anthropic.Beta.Messages.BetaThinkingConfigParam

export type SideQueryOptions = {
  
  model: string
  

  system?: string | TextBlockParam[]
  
  messages: MessageParam[]
  
  tools?: Tool[] | BetaToolUnion[]
  
  tool_choice?: ToolChoice
  
  output_format?: BetaJSONOutputFormat
  
  max_tokens?: number
  
  maxRetries?: number
  
  signal?: AbortSignal
  
  skipSystemPromptPrefix?: boolean
  
  temperature?: number
  
  thinking?: number | false
  
  stop_sequences?: string[]
  
  querySource: QuerySource
}

function extractFirstUserMessageText(messages: MessageParam[]): string {
  const firstUserMessage = messages.find(m => m.role === 'user')
  if (!firstUserMessage) return ''

  const content = firstUserMessage.content
  if (typeof content === 'string') return content

  
  const textBlock = content.find(block => block.type === 'text')
  return textBlock?.type === 'text' ? textBlock.text : ''
}

export async function sideQuery(opts: SideQueryOptions): Promise<BetaMessage> {
  const {
    model,
    system,
    messages,
    tools,
    tool_choice,
    output_format,
    max_tokens = 1024,
    maxRetries = 2,
    signal,
    skipSystemPromptPrefix,
    temperature,
    thinking,
    stop_sequences,
  } = opts

  const client = await getAnthropicClient({
    maxRetries,
    model,
    source: 'side_query',
  })
  const betas = [...getModelBetas(model)]
  
  if (
    output_format &&
    modelSupportsStructuredOutputs(model) &&
    !betas.includes(STRUCTURED_OUTPUTS_BETA_HEADER)
  ) {
    betas.push(STRUCTURED_OUTPUTS_BETA_HEADER)
  }

  
  const messageText = extractFirstUserMessageText(messages)

  
  const fingerprint = computeFingerprint(messageText, MACRO.VERSION)
  const attributionHeader = getAttributionHeader(fingerprint)

  
  
  const systemBlocks: TextBlockParam[] = [
    attributionHeader ? { type: 'text', text: attributionHeader } : null,
    
    ...(skipSystemPromptPrefix
      ? []
      : [
          {
            type: 'text' as const,
            text: getCLISyspromptPrefix({
              isNonInteractive: false,
              hasAppendSystemPrompt: false,
            }),
          },
        ]),
    ...(Array.isArray(system)
      ? system
      : system
        ? [{ type: 'text' as const, text: system }]
        : []),
  ].filter((block): block is TextBlockParam => block !== null)

  let thinkingConfig: BetaThinkingConfigParam | undefined
  if (thinking === false) {
    thinkingConfig = { type: 'disabled' }
  } else if (thinking !== undefined) {
    thinkingConfig = {
      type: 'enabled',
      budget_tokens: Math.min(thinking, max_tokens - 1),
    }
  }

  const normalizedModel = normalizeModelStringForAPI(model)
  const start = Date.now()
  
  const response = await client.beta.messages.create(
    {
      model: normalizedModel,
      max_tokens,
      system: systemBlocks,
      messages,
      ...(tools && { tools }),
      ...(tool_choice && { tool_choice }),
      ...(output_format && { output_config: { format: output_format } }),
      ...(temperature !== undefined && { temperature }),
      ...(stop_sequences && { stop_sequences }),
      ...(thinkingConfig && { thinking: thinkingConfig }),
      ...(betas.length > 0 && { betas }),
      metadata: getAPIMetadata(),
    },
    { signal },
  )

  const requestId =
    (response as { _request_id?: string | null })._request_id ?? undefined
  const now = Date.now()
  const lastCompletion = getLastApiCompletionTimestamp()
  logEvent('tengu_api_success', {
    requestId:
      requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      opts.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model:
      normalizedModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    uncachedInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    durationMsIncludingRetries: now - start,
    timeSinceLastApiCallMs:
      lastCompletion !== null ? now - lastCompletion : undefined,
  })
  setLastApiCompletionTimestamp(now)

  return response
}
