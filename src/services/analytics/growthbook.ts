import { GrowthBook } from '@growthbook/growthbook'
import { isEqual, memoize } from 'lodash-es'
import {
  getIsNonInteractiveSession,
  getSessionTrustAccepted,
} from '../../bootstrap/state.js'
import { getGrowthBookClientKey } from '../../constants/keys.js'
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { getAuthHeaders } from '../../utils/http.js'
import { logError } from '../../utils/log.js'
import { createSignal } from '../../utils/signal.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type GitHubActionsMetadata,
  getUserForGrowthBook,
} from '../../utils/user.js'
import {
  is1PEventLoggingEnabled,
  logGrowthBookExperimentTo1P,
} from './firstPartyEventLogger.js'

export type GrowthBookUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
  github?: GitHubActionsMetadata
}

type MalformedFeatureDefinition = {
  value?: unknown
  defaultValue?: unknown
  [key: string]: unknown
}

let client: GrowthBook | null = null

let currentBeforeExitHandler: (() => void) | null = null
let currentExitHandler: (() => void) | null = null

let clientCreatedWithAuth = false

type StoredExperimentData = {
  experimentId: string
  variationId: number
  inExperiment?: boolean
  hashAttribute?: string
  hashValue?: string
}
const experimentDataByFeature = new Map<string, StoredExperimentData>()

const remoteEvalFeatureValues = new Map<string, unknown>()

const pendingExposures = new Set<string>()

const loggedExposures = new Set<string>()

let reinitializingPromise: Promise<unknown> | null = null

type GrowthBookRefreshListener = () => void | Promise<void>
const refreshed = createSignal()

function callSafe(listener: GrowthBookRefreshListener): void {
  try {
    
    
    
    
    
    void Promise.resolve(listener()).catch(e => {
      logError(e)
    })
  } catch (e) {
    logError(e)
  }
}

export function onGrowthBookRefresh(
  listener: GrowthBookRefreshListener,
): () => void {
  let subscribed = true
  const unsubscribe = refreshed.subscribe(() => callSafe(listener))
  if (remoteEvalFeatureValues.size > 0) {
    queueMicrotask(() => {
      
      
      if (subscribed && remoteEvalFeatureValues.size > 0) {
        callSafe(listener)
      }
    })
  }
  return () => {
    subscribed = false
    unsubscribe()
  }
}

let envOverrides: Record<string, unknown> | null = null
let envOverridesParsed = false

function getEnvOverrides(): Record<string, unknown> | null {
  if (!envOverridesParsed) {
    envOverridesParsed = true
    if (process.env.USER_TYPE === 'ant') {
      const raw = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
      if (raw) {
        try {
          envOverrides = JSON.parse(raw) as Record<string, unknown>
          logForDebugging(
            `GrowthBook: Using env var overrides for ${Object.keys(envOverrides!).length} features: ${Object.keys(envOverrides!).join(', ')}`,
          )
        } catch {
          logError(
            new Error(
              `GrowthBook: Failed to parse CLAUDE_INTERNAL_FC_OVERRIDES: ${raw}`,
            ),
          )
        }
      }
    }
  }
  return envOverrides
}

export function hasGrowthBookEnvOverride(feature: string): boolean {
  const overrides = getEnvOverrides()
  return overrides !== null && feature in overrides
}

function getConfigOverrides(): Record<string, unknown> | undefined {
  if (process.env.USER_TYPE !== 'ant') return undefined
  try {
    return getGlobalConfig().growthBookOverrides
  } catch {
    
    
    return undefined
  }
}

export function getAllGrowthBookFeatures(): Record<string, unknown> {
  if (remoteEvalFeatureValues.size > 0) {
    return Object.fromEntries(remoteEvalFeatureValues)
  }
  return getGlobalConfig().cachedGrowthBookFeatures ?? {}
}

export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return getConfigOverrides() ?? {}
}

export function setGrowthBookConfigOverride(
  feature: string,
  value: unknown,
): void {
  if (process.env.USER_TYPE !== 'ant') return
  try {
    saveGlobalConfig(c => {
      const current = c.growthBookOverrides ?? {}
      if (value === undefined) {
        if (!(feature in current)) return c
        const { [feature]: _, ...rest } = current
        if (Object.keys(rest).length === 0) {
          const { growthBookOverrides: __, ...configWithout } = c
          return configWithout
        }
        return { ...c, growthBookOverrides: rest }
      }
      if (isEqual(current[feature], value)) return c
      return { ...c, growthBookOverrides: { ...current, [feature]: value } }
    })
    
    
    refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

export function clearGrowthBookConfigOverrides(): void {
  if (process.env.USER_TYPE !== 'ant') return
  try {
    saveGlobalConfig(c => {
      if (
        !c.growthBookOverrides ||
        Object.keys(c.growthBookOverrides).length === 0
      ) {
        return c
      }
      const { growthBookOverrides: _, ...rest } = c
      return rest
    })
    refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

function logExposureForFeature(feature: string): void {
  
  if (loggedExposures.has(feature)) {
    return
  }

  const expData = experimentDataByFeature.get(feature)
  if (expData) {
    loggedExposures.add(feature)
    logGrowthBookExperimentTo1P({
      experimentId: expData.experimentId,
      variationId: expData.variationId,
      userAttributes: getUserAttributes(),
      experimentMetadata: {
        feature_id: feature,
      },
    })
  }
}

async function processRemoteEvalPayload(
  gbClient: GrowthBook,
): Promise<boolean> {
  
  
  
  const payload = gbClient.getPayload()
  
  
  
  
  if (!payload?.features || Object.keys(payload.features).length === 0) {
    return false
  }

  
  
  experimentDataByFeature.clear()

  const transformedFeatures: Record<string, MalformedFeatureDefinition> = {}
  for (const [key, feature] of Object.entries(payload.features)) {
    const f = feature as MalformedFeatureDefinition
    if ('value' in f && !('defaultValue' in f)) {
      transformedFeatures[key] = {
        ...f,
        defaultValue: f.value,
      }
    } else {
      transformedFeatures[key] = f
    }

    
    if (f.source === 'experiment' && f.experimentResult) {
      const expResult = f.experimentResult as {
        variationId?: number
      }
      const exp = f.experiment as { key?: string } | undefined
      if (exp?.key && expResult.variationId !== undefined) {
        experimentDataByFeature.set(key, {
          experimentId: exp.key,
          variationId: expResult.variationId,
        })
      }
    }
  }
  
  await gbClient.setPayload({
    ...payload,
    features: transformedFeatures,
  })

  
  
  
  
  remoteEvalFeatureValues.clear()
  for (const [key, feature] of Object.entries(transformedFeatures)) {
    
    
    
    
    const v = 'value' in feature ? feature.value : feature.defaultValue
    if (v !== undefined) {
      remoteEvalFeatureValues.set(key, v)
    }
  }
  return true
}

function syncRemoteEvalToDisk(): void {
  const fresh = Object.fromEntries(remoteEvalFeatureValues)
  const config = getGlobalConfig()
  if (isEqual(config.cachedGrowthBookFeatures, fresh)) {
    return
  }
  saveGlobalConfig(current => ({
    ...current,
    cachedGrowthBookFeatures: fresh,
  }))
}

function isGrowthBookEnabled(): boolean {
  
  return is1PEventLoggingEnabled()
}

export function getApiBaseUrlHost(): string | undefined {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) return undefined
  try {
    const host = new URL(baseUrl).host
    if (host === 'api.anthropic.com') return undefined
    return host
  } catch {
    return undefined
  }
}

function getUserAttributes(): GrowthBookUserAttributes {
  const user = getUserForGrowthBook()

  
  
  let email = user.email
  if (!email && process.env.USER_TYPE === 'ant') {
    email = getGlobalConfig().oauthAccount?.emailAddress
  }

  const apiBaseUrlHost = getApiBaseUrlHost()

  const attributes = {
    id: user.deviceId,
    sessionId: user.sessionId,
    deviceID: user.deviceId,
    platform: user.platform,
    ...(apiBaseUrlHost && { apiBaseUrlHost }),
    ...(user.organizationUuid && { organizationUUID: user.organizationUuid }),
    ...(user.accountUuid && { accountUUID: user.accountUuid }),
    ...(user.userType && { userType: user.userType }),
    ...(user.subscriptionType && { subscriptionType: user.subscriptionType }),
    ...(user.rateLimitTier && { rateLimitTier: user.rateLimitTier }),
    ...(user.firstTokenTime && { firstTokenTime: user.firstTokenTime }),
    ...(email && { email }),
    ...(user.appVersion && { appVersion: user.appVersion }),
    ...(user.githubActionsMetadata && {
      githubActionsMetadata: user.githubActionsMetadata,
    }),
  }
  return attributes
}

const getGrowthBookClient = memoize(
  (): { client: GrowthBook; initialized: Promise<void> } | null => {
    if (!isGrowthBookEnabled()) {
      return null
    }

    const attributes = getUserAttributes()
    const clientKey = getGrowthBookClientKey()
    if (process.env.USER_TYPE === 'ant') {
      logForDebugging(
        `GrowthBook: Creating client with clientKey=${clientKey}, attributes: ${jsonStringify(attributes)}`,
      )
    }
    const baseUrl =
      process.env.USER_TYPE === 'ant'
        ? process.env.CLAUDE_CODE_NEXT_GB_BASE_URL || 'https://api.anthropic.com/'
        : 'https://api.anthropic.com/'

    
    
    
    
    
    
    const hasTrust =
      checkHasTrustDialogAccepted() ||
      getSessionTrustAccepted() ||
      getIsNonInteractiveSession()
    const authHeaders = hasTrust
      ? getAuthHeaders()
      : { headers: {}, error: 'trust not established' }
    const hasAuth = !authHeaders.error
    clientCreatedWithAuth = hasAuth

    
    
    const thisClient = new GrowthBook({
      apiHost: baseUrl,
      clientKey,
      attributes,
      remoteEval: true,
      
      cacheKeyAttributes: ['id', 'organizationUUID'],
      
      ...(authHeaders.error
        ? {}
        : { apiHostRequestHeaders: authHeaders.headers }),
      
      ...(process.env.USER_TYPE === 'ant'
        ? {
            log: (msg: string, ctx: Record<string, unknown>) => {
              logForDebugging(`GrowthBook: ${msg} ${jsonStringify(ctx)}`)
            },
          }
        : {}),
    })
    client = thisClient

    if (!hasAuth) {
      
      
      return { client: thisClient, initialized: Promise.resolve() }
    }

    const initialized = thisClient
      .init({ timeout: 5000 })
      .then(async result => {
        
        if (client !== thisClient) {
          if (process.env.USER_TYPE === 'ant') {
            logForDebugging(
              'GrowthBook: Skipping init callback for replaced client',
            )
          }
          return
        }

        if (process.env.USER_TYPE === 'ant') {
          logForDebugging(
            `GrowthBook initialized successfully, source: ${result.source}, success: ${result.success}`,
          )
        }

        const hadFeatures = await processRemoteEvalPayload(thisClient)
        
        
        
        
        if (client !== thisClient) return

        if (hadFeatures) {
          for (const feature of pendingExposures) {
            logExposureForFeature(feature)
          }
          pendingExposures.clear()
          syncRemoteEvalToDisk()
          
          
          
          refreshed.emit()
        }

        
        if (process.env.USER_TYPE === 'ant') {
          const features = thisClient.getFeatures()
          if (features) {
            const featureKeys = Object.keys(features)
            logForDebugging(
              `GrowthBook loaded ${featureKeys.length} features: ${featureKeys.slice(0, 10).join(', ')}${featureKeys.length > 10 ? '...' : ''}`,
            )
          }
        }
      })
      .catch(error => {
        if (process.env.USER_TYPE === 'ant') {
          logError(toError(error))
        }
      })

    
    currentBeforeExitHandler = () => client?.destroy()
    currentExitHandler = () => client?.destroy()
    process.on('beforeExit', currentBeforeExitHandler)
    process.on('exit', currentExitHandler)

    return { client: thisClient, initialized }
  },
)

export const initializeGrowthBook = memoize(
  async (): Promise<GrowthBook | null> => {
    let clientWrapper = getGrowthBookClient()
    if (!clientWrapper) {
      return null
    }

    
    
    
    if (!clientCreatedWithAuth) {
      const hasTrust =
        checkHasTrustDialogAccepted() ||
        getSessionTrustAccepted() ||
        getIsNonInteractiveSession()
      if (hasTrust) {
        const currentAuth = getAuthHeaders()
        if (!currentAuth.error) {
          if (process.env.USER_TYPE === 'ant') {
            logForDebugging(
              'GrowthBook: Auth became available after client creation, reinitializing',
            )
          }
          
          
          resetGrowthBook()
          clientWrapper = getGrowthBookClient()
          if (!clientWrapper) {
            return null
          }
        }
      }
    }

    await clientWrapper.initialized

    
    
    setupPeriodicGrowthBookRefresh()

    return clientWrapper.client
  },
)

async function getFeatureValueInternal<T>(
  feature: string,
  defaultValue: T,
  logExposure: boolean,
): Promise<T> {
  
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return overrides[feature] as T
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return configOverrides[feature] as T
  }

  if (!isGrowthBookEnabled()) {
    return defaultValue
  }

  const growthBookClient = await initializeGrowthBook()
  if (!growthBookClient) {
    return defaultValue
  }

  
  let result: T
  if (remoteEvalFeatureValues.has(feature)) {
    result = remoteEvalFeatureValues.get(feature) as T
  } else {
    result = growthBookClient.getFeatureValue(feature, defaultValue) as T
  }

  
  if (logExposure) {
    logExposureForFeature(feature)
  }

  if (process.env.USER_TYPE === 'ant') {
    logForDebugging(
      `GrowthBook: getFeatureValue("${feature}") = ${jsonStringify(result)}`,
    )
  }
  return result
}

export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValueInternal(feature, defaultValue, true)
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return overrides[feature] as T
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return configOverrides[feature] as T
  }

  if (!isGrowthBookEnabled()) {
    return defaultValue
  }

  
  if (experimentDataByFeature.has(feature)) {
    logExposureForFeature(feature)
  } else {
    pendingExposures.add(feature)
  }

  
  
  
  
  
  if (remoteEvalFeatureValues.has(feature)) {
    return remoteEvalFeatureValues.get(feature) as T
  }

  
  try {
    const cached = getGlobalConfig().cachedGrowthBookFeatures?.[feature]
    return cached !== undefined ? (cached as T) : defaultValue
  } catch {
    return defaultValue
  }
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    return false
  }

  
  if (experimentDataByFeature.has(gate)) {
    logExposureForFeature(gate)
  } else {
    pendingExposures.add(gate)
  }

  
  
  const config = getGlobalConfig()
  const gbCached = config.cachedGrowthBookFeatures?.[gate]
  if (gbCached !== undefined) {
    return Boolean(gbCached)
  }
  
  return config.cachedStatsigGates?.[gate] ?? false
}

export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    return false
  }

  
  
  if (reinitializingPromise) {
    await reinitializingPromise
  }

  
  const config = getGlobalConfig()
  const statsigCached = config.cachedStatsigGates?.[gate]
  if (statsigCached !== undefined) {
    return Boolean(statsigCached)
  }

  
  const gbCached = config.cachedGrowthBookFeatures?.[gate]
  if (gbCached !== undefined) {
    return Boolean(gbCached)
  }

  
  return false
}

export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    return false
  }

  
  const cached = getGlobalConfig().cachedGrowthBookFeatures?.[gate]
  if (cached === true) {
    
    if (experimentDataByFeature.has(gate)) {
      logExposureForFeature(gate)
    } else {
      pendingExposures.add(gate)
    }
    return true
  }

  
  return getFeatureValueInternal(gate, false, true)
}

export function refreshGrowthBookAfterAuthChange(): void {
  if (!isGrowthBookEnabled()) {
    return
  }

  try {
    
    
    resetGrowthBook()

    
    
    
    
    
    
    refreshed.emit()

    
    
    
    
    
    
    
    reinitializingPromise = initializeGrowthBook()
      .catch(error => {
        logError(toError(error))
        return null
      })
      .finally(() => {
        reinitializingPromise = null
      })
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      throw error
    }
    logError(toError(error))
  }
}

export function resetGrowthBook(): void {
  stopPeriodicGrowthBookRefresh()
  
  if (currentBeforeExitHandler) {
    process.off('beforeExit', currentBeforeExitHandler)
    currentBeforeExitHandler = null
  }
  if (currentExitHandler) {
    process.off('exit', currentExitHandler)
    currentExitHandler = null
  }
  client?.destroy()
  client = null
  clientCreatedWithAuth = false
  reinitializingPromise = null
  experimentDataByFeature.clear()
  pendingExposures.clear()
  loggedExposures.clear()
  remoteEvalFeatureValues.clear()
  getGrowthBookClient.cache?.clear?.()
  initializeGrowthBook.cache?.clear?.()
  envOverrides = null
  envOverridesParsed = false
}

const GROWTHBOOK_REFRESH_INTERVAL_MS =
  process.env.USER_TYPE !== 'ant'
    ? 6 * 60 * 60 * 1000 
    : 20 * 60 * 1000 
let refreshInterval: ReturnType<typeof setInterval> | null = null
let beforeExitListener: (() => void) | null = null

export async function refreshGrowthBookFeatures(): Promise<void> {
  if (!isGrowthBookEnabled()) {
    return
  }

  try {
    const growthBookClient = await initializeGrowthBook()
    if (!growthBookClient) {
      return
    }

    await growthBookClient.refreshFeatures()

    
    
    
    if (growthBookClient !== client) {
      if (process.env.USER_TYPE === 'ant') {
        logForDebugging(
          'GrowthBook: Skipping refresh processing for replaced client',
        )
      }
      return
    }

    
    
    
    const hadFeatures = await processRemoteEvalPayload(growthBookClient)
    
    
    if (growthBookClient !== client) return

    if (process.env.USER_TYPE === 'ant') {
      logForDebugging('GrowthBook: Light refresh completed')
    }

    
    
    
    
    if (hadFeatures) {
      syncRemoteEvalToDisk()
      refreshed.emit()
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      throw error
    }
    logError(toError(error))
  }
}

export function setupPeriodicGrowthBookRefresh(): void {
  if (!isGrowthBookEnabled()) {
    return
  }

  
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }

  refreshInterval = setInterval(() => {
    void refreshGrowthBookFeatures()
  }, GROWTHBOOK_REFRESH_INTERVAL_MS)
  
  refreshInterval.unref?.()

  
  if (!beforeExitListener) {
    beforeExitListener = () => {
      stopPeriodicGrowthBookRefresh()
    }
    process.once('beforeExit', beforeExitListener)
  }
}

export function stopPeriodicGrowthBookRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval)
    refreshInterval = null
  }
  if (beforeExitListener) {
    process.removeListener('beforeExit', beforeExitListener)
    beforeExitListener = null
  }
}

export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValue_DEPRECATED(configName, defaultValue)
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(configName, defaultValue)
}
