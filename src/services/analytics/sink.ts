

import { trackDatadogEvent } from './datadog.js'
import { logEventTo1P, shouldSampleEvent } from './firstPartyEventLogger.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from './growthbook.js'
import { attachAnalyticsSink, stripProtoFields } from './index.js'
import { isSinkKilled } from './sinkKillswitch.js'

type LogEventMetadata = { [key: string]: boolean | number | undefined }

const DATADOG_GATE_NAME = 'tengu_log_datadog_events'

let isDatadogGateEnabled: boolean | undefined = undefined

function shouldTrackDatadog(): boolean {
  if (isSinkKilled('datadog')) {
    return false
  }
  if (isDatadogGateEnabled !== undefined) {
    return isDatadogGateEnabled
  }

  
  try {
    return checkStatsigFeatureGate_CACHED_MAY_BE_STALE(DATADOG_GATE_NAME)
  } catch {
    return false
  }
}

function logEventImpl(eventName: string, metadata: LogEventMetadata): void {
  
  const sampleResult = shouldSampleEvent(eventName)

  
  if (sampleResult === 0) {
    return
  }

  
  const metadataWithSampleRate =
    sampleResult !== null
      ? { ...metadata, sample_rate: sampleResult }
      : metadata

  if (shouldTrackDatadog()) {
    
    
    void trackDatadogEvent(eventName, stripProtoFields(metadataWithSampleRate))
  }

  
  
  logEventTo1P(eventName, metadataWithSampleRate)
}

function logEventAsyncImpl(
  eventName: string,
  metadata: LogEventMetadata,
): Promise<void> {
  logEventImpl(eventName, metadata)
  return Promise.resolve()
}

export function initializeAnalyticsGates(): void {
  isDatadogGateEnabled =
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE(DATADOG_GATE_NAME)
}

export function initializeAnalyticsSink(): void {
  attachAnalyticsSink({
    logEvent: logEventImpl,
    logEventAsync: logEventAsyncImpl,
  })
}
