

import { feature } from 'bun:bundle'
import { context as otelContext, type Span, trace } from '@opentelemetry/api'
import { AsyncLocalStorage } from 'async_hooks'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'
import {
  addBetaInteractionAttributes,
  addBetaLLMRequestAttributes,
  addBetaLLMResponseAttributes,
  addBetaToolInputAttributes,
  addBetaToolResultAttributes,
  isBetaTracingEnabled,
  type LLMRequestNewContext,
  truncateContent,
} from './betaSessionTracing.js'
import {
  endInteractionPerfettoSpan,
  endLLMRequestPerfettoSpan,
  endToolPerfettoSpan,
  endUserInputPerfettoSpan,
  isPerfettoTracingEnabled,
  startInteractionPerfettoSpan,
  startLLMRequestPerfettoSpan,
  startToolPerfettoSpan,
  startUserInputPerfettoSpan,
} from './perfettoTracing.js'

export type { Span }
export { isBetaTracingEnabled, type LLMRequestNewContext }

// Message type for API calls (UserMessage or AssistantMessage)
type APIMessage = UserMessage | AssistantMessage

type SpanType =
  | 'interaction'
  | 'llm_request'
  | 'tool'
  | 'tool.blocked_on_user'
  | 'tool.execution'
  | 'hook'

interface SpanContext {
  span: Span
  startTime: number
  attributes: Record<string, string | number | boolean>
  ended?: boolean
  perfettoSpanId?: string
}

// ALS stores SpanContext directly so it holds a strong reference while a span

const interactionContext = new AsyncLocalStorage<SpanContext | undefined>()
const toolContext = new AsyncLocalStorage<SpanContext | undefined>()
const activeSpans = new Map<string, WeakRef<SpanContext>>()

const strongSpans = new Map<string, SpanContext>()
let interactionSequence = 0
let _cleanupIntervalStarted = false

const SPAN_TTL_MS = 30 * 60 * 1000 

function getSpanId(span: Span): string {
  return span.spanContext().spanId || ''
}

/**
 * Lazily start a background interval that evicts orphaned spans from activeSpans.
 *
 * Normal teardown calls endInteractionSpan / endToolSpan, which delete spans
 * immediately. This interval is a safety net for spans that were never ended
 * (e.g. aborted streams, uncaught exceptions mid-query) — without it they
 * accumulate in activeSpans indefinitely, holding references to Span objects
 * and the OpenTelemetry context chain.
 *
 * Initialized on the first startInteractionSpan call (not at module load) to
 * avoid triggering the no-top-level-side-effects lint rule and to keep the
 * interval from running in processes that never start a span.
 * unref() prevents the timer from keeping the process alive after all other
 * work is done.
 */
function ensureCleanupInterval(): void {
  if (_cleanupIntervalStarted) return
  _cleanupIntervalStarted = true
  const interval = setInterval(() => {
    const cutoff = Date.now() - SPAN_TTL_MS
    for (const [spanId, weakRef] of activeSpans) {
      const ctx = weakRef.deref()
      if (ctx === undefined) {
        activeSpans.delete(spanId)
        strongSpans.delete(spanId)
      } else if (ctx.startTime < cutoff) {
        if (!ctx.ended) ctx.span.end() 
        activeSpans.delete(spanId)
        strongSpans.delete(spanId)
      }
    }
  }, 60_000)
  if (typeof interval.unref === 'function') {
    interval.unref() 
  }
}

/**
 * Check if enhanced telemetry is enabled.
 * Priority: env var override > ant build > GrowthBook gate
 */
export function isEnhancedTelemetryEnabled(): boolean {
  if (feature('ENHANCED_TELEMETRY_BETA')) {
    const env =
      process.env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA ??
      process.env.ENABLE_ENHANCED_TELEMETRY_BETA
    if (isEnvTruthy(env)) {
      return true
    }
    if (isEnvDefinedFalsy(env)) {
      return false
    }
    return (
      process.env.USER_TYPE === 'ant' ||
      getFeatureValue_CACHED_MAY_BE_STALE('enhanced_telemetry_beta', false)
    )
  }
  return false
}

/**
 * Check if any tracing is enabled (either standard enhanced telemetry OR beta tracing)
 */
function isAnyTracingEnabled(): boolean {
  return isEnhancedTelemetryEnabled() || isBetaTracingEnabled()
}

function getTracer() {
  return trace.getTracer('com.anthropic.claude_code.tracing', '1.0.0')
}

function createSpanAttributes(
  spanType: SpanType,
  customAttributes: Record<string, string | number | boolean> = {},
): Record<string, string | number | boolean> {
  const baseAttributes = getTelemetryAttributes()

  const attributes: Record<string, string | number | boolean> = {
    ...baseAttributes,
    'span.type': spanType,
    ...customAttributes,
  }

  return attributes
}

/**
 * Start an interaction span. This wraps a user request -> Claude response cycle.
 * This is now a root span that includes all session-level attributes.
 * Sets the interaction context for all subsequent operations.
 */
export function startInteractionSpan(userPrompt: string): Span {
  ensureCleanupInterval()

  
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startInteractionPerfettoSpan(userPrompt)
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: {},
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      interactionContext.enterWith(spanContextObj)
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const isUserPromptLoggingEnabled = isEnvTruthy(
    process.env.OTEL_LOG_USER_PROMPTS,
  )
  const promptToLog = isUserPromptLoggingEnabled ? userPrompt : '<REDACTED>'

  interactionSequence++

  const attributes = createSpanAttributes('interaction', {
    user_prompt: promptToLog,
    user_prompt_length: userPrompt.length,
    'interaction.sequence': interactionSequence,
  })

  const span = tracer.startSpan('claude_code.interaction', {
    attributes,
  })

  
  addBetaInteractionAttributes(span, userPrompt)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))

  interactionContext.enterWith(spanContextObj)

  return span
}

export function endInteractionSpan(): void {
  const spanContext = interactionContext.getStore()
  if (!spanContext) {
    return
  }

  if (spanContext.ended) {
    return
  }

  // End Perfetto span
  if (spanContext.perfettoSpanId) {
    endInteractionPerfettoSpan(spanContext.perfettoSpanId)
  }

  if (!isAnyTracingEnabled()) {
    spanContext.ended = true
    activeSpans.delete(getSpanId(spanContext.span))
    
    // promise callbacks, I/O) do not inherit a reference to the ended span.
    
    
    interactionContext.enterWith(undefined)
    return
  }

  const duration = Date.now() - spanContext.startTime
  spanContext.span.setAttributes({
    'interaction.duration_ms': duration,
  })

  spanContext.span.end()
  spanContext.ended = true
  activeSpans.delete(getSpanId(spanContext.span))
  interactionContext.enterWith(undefined)
}

export function startLLMRequestSpan(
  model: string,
  newContext?: LLMRequestNewContext,
  messagesForAPI?: APIMessage[],
  fastMode?: boolean,
): Span {
  // Start Perfetto span regardless of OTel tracing state
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startLLMRequestPerfettoSpan({
        model,
        querySource: newContext?.querySource,
        messageId: undefined, // Will be set in endLLMRequestSpan
      })
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: { model },
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      strongSpans.set(spanId, spanContextObj)
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = interactionContext.getStore()

  const attributes = createSpanAttributes('llm_request', {
    model: model,
    'llm_request.context': parentSpanCtx ? 'interaction' : 'standalone',
    speed: fastMode ? 'fast' : 'normal',
  })

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan('claude_code.llm_request', { attributes }, ctx)

  
  if (newContext?.querySource) {
    span.setAttribute('query_source', newContext.querySource)
  }

  // Add experimental attributes (system prompt, new_context)
  addBetaLLMRequestAttributes(span, newContext, messagesForAPI)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

/**
 * End an LLM request span and attach response metadata.
 *
 * @param span - Optional. The exact span returned by startLLMRequestSpan().
 *   IMPORTANT: When multiple LLM requests run in parallel (e.g., warmup requests,
 *   topic classifier, file path extractor, main thread), you MUST pass the specific span
 *   to ensure responses are attached to the correct request. Without it, responses may be
 *   incorrectly attached to whichever span happens to be "last" in the activeSpans map.
 *
 *   If not provided, falls back to finding the most recent llm_request span (legacy behavior).
 */
export function endLLMRequestSpan(
  span?: Span,
  metadata?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    success?: boolean
    statusCode?: number
    error?: string
    attempt?: number
    modelResponse?: string
    
    modelOutput?: string
    
    thinkingOutput?: string
    
    hasToolCall?: boolean
    
    ttftMs?: number
    
    requestSetupMs?: number
    
    attemptStartTimes?: number[]
  },
): void {
  let llmSpanContext: SpanContext | undefined

  if (span) {
    // Use the provided span directly - this is the correct approach for parallel requests
    const spanId = getSpanId(span)
    llmSpanContext = activeSpans.get(spanId)?.deref()
  } else {
    // Legacy fallback: find the most recent llm_request span
    
    llmSpanContext = Array.from(activeSpans.values())
      .findLast(r => {
        const ctx = r.deref()
        return (
          ctx?.attributes['span.type'] === 'llm_request' ||
          ctx?.attributes['model']
        )
      })
      ?.deref()
  }

  if (!llmSpanContext) {
    // Span was already ended or never tracked
    return
  }

  const duration = Date.now() - llmSpanContext.startTime

  
  if (llmSpanContext.perfettoSpanId) {
    endLLMRequestPerfettoSpan(llmSpanContext.perfettoSpanId, {
      ttftMs: metadata?.ttftMs,
      ttltMs: duration, // Time to last token is the total duration
      promptTokens: metadata?.inputTokens,
      outputTokens: metadata?.outputTokens,
      cacheReadTokens: metadata?.cacheReadTokens,
      cacheCreationTokens: metadata?.cacheCreationTokens,
      success: metadata?.success,
      error: metadata?.error,
      requestSetupMs: metadata?.requestSetupMs,
      attemptStartTimes: metadata?.attemptStartTimes,
    })
  }

  if (!isAnyTracingEnabled()) {
    const spanId = getSpanId(llmSpanContext.span)
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    return
  }

  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (metadata) {
    if (metadata.inputTokens !== undefined)
      endAttributes['input_tokens'] = metadata.inputTokens
    if (metadata.outputTokens !== undefined)
      endAttributes['output_tokens'] = metadata.outputTokens
    if (metadata.cacheReadTokens !== undefined)
      endAttributes['cache_read_tokens'] = metadata.cacheReadTokens
    if (metadata.cacheCreationTokens !== undefined)
      endAttributes['cache_creation_tokens'] = metadata.cacheCreationTokens
    if (metadata.success !== undefined)
      endAttributes['success'] = metadata.success
    if (metadata.statusCode !== undefined)
      endAttributes['status_code'] = metadata.statusCode
    if (metadata.error !== undefined) endAttributes['error'] = metadata.error
    if (metadata.attempt !== undefined)
      endAttributes['attempt'] = metadata.attempt
    if (metadata.hasToolCall !== undefined)
      endAttributes['response.has_tool_call'] = metadata.hasToolCall
    if (metadata.ttftMs !== undefined)
      endAttributes['ttft_ms'] = metadata.ttftMs

    
    addBetaLLMResponseAttributes(endAttributes, metadata)
  }

  llmSpanContext.span.setAttributes(endAttributes)
  llmSpanContext.span.end()

  const spanId = getSpanId(llmSpanContext.span)
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}

export function startToolSpan(
  toolName: string,
  toolAttributes?: Record<string, string | number | boolean>,
  toolInput?: string,
): Span {
  // Start Perfetto span regardless of OTel tracing state
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startToolPerfettoSpan(toolName, toolAttributes)
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: { 'span.type': 'tool', tool_name: toolName },
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      toolContext.enterWith(spanContextObj)
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = interactionContext.getStore()

  const attributes = createSpanAttributes('tool', {
    tool_name: toolName,
    ...toolAttributes,
  })

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan('claude_code.tool', { attributes }, ctx)

  
  if (toolInput) {
    addBetaToolInputAttributes(span, toolName, toolInput)
  }

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))

  toolContext.enterWith(spanContextObj)

  return span
}

export function startToolBlockedOnUserSpan(): Span {
  // Start Perfetto span regardless of OTel tracing state
  const perfettoSpanId = isPerfettoTracingEnabled()
    ? startUserInputPerfettoSpan('tool_permission')
    : undefined

  if (!isAnyTracingEnabled()) {
    // Still track Perfetto span even if OTel is disabled
    if (perfettoSpanId) {
      const dummySpan = trace.getActiveSpan() || getTracer().startSpan('dummy')
      const spanId = getSpanId(dummySpan)
      const spanContextObj: SpanContext = {
        span: dummySpan,
        startTime: Date.now(),
        attributes: { 'span.type': 'tool.blocked_on_user' },
        perfettoSpanId,
      }
      activeSpans.set(spanId, new WeakRef(spanContextObj))
      strongSpans.set(spanId, spanContextObj)
      return dummySpan
    }
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore()

  const attributes = createSpanAttributes('tool.blocked_on_user')

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan(
    'claude_code.tool.blocked_on_user',
    { attributes },
    ctx,
  )

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
    perfettoSpanId,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

export function endToolBlockedOnUserSpan(
  decision?: string,
  source?: string,
): void {
  const blockedSpanContext = Array.from(activeSpans.values())
    .findLast(
      r => r.deref()?.attributes['span.type'] === 'tool.blocked_on_user',
    )
    ?.deref()

  if (!blockedSpanContext) {
    return
  }

  // End Perfetto span
  if (blockedSpanContext.perfettoSpanId) {
    endUserInputPerfettoSpan(blockedSpanContext.perfettoSpanId, {
      decision,
      source,
    })
  }

  if (!isAnyTracingEnabled()) {
    const spanId = getSpanId(blockedSpanContext.span)
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    return
  }

  const duration = Date.now() - blockedSpanContext.startTime
  const attributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (decision) {
    attributes['decision'] = decision
  }
  if (source) {
    attributes['source'] = source
  }

  blockedSpanContext.span.setAttributes(attributes)
  blockedSpanContext.span.end()

  const spanId = getSpanId(blockedSpanContext.span)
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}

export function startToolExecutionSpan(): Span {
  if (!isAnyTracingEnabled()) {
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore()

  const attributes = createSpanAttributes('tool.execution')

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan(
    'claude_code.tool.execution',
    { attributes },
    ctx,
  )

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

export function endToolExecutionSpan(metadata?: {
  success?: boolean
  error?: string
}): void {
  if (!isAnyTracingEnabled()) {
    return
  }

  const executionSpanContext = Array.from(activeSpans.values())
    .findLast(r => r.deref()?.attributes['span.type'] === 'tool.execution')
    ?.deref()

  if (!executionSpanContext) {
    return
  }

  const duration = Date.now() - executionSpanContext.startTime
  const attributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (metadata) {
    if (metadata.success !== undefined) attributes['success'] = metadata.success
    if (metadata.error !== undefined) attributes['error'] = metadata.error
  }

  executionSpanContext.span.setAttributes(attributes)
  executionSpanContext.span.end()

  const spanId = getSpanId(executionSpanContext.span)
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}

export function endToolSpan(toolResult?: string, resultTokens?: number): void {
  const toolSpanContext = toolContext.getStore()

  if (!toolSpanContext) {
    return
  }

  // End Perfetto span
  if (toolSpanContext.perfettoSpanId) {
    endToolPerfettoSpan(toolSpanContext.perfettoSpanId, {
      success: true,
      resultTokens,
    })
  }

  if (!isAnyTracingEnabled()) {
    const spanId = getSpanId(toolSpanContext.span)
    activeSpans.delete(spanId)
    
    
    toolContext.enterWith(undefined)
    return
  }

  const duration = Date.now() - toolSpanContext.startTime
  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  // Add experimental tool result attributes (new_context)
  if (toolResult) {
    const toolName = toolSpanContext.attributes['tool_name'] || 'unknown'
    addBetaToolResultAttributes(endAttributes, toolName, toolResult)
  }

  if (resultTokens !== undefined) {
    endAttributes['result_tokens'] = resultTokens
  }

  toolSpanContext.span.setAttributes(endAttributes)
  toolSpanContext.span.end()

  const spanId = getSpanId(toolSpanContext.span)
  activeSpans.delete(spanId)
  toolContext.enterWith(undefined)
}

function isToolContentLoggingEnabled(): boolean {
  return isEnvTruthy(process.env.OTEL_LOG_TOOL_CONTENT)
}

/**
 * Add a span event with tool content/output data.
 * Only logs if OTEL_LOG_TOOL_CONTENT=1 is set.
 * Truncates content if it exceeds MAX_CONTENT_SIZE.
 */
export function addToolContentEvent(
  eventName: string,
  attributes: Record<string, string | number | boolean>,
): void {
  if (!isAnyTracingEnabled() || !isToolContentLoggingEnabled()) {
    return
  }

  const currentSpanCtx = toolContext.getStore()
  if (!currentSpanCtx) {
    return
  }

  // Truncate string attributes that might be large
  const processedAttributes: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string') {
      const { content, truncated } = truncateContent(value)
      processedAttributes[key] = content
      if (truncated) {
        processedAttributes[`${key}_truncated`] = true
        processedAttributes[`${key}_original_length`] = value.length
      }
    } else {
      processedAttributes[key] = value
    }
  }

  currentSpanCtx.span.addEvent(eventName, processedAttributes)
}

export function getCurrentSpan(): Span | null {
  if (!isAnyTracingEnabled()) {
    return null
  }

  return (
    toolContext.getStore()?.span ?? interactionContext.getStore()?.span ?? null
  )
}

export async function executeInSpan<T>(
  spanName: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!isAnyTracingEnabled()) {
    return fn(trace.getActiveSpan() || getTracer().startSpan('dummy'))
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore() ?? interactionContext.getStore()

  const finalAttributes = createSpanAttributes('tool', {
    ...attributes,
  })

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan(spanName, { attributes: finalAttributes }, ctx)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes: finalAttributes,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  try {
    const result = await fn(span)
    span.end()
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    return result
  } catch (error) {
    if (error instanceof Error) {
      span.recordException(error)
    }
    span.end()
    activeSpans.delete(spanId)
    strongSpans.delete(spanId)
    throw error
  }
}

/**
 * Start a hook execution span.
 * Only creates a span when beta tracing is enabled.
 * @param hookEvent The hook event type (e.g., 'PreToolUse', 'PostToolUse')
 * @param hookName The full hook name (e.g., 'PreToolUse:Write')
 * @param numHooks The number of hooks being executed
 * @param hookDefinitions JSON string of hook definitions for tracing
 * @returns The span (or a dummy span if tracing is disabled)
 */
export function startHookSpan(
  hookEvent: string,
  hookName: string,
  numHooks: number,
  hookDefinitions: string,
): Span {
  if (!isBetaTracingEnabled()) {
    return trace.getActiveSpan() || getTracer().startSpan('dummy')
  }

  const tracer = getTracer()
  const parentSpanCtx = toolContext.getStore() ?? interactionContext.getStore()

  const attributes = createSpanAttributes('hook', {
    hook_event: hookEvent,
    hook_name: hookName,
    num_hooks: numHooks,
    hook_definitions: hookDefinitions,
  })

  const ctx = parentSpanCtx
    ? trace.setSpan(otelContext.active(), parentSpanCtx.span)
    : otelContext.active()
  const span = tracer.startSpan('claude_code.hook', { attributes }, ctx)

  const spanId = getSpanId(span)
  const spanContextObj: SpanContext = {
    span,
    startTime: Date.now(),
    attributes,
  }
  activeSpans.set(spanId, new WeakRef(spanContextObj))
  strongSpans.set(spanId, spanContextObj)

  return span
}

/**
 * End a hook execution span with outcome metadata.
 * Only does work when beta tracing is enabled.
 * @param span The span to end (returned from startHookSpan)
 * @param metadata The outcome metadata for the hook execution
 */
export function endHookSpan(
  span: Span,
  metadata?: {
    numSuccess?: number
    numBlocking?: number
    numNonBlockingError?: number
    numCancelled?: number
  },
): void {
  if (!isBetaTracingEnabled()) {
    return
  }

  const spanId = getSpanId(span)
  const spanContext = activeSpans.get(spanId)?.deref()

  if (!spanContext) {
    return
  }

  const duration = Date.now() - spanContext.startTime
  const endAttributes: Record<string, string | number | boolean> = {
    duration_ms: duration,
  }

  if (metadata) {
    if (metadata.numSuccess !== undefined)
      endAttributes['num_success'] = metadata.numSuccess
    if (metadata.numBlocking !== undefined)
      endAttributes['num_blocking'] = metadata.numBlocking
    if (metadata.numNonBlockingError !== undefined)
      endAttributes['num_non_blocking_error'] = metadata.numNonBlockingError
    if (metadata.numCancelled !== undefined)
      endAttributes['num_cancelled'] = metadata.numCancelled
  }

  spanContext.span.setAttributes(endAttributes)
  spanContext.span.end()
  activeSpans.delete(spanId)
  strongSpans.delete(spanId)
}
