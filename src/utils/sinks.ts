import { initializeAnalyticsSink } from '../services/analytics/sink.js'
import { initializeErrorLogSink } from './errorLogSink.js'

export function initSinks(): void {
  initializeErrorLogSink()
  initializeAnalyticsSink()
}
