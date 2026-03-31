import { getSessionId } from '../bootstrap/state.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import type { SessionId } from '../types/ids.js'
import { isEnvTruthy } from '../utils/envUtils.js'

export type QueryConfig = {
  sessionId: SessionId

  
  gates: {
    
    
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}

export function buildQueryConfig(): QueryConfig {
  return {
    sessionId: getSessionId(),
    gates: {
      streamingToolExecution: checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
        'tengu_streaming_tool_execution2',
      ),
      emitToolUseSummaries: isEnvTruthy(
        process.env.CLAUDE_CODE_NEXT_EMIT_TOOL_USE_SUMMARIES,
      ),
      isAnt: process.env.USER_TYPE === 'ant',
      
      
      
      fastModeEnabled: !isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_FAST_MODE),
    },
  }
}
