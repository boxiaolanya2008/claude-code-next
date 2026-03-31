

import { feature } from 'bun:bundle'
import { mkdirSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getSessionId } from '../../bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { logForDebugging } from '../debug.js'
import {
  getClaudeConfigHomeDir,
  isEnvDefinedFalsy,
  isEnvTruthy,
} from '../envUtils.js'
import { errorMessage } from '../errors.js'
import { djb2Hash } from '../hash.js'
import { jsonStringify } from '../slowOperations.js'
import { getAgentId, getAgentName, getParentSessionId } from '../teammate.js'

export type TraceEventPhase =
  | 'B' 
  | 'E' 
  | 'X' 
  | 'i' 
  | 'C' 
  | 'b' 
  | 'n' 
  | 'e' 
  | 'M' 

export type TraceEvent = {
  name: string
  cat: string
  ph: TraceEventPhase
  ts: number 
  pid: number 
  tid: number 
  dur?: number 
  args?: Record<string, unknown>
  id?: string 
  scope?: string
}

type AgentInfo = {
  agentId: string
  agentName: string
  parentAgentId?: string
  processId: number
  threadId: number
}

type PendingSpan = {
  name: string
  category: string
  startTime: number
  agentInfo: AgentInfo
  args: Record<string, unknown>
}

let isEnabled = false
let tracePath: string | null = null

const metadataEvents: TraceEvent[] = []
const events: TraceEvent[] = []

const MAX_EVENTS = 100_000
const pendingSpans = new Map<string, PendingSpan>()
const agentRegistry = new Map<string, AgentInfo>()
let totalAgentCount = 0
let startTimeMs = 0
let spanIdCounter = 0
let traceWritten = false 

let processIdCounter = 1
const agentIdToProcessId = new Map<string, number>()

let writeIntervalId: ReturnType<typeof setInterval> | null = null

const STALE_SPAN_TTL_MS = 30 * 60 * 1000 
const STALE_SPAN_CLEANUP_INTERVAL_MS = 60 * 1000 
let staleSpanCleanupId: ReturnType<typeof setInterval> | null = null

function stringToNumericHash(str: string): number {
  return Math.abs(djb2Hash(str)) || 1 
}

function getProcessIdForAgent(agentId: string): number {
  const existing = agentIdToProcessId.get(agentId)
  if (existing !== undefined) return existing

  processIdCounter++
  agentIdToProcessId.set(agentId, processIdCounter)
  return processIdCounter
}

function getCurrentAgentInfo(): AgentInfo {
  const agentId = getAgentId() ?? getSessionId()
  const agentName = getAgentName() ?? 'main'
  const parentSessionId = getParentSessionId()

  
  const existing = agentRegistry.get(agentId)
  if (existing) return existing

  const info: AgentInfo = {
    agentId,
    agentName,
    parentAgentId: parentSessionId,
    processId: agentId === getSessionId() ? 1 : getProcessIdForAgent(agentId),
    threadId: stringToNumericHash(agentName),
  }

  agentRegistry.set(agentId, info)
  totalAgentCount++
  return info
}

function getTimestamp(): number {
  return (Date.now() - startTimeMs) * 1000
}

function generateSpanId(): string {
  return `span_${++spanIdCounter}`
}

function evictStaleSpans(): void {
  const now = getTimestamp()
  const ttlUs = STALE_SPAN_TTL_MS * 1000 
  for (const [spanId, span] of pendingSpans) {
    if (now - span.startTime > ttlUs) {
      
      events.push({
        name: span.name,
        cat: span.category,
        ph: 'E',
        ts: now,
        pid: span.agentInfo.processId,
        tid: span.agentInfo.threadId,
        args: {
          ...span.args,
          evicted: true,
          duration_ms: (now - span.startTime) / 1000,
        },
      })
      pendingSpans.delete(spanId)
    }
  }
}

function buildTraceDocument(): string {
  return jsonStringify({
    traceEvents: [...metadataEvents, ...events],
    metadata: {
      session_id: getSessionId(),
      trace_start_time: new Date(startTimeMs).toISOString(),
      agent_count: totalAgentCount,
      total_event_count: metadataEvents.length + events.length,
    },
  })
}

function evictOldestEvents(): void {
  if (events.length < MAX_EVENTS) return
  const dropped = events.splice(0, MAX_EVENTS / 2)
  events.unshift({
    name: 'trace_truncated',
    cat: '__metadata',
    ph: 'i',
    ts: dropped[dropped.length - 1]?.ts ?? 0,
    pid: 1,
    tid: 0,
    args: { dropped_events: dropped.length },
  })
  logForDebugging(
    `[Perfetto] Evicted ${dropped.length} oldest events (cap ${MAX_EVENTS})`,
  )
}

export function initializePerfettoTracing(): void {
  const envValue = process.env.CLAUDE_CODE_NEXT_PERFETTO_TRACE
  logForDebugging(
    `[Perfetto] initializePerfettoTracing called, env value: ${envValue}`,
  )

  
  if (feature('PERFETTO_TRACING')) {
    if (!envValue || isEnvDefinedFalsy(envValue)) {
      logForDebugging(
        '[Perfetto] Tracing disabled (env var not set or disabled)',
      )
      return
    }

    isEnabled = true
    startTimeMs = Date.now()

    
    if (isEnvTruthy(envValue)) {
      const tracesDir = join(getClaudeConfigHomeDir(), 'traces')
      tracePath = join(tracesDir, `trace-${getSessionId()}.json`)
    } else {
      
      tracePath = envValue
    }

    logForDebugging(
      `[Perfetto] Tracing enabled, will write to: ${tracePath}, isEnabled=${isEnabled}`,
    )

    
    const intervalSec = parseInt(
      process.env.CLAUDE_CODE_NEXT_PERFETTO_WRITE_INTERVAL_S ?? '',
      10,
    )
    if (intervalSec > 0) {
      writeIntervalId = setInterval(() => {
        void periodicWrite()
      }, intervalSec * 1000)
      
      if (writeIntervalId.unref) writeIntervalId.unref()
      logForDebugging(
        `[Perfetto] Periodic write enabled, interval: ${intervalSec}s`,
      )
    }

    
    staleSpanCleanupId = setInterval(() => {
      evictStaleSpans()
      evictOldestEvents()
    }, STALE_SPAN_CLEANUP_INTERVAL_MS)
    if (staleSpanCleanupId.unref) staleSpanCleanupId.unref()

    
    registerCleanup(async () => {
      logForDebugging('[Perfetto] Cleanup callback invoked')
      await writePerfettoTrace()
    })

    
    
    process.on('beforeExit', () => {
      logForDebugging('[Perfetto] beforeExit handler invoked')
      void writePerfettoTrace()
    })

    
    
    process.on('exit', () => {
      if (!traceWritten) {
        logForDebugging(
          '[Perfetto] exit handler invoked, writing trace synchronously',
        )
        writePerfettoTraceSync()
      }
    })

    
    const mainAgent = getCurrentAgentInfo()
    emitProcessMetadata(mainAgent)
  }
}

function emitProcessMetadata(agentInfo: AgentInfo): void {
  if (!isEnabled) return

  
  metadataEvents.push({
    name: 'process_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid: agentInfo.processId,
    tid: 0,
    args: { name: agentInfo.agentName },
  })

  
  metadataEvents.push({
    name: 'thread_name',
    cat: '__metadata',
    ph: 'M',
    ts: 0,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: { name: agentInfo.agentName },
  })

  
  if (agentInfo.parentAgentId) {
    metadataEvents.push({
      name: 'parent_agent',
      cat: '__metadata',
      ph: 'M',
      ts: 0,
      pid: agentInfo.processId,
      tid: 0,
      args: {
        parent_agent_id: agentInfo.parentAgentId,
      },
    })
  }
}

export function isPerfettoTracingEnabled(): boolean {
  return isEnabled
}

export function registerAgent(
  agentId: string,
  agentName: string,
  parentAgentId?: string,
): void {
  if (!isEnabled) return

  const info: AgentInfo = {
    agentId,
    agentName,
    parentAgentId,
    processId: getProcessIdForAgent(agentId),
    threadId: stringToNumericHash(agentName),
  }

  agentRegistry.set(agentId, info)
  totalAgentCount++
  emitProcessMetadata(info)
}

export function unregisterAgent(agentId: string): void {
  if (!isEnabled) return
  agentRegistry.delete(agentId)
  agentIdToProcessId.delete(agentId)
}

export function startLLMRequestPerfettoSpan(args: {
  model: string
  promptTokens?: number
  messageId?: string
  isSpeculative?: boolean
  querySource?: string
}): string {
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: 'API Call',
    category: 'api',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      model: args.model,
      prompt_tokens: args.promptTokens,
      message_id: args.messageId,
      is_speculative: args.isSpeculative ?? false,
      query_source: args.querySource,
    },
  })

  
  events.push({
    name: 'API Call',
    cat: 'api',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

export function endLLMRequestPerfettoSpan(
  spanId: string,
  metadata: {
    ttftMs?: number
    ttltMs?: number
    promptTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    messageId?: string
    success?: boolean
    error?: string
    
    requestSetupMs?: number
    
    attemptStartTimes?: number[]
  },
): void {
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  const promptTokens =
    metadata.promptTokens ?? (pending.args.prompt_tokens as number | undefined)
  const ttftMs = metadata.ttftMs
  const ttltMs = metadata.ttltMs
  const outputTokens = metadata.outputTokens
  const cacheReadTokens = metadata.cacheReadTokens

  
  
  const itps =
    ttftMs !== undefined && promptTokens !== undefined && ttftMs > 0
      ? Math.round((promptTokens / (ttftMs / 1000)) * 100) / 100
      : undefined

  
  const samplingMs =
    ttltMs !== undefined && ttftMs !== undefined ? ttltMs - ttftMs : undefined
  const otps =
    samplingMs !== undefined && outputTokens !== undefined && samplingMs > 0
      ? Math.round((outputTokens / (samplingMs / 1000)) * 100) / 100
      : undefined

  
  const cacheHitRate =
    cacheReadTokens !== undefined &&
    promptTokens !== undefined &&
    promptTokens > 0
      ? Math.round((cacheReadTokens / promptTokens) * 10000) / 100
      : undefined

  const requestSetupMs = metadata.requestSetupMs
  const attemptStartTimes = metadata.attemptStartTimes

  
  const args = {
    ...pending.args,
    ttft_ms: ttftMs,
    ttlt_ms: ttltMs,
    prompt_tokens: promptTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_creation_tokens: metadata.cacheCreationTokens,
    message_id: metadata.messageId ?? pending.args.message_id,
    success: metadata.success ?? true,
    error: metadata.error,
    duration_ms: duration / 1000,
    request_setup_ms: requestSetupMs,
    
    itps,
    otps,
    cache_hit_rate_pct: cacheHitRate,
  }

  
  
  const setupUs =
    requestSetupMs !== undefined && requestSetupMs > 0
      ? requestSetupMs * 1000
      : 0
  if (setupUs > 0) {
    const setupEndTs = pending.startTime + setupUs

    events.push({
      name: 'Request Setup',
      cat: 'api,setup',
      ph: 'B',
      ts: pending.startTime,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        request_setup_ms: requestSetupMs,
        attempt_count: attemptStartTimes?.length ?? 1,
      },
    })

    
    
    if (attemptStartTimes && attemptStartTimes.length > 1) {
      
      
      const baseWallMs = attemptStartTimes[0]!
      for (let i = 0; i < attemptStartTimes.length - 1; i++) {
        const attemptStartUs =
          pending.startTime + (attemptStartTimes[i]! - baseWallMs) * 1000
        const attemptEndUs =
          pending.startTime + (attemptStartTimes[i + 1]! - baseWallMs) * 1000

        events.push({
          name: `Attempt ${i + 1} (retry)`,
          cat: 'api,retry',
          ph: 'B',
          ts: attemptStartUs,
          pid: pending.agentInfo.processId,
          tid: pending.agentInfo.threadId,
          args: { attempt: i + 1 },
        })
        events.push({
          name: `Attempt ${i + 1} (retry)`,
          cat: 'api,retry',
          ph: 'E',
          ts: attemptEndUs,
          pid: pending.agentInfo.processId,
          tid: pending.agentInfo.threadId,
        })
      }
    }

    events.push({
      name: 'Request Setup',
      cat: 'api,setup',
      ph: 'E',
      ts: setupEndTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
    })
  }

  
  
  if (ttftMs !== undefined) {
    
    const firstTokenStartTs = pending.startTime + setupUs
    const firstTokenEndTs = firstTokenStartTs + ttftMs * 1000

    
    events.push({
      name: 'First Token',
      cat: 'api,ttft',
      ph: 'B',
      ts: firstTokenStartTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        ttft_ms: ttftMs,
        prompt_tokens: promptTokens,
        itps,
        cache_hit_rate_pct: cacheHitRate,
      },
    })
    events.push({
      name: 'First Token',
      cat: 'api,ttft',
      ph: 'E',
      ts: firstTokenEndTs,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
    })

    
    
    
    
    const actualSamplingMs =
      ttltMs !== undefined ? ttltMs - ttftMs - setupUs / 1000 : undefined
    if (actualSamplingMs !== undefined && actualSamplingMs > 0) {
      events.push({
        name: 'Sampling',
        cat: 'api,sampling',
        ph: 'B',
        ts: firstTokenEndTs,
        pid: pending.agentInfo.processId,
        tid: pending.agentInfo.threadId,
        args: {
          sampling_ms: actualSamplingMs,
          output_tokens: outputTokens,
          otps,
        },
      })
      events.push({
        name: 'Sampling',
        cat: 'api,sampling',
        ph: 'E',
        ts: firstTokenEndTs + actualSamplingMs * 1000,
        pid: pending.agentInfo.processId,
        tid: pending.agentInfo.threadId,
      })
    }
  }

  
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  pendingSpans.delete(spanId)
}

export function startToolPerfettoSpan(
  toolName: string,
  args?: Record<string, unknown>,
): string {
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: `Tool: ${toolName}`,
    category: 'tool',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      tool_name: toolName,
      ...args,
    },
  })

  
  events.push({
    name: `Tool: ${toolName}`,
    cat: 'tool',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

export function endToolPerfettoSpan(
  spanId: string,
  metadata?: {
    success?: boolean
    error?: string
    resultTokens?: number
  },
): void {
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  const args = {
    ...pending.args,
    success: metadata?.success ?? true,
    error: metadata?.error,
    result_tokens: metadata?.resultTokens,
    duration_ms: duration / 1000,
  }

  
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  pendingSpans.delete(spanId)
}

export function startUserInputPerfettoSpan(context?: string): string {
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: 'Waiting for User Input',
    category: 'user_input',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      context,
    },
  })

  
  events.push({
    name: 'Waiting for User Input',
    cat: 'user_input',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

export function endUserInputPerfettoSpan(
  spanId: string,
  metadata?: {
    decision?: string
    source?: string
  },
): void {
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  const args = {
    ...pending.args,
    decision: metadata?.decision,
    source: metadata?.source,
    duration_ms: duration / 1000,
  }

  
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args,
  })

  pendingSpans.delete(spanId)
}

export function emitPerfettoInstant(
  name: string,
  category: string,
  args?: Record<string, unknown>,
): void {
  if (!isEnabled) return

  const agentInfo = getCurrentAgentInfo()

  events.push({
    name,
    cat: category,
    ph: 'i',
    ts: getTimestamp(),
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args,
  })
}

export function emitPerfettoCounter(
  name: string,
  values: Record<string, number>,
): void {
  if (!isEnabled) return

  const agentInfo = getCurrentAgentInfo()

  events.push({
    name,
    cat: 'counter',
    ph: 'C',
    ts: getTimestamp(),
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: values,
  })
}

export function startInteractionPerfettoSpan(userPrompt?: string): string {
  if (!isEnabled) return ''

  const spanId = generateSpanId()
  const agentInfo = getCurrentAgentInfo()

  pendingSpans.set(spanId, {
    name: 'Interaction',
    category: 'interaction',
    startTime: getTimestamp(),
    agentInfo,
    args: {
      user_prompt_length: userPrompt?.length,
    },
  })

  
  events.push({
    name: 'Interaction',
    cat: 'interaction',
    ph: 'B',
    ts: pendingSpans.get(spanId)!.startTime,
    pid: agentInfo.processId,
    tid: agentInfo.threadId,
    args: pendingSpans.get(spanId)!.args,
  })

  return spanId
}

export function endInteractionPerfettoSpan(spanId: string): void {
  if (!isEnabled || !spanId) return

  const pending = pendingSpans.get(spanId)
  if (!pending) return

  const endTime = getTimestamp()
  const duration = endTime - pending.startTime

  
  events.push({
    name: pending.name,
    cat: pending.category,
    ph: 'E',
    ts: endTime,
    pid: pending.agentInfo.processId,
    tid: pending.agentInfo.threadId,
    args: {
      ...pending.args,
      duration_ms: duration / 1000,
    },
  })

  pendingSpans.delete(spanId)
}

function stopWriteInterval(): void {
  if (staleSpanCleanupId) {
    clearInterval(staleSpanCleanupId)
    staleSpanCleanupId = null
  }
  if (writeIntervalId) {
    clearInterval(writeIntervalId)
    writeIntervalId = null
  }
}

function closeOpenSpans(): void {
  for (const [spanId, pending] of pendingSpans) {
    const endTime = getTimestamp()
    events.push({
      name: pending.name,
      cat: pending.category,
      ph: 'E',
      ts: endTime,
      pid: pending.agentInfo.processId,
      tid: pending.agentInfo.threadId,
      args: {
        ...pending.args,
        incomplete: true,
        duration_ms: (endTime - pending.startTime) / 1000,
      },
    })
    pendingSpans.delete(spanId)
  }
}

async function periodicWrite(): Promise<void> {
  if (!isEnabled || !tracePath || traceWritten) return

  try {
    await mkdir(dirname(tracePath), { recursive: true })
    await writeFile(tracePath, buildTraceDocument())
    logForDebugging(
      `[Perfetto] Periodic write: ${events.length} events to ${tracePath}`,
    )
  } catch (error) {
    logForDebugging(
      `[Perfetto] Periodic write failed: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

async function writePerfettoTrace(): Promise<void> {
  if (!isEnabled || !tracePath || traceWritten) {
    logForDebugging(
      `[Perfetto] Skipping final write: isEnabled=${isEnabled}, tracePath=${tracePath}, traceWritten=${traceWritten}`,
    )
    return
  }

  stopWriteInterval()
  closeOpenSpans()

  logForDebugging(
    `[Perfetto] writePerfettoTrace called: events=${events.length}`,
  )

  try {
    await mkdir(dirname(tracePath), { recursive: true })
    await writeFile(tracePath, buildTraceDocument())
    traceWritten = true
    logForDebugging(`[Perfetto] Trace finalized at: ${tracePath}`)
  } catch (error) {
    logForDebugging(
      `[Perfetto] Failed to write final trace: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

function writePerfettoTraceSync(): void {
  if (!isEnabled || !tracePath || traceWritten) {
    logForDebugging(
      `[Perfetto] Skipping final sync write: isEnabled=${isEnabled}, tracePath=${tracePath}, traceWritten=${traceWritten}`,
    )
    return
  }

  stopWriteInterval()
  closeOpenSpans()

  logForDebugging(
    `[Perfetto] writePerfettoTraceSync called: events=${events.length}`,
  )

  try {
    const dir = dirname(tracePath)
    
    mkdirSync(dir, { recursive: true })
    
    writeFileSync(tracePath, buildTraceDocument())
    traceWritten = true
    logForDebugging(`[Perfetto] Trace finalized synchronously at: ${tracePath}`)
  } catch (error) {
    logForDebugging(
      `[Perfetto] Failed to write final trace synchronously: ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

export function getPerfettoEvents(): TraceEvent[] {
  return [...metadataEvents, ...events]
}

export function resetPerfettoTracer(): void {
  if (staleSpanCleanupId) {
    clearInterval(staleSpanCleanupId)
    staleSpanCleanupId = null
  }
  stopWriteInterval()
  metadataEvents.length = 0
  events.length = 0
  pendingSpans.clear()
  agentRegistry.clear()
  agentIdToProcessId.clear()
  totalAgentCount = 0
  processIdCounter = 1
  spanIdCounter = 0
  isEnabled = false
  tracePath = null
  startTimeMs = 0
  traceWritten = false
}

export async function triggerPeriodicWriteForTesting(): Promise<void> {
  await periodicWrite()
}

export function evictStaleSpansForTesting(): void {
  evictStaleSpans()
}

export const MAX_EVENTS_FOR_TESTING = MAX_EVENTS
export function evictOldestEventsForTesting(): void {
  evictOldestEvents()
}
