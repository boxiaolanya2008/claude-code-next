

import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { getPerformance } from './profilerBase.js'
import { jsonStringify } from './slowOperations.js'

const DETAILED_PROFILING = isEnvTruthy(process.env.CLAUDE_CODE_NEXT_PROFILE_STARTUP)

const STATSIG_SAMPLE_RATE = 0.05

const STATSIG_LOGGING_SAMPLED =
  process.env.USER_TYPE === 'ant' || Math.random() < STATSIG_SAMPLE_RATE

const SHOULD_PROFILE = DETAILED_PROFILING || STATSIG_LOGGING_SAMPLED

const MARK_PREFIX = 'headless_'

let currentTurnNumber = -1

function clearHeadlessMarks(): void {
  const perf = getPerformance()
  const allMarks = perf.getEntriesByType('mark')
  for (const mark of allMarks) {
    if (mark.name.startsWith(MARK_PREFIX)) {
      perf.clearMarks(mark.name)
    }
  }
}

export function headlessProfilerStartTurn(): void {
  
  if (!getIsNonInteractiveSession()) return
  
  if (!SHOULD_PROFILE) return

  currentTurnNumber++
  clearHeadlessMarks()

  const perf = getPerformance()
  perf.mark(`${MARK_PREFIX}turn_start`)

  if (DETAILED_PROFILING) {
    logForDebugging(`[headlessProfiler] Started turn ${currentTurnNumber}`)
  }
}

export function headlessProfilerCheckpoint(name: string): void {
  
  if (!getIsNonInteractiveSession()) return
  
  if (!SHOULD_PROFILE) return

  const perf = getPerformance()
  perf.mark(`${MARK_PREFIX}${name}`)

  if (DETAILED_PROFILING) {
    logForDebugging(
      `[headlessProfiler] Checkpoint: ${name} at ${perf.now().toFixed(1)}ms`,
    )
  }
}

export function logHeadlessProfilerTurn(): void {
  
  if (!getIsNonInteractiveSession()) return
  
  if (!SHOULD_PROFILE) return

  const perf = getPerformance()
  const allMarks = perf.getEntriesByType('mark')

  
  const marks = allMarks.filter(mark => mark.name.startsWith(MARK_PREFIX))
  if (marks.length === 0) return

  
  const checkpointTimes = new Map<string, number>()
  for (const mark of marks) {
    const name = mark.name.slice(MARK_PREFIX.length)
    checkpointTimes.set(name, mark.startTime)
  }

  const turnStart = checkpointTimes.get('turn_start')
  if (turnStart === undefined) return

  
  const metadata: Record<string, number | string | undefined> = {
    turn_number: currentTurnNumber,
  }

  
  
  const systemMessageTime = checkpointTimes.get('system_message_yielded')
  if (systemMessageTime !== undefined && currentTurnNumber === 0) {
    metadata.time_to_system_message_ms = Math.round(systemMessageTime)
  }

  
  const queryStartTime = checkpointTimes.get('query_started')
  if (queryStartTime !== undefined) {
    metadata.time_to_query_start_ms = Math.round(queryStartTime - turnStart)
  }

  
  const firstChunkTime = checkpointTimes.get('first_chunk')
  if (firstChunkTime !== undefined) {
    metadata.time_to_first_response_ms = Math.round(firstChunkTime - turnStart)
  }

  
  const apiRequestTime = checkpointTimes.get('api_request_sent')
  if (queryStartTime !== undefined && apiRequestTime !== undefined) {
    metadata.query_overhead_ms = Math.round(apiRequestTime - queryStartTime)
  }

  
  metadata.checkpoint_count = marks.length

  
  if (process.env.CLAUDE_CODE_NEXT_ENTRYPOINT) {
    metadata.entrypoint = process.env.CLAUDE_CODE_NEXT_ENTRYPOINT
  }

  
  if (STATSIG_LOGGING_SAMPLED) {
    logEvent(
      'tengu_headless_latency',
      metadata as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    )
  }

  
  if (DETAILED_PROFILING) {
    logForDebugging(
      `[headlessProfiler] Turn ${currentTurnNumber} metrics: ${jsonStringify(metadata)}`,
    )
  }
}
