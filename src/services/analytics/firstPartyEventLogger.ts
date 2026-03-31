import type { AnyValueMap, Logger, logs } from '@opentelemetry/api-logs'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { randomUUID } from 'crypto'
import { isEqual } from 'lodash-es'
import { getOrCreateUserID } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { getPlatform, getWslVersion } from '../../utils/platform.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { profileCheckpoint } from '../../utils/startupProfiler.js'
import { getCoreUserData } from '../../utils/user.js'
import { isAnalyticsDisabled } from './config.js'
import { FirstPartyEventLoggingExporter } from './firstPartyEventLoggingExporter.js'
import type { GrowthBookUserAttributes } from './growthbook.js'
import { getDynamicConfig_CACHED_MAY_BE_STALE } from './growthbook.js'
import { getEventMetadata } from './metadata.js'
import { isSinkKilled } from './sinkKillswitch.js'

export type EventSamplingConfig = {
  [eventName: string]: {
    sample_rate: number
  }
}

const EVENT_SAMPLING_CONFIG_NAME = 'tengu_event_sampling_config'

export function getEventSamplingConfig(): EventSamplingConfig {
  return getDynamicConfig_CACHED_MAY_BE_STALE<EventSamplingConfig>(
    EVENT_SAMPLING_CONFIG_NAME,
    {},
  )
}

export function shouldSampleEvent(eventName: string): number | null {
  const config = getEventSamplingConfig()
  const eventConfig = config[eventName]

  
  if (!eventConfig) {
    return null
  }

  const sampleRate = eventConfig.sample_rate

  
  if (typeof sampleRate !== 'number' || sampleRate < 0 || sampleRate > 1) {
    return null
  }

  
  if (sampleRate >= 1) {
    return null
  }

  
  if (sampleRate <= 0) {
    return 0
  }

  
  return Math.random() < sampleRate ? sampleRate : 0
}

const BATCH_CONFIG_NAME = 'tengu_1p_event_batch_config'
type BatchConfig = {
  scheduledDelayMillis?: number
  maxExportBatchSize?: number
  maxQueueSize?: number
  skipAuth?: boolean
  maxAttempts?: number
  path?: string
  baseUrl?: string
}
function getBatchConfig(): BatchConfig {
  return getDynamicConfig_CACHED_MAY_BE_STALE<BatchConfig>(
    BATCH_CONFIG_NAME,
    {},
  )
}

let firstPartyEventLogger: ReturnType<typeof logs.getLogger> | null = null
let firstPartyEventLoggerProvider: LoggerProvider | null = null

let lastBatchConfig: BatchConfig | null = null

export async function shutdown1PEventLogging(): Promise<void> {
  if (!firstPartyEventLoggerProvider) {
    return
  }
  try {
    await firstPartyEventLoggerProvider.shutdown()
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging('1P event logging: final shutdown complete')
    }
  } catch {
    
  }
}

export function is1PEventLoggingEnabled(): boolean {
  
  return !isAnalyticsDisabled()
}

async function logEventTo1PAsync(
  firstPartyEventLogger: Logger,
  eventName: string,
  metadata: Record<string, number | boolean | undefined> = {},
): Promise<void> {
  try {
    
    const coreMetadata = await getEventMetadata({
      model: metadata.model,
      betas: metadata.betas,
    })

    
    
    
    const attributes = {
      event_name: eventName,
      event_id: randomUUID(),
      
      core_metadata: coreMetadata,
      user_metadata: getCoreUserData(true),
      event_metadata: metadata,
    } as unknown as AnyValueMap

    
    const userId = getOrCreateUserID()
    if (userId) {
      attributes.user_id = userId
    }

    
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `[ANT-ONLY] 1P event: ${eventName} ${jsonStringify(metadata, null, 0)}`,
      )
    }

    
    firstPartyEventLogger.emit({
      body: eventName,
      attributes,
    })
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      throw e
    }
    if (process.env.USER_TYPE === 'ant') {
      logError(e as Error)
    }
    
  }
}

export function logEventTo1P(
  eventName: string,
  metadata: Record<string, number | boolean | undefined> = {},
): void {
  if (!is1PEventLoggingEnabled()) {
    return
  }

  if (!firstPartyEventLogger || isSinkKilled('firstParty')) {
    return
  }

  
  void logEventTo1PAsync(firstPartyEventLogger, eventName, metadata)
}

export type GrowthBookExperimentData = {
  experimentId: string
  variationId: number
  userAttributes?: GrowthBookUserAttributes
  experimentMetadata?: Record<string, unknown>
}

function getEnvironmentForGrowthBook(): string {
  return 'production'
}

export function logGrowthBookExperimentTo1P(
  data: GrowthBookExperimentData,
): void {
  if (!is1PEventLoggingEnabled()) {
    return
  }

  if (!firstPartyEventLogger || isSinkKilled('firstParty')) {
    return
  }

  const userId = getOrCreateUserID()
  const { accountUuid, organizationUuid } = getCoreUserData(true)

  
  const attributes = {
    event_type: 'GrowthbookExperimentEvent',
    event_id: randomUUID(),
    experiment_id: data.experimentId,
    variation_id: data.variationId,
    ...(userId && { device_id: userId }),
    ...(accountUuid && { account_uuid: accountUuid }),
    ...(organizationUuid && { organization_uuid: organizationUuid }),
    ...(data.userAttributes && {
      session_id: data.userAttributes.sessionId,
      user_attributes: jsonStringify(data.userAttributes),
    }),
    ...(data.experimentMetadata && {
      experiment_metadata: jsonStringify(data.experimentMetadata),
    }),
    environment: getEnvironmentForGrowthBook(),
  }

  if (process.env.USER_TYPE === 'ant') {
    logForDebugging(
      `[ANT-ONLY] 1P GrowthBook experiment: ${data.experimentId} variation=${data.variationId}`,
    )
  }

  firstPartyEventLogger.emit({
    body: 'growthbook_experiment',
    attributes,
  })
}

const DEFAULT_LOGS_EXPORT_INTERVAL_MS = 10000
const DEFAULT_MAX_EXPORT_BATCH_SIZE = 200
const DEFAULT_MAX_QUEUE_SIZE = 8192

export function initialize1PEventLogging(): void {
  profileCheckpoint('1p_event_logging_start')
  const enabled = is1PEventLoggingEnabled()

  if (!enabled) {
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging('1P event logging not enabled')
    }
    return
  }

  
  
  const batchConfig = getBatchConfig()
  lastBatchConfig = batchConfig
  profileCheckpoint('1p_event_after_growthbook_config')

  const scheduledDelayMillis =
    batchConfig.scheduledDelayMillis ||
    parseInt(
      process.env.OTEL_LOGS_EXPORT_INTERVAL ||
        DEFAULT_LOGS_EXPORT_INTERVAL_MS.toString(),
    )

  const maxExportBatchSize =
    batchConfig.maxExportBatchSize || DEFAULT_MAX_EXPORT_BATCH_SIZE

  const maxQueueSize = batchConfig.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE

  
  const platform = getPlatform()
  const attributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: 'claude-code-next',
    [ATTR_SERVICE_VERSION]: MACRO.VERSION,
  }

  
  if (platform === 'wsl') {
    const wslVersion = getWslVersion()
    if (wslVersion) {
      attributes['wsl.version'] = wslVersion
    }
  }

  const resource = resourceFromAttributes(attributes)

  
  
  
  
  const eventLoggingExporter = new FirstPartyEventLoggingExporter({
    maxBatchSize: maxExportBatchSize,
    skipAuth: batchConfig.skipAuth,
    maxAttempts: batchConfig.maxAttempts,
    path: batchConfig.path,
    baseUrl: batchConfig.baseUrl,
    isKilled: () => isSinkKilled('firstParty'),
  })
  firstPartyEventLoggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor(eventLoggingExporter, {
        scheduledDelayMillis,
        maxExportBatchSize,
        maxQueueSize,
      }),
    ],
  })

  
  
  
  
  firstPartyEventLogger = firstPartyEventLoggerProvider.getLogger(
    'com.anthropic.claude_code_next.events',
    MACRO.VERSION,
  )
}

export async function reinitialize1PEventLoggingIfConfigChanged(): Promise<void> {
  if (!is1PEventLoggingEnabled() || !firstPartyEventLoggerProvider) {
    return
  }

  const newConfig = getBatchConfig()

  if (isEqual(newConfig, lastBatchConfig)) {
    return
  }

  if (process.env.USER_TYPE === 'ant') {
    logForDebugging(
      `1P event logging: ${BATCH_CONFIG_NAME} changed, reinitializing`,
    )
  }

  const oldProvider = firstPartyEventLoggerProvider
  const oldLogger = firstPartyEventLogger
  firstPartyEventLogger = null

  try {
    await oldProvider.forceFlush()
  } catch {
    
  }

  firstPartyEventLoggerProvider = null
  try {
    initialize1PEventLogging()
  } catch (e) {
    
    
    
    
    firstPartyEventLoggerProvider = oldProvider
    firstPartyEventLogger = oldLogger
    logError(e)
    return
  }

  void oldProvider.shutdown().catch(() => {})
}
