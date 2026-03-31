import chalk from 'chalk'
import { exec } from 'child_process'
import { execa } from 'execa'
import { mkdir, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import { CLAUDE_AI_PROFILE_SCOPE } from 'src/constants/oauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getModelStrings } from 'src/utils/model/modelStrings.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import {
  getIsNonInteractiveSession,
  preferThirdPartyAuthentication,
} from '../bootstrap/state.js'
import {
  getMockSubscriptionType,
  shouldUseMockSubscription,
} from '../services/mockRateLimits.js'
import {
  isOAuthTokenExpired,
  refreshOAuthToken,
  shouldUseClaudeAIAuth,
} from '../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../services/oauth/getOauthProfile.js'
import type { OAuthTokens, SubscriptionType } from '../services/oauth/types.js'
import {
  getApiKeyFromFileDescriptor,
  getOAuthTokenFromFileDescriptor,
} from './authFileDescriptor.js'
import {
  maybeRemoveApiKeyFromMacOSKeychainThrows,
  normalizeApiKeyForConfig,
} from './authPortable.js'
import {
  checkStsCallerIdentity,
  clearAwsIniCache,
  isValidAwsStsOutput,
} from './aws.js'
import { AwsAuthStatusManager } from './awsAuthStatusManager.js'
import { clearBetasCaches } from './betas.js'
import {
  type AccountInfo,
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from './config.js'
import { logAntError, logForDebugging } from './debug.js'
import {
  getClaudeConfigHomeDir,
  isBareMode,
  isEnvTruthy,
  isRunningOnHomespace,
} from './envUtils.js'
import { errorMessage } from './errors.js'
import { execSyncWithDefaults_DEPRECATED } from './execFileNoThrow.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { memoizeWithTTLAsync } from './memoize.js'
import { getSecureStorage } from './secureStorage/index.js'
import {
  clearLegacyApiKeyPrefetch,
  getLegacyApiKeyPrefetchResult,
} from './secureStorage/keychainPrefetch.js'
import {
  clearKeychainCache,
  getMacOsKeychainStorageServiceName,
  getUsername,
} from './secureStorage/macOsKeychainHelpers.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from './settings/settings.js'
import { sleep } from './sleep.js'
import { jsonParse } from './slowOperations.js'
import { clearToolSchemaCache } from './toolSchemaCache.js'

const DEFAULT_API_KEY_HELPER_TTL = 5 * 60 * 1000

function isManagedOAuthContext(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE) ||
    process.env.CLAUDE_CODE_NEXT_ENTRYPOINT === 'claude-desktop'
  )
}

export function isAnthropicAuthEnabled(): boolean {
  
  if (isBareMode()) return false

  
  
  
  
  
  
  
  if (process.env.ANTHROPIC_UNIX_SOCKET) {
    return !!process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN
  }

  const is3P =
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_FOUNDRY)

  
  
  const settings = getSettings_DEPRECATED() || {}
  const apiKeyHelper = settings.apiKeyHelper
  const hasExternalAuthToken =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    apiKeyHelper ||
    process.env.CLAUDE_CODE_NEXT_API_KEY_FILE_DESCRIPTOR

  
  const { source: apiKeySource } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  const hasExternalApiKey =
    apiKeySource === 'ANTHROPIC_API_KEY' || apiKeySource === 'apiKeyHelper'

  
  
  
  
  
  
  
  const shouldDisableAuth =
    is3P ||
    (hasExternalAuthToken && !isManagedOAuthContext()) ||
    (hasExternalApiKey && !isManagedOAuthContext())

  return !shouldDisableAuth
}

export function getAuthTokenSource() {
  
  
  
  if (isBareMode()) {
    if (getConfiguredApiKeyHelper()) {
      return { source: 'apiKeyHelper' as const, hasToken: true }
    }
    return { source: 'none' as const, hasToken: false }
  }

  if (process.env.ANTHROPIC_AUTH_TOKEN && !isManagedOAuthContext()) {
    return { source: 'ANTHROPIC_AUTH_TOKEN' as const, hasToken: true }
  }

  if (process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN) {
    return { source: 'CLAUDE_CODE_NEXT_OAUTH_TOKEN' as const, hasToken: true }
  }

  
  const oauthTokenFromFd = getOAuthTokenFromFileDescriptor()
  if (oauthTokenFromFd) {
    
    
    
    
    
    
    if (process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN_FILE_DESCRIPTOR) {
      return {
        source: 'CLAUDE_CODE_NEXT_OAUTH_TOKEN_FILE_DESCRIPTOR' as const,
        hasToken: true,
      }
    }
    return {
      source: 'CCR_OAUTH_TOKEN_FILE' as const,
      hasToken: true,
    }
  }

  
  
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (apiKeyHelper && !isManagedOAuthContext()) {
    return { source: 'apiKeyHelper' as const, hasToken: true }
  }

  const oauthTokens = getClaudeAIOAuthTokens()
  if (shouldUseClaudeAIAuth(oauthTokens?.scopes) && oauthTokens?.accessToken) {
    return { source: 'claude.ai' as const, hasToken: true }
  }

  return { source: 'none' as const, hasToken: false }
}

export type ApiKeySource =
  | 'ANTHROPIC_API_KEY'
  | 'apiKeyHelper'
  | '/login managed key'
  | 'none'

export function getAnthropicApiKey(): null | string {
  const { key } = getAnthropicApiKeyWithSource()
  return key
}

export function hasAnthropicApiKeyAuth(): boolean {
  const { key, source } = getAnthropicApiKeyWithSource({
    skipRetrievingKeyFromApiKeyHelper: true,
  })
  return key !== null && source !== 'none'
}

export function getAnthropicApiKeyWithSource(
  opts: { skipRetrievingKeyFromApiKeyHelper?: boolean } = {},
): {
  key: null | string
  source: ApiKeySource
} {
  
  
  
  if (isBareMode()) {
    if (process.env.ANTHROPIC_API_KEY) {
      return { key: process.env.ANTHROPIC_API_KEY, source: 'ANTHROPIC_API_KEY' }
    }
    if (getConfiguredApiKeyHelper()) {
      return {
        key: opts.skipRetrievingKeyFromApiKeyHelper
          ? null
          : getApiKeyFromApiKeyHelperCached(),
        source: 'apiKeyHelper',
      }
    }
    return { key: null, source: 'none' }
  }

  
  
  const apiKeyEnv = isRunningOnHomespace()
    ? undefined
    : process.env.ANTHROPIC_API_KEY

  
  
  if (preferThirdPartyAuthentication() && apiKeyEnv) {
    return {
      key: apiKeyEnv,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  if (isEnvTruthy(process.env.CI) || process.env.NODE_ENV === 'test') {
    
    const apiKeyFromFd = getApiKeyFromFileDescriptor()
    if (apiKeyFromFd) {
      return {
        key: apiKeyFromFd,
        source: 'ANTHROPIC_API_KEY',
      }
    }

    if (
      !apiKeyEnv &&
      !process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN &&
      !process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN_FILE_DESCRIPTOR
    ) {
      throw new Error(
        'ANTHROPIC_API_KEY or CLAUDE_CODE_NEXT_OAUTH_TOKEN env var is required',
      )
    }

    if (apiKeyEnv) {
      return {
        key: apiKeyEnv,
        source: 'ANTHROPIC_API_KEY',
      }
    }

    
    return {
      key: null,
      source: 'none',
    }
  }
  
  if (
    apiKeyEnv &&
    getGlobalConfig().customApiKeyResponses?.approved?.includes(
      normalizeApiKeyForConfig(apiKeyEnv),
    )
  ) {
    return {
      key: apiKeyEnv,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  
  const apiKeyFromFd = getApiKeyFromFileDescriptor()
  if (apiKeyFromFd) {
    return {
      key: apiKeyFromFd,
      source: 'ANTHROPIC_API_KEY',
    }
  }

  
  const apiKeyHelperCommand = getConfiguredApiKeyHelper()
  if (apiKeyHelperCommand) {
    if (opts.skipRetrievingKeyFromApiKeyHelper) {
      return {
        key: null,
        source: 'apiKeyHelper',
      }
    }
    
    
    
    
    return {
      key: getApiKeyFromApiKeyHelperCached(),
      source: 'apiKeyHelper',
    }
  }

  const apiKeyFromConfigOrMacOSKeychain = getApiKeyFromConfigOrMacOSKeychain()
  if (apiKeyFromConfigOrMacOSKeychain) {
    return apiKeyFromConfigOrMacOSKeychain
  }

  return {
    key: null,
    source: 'none',
  }
}

export function getConfiguredApiKeyHelper(): string | undefined {
  if (isBareMode()) {
    return getSettingsForSource('flagSettings')?.apiKeyHelper
  }
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.apiKeyHelper
}

function isApiKeyHelperFromProjectOrLocalSettings(): boolean {
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (!apiKeyHelper) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.apiKeyHelper === apiKeyHelper ||
    localSettings?.apiKeyHelper === apiKeyHelper
  )
}

function getConfiguredAwsAuthRefresh(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.awsAuthRefresh
}

export function isAwsAuthRefreshFromProjectSettings(): boolean {
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()
  if (!awsAuthRefresh) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.awsAuthRefresh === awsAuthRefresh ||
    localSettings?.awsAuthRefresh === awsAuthRefresh
  )
}

function getConfiguredAwsCredentialExport(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.awsCredentialExport
}

export function isAwsCredentialExportFromProjectSettings(): boolean {
  const awsCredentialExport = getConfiguredAwsCredentialExport()
  if (!awsCredentialExport) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.awsCredentialExport === awsCredentialExport ||
    localSettings?.awsCredentialExport === awsCredentialExport
  )
}

export function calculateApiKeyHelperTTL(): number {
  const envTtl = process.env.CLAUDE_CODE_NEXT_API_KEY_HELPER_TTL_MS

  if (envTtl) {
    const parsed = parseInt(envTtl, 10)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed
    }
    logForDebugging(
      `Found CLAUDE_CODE_NEXT_API_KEY_HELPER_TTL_MS env var, but it was not a valid number. Got ${envTtl}`,
      { level: 'error' },
    )
  }

  return DEFAULT_API_KEY_HELPER_TTL
}

let _apiKeyHelperCache: { value: string; timestamp: number } | null = null
let _apiKeyHelperInflight: {
  promise: Promise<string | null>
  
  startedAt: number | null
} | null = null
let _apiKeyHelperEpoch = 0

export function getApiKeyHelperElapsedMs(): number {
  const startedAt = _apiKeyHelperInflight?.startedAt
  return startedAt ? Date.now() - startedAt : 0
}

export async function getApiKeyFromApiKeyHelper(
  isNonInteractiveSession: boolean,
): Promise<string | null> {
  if (!getConfiguredApiKeyHelper()) return null
  const ttl = calculateApiKeyHelperTTL()
  if (_apiKeyHelperCache) {
    if (Date.now() - _apiKeyHelperCache.timestamp < ttl) {
      return _apiKeyHelperCache.value
    }
    
    
    if (!_apiKeyHelperInflight) {
      _apiKeyHelperInflight = {
        promise: _runAndCache(
          isNonInteractiveSession,
          false,
          _apiKeyHelperEpoch,
        ),
        startedAt: null,
      }
    }
    return _apiKeyHelperCache.value
  }
  
  if (_apiKeyHelperInflight) return _apiKeyHelperInflight.promise
  _apiKeyHelperInflight = {
    promise: _runAndCache(isNonInteractiveSession, true, _apiKeyHelperEpoch),
    startedAt: Date.now(),
  }
  return _apiKeyHelperInflight.promise
}

async function _runAndCache(
  isNonInteractiveSession: boolean,
  isCold: boolean,
  epoch: number,
): Promise<string | null> {
  try {
    const value = await _executeApiKeyHelper(isNonInteractiveSession)
    if (epoch !== _apiKeyHelperEpoch) return value
    if (value !== null) {
      _apiKeyHelperCache = { value, timestamp: Date.now() }
    }
    return value
  } catch (e) {
    if (epoch !== _apiKeyHelperEpoch) return ' '
    const detail = e instanceof Error ? e.message : String(e)
    
    console.error(chalk.red(`apiKeyHelper failed: ${detail}`))
    logForDebugging(`Error getting API key from apiKeyHelper: ${detail}`, {
      level: 'error',
    })
    
    
    
    if (!isCold && _apiKeyHelperCache && _apiKeyHelperCache.value !== ' ') {
      _apiKeyHelperCache = { ..._apiKeyHelperCache, timestamp: Date.now() }
      return _apiKeyHelperCache.value
    }
    
    _apiKeyHelperCache = { value: ' ', timestamp: Date.now() }
    return ' '
  } finally {
    if (epoch === _apiKeyHelperEpoch) {
      _apiKeyHelperInflight = null
    }
  }
}

async function _executeApiKeyHelper(
  isNonInteractiveSession: boolean,
): Promise<string | null> {
  const apiKeyHelper = getConfiguredApiKeyHelper()
  if (!apiKeyHelper) {
    return null
  }

  if (isApiKeyHelperFromProjectOrLocalSettings()) {
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !isNonInteractiveSession) {
      const error = new Error(
        `Security: apiKeyHelper executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('apiKeyHelper invoked before trust check', error)
      logEvent('tengu_apiKeyHelper_missing_trust11', {})
      return null
    }
  }

  const result = await execa(apiKeyHelper, {
    shell: true,
    timeout: 10 * 60 * 1000,
    reject: false,
  })
  if (result.failed) {
    
    const why = result.timedOut ? 'timed out' : `exited ${result.exitCode}`
    const stderr = result.stderr?.trim()
    throw new Error(stderr ? `${why}: ${stderr}` : why)
  }
  const stdout = result.stdout?.trim()
  if (!stdout) {
    throw new Error('did not return a value')
  }
  return stdout
}

export function getApiKeyFromApiKeyHelperCached(): string | null {
  return _apiKeyHelperCache?.value ?? null
}

export function clearApiKeyHelperCache(): void {
  _apiKeyHelperEpoch++
  _apiKeyHelperCache = null
  _apiKeyHelperInflight = null
}

export function prefetchApiKeyFromApiKeyHelperIfSafe(
  isNonInteractiveSession: boolean,
): void {
  
  
  if (
    isApiKeyHelperFromProjectOrLocalSettings() &&
    !checkHasTrustDialogAccepted()
  ) {
    return
  }
  void getApiKeyFromApiKeyHelper(isNonInteractiveSession)
}

const DEFAULT_AWS_STS_TTL = 60 * 60 * 1000

async function runAwsAuthRefresh(): Promise<boolean> {
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()

  if (!awsAuthRefresh) {
    return false 
  }

  
  if (isAwsAuthRefreshFromProjectSettings()) {
    
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: awsAuthRefresh executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('awsAuthRefresh invoked before trust check', error)
      logEvent('tengu_awsAuthRefresh_missing_trust', {})
      return false
    }
  }

  try {
    logForDebugging('Fetching AWS caller identity for AWS auth refresh command')
    await checkStsCallerIdentity()
    logForDebugging(
      'Fetched AWS caller identity, skipping AWS auth refresh command',
    )
    return false
  } catch {
    
    return refreshAwsAuth(awsAuthRefresh)
  }
}

const AWS_AUTH_REFRESH_TIMEOUT_MS = 3 * 60 * 1000

export function refreshAwsAuth(awsAuthRefresh: string): Promise<boolean> {
  logForDebugging('Running AWS auth refresh command')
  
  const authStatusManager = AwsAuthStatusManager.getInstance()
  authStatusManager.startAuthentication()

  return new Promise(resolve => {
    const refreshProc = exec(awsAuthRefresh, {
      timeout: AWS_AUTH_REFRESH_TIMEOUT_MS,
    })
    refreshProc.stdout!.on('data', data => {
      const output = data.toString().trim()
      if (output) {
        
        authStatusManager.addOutput(output)
        
        logForDebugging(output, { level: 'debug' })
      }
    })

    refreshProc.stderr!.on('data', data => {
      const error = data.toString().trim()
      if (error) {
        authStatusManager.setError(error)
        logForDebugging(error, { level: 'error' })
      }
    })

    refreshProc.on('close', (code, signal) => {
      if (code === 0) {
        logForDebugging('AWS auth refresh completed successfully')
        authStatusManager.endAuthentication(true)
        void resolve(true)
      } else {
        const timedOut = signal === 'SIGTERM'
        const message = timedOut
          ? chalk.red(
              'AWS auth refresh timed out after 3 minutes. Run your auth command manually in a separate terminal.',
            )
          : chalk.red(
              'Error running awsAuthRefresh (in settings or ~/.claude.json):',
            )
        
        console.error(message)
        authStatusManager.endAuthentication(false)
        void resolve(false)
      }
    })
  })
}

async function getAwsCredsFromCredentialExport(): Promise<{
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
} | null> {
  const awsCredentialExport = getConfiguredAwsCredentialExport()

  if (!awsCredentialExport) {
    return null
  }

  
  if (isAwsCredentialExportFromProjectSettings()) {
    
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: awsCredentialExport executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('awsCredentialExport invoked before trust check', error)
      logEvent('tengu_awsCredentialExport_missing_trust', {})
      return null
    }
  }

  try {
    logForDebugging(
      'Fetching AWS caller identity for credential export command',
    )
    await checkStsCallerIdentity()
    logForDebugging(
      'Fetched AWS caller identity, skipping AWS credential export command',
    )
    return null
  } catch {
    
    try {
      logForDebugging('Running AWS credential export command')
      const result = await execa(awsCredentialExport, {
        shell: true,
        reject: false,
      })
      if (result.exitCode !== 0 || !result.stdout) {
        throw new Error('awsCredentialExport did not return a valid value')
      }

      
      const awsOutput = jsonParse(result.stdout.trim())

      if (!isValidAwsStsOutput(awsOutput)) {
        throw new Error(
          'awsCredentialExport did not return valid AWS STS output structure',
        )
      }

      logForDebugging('AWS credentials retrieved from awsCredentialExport')
      return {
        accessKeyId: awsOutput.Credentials.AccessKeyId,
        secretAccessKey: awsOutput.Credentials.SecretAccessKey,
        sessionToken: awsOutput.Credentials.SessionToken,
      }
    } catch (e) {
      const message = chalk.red(
        'Error getting AWS credentials from awsCredentialExport (in settings or ~/.claude.json):',
      )
      if (e instanceof Error) {
        
        console.error(message, e.message)
      } else {
        
        console.error(message, e)
      }
      return null
    }
  }
}

export const refreshAndGetAwsCredentials = memoizeWithTTLAsync(
  async (): Promise<{
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
  } | null> => {
    
    const refreshed = await runAwsAuthRefresh()

    
    const credentials = await getAwsCredsFromCredentialExport()

    
    if (refreshed || credentials) {
      await clearAwsIniCache()
    }

    return credentials
  },
  DEFAULT_AWS_STS_TTL,
)

export function clearAwsCredentialsCache(): void {
  refreshAndGetAwsCredentials.cache.clear()
}

function getConfiguredGcpAuthRefresh(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.gcpAuthRefresh
}

export function isGcpAuthRefreshFromProjectSettings(): boolean {
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()
  if (!gcpAuthRefresh) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.gcpAuthRefresh === gcpAuthRefresh ||
    localSettings?.gcpAuthRefresh === gcpAuthRefresh
  )
}

const GCP_CREDENTIALS_CHECK_TIMEOUT_MS = 5_000

export async function checkGcpCredentialsValid(): Promise<boolean> {
  try {
    
    const { GoogleAuth } = await import('google-auth-library')
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const probe = (async () => {
      const client = await auth.getClient()
      await client.getAccessToken()
    })()
    const timeout = sleep(GCP_CREDENTIALS_CHECK_TIMEOUT_MS).then(() => {
      throw new GcpCredentialsTimeoutError('GCP credentials check timed out')
    })
    await Promise.race([probe, timeout])
    return true
  } catch {
    return false
  }
}

const DEFAULT_GCP_CREDENTIAL_TTL = 60 * 60 * 1000

async function runGcpAuthRefresh(): Promise<boolean> {
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()

  if (!gcpAuthRefresh) {
    return false 
  }

  
  if (isGcpAuthRefreshFromProjectSettings()) {
    
    
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      const error = new Error(
        `Security: gcpAuthRefresh executed before workspace trust is confirmed. If you see this message, post in ${MACRO.FEEDBACK_CHANNEL}.`,
      )
      logAntError('gcpAuthRefresh invoked before trust check', error)
      logEvent('tengu_gcpAuthRefresh_missing_trust', {})
      return false
    }
  }

  try {
    logForDebugging('Checking GCP credentials validity for auth refresh')
    const isValid = await checkGcpCredentialsValid()
    if (isValid) {
      logForDebugging(
        'GCP credentials are valid, skipping auth refresh command',
      )
      return false
    }
  } catch {
    
  }

  return refreshGcpAuth(gcpAuthRefresh)
}

const GCP_AUTH_REFRESH_TIMEOUT_MS = 3 * 60 * 1000

export function refreshGcpAuth(gcpAuthRefresh: string): Promise<boolean> {
  logForDebugging('Running GCP auth refresh command')
  
  
  const authStatusManager = AwsAuthStatusManager.getInstance()
  authStatusManager.startAuthentication()

  return new Promise(resolve => {
    const refreshProc = exec(gcpAuthRefresh, {
      timeout: GCP_AUTH_REFRESH_TIMEOUT_MS,
    })
    refreshProc.stdout!.on('data', data => {
      const output = data.toString().trim()
      if (output) {
        
        authStatusManager.addOutput(output)
        
        logForDebugging(output, { level: 'debug' })
      }
    })

    refreshProc.stderr!.on('data', data => {
      const error = data.toString().trim()
      if (error) {
        authStatusManager.setError(error)
        logForDebugging(error, { level: 'error' })
      }
    })

    refreshProc.on('close', (code, signal) => {
      if (code === 0) {
        logForDebugging('GCP auth refresh completed successfully')
        authStatusManager.endAuthentication(true)
        void resolve(true)
      } else {
        const timedOut = signal === 'SIGTERM'
        const message = timedOut
          ? chalk.red(
              'GCP auth refresh timed out after 3 minutes. Run your auth command manually in a separate terminal.',
            )
          : chalk.red(
              'Error running gcpAuthRefresh (in settings or ~/.claude.json):',
            )
        
        console.error(message)
        authStatusManager.endAuthentication(false)
        void resolve(false)
      }
    })
  })
}

export const refreshGcpCredentialsIfNeeded = memoizeWithTTLAsync(
  async (): Promise<boolean> => {
    
    const refreshed = await runGcpAuthRefresh()
    return refreshed
  },
  DEFAULT_GCP_CREDENTIAL_TTL,
)

export function clearGcpCredentialsCache(): void {
  refreshGcpCredentialsIfNeeded.cache.clear()
}

export function prefetchGcpCredentialsIfSafe(): void {
  
  const gcpAuthRefresh = getConfiguredGcpAuthRefresh()

  if (!gcpAuthRefresh) {
    return
  }

  
  if (isGcpAuthRefreshFromProjectSettings()) {
    
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      
      return
    }
  }

  
  void refreshGcpCredentialsIfNeeded()
}

export function prefetchAwsCredentialsAndBedRockInfoIfSafe(): void {
  
  const awsAuthRefresh = getConfiguredAwsAuthRefresh()
  const awsCredentialExport = getConfiguredAwsCredentialExport()

  if (!awsAuthRefresh && !awsCredentialExport) {
    return
  }

  
  if (
    isAwsAuthRefreshFromProjectSettings() ||
    isAwsCredentialExportFromProjectSettings()
  ) {
    
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust && !getIsNonInteractiveSession()) {
      
      return
    }
  }

  
  void refreshAndGetAwsCredentials()
  getModelStrings()
}

export const getApiKeyFromConfigOrMacOSKeychain = memoize(
  (): { key: string; source: ApiKeySource } | null => {
    if (isBareMode()) return null
    
    if (process.platform === 'darwin') {
      
      
      
      const prefetch = getLegacyApiKeyPrefetchResult()
      if (prefetch) {
        if (prefetch.stdout) {
          return { key: prefetch.stdout, source: '/login managed key' }
        }
        
      } else {
        const storageServiceName = getMacOsKeychainStorageServiceName()
        try {
          const result = execSyncWithDefaults_DEPRECATED(
            `security find-generic-password -a $USER -w -s "${storageServiceName}"`,
          )
          if (result) {
            return { key: result, source: '/login managed key' }
          }
        } catch (e) {
          logError(e)
        }
      }
    }

    const config = getGlobalConfig()
    if (!config.primaryApiKey) {
      return null
    }

    return { key: config.primaryApiKey, source: '/login managed key' }
  },
)

function isValidApiKey(apiKey: string): boolean {
  
  return /^[a-zA-Z0-9-_]+$/.test(apiKey)
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (!isValidApiKey(apiKey)) {
    throw new Error(
      'Invalid API key format. API key must contain only alphanumeric characters, dashes, and underscores.',
    )
  }

  
  await maybeRemoveApiKeyFromMacOSKeychain()
  let savedToKeychain = false
  if (process.platform === 'darwin') {
    try {
      
      const storageServiceName = getMacOsKeychainStorageServiceName()
      const username = getUsername()

      
      const hexValue = Buffer.from(apiKey, 'utf-8').toString('hex')

      
      
      
      const command = `add-generic-password -U -a "${username}" -s "${storageServiceName}" -X "${hexValue}"\n`

      await execa('security', ['-i'], {
        input: command,
        reject: false,
      })

      logEvent('tengu_api_key_saved_to_keychain', {})
      savedToKeychain = true
    } catch (e) {
      logError(e)
      logEvent('tengu_api_key_keychain_error', {
        error: errorMessage(
          e,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logEvent('tengu_api_key_saved_to_config', {})
    }
  } else {
    logEvent('tengu_api_key_saved_to_config', {})
  }

  const normalizedKey = normalizeApiKeyForConfig(apiKey)

  
  saveGlobalConfig(current => {
    const approved = current.customApiKeyResponses?.approved ?? []
    return {
      ...current,
      
      primaryApiKey: savedToKeychain ? current.primaryApiKey : apiKey,
      customApiKeyResponses: {
        ...current.customApiKeyResponses,
        approved: approved.includes(normalizedKey)
          ? approved
          : [...approved, normalizedKey],
        rejected: current.customApiKeyResponses?.rejected ?? [],
      },
    }
  })

  
  getApiKeyFromConfigOrMacOSKeychain.cache.clear?.()
  clearLegacyApiKeyPrefetch()
}

export function isCustomApiKeyApproved(apiKey: string): boolean {
  const config = getGlobalConfig()
  const normalizedKey = normalizeApiKeyForConfig(apiKey)
  return (
    config.customApiKeyResponses?.approved?.includes(normalizedKey) ?? false
  )
}

export async function removeApiKey(): Promise<void> {
  await maybeRemoveApiKeyFromMacOSKeychain()

  
  
  saveGlobalConfig(current => ({
    ...current,
    primaryApiKey: undefined,
  }))

  
  getApiKeyFromConfigOrMacOSKeychain.cache.clear?.()
  clearLegacyApiKeyPrefetch()
}

async function maybeRemoveApiKeyFromMacOSKeychain(): Promise<void> {
  try {
    await maybeRemoveApiKeyFromMacOSKeychainThrows()
  } catch (e) {
    logError(e)
  }
}

export function saveOAuthTokensIfNeeded(tokens: OAuthTokens): {
  success: boolean
  warning?: string
} {
  if (!shouldUseClaudeAIAuth(tokens.scopes)) {
    logEvent('tengu_oauth_tokens_not_claude_ai', {})
    return { success: true }
  }

  
  if (!tokens.refreshToken || !tokens.expiresAt) {
    logEvent('tengu_oauth_tokens_inference_only', {})
    return { success: true }
  }

  const secureStorage = getSecureStorage()
  const storageBackend =
    secureStorage.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

  try {
    const storageData = secureStorage.read() || {}
    const existingOauth = storageData.claudeAiOauth

    storageData.claudeAiOauth = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes,
      
      
      
      subscriptionType:
        tokens.subscriptionType ?? existingOauth?.subscriptionType ?? null,
      rateLimitTier:
        tokens.rateLimitTier ?? existingOauth?.rateLimitTier ?? null,
    }

    const updateStatus = secureStorage.update(storageData)

    if (updateStatus.success) {
      logEvent('tengu_oauth_tokens_saved', { storageBackend })
    } else {
      logEvent('tengu_oauth_tokens_save_failed', { storageBackend })
    }

    getClaudeAIOAuthTokens.cache?.clear?.()
    clearBetasCaches()
    clearToolSchemaCache()
    return updateStatus
  } catch (error) {
    logError(error)
    logEvent('tengu_oauth_tokens_save_exception', {
      storageBackend,
      error: errorMessage(
        error,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return { success: false, warning: 'Failed to save OAuth tokens' }
  }
}

export const getClaudeAIOAuthTokens = memoize((): OAuthTokens | null => {
  
  if (isBareMode()) return null

  
  if (process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN) {
    
    return {
      accessToken: process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN,
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
      subscriptionType: null,
      rateLimitTier: null,
    }
  }

  
  const oauthTokenFromFd = getOAuthTokenFromFileDescriptor()
  if (oauthTokenFromFd) {
    
    return {
      accessToken: oauthTokenFromFd,
      refreshToken: null,
      expiresAt: null,
      scopes: ['user:inference'],
      subscriptionType: null,
      rateLimitTier: null,
    }
  }

  try {
    const secureStorage = getSecureStorage()
    const storageData = secureStorage.read()
    const oauthData = storageData?.claudeAiOauth

    if (!oauthData?.accessToken) {
      return null
    }

    return oauthData
  } catch (error) {
    logError(error)
    return null
  }
})

export function clearOAuthTokenCache(): void {
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearKeychainCache()
}

let lastCredentialsMtimeMs = 0

async function invalidateOAuthCacheIfDiskChanged(): Promise<void> {
  try {
    const { mtimeMs } = await stat(
      join(getClaudeConfigHomeDir(), '.credentials.json'),
    )
    if (mtimeMs !== lastCredentialsMtimeMs) {
      lastCredentialsMtimeMs = mtimeMs
      clearOAuthTokenCache()
    }
  } catch {
    
    
    
    
    getClaudeAIOAuthTokens.cache?.clear?.()
  }
}

const pending401Handlers = new Map<string, Promise<boolean>>()

export function handleOAuth401Error(
  failedAccessToken: string,
): Promise<boolean> {
  const pending = pending401Handlers.get(failedAccessToken)
  if (pending) return pending

  const promise = handleOAuth401ErrorImpl(failedAccessToken).finally(() => {
    pending401Handlers.delete(failedAccessToken)
  })
  pending401Handlers.set(failedAccessToken, promise)
  return promise
}

async function handleOAuth401ErrorImpl(
  failedAccessToken: string,
): Promise<boolean> {
  
  clearOAuthTokenCache()
  const currentTokens = await getClaudeAIOAuthTokensAsync()

  if (!currentTokens?.refreshToken) {
    return false
  }

  
  if (currentTokens.accessToken !== failedAccessToken) {
    logEvent('tengu_oauth_401_recovered_from_keychain', {})
    return true
  }

  
  return checkAndRefreshOAuthTokenIfNeeded(0, true)
}

export async function getClaudeAIOAuthTokensAsync(): Promise<OAuthTokens | null> {
  if (isBareMode()) return null

  
  if (
    process.env.CLAUDE_CODE_NEXT_OAUTH_TOKEN ||
    getOAuthTokenFromFileDescriptor()
  ) {
    return getClaudeAIOAuthTokens()
  }

  try {
    const secureStorage = getSecureStorage()
    const storageData = await secureStorage.readAsync()
    const oauthData = storageData?.claudeAiOauth
    if (!oauthData?.accessToken) {
      return null
    }
    return oauthData
  } catch (error) {
    logError(error)
    return null
  }
}

let pendingRefreshCheck: Promise<boolean> | null = null

export function checkAndRefreshOAuthTokenIfNeeded(
  retryCount = 0,
  force = false,
): Promise<boolean> {
  
  if (retryCount === 0 && !force) {
    if (pendingRefreshCheck) {
      return pendingRefreshCheck
    }

    const promise = checkAndRefreshOAuthTokenIfNeededImpl(retryCount, force)
    pendingRefreshCheck = promise.finally(() => {
      pendingRefreshCheck = null
    })
    return pendingRefreshCheck
  }

  return checkAndRefreshOAuthTokenIfNeededImpl(retryCount, force)
}

async function checkAndRefreshOAuthTokenIfNeededImpl(
  retryCount: number,
  force: boolean,
): Promise<boolean> {
  const MAX_RETRIES = 5

  await invalidateOAuthCacheIfDiskChanged()

  
  
  const tokens = getClaudeAIOAuthTokens()
  if (!force) {
    if (!tokens?.refreshToken || !isOAuthTokenExpired(tokens.expiresAt)) {
      return false
    }
  }

  if (!tokens?.refreshToken) {
    return false
  }

  if (!shouldUseClaudeAIAuth(tokens.scopes)) {
    return false
  }

  
  
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearKeychainCache()
  const freshTokens = await getClaudeAIOAuthTokensAsync()
  if (
    !freshTokens?.refreshToken ||
    !isOAuthTokenExpired(freshTokens.expiresAt)
  ) {
    return false
  }

  
  const claudeDir = getClaudeConfigHomeDir()
  await mkdir(claudeDir, { recursive: true })

  let release
  try {
    logEvent('tengu_oauth_token_refresh_lock_acquiring', {})
    release = await lockfile.lock(claudeDir)
    logEvent('tengu_oauth_token_refresh_lock_acquired', {})
  } catch (err) {
    if ((err as { code?: string }).code === 'ELOCKED') {
      
      if (retryCount < MAX_RETRIES) {
        logEvent('tengu_oauth_token_refresh_lock_retry', {
          retryCount: retryCount + 1,
        })
        
        await sleep(1000 + Math.random() * 1000)
        return checkAndRefreshOAuthTokenIfNeededImpl(retryCount + 1, force)
      }
      logEvent('tengu_oauth_token_refresh_lock_retry_limit_reached', {
        maxRetries: MAX_RETRIES,
      })
      return false
    }
    logError(err)
    logEvent('tengu_oauth_token_refresh_lock_error', {
      error: errorMessage(
        err,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return false
  }
  try {
    
    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    const lockedTokens = await getClaudeAIOAuthTokensAsync()
    if (
      !lockedTokens?.refreshToken ||
      !isOAuthTokenExpired(lockedTokens.expiresAt)
    ) {
      logEvent('tengu_oauth_token_refresh_race_resolved', {})
      return false
    }

    logEvent('tengu_oauth_token_refresh_starting', {})
    const refreshedTokens = await refreshOAuthToken(lockedTokens.refreshToken, {
      
      
      
      scopes: shouldUseClaudeAIAuth(lockedTokens.scopes)
        ? undefined
        : lockedTokens.scopes,
    })
    saveOAuthTokensIfNeeded(refreshedTokens)

    
    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    return true
  } catch (error) {
    logError(error)

    getClaudeAIOAuthTokens.cache?.clear?.()
    clearKeychainCache()
    const currentTokens = await getClaudeAIOAuthTokensAsync()
    if (currentTokens && !isOAuthTokenExpired(currentTokens.expiresAt)) {
      logEvent('tengu_oauth_token_refresh_race_recovered', {})
      return true
    }

    return false
  } finally {
    logEvent('tengu_oauth_token_refresh_lock_releasing', {})
    await release()
    logEvent('tengu_oauth_token_refresh_lock_released', {})
  }
}

export function isClaudeAISubscriber(): boolean {
  if (!isAnthropicAuthEnabled()) {
    return false
  }

  return shouldUseClaudeAIAuth(getClaudeAIOAuthTokens()?.scopes)
}

export function hasProfileScope(): boolean {
  return (
    getClaudeAIOAuthTokens()?.scopes?.includes(CLAUDE_AI_PROFILE_SCOPE) ?? false
  )
}

export function is1PApiCustomer(): boolean {
  
  
  
  
  

  
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_FOUNDRY)
  ) {
    return false
  }

  
  if (isClaudeAISubscriber()) {
    return false
  }

  
  return true
}

export function getOauthAccountInfo(): AccountInfo | undefined {
  return isAnthropicAuthEnabled() ? getGlobalConfig().oauthAccount : undefined
}

export function isOverageProvisioningAllowed(): boolean {
  const accountInfo = getOauthAccountInfo()
  const billingType = accountInfo?.billingType

  
  if (!isClaudeAISubscriber() || !billingType) {
    return false
  }

  
  if (
    billingType !== 'stripe_subscription' &&
    billingType !== 'stripe_subscription_contracted' &&
    billingType !== 'apple_subscription' &&
    billingType !== 'google_play_subscription'
  ) {
    return false
  }

  return true
}

export function hasOpusAccess(): boolean {
  const subscriptionType = getSubscriptionType()

  return (
    subscriptionType === 'max' ||
    subscriptionType === 'enterprise' ||
    subscriptionType === 'team' ||
    subscriptionType === 'pro' ||
    
    
    
    subscriptionType === null
  )
}

export function getSubscriptionType(): SubscriptionType | null {
  
  if (shouldUseMockSubscription()) {
    return getMockSubscriptionType()
  }

  if (!isAnthropicAuthEnabled()) {
    return null
  }
  const oauthTokens = getClaudeAIOAuthTokens()
  if (!oauthTokens) {
    return null
  }

  return oauthTokens.subscriptionType ?? null
}

export function isMaxSubscriber(): boolean {
  return getSubscriptionType() === 'max'
}

export function isTeamSubscriber(): boolean {
  return getSubscriptionType() === 'team'
}

export function isTeamPremiumSubscriber(): boolean {
  return (
    getSubscriptionType() === 'team' &&
    getRateLimitTier() === 'default_claude_max_5x'
  )
}

export function isEnterpriseSubscriber(): boolean {
  return getSubscriptionType() === 'enterprise'
}

export function isProSubscriber(): boolean {
  return getSubscriptionType() === 'pro'
}

export function getRateLimitTier(): string | null {
  if (!isAnthropicAuthEnabled()) {
    return null
  }
  const oauthTokens = getClaudeAIOAuthTokens()
  if (!oauthTokens) {
    return null
  }

  return oauthTokens.rateLimitTier ?? null
}

export function getSubscriptionName(): string {
  const subscriptionType = getSubscriptionType()

  switch (subscriptionType) {
    case 'enterprise':
      return 'Claude Enterprise'
    case 'team':
      return 'Claude Team'
    case 'max':
      return 'Claude Max'
    case 'pro':
      return 'Claude Pro'
    default:
      return 'Claude API'
  }
}

export function isUsing3PServices(): boolean {
  return !!(
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_FOUNDRY)
  )
}

function getConfiguredOtelHeadersHelper(): string | undefined {
  const mergedSettings = getSettings_DEPRECATED() || {}
  return mergedSettings.otelHeadersHelper
}

export function isOtelHeadersHelperFromProjectOrLocalSettings(): boolean {
  const otelHeadersHelper = getConfiguredOtelHeadersHelper()
  if (!otelHeadersHelper) {
    return false
  }

  const projectSettings = getSettingsForSource('projectSettings')
  const localSettings = getSettingsForSource('localSettings')
  return (
    projectSettings?.otelHeadersHelper === otelHeadersHelper ||
    localSettings?.otelHeadersHelper === otelHeadersHelper
  )
}

let cachedOtelHeaders: Record<string, string> | null = null
let cachedOtelHeadersTimestamp = 0
const DEFAULT_OTEL_HEADERS_DEBOUNCE_MS = 29 * 60 * 1000 

export function getOtelHeadersFromHelper(): Record<string, string> {
  const otelHeadersHelper = getConfiguredOtelHeadersHelper()

  if (!otelHeadersHelper) {
    return {}
  }

  
  const debounceMs = parseInt(
    process.env.CLAUDE_CODE_NEXT_OTEL_HEADERS_HELPER_DEBOUNCE_MS ||
      DEFAULT_OTEL_HEADERS_DEBOUNCE_MS.toString(),
  )
  if (
    cachedOtelHeaders &&
    Date.now() - cachedOtelHeadersTimestamp < debounceMs
  ) {
    return cachedOtelHeaders
  }

  if (isOtelHeadersHelperFromProjectOrLocalSettings()) {
    
    const hasTrust = checkHasTrustDialogAccepted()
    if (!hasTrust) {
      return {}
    }
  }

  try {
    const result = execSyncWithDefaults_DEPRECATED(otelHeadersHelper, {
      timeout: 30000, 
    })
      ?.toString()
      .trim()
    if (!result) {
      throw new Error('otelHeadersHelper did not return a valid value')
    }

    const headers = jsonParse(result)
    if (
      typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers)
    ) {
      throw new Error(
        'otelHeadersHelper must return a JSON object with string key-value pairs',
      )
    }

    
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') {
        throw new Error(
          `otelHeadersHelper returned non-string value for key "${key}": ${typeof value}`,
        )
      }
    }

    
    cachedOtelHeaders = headers as Record<string, string>
    cachedOtelHeadersTimestamp = Date.now()

    return cachedOtelHeaders
  } catch (error) {
    logError(
      new Error(
        `Error getting OpenTelemetry headers from otelHeadersHelper (in settings): ${errorMessage(error)}`,
      ),
    )
    throw error
  }
}

function isConsumerPlan(plan: SubscriptionType): plan is 'max' | 'pro' {
  return plan === 'max' || plan === 'pro'
}

export function isConsumerSubscriber(): boolean {
  const subscriptionType = getSubscriptionType()
  return (
    isClaudeAISubscriber() &&
    subscriptionType !== null &&
    isConsumerPlan(subscriptionType)
  )
}

export type UserAccountInfo = {
  subscription?: string
  tokenSource?: string
  apiKeySource?: ApiKeySource
  organization?: string
  email?: string
}

export function getAccountInformation() {
  const apiProvider = getAPIProvider()
  
  if (apiProvider !== 'firstParty') {
    return undefined
  }
  const { source: authTokenSource } = getAuthTokenSource()
  const accountInfo: UserAccountInfo = {}
  if (
    authTokenSource === 'CLAUDE_CODE_NEXT_OAUTH_TOKEN' ||
    authTokenSource === 'CLAUDE_CODE_NEXT_OAUTH_TOKEN_FILE_DESCRIPTOR'
  ) {
    accountInfo.tokenSource = authTokenSource
  } else if (isClaudeAISubscriber()) {
    accountInfo.subscription = getSubscriptionName()
  } else {
    accountInfo.tokenSource = authTokenSource
  }
  const { key: apiKey, source: apiKeySource } = getAnthropicApiKeyWithSource()
  if (apiKey) {
    accountInfo.apiKeySource = apiKeySource
  }

  
  if (
    authTokenSource === 'claude.ai' ||
    apiKeySource === '/login managed key'
  ) {
    
    const orgName = getOauthAccountInfo()?.organizationName
    if (orgName) {
      accountInfo.organization = orgName
    }
  }
  const email = getOauthAccountInfo()?.emailAddress
  if (
    (authTokenSource === 'claude.ai' ||
      apiKeySource === '/login managed key') &&
    email
  ) {
    accountInfo.email = email
  }
  return accountInfo
}

export type OrgValidationResult =
  | { valid: true }
  | { valid: false; message: string }

export async function validateForceLoginOrg(): Promise<OrgValidationResult> {
  
  
  
  if (process.env.ANTHROPIC_UNIX_SOCKET) {
    return { valid: true }
  }

  if (!isAnthropicAuthEnabled()) {
    return { valid: true }
  }

  const requiredOrgUuid =
    getSettingsForSource('policySettings')?.forceLoginOrgUUID
  if (!requiredOrgUuid) {
    return { valid: true }
  }

  
  
  await checkAndRefreshOAuthTokenIfNeeded()

  const tokens = getClaudeAIOAuthTokens()
  if (!tokens) {
    return { valid: true }
  }

  
  
  
  const { source } = getAuthTokenSource()
  const isEnvVarToken =
    source === 'CLAUDE_CODE_NEXT_OAUTH_TOKEN' ||
    source === 'CLAUDE_CODE_NEXT_OAUTH_TOKEN_FILE_DESCRIPTOR'

  const profile = await getOauthProfileFromOauthToken(tokens.accessToken)
  if (!profile) {
    
    return {
      valid: false,
      message:
        `Unable to verify organization for the current authentication token.\n` +
        `This machine requires organization ${requiredOrgUuid} but the profile could not be fetched.\n` +
        `This may be a network error, or the token may lack the user:profile scope required for\n` +
        `verification (tokens from 'claude setup-token' do not include this scope).\n` +
        `Try again, or obtain a full-scope token via 'claude auth login'.`,
    }
  }

  const tokenOrgUuid = profile.organization.uuid
  if (tokenOrgUuid === requiredOrgUuid) {
    return { valid: true }
  }

  if (isEnvVarToken) {
    const envVarName =
      source === 'CLAUDE_CODE_NEXT_OAUTH_TOKEN'
        ? 'CLAUDE_CODE_NEXT_OAUTH_TOKEN'
        : 'CLAUDE_CODE_NEXT_OAUTH_TOKEN_FILE_DESCRIPTOR'
    return {
      valid: false,
      message:
        `The ${envVarName} environment variable provides a token for a\n` +
        `different organization than required by this machine's managed settings.\n\n` +
        `Required organization: ${requiredOrgUuid}\n` +
        `Token organization:   ${tokenOrgUuid}\n\n` +
        `Remove the environment variable or obtain a token for the correct organization.`,
    }
  }

  return {
    valid: false,
    message:
      `Your authentication token belongs to organization ${tokenOrgUuid},\n` +
      `but this machine requires organization ${requiredOrgUuid}.\n\n` +
      `Please log in with the correct organization: claude auth login`,
  }
}

class GcpCredentialsTimeoutError extends Error {}
