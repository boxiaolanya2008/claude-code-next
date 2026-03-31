

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  let result: Record<string, V> | undefined
  for (const key in metadata) {
    if (key.startsWith('_PROTO_')) {
      if (result === undefined) {
        result = { ...metadata }
      }
      delete result[key]
    }
  }
  return result ?? metadata
}

type LogEventMetadata = { [key: string]: boolean | number | undefined }

type QueuedEvent = {
  eventName: string
  metadata: LogEventMetadata
  async: boolean
}

export type AnalyticsSink = {
  logEvent: (eventName: string, metadata: LogEventMetadata) => void
  logEventAsync: (
    eventName: string,
    metadata: LogEventMetadata,
  ) => Promise<void>
}

const eventQueue: QueuedEvent[] = []

let sink: AnalyticsSink | null = null

export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  if (sink !== null) {
    return
  }
  sink = newSink

  
  if (eventQueue.length > 0) {
    const queuedEvents = [...eventQueue]
    eventQueue.length = 0

    
    if (process.env.USER_TYPE === 'ant') {
      sink.logEvent('analytics_sink_attached', {
        queued_event_count: queuedEvents.length,
      })
    }

    queueMicrotask(() => {
      for (const event of queuedEvents) {
        if (event.async) {
          void sink!.logEventAsync(event.eventName, event.metadata)
        } else {
          sink!.logEvent(event.eventName, event.metadata)
        }
      }
    })
  }
}

export function logEvent(
  eventName: string,
  
  
  metadata: LogEventMetadata,
): void {
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: false })
    return
  }
  sink.logEvent(eventName, metadata)
}

export async function logEventAsync(
  eventName: string,
  
  metadata: LogEventMetadata,
): Promise<void> {
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: true })
    return
  }
  await sink.logEventAsync(eventName, metadata)
}

export function _resetForTesting(): void {
  sink = null
  eventQueue.length = 0
}
