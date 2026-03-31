import {
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  auth as sdkAuth,
  refreshAuthorization as sdkRefreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  InvalidGrantError,
  OAuthError,
  ServerError,
  TemporarilyUnavailableError,
  TooManyRequestsError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import {
  type AuthorizationServerMetadata,
  type OAuthClientInformation,
  type OAuthClientInformationFull,
  type OAuthClientMetadata,
  OAuthErrorResponseSchema,
  OAuthMetadataSchema,
  type OAuthTokens,
  OAuthTokensSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import axios from 'axios'
import { createHash, randomBytes, randomUUID } from 'crypto'
import { mkdir } from 'fs/promises'
import { createServer, type Server } from 'http'
import { join } from 'path'
import { parse } from 'url'
import xss from 'xss'
import { MCP_CLIENT_METADATA_URL } from '../../constants/oauth.js'
import { openBrowser } from '../../utils/browser.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage, getErrnoCode } from '../../utils/errors.js'
import * as lockfile from '../../utils/lockfile.js'
import { logMCPDebug } from '../../utils/log.js'
import { getPlatform } from '../../utils/platform.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'
import { clearKeychainCache } from '../../utils/secureStorage/macOsKeychainHelpers.js'
import type { SecureStorageData } from '../../utils/secureStorage/types.js'
import { sleep } from '../../utils/sleep.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import { logEvent } from '../analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../analytics/metadata.js'
import { buildRedirectUri, findAvailablePort } from './oauthPort.js'
import type { McpHTTPServerConfig, McpSSEServerConfig } from './types.js'
import { getLoggingSafeMcpBaseUrl } from './utils.js'
import { performCrossAppAccess, XaaTokenExchangeError } from './xaa.js'
import {
  acquireIdpIdToken,
  clearIdpIdToken,
  discoverOidc,
  getCachedIdpIdToken,
  getIdpClientSecret,
  getXaaIdpSettings,
  isXaaEnabled,
} from './xaaIdpLogin.js'

const AUTH_REQUEST_TIMEOUT_MS = 30000

type MCPRefreshFailureReason =
  | 'metadata_discovery_failed'
  | 'no_client_info'
  | 'no_tokens_returned'
  | 'invalid_grant'
  | 'transient_retries_exhausted'
  | 'request_failed'

type MCPOAuthFlowErrorReason =
  | 'cancelled'
  | 'timeout'
  | 'provider_denied'
  | 'state_mismatch'
  | 'port_unavailable'
  | 'sdk_auth_failed'
  | 'token_exchange_failed'
  | 'unknown'

const MAX_LOCK_RETRIES = 5

const SENSITIVE_OAUTH_PARAMS = [
  'state',
  'nonce',
  'code_challenge',
  'code_verifier',
  'code',
]

function redactSensitiveUrlParams(url: string): string {
  try {
    const parsedUrl = new URL(url)
    for (const param of SENSITIVE_OAUTH_PARAMS) {
      if (parsedUrl.searchParams.has(param)) {
        parsedUrl.searchParams.set(param, '[REDACTED]')
      }
    }
    return parsedUrl.toString()
  } catch {
    
    return url
  }
}

const NONSTANDARD_INVALID_GRANT_ALIASES = new Set([
  'invalid_refresh_token',
  'expired_refresh_token',
  'token_expired',
])

export async function normalizeOAuthErrorBody(
  response: Response,
): Promise<Response> {
  if (!response.ok) {
    return response
  }
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = jsonParse(text)
  } catch {
    return new Response(text, response)
  }
  if (OAuthTokensSchema.safeParse(parsed).success) {
    return new Response(text, response)
  }
  const result = OAuthErrorResponseSchema.safeParse(parsed)
  if (!result.success) {
    return new Response(text, response)
  }
  const normalized = NONSTANDARD_INVALID_GRANT_ALIASES.has(result.data.error)
    ? {
        error: 'invalid_grant',
        error_description:
          result.data.error_description ??
          `Server returned non-standard error code: ${result.data.error}`,
      }
    : result.data
  return new Response(jsonStringify(normalized), {
    status: 400,
    statusText: 'Bad Request',
    headers: response.headers,
  })
}

function createAuthFetch(): FetchLike {
  return async (url: string | URL, init?: RequestInit) => {
    const timeoutSignal = AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS)
    const isPost = init?.method?.toUpperCase() === 'POST'

    
    if (!init?.signal) {
      
      const response = await fetch(url, { ...init, signal: timeoutSignal })
      return isPost ? normalizeOAuthErrorBody(response) : response
    }

    
    const controller = new AbortController()
    const abort = () => controller.abort()

    init.signal.addEventListener('abort', abort)
    timeoutSignal.addEventListener('abort', abort)

    
    const cleanup = () => {
      init.signal?.removeEventListener('abort', abort)
      timeoutSignal.removeEventListener('abort', abort)
    }

    if (init.signal.aborted) {
      controller.abort()
    }

    try {
      
      const response = await fetch(url, { ...init, signal: controller.signal })
      cleanup()
      return isPost ? normalizeOAuthErrorBody(response) : response
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

async function fetchAuthServerMetadata(
  serverName: string,
  serverUrl: string,
  configuredMetadataUrl: string | undefined,
  fetchFn?: FetchLike,
  resourceMetadataUrl?: URL,
): Promise<Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>> {
  if (configuredMetadataUrl) {
    if (!configuredMetadataUrl.startsWith('https://')) {
      throw new Error(
        `authServerMetadataUrl must use https:// (got: ${configuredMetadataUrl})`,
      )
    }
    const authFetch = fetchFn ?? createAuthFetch()
    const response = await authFetch(configuredMetadataUrl, {
      headers: { Accept: 'application/json' },
    })
    if (response.ok) {
      return OAuthMetadataSchema.parse(await response.json())
    }
    throw new Error(
      `HTTP ${response.status} fetching configured auth server metadata from ${configuredMetadataUrl}`,
    )
  }

  try {
    const { authorizationServerMetadata } = await discoverOAuthServerInfo(
      serverUrl,
      {
        ...(fetchFn && { fetchFn }),
        ...(resourceMetadataUrl && { resourceMetadataUrl }),
      },
    )
    if (authorizationServerMetadata) {
      return authorizationServerMetadata
    }
  } catch (err) {
    
    
    
    logMCPDebug(
      serverName,
      `RFC 9728 discovery failed, falling back: ${errorMessage(err)}`,
    )
  }

  
  
  const url = new URL(serverUrl)
  if (url.pathname === '/') {
    return undefined
  }
  return discoverAuthorizationServerMetadata(url, {
    ...(fetchFn && { fetchFn }),
  })
}

export class AuthenticationCancelledError extends Error {
  constructor() {
    super('Authentication was cancelled')
    this.name = 'AuthenticationCancelledError'
  }
}

export function getServerKey(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): string {
  const configJson = jsonStringify({
    type: serverConfig.type,
    url: serverConfig.url,
    headers: serverConfig.headers || {},
  })

  const hash = createHash('sha256')
    .update(configJson)
    .digest('hex')
    .substring(0, 16)

  return `${serverName}|${hash}`
}

export function hasMcpDiscoveryButNoToken(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): boolean {
  
  
  
  
  if (isXaaEnabled() && serverConfig.oauth?.xaa) {
    return false
  }
  const serverKey = getServerKey(serverName, serverConfig)
  const entry = getSecureStorage().read()?.mcpOAuth?.[serverKey]
  return entry !== undefined && !entry.accessToken && !entry.refreshToken
}

async function revokeToken({
  serverName,
  endpoint,
  token,
  tokenTypeHint,
  clientId,
  clientSecret,
  accessToken,
  authMethod = 'client_secret_basic',
}: {
  serverName: string
  endpoint: string
  token: string
  tokenTypeHint: 'access_token' | 'refresh_token'
  clientId?: string
  clientSecret?: string
  accessToken?: string
  authMethod?: 'client_secret_basic' | 'client_secret_post'
}): Promise<void> {
  const params = new URLSearchParams()
  params.set('token', token)
  params.set('token_type_hint', tokenTypeHint)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  
  
  
  if (clientId && clientSecret) {
    if (authMethod === 'client_secret_post') {
      params.set('client_id', clientId)
      params.set('client_secret', clientSecret)
    } else {
      const basic = Buffer.from(
        `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
      ).toString('base64')
      headers.Authorization = `Basic ${basic}`
    }
  } else if (clientId) {
    params.set('client_id', clientId)
  } else {
    logMCPDebug(
      serverName,
      `No client_id available for ${tokenTypeHint} revocation - server may reject`,
    )
  }

  try {
    await axios.post(endpoint, params, { headers })
    logMCPDebug(serverName, `Successfully revoked ${tokenTypeHint}`)
  } catch (error: unknown) {
    
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      accessToken
    ) {
      logMCPDebug(
        serverName,
        `Got 401, retrying ${tokenTypeHint} revocation with Bearer auth`,
      )
      
      
      params.delete('client_id')
      params.delete('client_secret')
      await axios.post(endpoint, params, {
        headers: { ...headers, Authorization: `Bearer ${accessToken}` },
      })
      logMCPDebug(
        serverName,
        `Successfully revoked ${tokenTypeHint} with Bearer auth`,
      )
    } else {
      throw error
    }
  }
}

export async function revokeServerTokens(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  { preserveStepUpState = false }: { preserveStepUpState?: boolean } = {},
): Promise<void> {
  const storage = getSecureStorage()
  const existingData = storage.read()
  if (!existingData?.mcpOAuth) return

  const serverKey = getServerKey(serverName, serverConfig)
  const tokenData = existingData.mcpOAuth[serverKey]

  
  if (tokenData?.accessToken || tokenData?.refreshToken) {
    try {
      
      
      const asUrl =
        tokenData.discoveryState?.authorizationServerUrl ?? serverConfig.url
      const metadata = await fetchAuthServerMetadata(
        serverName,
        asUrl,
        serverConfig.oauth?.authServerMetadataUrl,
      )

      if (!metadata) {
        logMCPDebug(serverName, 'No OAuth metadata found')
      } else {
        const revocationEndpoint =
          'revocation_endpoint' in metadata
            ? metadata.revocation_endpoint
            : null
        if (!revocationEndpoint) {
          logMCPDebug(serverName, 'Server does not support token revocation')
        } else {
          const revocationEndpointStr = String(revocationEndpoint)
          
          
          const authMethods =
            ('revocation_endpoint_auth_methods_supported' in metadata
              ? metadata.revocation_endpoint_auth_methods_supported
              : undefined) ??
            ('token_endpoint_auth_methods_supported' in metadata
              ? metadata.token_endpoint_auth_methods_supported
              : undefined)
          const authMethod: 'client_secret_basic' | 'client_secret_post' =
            authMethods &&
            !authMethods.includes('client_secret_basic') &&
            authMethods.includes('client_secret_post')
              ? 'client_secret_post'
              : 'client_secret_basic'
          logMCPDebug(
            serverName,
            `Revoking tokens via ${revocationEndpointStr} (${authMethod})`,
          )

          
          if (tokenData.refreshToken) {
            try {
              await revokeToken({
                serverName,
                endpoint: revocationEndpointStr,
                token: tokenData.refreshToken,
                tokenTypeHint: 'refresh_token',
                clientId: tokenData.clientId,
                clientSecret: tokenData.clientSecret,
                accessToken: tokenData.accessToken,
                authMethod,
              })
            } catch (error: unknown) {
              
              logMCPDebug(
                serverName,
                `Failed to revoke refresh token: ${errorMessage(error)}`,
              )
            }
          }

          
          if (tokenData.accessToken) {
            try {
              await revokeToken({
                serverName,
                endpoint: revocationEndpointStr,
                token: tokenData.accessToken,
                tokenTypeHint: 'access_token',
                clientId: tokenData.clientId,
                clientSecret: tokenData.clientSecret,
                accessToken: tokenData.accessToken,
                authMethod,
              })
            } catch (error: unknown) {
              logMCPDebug(
                serverName,
                `Failed to revoke access token: ${errorMessage(error)}`,
              )
            }
          }
        }
      }
    } catch (error: unknown) {
      
      logMCPDebug(serverName, `Failed to revoke tokens: ${errorMessage(error)}`)
    }
  } else {
    logMCPDebug(serverName, 'No tokens to revoke')
  }

  
  clearServerTokensFromLocalStorage(serverName, serverConfig)

  
  
  
  if (
    preserveStepUpState &&
    tokenData &&
    (tokenData.stepUpScope || tokenData.discoveryState)
  ) {
    const freshData = storage.read() || {}
    const updatedData: SecureStorageData = {
      ...freshData,
      mcpOAuth: {
        ...freshData.mcpOAuth,
        [serverKey]: {
          ...freshData.mcpOAuth?.[serverKey],
          serverName,
          serverUrl: serverConfig.url,
          accessToken: freshData.mcpOAuth?.[serverKey]?.accessToken ?? '',
          expiresAt: freshData.mcpOAuth?.[serverKey]?.expiresAt ?? 0,
          ...(tokenData.stepUpScope
            ? { stepUpScope: tokenData.stepUpScope }
            : {}),
          ...(tokenData.discoveryState
            ? {
                
                
                discoveryState: {
                  authorizationServerUrl:
                    tokenData.discoveryState.authorizationServerUrl,
                  resourceMetadataUrl:
                    tokenData.discoveryState.resourceMetadataUrl,
                },
              }
            : {}),
        },
      },
    }
    storage.update(updatedData)
    logMCPDebug(serverName, 'Preserved step-up auth state across revocation')
  }
}

export function clearServerTokensFromLocalStorage(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): void {
  const storage = getSecureStorage()
  const existingData = storage.read()
  if (!existingData?.mcpOAuth) return

  const serverKey = getServerKey(serverName, serverConfig)
  if (existingData.mcpOAuth[serverKey]) {
    delete existingData.mcpOAuth[serverKey]
    storage.update(existingData)
    logMCPDebug(serverName, 'Cleared stored tokens')
  }
}

type WWWAuthenticateParams = {
  scope?: string
  resourceMetadataUrl?: URL
}

type XaaFailureStage =
  | 'idp_login'
  | 'discovery'
  | 'token_exchange'
  | 'jwt_bearer'

async function performMCPXaaAuth(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  onAuthorizationUrl: (url: string) => void,
  abortSignal?: AbortSignal,
  skipBrowserOpen?: boolean,
): Promise<void> {
  if (!serverConfig.oauth?.xaa) {
    throw new Error('XAA: oauth.xaa must be set') 
  }

  
  const idp = getXaaIdpSettings()
  if (!idp) {
    throw new Error(
      "XAA: no IdP connection configured. Run 'claude mcp xaa setup --issuer <url> --client-id <id> --client-secret' to configure.",
    )
  }

  const clientId = serverConfig.oauth?.clientId
  if (!clientId) {
    throw new Error(
      `XAA: server '${serverName}' needs an AS client_id. Re-add with --client-id.`,
    )
  }

  const clientConfig = getMcpClientConfig(serverName, serverConfig)
  const clientSecret = clientConfig?.clientSecret
  if (!clientSecret) {
    
    
    const wantedKey = getServerKey(serverName, serverConfig)
    const haveKeys = Object.keys(
      getSecureStorage().read()?.mcpOAuthClientConfig ?? {},
    )
    const headersForLogging = Object.fromEntries(
      Object.entries(serverConfig.headers ?? {}).map(([k, v]) =>
        k.toLowerCase() === 'authorization' ? [k, '[REDACTED]'] : [k, v],
      ),
    )
    logMCPDebug(
      serverName,
      `XAA: secret lookup miss. wanted=${wantedKey} have=[${haveKeys.join(', ')}] configHeaders=${jsonStringify(headersForLogging)}`,
    )
    throw new Error(
      `XAA: AS client secret not found for '${serverName}'. Re-add with --client-secret.`,
    )
  }

  logMCPDebug(serverName, 'XAA: starting cross-app access flow')

  
  
  const idpClientSecret = getIdpClientSecret(idp.issuer)

  
  
  
  const idTokenCacheHit = getCachedIdpIdToken(idp.issuer) !== undefined

  let failureStage: XaaFailureStage = 'idp_login'
  try {
    let idToken
    try {
      idToken = await acquireIdpIdToken({
        idpIssuer: idp.issuer,
        idpClientId: idp.clientId,
        idpClientSecret,
        callbackPort: idp.callbackPort,
        onAuthorizationUrl,
        skipBrowserOpen,
        abortSignal,
      })
    } catch (e) {
      if (abortSignal?.aborted) throw new AuthenticationCancelledError()
      throw e
    }

    
    failureStage = 'discovery'
    const oidc = await discoverOidc(idp.issuer)

    
    
    failureStage = 'token_exchange'
    let tokens
    try {
      tokens = await performCrossAppAccess(
        serverConfig.url,
        {
          clientId,
          clientSecret,
          idpClientId: idp.clientId,
          idpClientSecret,
          idpIdToken: idToken,
          idpTokenEndpoint: oidc.token_endpoint,
        },
        serverName,
        abortSignal,
      )
    } catch (e) {
      if (abortSignal?.aborted) throw new AuthenticationCancelledError()
      const msg = errorMessage(e)
      
      
      
      
      if (e instanceof XaaTokenExchangeError) {
        if (e.shouldClearIdToken) {
          clearIdpIdToken(idp.issuer)
          logMCPDebug(
            serverName,
            'XAA: cleared cached id_token after token-exchange failure',
          )
        }
      } else if (
        msg.includes('PRM discovery failed') ||
        msg.includes('AS metadata discovery failed') ||
        msg.includes('no authorization server supports jwt-bearer')
      ) {
        
        
        failureStage = 'discovery'
      } else if (msg.includes('jwt-bearer')) {
        failureStage = 'jwt_bearer'
      }
      throw e
    }

    
    
    
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(serverName, serverConfig)
    const prev = existingData.mcpOAuth?.[serverKey]
    storage.update({
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...prev,
          serverName,
          serverUrl: serverConfig.url,
          accessToken: tokens.access_token,
          
          refreshToken: tokens.refresh_token ?? prev?.refreshToken,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          scope: tokens.scope,
          clientId,
          clientSecret,
          
          
          
          discoveryState: {
            authorizationServerUrl: tokens.authorizationServerUrl,
          },
        },
      },
    })

    logMCPDebug(serverName, 'XAA: tokens saved')
    logEvent('tengu_mcp_oauth_flow_success', {
      authMethod:
        'xaa' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      idTokenCacheHit,
    })
  } catch (e) {
    
    if (e instanceof AuthenticationCancelledError) {
      throw e
    }
    logEvent('tengu_mcp_oauth_flow_failure', {
      authMethod:
        'xaa' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      xaaFailureStage:
        failureStage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      idTokenCacheHit,
    })
    throw e
  }
}

export async function performMCPOAuthFlow(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  onAuthorizationUrl: (url: string) => void,
  abortSignal?: AbortSignal,
  options?: {
    skipBrowserOpen?: boolean
    onWaitingForCallback?: (submit: (callbackUrl: string) => void) => void
  },
): Promise<void> {
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (serverConfig.oauth?.xaa) {
    if (!isXaaEnabled()) {
      throw new Error(
        `XAA is not enabled (set CLAUDE_CODE_NEXT_ENABLE_XAA=1). Remove 'oauth.xaa' from server '${serverName}' to use the standard consent flow.`,
      )
    }
    logEvent('tengu_mcp_oauth_flow_start', {
      isOAuthFlow: true,
      authMethod:
        'xaa' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transportType:
        serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(getLoggingSafeMcpBaseUrl(serverConfig)
        ? {
            mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
              serverConfig,
            ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    })
    
    
    await performMCPXaaAuth(
      serverName,
      serverConfig,
      onAuthorizationUrl,
      abortSignal,
      options?.skipBrowserOpen,
    )
    return
  }

  
  
  
  const storage = getSecureStorage()
  const serverKey = getServerKey(serverName, serverConfig)
  const cachedEntry = storage.read()?.mcpOAuth?.[serverKey]
  const cachedStepUpScope = cachedEntry?.stepUpScope
  const cachedResourceMetadataUrl =
    cachedEntry?.discoveryState?.resourceMetadataUrl

  
  
  
  clearServerTokensFromLocalStorage(serverName, serverConfig)

  
  
  
  let resourceMetadataUrl: URL | undefined
  if (cachedResourceMetadataUrl) {
    try {
      resourceMetadataUrl = new URL(cachedResourceMetadataUrl)
    } catch {
      logMCPDebug(
        serverName,
        `Invalid cached resourceMetadataUrl: ${cachedResourceMetadataUrl}`,
      )
    }
  }
  const wwwAuthParams: WWWAuthenticateParams = {
    scope: cachedStepUpScope,
    resourceMetadataUrl,
  }

  const flowAttemptId = randomUUID()

  logEvent('tengu_mcp_oauth_flow_start', {
    flowAttemptId:
      flowAttemptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    isOAuthFlow: true,
    transportType:
      serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(getLoggingSafeMcpBaseUrl(serverConfig)
      ? {
          mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
            serverConfig,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }
      : {}),
  })

  
  
  let authorizationCodeObtained = false

  try {
    
    const configuredCallbackPort = serverConfig.oauth?.callbackPort
    const port = configuredCallbackPort ?? (await findAvailablePort())
    const redirectUri = buildRedirectUri(port)
    logMCPDebug(
      serverName,
      `Using redirect port: ${port}${configuredCallbackPort ? ' (from config)' : ''}`,
    )

    const provider = new ClaudeAuthProvider(
      serverName,
      serverConfig,
      redirectUri,
      true,
      onAuthorizationUrl,
      options?.skipBrowserOpen,
    )

    
    try {
      const metadata = await fetchAuthServerMetadata(
        serverName,
        serverConfig.url,
        serverConfig.oauth?.authServerMetadataUrl,
        undefined,
        wwwAuthParams.resourceMetadataUrl,
      )
      if (metadata) {
        
        provider.setMetadata(metadata)
        logMCPDebug(
          serverName,
          `Fetched OAuth metadata with scope: ${getScopeFromMetadata(metadata) || 'NONE'}`,
        )
      }
    } catch (error) {
      logMCPDebug(
        serverName,
        `Failed to fetch OAuth metadata: ${errorMessage(error)}`,
      )
    }

    
    const oauthState = await provider.state()

    
    let server: Server | null = null
    let timeoutId: NodeJS.Timeout | null = null
    let abortHandler: (() => void) | null = null

    const cleanup = () => {
      if (server) {
        server.removeAllListeners()
        
        server.on('error', () => {})
        server.close()
        server = null
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener('abort', abortHandler)
        abortHandler = null
      }
      logMCPDebug(serverName, `MCP OAuth server cleaned up`)
    }

    
    const authorizationCode = await new Promise<string>((resolve, reject) => {
      let resolved = false
      const resolveOnce = (code: string) => {
        if (resolved) return
        resolved = true
        resolve(code)
      }
      const rejectOnce = (error: Error) => {
        if (resolved) return
        resolved = true
        reject(error)
      }

      if (abortSignal) {
        abortHandler = () => {
          cleanup()
          rejectOnce(new AuthenticationCancelledError())
        }
        if (abortSignal.aborted) {
          abortHandler()
          return
        }
        abortSignal.addEventListener('abort', abortHandler)
      }

      
      
      if (options?.onWaitingForCallback) {
        options.onWaitingForCallback((callbackUrl: string) => {
          try {
            const parsed = new URL(callbackUrl)
            const code = parsed.searchParams.get('code')
            const state = parsed.searchParams.get('state')
            const error = parsed.searchParams.get('error')

            if (error) {
              const errorDescription =
                parsed.searchParams.get('error_description') || ''
              cleanup()
              rejectOnce(
                new Error(`OAuth error: ${error} - ${errorDescription}`),
              )
              return
            }

            if (!code) {
              
              return
            }

            if (state !== oauthState) {
              cleanup()
              rejectOnce(
                new Error('OAuth state mismatch - possible CSRF attack'),
              )
              return
            }

            logMCPDebug(
              serverName,
              `Received auth code via manual callback URL`,
            )
            cleanup()
            resolveOnce(code)
          } catch {
            
          }
        })
      }

      server = createServer((req, res) => {
        const parsedUrl = parse(req.url || '', true)

        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.query.code as string
          const state = parsedUrl.query.state as string
          const error = parsedUrl.query.error
          const errorDescription = parsedUrl.query.error_description as string
          const errorUri = parsedUrl.query.error_uri as string

          
          if (!error && state !== oauthState) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(
              `<h1>Authentication Error</h1><p>Invalid state parameter. Please try again.</p><p>You can close this window.</p>`,
            )
            cleanup()
            rejectOnce(new Error('OAuth state mismatch - possible CSRF attack'))
            return
          }

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            
            const sanitizedError = xss(String(error))
            const sanitizedErrorDescription = errorDescription
              ? xss(String(errorDescription))
              : ''
            res.end(
              `<h1>Authentication Error</h1><p>${sanitizedError}: ${sanitizedErrorDescription}</p><p>You can close this window.</p>`,
            )
            cleanup()
            let errorMessage = `OAuth error: ${error}`
            if (errorDescription) {
              errorMessage += ` - ${errorDescription}`
            }
            if (errorUri) {
              errorMessage += ` (See: ${errorUri})`
            }
            rejectOnce(new Error(errorMessage))
            return
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              `<h1>Authentication Successful</h1><p>You can close this window. Return to Claude Code Next.</p>`,
            )
            cleanup()
            resolveOnce(code)
          }
        }
      })

      server.on('error', (err: NodeJS.ErrnoException) => {
        cleanup()
        if (err.code === 'EADDRINUSE') {
          const findCmd =
            getPlatform() === 'windows'
              ? `netstat -ano | findstr :${port}`
              : `lsof -ti:${port} -sTCP:LISTEN`
          rejectOnce(
            new Error(
              `OAuth callback port ${port} is already in use — another process may be holding it. ` +
                `Run \`${findCmd}\` to find it.`,
            ),
          )
        } else {
          rejectOnce(new Error(`OAuth callback server failed: ${err.message}`))
        }
      })

      server.listen(port, '127.0.0.1', async () => {
        try {
          logMCPDebug(serverName, `Starting SDK auth`)
          logMCPDebug(serverName, `Server URL: ${serverConfig.url}`)

          
          
          const result = await sdkAuth(provider, {
            serverUrl: serverConfig.url,
            scope: wwwAuthParams.scope,
            resourceMetadataUrl: wwwAuthParams.resourceMetadataUrl,
          })
          logMCPDebug(serverName, `Initial auth result: ${result}`)

          if (result !== 'REDIRECT') {
            logMCPDebug(
              serverName,
              `Unexpected auth result, expected REDIRECT: ${result}`,
            )
          }
        } catch (error) {
          logMCPDebug(serverName, `SDK auth error: ${error}`)
          cleanup()
          rejectOnce(new Error(`SDK auth failed: ${errorMessage(error)}`))
        }
      })

      
      
      
      
      server.unref()

      timeoutId = setTimeout(
        (cleanup, rejectOnce) => {
          cleanup()
          rejectOnce(new Error('Authentication timeout'))
        },
        5 * 60 * 1000, 
        cleanup,
        rejectOnce,
      )
      timeoutId.unref()
    })

    authorizationCodeObtained = true

    
    logMCPDebug(serverName, `Completing auth flow with authorization code`)
    const result = await sdkAuth(provider, {
      serverUrl: serverConfig.url,
      authorizationCode,
      resourceMetadataUrl: wwwAuthParams.resourceMetadataUrl,
    })

    logMCPDebug(serverName, `Auth result: ${result}`)

    if (result === 'AUTHORIZED') {
      
      const savedTokens = await provider.tokens()
      logMCPDebug(
        serverName,
        `Tokens after auth: ${savedTokens ? 'Present' : 'Missing'}`,
      )
      if (savedTokens) {
        logMCPDebug(
          serverName,
          `Token access_token length: ${savedTokens.access_token?.length}`,
        )
        logMCPDebug(serverName, `Token expires_in: ${savedTokens.expires_in}`)
      }

      logEvent('tengu_mcp_oauth_flow_success', {
        flowAttemptId:
          flowAttemptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        transportType:
          serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(getLoggingSafeMcpBaseUrl(serverConfig)
          ? {
              mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
                serverConfig,
              ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
      })
    } else {
      throw new Error('Unexpected auth result: ' + result)
    }
  } catch (error) {
    logMCPDebug(serverName, `Error during auth completion: ${error}`)

    
    
    
    let reason: MCPOAuthFlowErrorReason = 'unknown'
    let oauthErrorCode: string | undefined
    let httpStatus: number | undefined

    if (error instanceof AuthenticationCancelledError) {
      reason = 'cancelled'
    } else if (authorizationCodeObtained) {
      reason = 'token_exchange_failed'
    } else {
      const msg = errorMessage(error)
      if (msg.includes('Authentication timeout')) {
        reason = 'timeout'
      } else if (msg.includes('OAuth state mismatch')) {
        reason = 'state_mismatch'
      } else if (msg.includes('OAuth error:')) {
        reason = 'provider_denied'
      } else if (
        msg.includes('already in use') ||
        msg.includes('EADDRINUSE') ||
        msg.includes('callback server failed') ||
        msg.includes('No available port')
      ) {
        reason = 'port_unavailable'
      } else if (msg.includes('SDK auth failed')) {
        reason = 'sdk_auth_failed'
      }
    }

    
    
    
    if (error instanceof OAuthError) {
      oauthErrorCode = error.errorCode
      
      
      
      const statusMatch = error.message.match(/^HTTP (\d{3}):/)
      if (statusMatch) {
        httpStatus = Number(statusMatch[1])
      }
      
      if (
        error.errorCode === 'invalid_client' &&
        error.message.includes('Client not found')
      ) {
        const storage = getSecureStorage()
        const existingData = storage.read() || {}
        const serverKey = getServerKey(serverName, serverConfig)
        if (existingData.mcpOAuth?.[serverKey]) {
          delete existingData.mcpOAuth[serverKey].clientId
          delete existingData.mcpOAuth[serverKey].clientSecret
          storage.update(existingData)
        }
      }
    }

    logEvent('tengu_mcp_oauth_flow_error', {
      flowAttemptId:
        flowAttemptId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      reason:
        reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_code:
        oauthErrorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      http_status:
        httpStatus?.toString() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      transportType:
        serverConfig.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(getLoggingSafeMcpBaseUrl(serverConfig)
        ? {
            mcpServerBaseUrl: getLoggingSafeMcpBaseUrl(
              serverConfig,
            ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    })
    throw error
  }
}

export function wrapFetchWithStepUpDetection(
  baseFetch: FetchLike,
  provider: ClaudeAuthProvider,
): FetchLike {
  return async (url, init) => {
    const response = await baseFetch(url, init)
    if (response.status === 403) {
      const wwwAuth = response.headers.get('WWW-Authenticate')
      if (wwwAuth?.includes('insufficient_scope')) {
        
        
        const match = wwwAuth.match(/scope=(?:"([^"]+)"|([^\s,]+))/)
        const scope = match?.[1] ?? match?.[2]
        if (scope) {
          provider.markStepUpPending(scope)
        }
      }
    }
    return response
  }
}

export class ClaudeAuthProvider implements OAuthClientProvider {
  private serverName: string
  private serverConfig: McpSSEServerConfig | McpHTTPServerConfig
  private redirectUri: string
  private handleRedirection: boolean
  private _codeVerifier?: string
  private _authorizationUrl?: string
  private _state?: string
  private _scopes?: string
  private _metadata?: Awaited<
    ReturnType<typeof discoverAuthorizationServerMetadata>
  >
  private _refreshInProgress?: Promise<OAuthTokens | undefined>
  private _pendingStepUpScope?: string
  private onAuthorizationUrlCallback?: (url: string) => void
  private skipBrowserOpen: boolean

  constructor(
    serverName: string,
    serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
    redirectUri: string = buildRedirectUri(),
    handleRedirection = false,
    onAuthorizationUrl?: (url: string) => void,
    skipBrowserOpen?: boolean,
  ) {
    this.serverName = serverName
    this.serverConfig = serverConfig
    this.redirectUri = redirectUri
    this.handleRedirection = handleRedirection
    this.onAuthorizationUrlCallback = onAuthorizationUrl
    this.skipBrowserOpen = skipBrowserOpen ?? false
  }

  get redirectUrl(): string {
    return this.redirectUri
  }

  get authorizationUrl(): string | undefined {
    return this._authorizationUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    const metadata: OAuthClientMetadata = {
      client_name: `Claude Code Next (${this.serverName})`,
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', 
    }

    
    const metadataScope = getScopeFromMetadata(this._metadata)
    if (metadataScope) {
      metadata.scope = metadataScope
      logMCPDebug(
        this.serverName,
        `Using scope from metadata: ${metadata.scope}`,
      )
    }

    return metadata
  }

  

  get clientMetadataUrl(): string | undefined {
    const override = process.env.MCP_OAUTH_CLIENT_METADATA_URL
    if (override) {
      logMCPDebug(this.serverName, `Using CIMD URL from env: ${override}`)
      return override
    }
    return MCP_CLIENT_METADATA_URL
  }

  setMetadata(
    metadata: Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>,
  ): void {
    this._metadata = metadata
  }

  

  markStepUpPending(scope: string): void {
    this._pendingStepUpScope = scope
    logMCPDebug(this.serverName, `Marked step-up pending: ${scope}`)
  }

  async state(): Promise<string> {
    
    if (!this._state) {
      this._state = randomBytes(32).toString('base64url')
      logMCPDebug(this.serverName, 'Generated new OAuth state')
    }
    return this._state
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const storage = getSecureStorage()
    const data = storage.read()
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    
    const storedInfo = data?.mcpOAuth?.[serverKey]
    if (storedInfo?.clientId) {
      logMCPDebug(this.serverName, `Found client info`)
      return {
        client_id: storedInfo.clientId,
        client_secret: storedInfo.clientSecret,
      }
    }

    
    const configClientId = this.serverConfig.oauth?.clientId
    if (configClientId) {
      const clientConfig = data?.mcpOAuthClientConfig?.[serverKey]
      logMCPDebug(this.serverName, `Using pre-configured client ID`)
      return {
        client_id: configClientId,
        client_secret: clientConfig?.clientSecret,
      }
    }

    
    logMCPDebug(this.serverName, `No client info found`)
    return undefined
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationFull,
  ): Promise<void> {
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    const updatedData: SecureStorageData = {
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...existingData.mcpOAuth?.[serverKey],
          serverName: this.serverName,
          serverUrl: this.serverConfig.url,
          clientId: clientInformation.client_id,
          clientSecret: clientInformation.client_secret,
          
          accessToken: existingData.mcpOAuth?.[serverKey]?.accessToken || '',
          expiresAt: existingData.mcpOAuth?.[serverKey]?.expiresAt || 0,
        },
      },
    }

    storage.update(updatedData)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    
    
    
    
    
    
    
    const storage = getSecureStorage()
    const data = await storage.readAsync()
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    const tokenData = data?.mcpOAuth?.[serverKey]

    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    if (
      isXaaEnabled() &&
      this.serverConfig.oauth?.xaa &&
      !tokenData?.refreshToken &&
      (!tokenData?.accessToken ||
        (tokenData.expiresAt - Date.now()) / 1000 <= 300)
    ) {
      if (!this._refreshInProgress) {
        logMCPDebug(
          this.serverName,
          tokenData
            ? `XAA: access_token expiring, attempting silent exchange`
            : `XAA: no access_token yet, attempting silent exchange`,
        )
        this._refreshInProgress = this.xaaRefresh().finally(() => {
          this._refreshInProgress = undefined
        })
      }
      try {
        const refreshed = await this._refreshInProgress
        if (refreshed) return refreshed
      } catch (e) {
        logMCPDebug(
          this.serverName,
          `XAA silent exchange failed: ${errorMessage(e)}`,
        )
      }
      
      
      
    }

    if (!tokenData) {
      logMCPDebug(this.serverName, `No token data found`)
      return undefined
    }

    
    const expiresIn = (tokenData.expiresAt - Date.now()) / 1000

    
    
    
    const currentScopes = tokenData.scope?.split(' ') ?? []
    const needsStepUp =
      this._pendingStepUpScope !== undefined &&
      this._pendingStepUpScope.split(' ').some(s => !currentScopes.includes(s))
    if (needsStepUp) {
      logMCPDebug(
        this.serverName,
        `Step-up pending (${this._pendingStepUpScope}), omitting refresh_token`,
      )
    }

    
    if (expiresIn <= 0 && !tokenData.refreshToken) {
      logMCPDebug(this.serverName, `Token expired without refresh token`)
      return undefined
    }

    
    
    
    
    
    if (expiresIn <= 300 && tokenData.refreshToken && !needsStepUp) {
      
      if (!this._refreshInProgress) {
        logMCPDebug(
          this.serverName,
          `Token expires in ${Math.floor(expiresIn)}s, attempting proactive refresh`,
        )
        this._refreshInProgress = this.refreshAuthorization(
          tokenData.refreshToken,
        ).finally(() => {
          this._refreshInProgress = undefined
        })
      } else {
        logMCPDebug(
          this.serverName,
          `Token refresh already in progress, reusing existing promise`,
        )
      }

      try {
        const refreshed = await this._refreshInProgress
        if (refreshed) {
          logMCPDebug(this.serverName, `Token refreshed successfully`)
          return refreshed
        }
        logMCPDebug(
          this.serverName,
          `Token refresh failed, returning current tokens`,
        )
      } catch (error) {
        logMCPDebug(
          this.serverName,
          `Token refresh error: ${errorMessage(error)}`,
        )
      }
    }

    
    const tokens = {
      access_token: tokenData.accessToken,
      refresh_token: needsStepUp ? undefined : tokenData.refreshToken,
      expires_in: expiresIn,
      scope: tokenData.scope,
      token_type: 'Bearer',
    }

    logMCPDebug(this.serverName, `Returning tokens`)
    logMCPDebug(this.serverName, `Token length: ${tokens.access_token?.length}`)
    logMCPDebug(this.serverName, `Has refresh token: ${!!tokens.refresh_token}`)
    logMCPDebug(this.serverName, `Expires in: ${Math.floor(expiresIn)}s`)

    return tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this._pendingStepUpScope = undefined
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    logMCPDebug(this.serverName, `Saving tokens`)
    logMCPDebug(this.serverName, `Token expires in: ${tokens.expires_in}`)
    logMCPDebug(this.serverName, `Has refresh token: ${!!tokens.refresh_token}`)

    const updatedData: SecureStorageData = {
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...existingData.mcpOAuth?.[serverKey],
          serverName: this.serverName,
          serverUrl: this.serverConfig.url,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
          scope: tokens.scope,
        },
      },
    }

    storage.update(updatedData)
  }

  

  private async xaaRefresh(): Promise<OAuthTokens | undefined> {
    const idp = getXaaIdpSettings()
    if (!idp) return undefined 

    const idToken = getCachedIdpIdToken(idp.issuer)
    if (!idToken) {
      logMCPDebug(
        this.serverName,
        'XAA: id_token not cached, needs interactive re-auth',
      )
      return undefined
    }

    const clientId = this.serverConfig.oauth?.clientId
    const clientConfig = getMcpClientConfig(this.serverName, this.serverConfig)
    if (!clientId || !clientConfig?.clientSecret) {
      logMCPDebug(
        this.serverName,
        'XAA: missing clientId or clientSecret in config — skipping silent refresh',
      )
      return undefined 
    }

    const idpClientSecret = getIdpClientSecret(idp.issuer)

    
    
    
    
    let oidc
    try {
      oidc = await discoverOidc(idp.issuer)
    } catch (e) {
      logMCPDebug(
        this.serverName,
        `XAA: OIDC discovery failed in silent refresh: ${errorMessage(e)}`,
      )
      return undefined
    }

    try {
      const tokens = await performCrossAppAccess(
        this.serverConfig.url,
        {
          clientId,
          clientSecret: clientConfig.clientSecret,
          idpClientId: idp.clientId,
          idpClientSecret,
          idpIdToken: idToken,
          idpTokenEndpoint: oidc.token_endpoint,
        },
        this.serverName,
      )
      
      
      
      
      
      const storage = getSecureStorage()
      const existingData = storage.read() || {}
      const serverKey = getServerKey(this.serverName, this.serverConfig)
      const prev = existingData.mcpOAuth?.[serverKey]
      storage.update({
        ...existingData,
        mcpOAuth: {
          ...existingData.mcpOAuth,
          [serverKey]: {
            ...prev,
            serverName: this.serverName,
            serverUrl: this.serverConfig.url,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? prev?.refreshToken,
            expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
            scope: tokens.scope,
            clientId,
            clientSecret: clientConfig.clientSecret,
            discoveryState: {
              authorizationServerUrl: tokens.authorizationServerUrl,
            },
          },
        },
      })
      return {
        access_token: tokens.access_token,
        token_type: 'Bearer',
        expires_in: tokens.expires_in,
        scope: tokens.scope,
        refresh_token: tokens.refresh_token,
      }
    } catch (e) {
      if (e instanceof XaaTokenExchangeError && e.shouldClearIdToken) {
        clearIdpIdToken(idp.issuer)
        logMCPDebug(
          this.serverName,
          'XAA: cleared id_token after exchange failure',
        )
      }
      throw e
    }
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    
    this._authorizationUrl = authorizationUrl.toString()

    
    const scopes = authorizationUrl.searchParams.get('scope')
    logMCPDebug(
      this.serverName,
      `Authorization URL: ${redactSensitiveUrlParams(authorizationUrl.toString())}`,
    )
    logMCPDebug(this.serverName, `Scopes in URL: ${scopes || 'NOT FOUND'}`)

    if (scopes) {
      this._scopes = scopes
      logMCPDebug(
        this.serverName,
        `Captured scopes from authorization URL: ${scopes}`,
      )
    } else {
      
      const metadataScope = getScopeFromMetadata(this._metadata)
      if (metadataScope) {
        this._scopes = metadataScope
        logMCPDebug(
          this.serverName,
          `Using scopes from metadata: ${metadataScope}`,
        )
      } else {
        logMCPDebug(this.serverName, `No scopes available from URL or metadata`)
      }
    }

    
    
    
    
    
    
    if (this._scopes && !this.handleRedirection) {
      const storage = getSecureStorage()
      const existingData = storage.read() || {}
      const serverKey = getServerKey(this.serverName, this.serverConfig)
      const existing = existingData.mcpOAuth?.[serverKey]
      if (existing) {
        existing.stepUpScope = this._scopes
        storage.update(existingData)
        logMCPDebug(this.serverName, `Persisted step-up scope: ${this._scopes}`)
      }
    }

    if (!this.handleRedirection) {
      logMCPDebug(
        this.serverName,
        `Redirection handling is disabled, skipping redirect`,
      )
      return
    }

    
    const urlString = authorizationUrl.toString()
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      throw new Error(
        'Invalid authorization URL: must use http:// or https:// scheme',
      )
    }

    logMCPDebug(this.serverName, `Redirecting to authorization URL`)
    const redactedUrl = redactSensitiveUrlParams(urlString)
    logMCPDebug(this.serverName, `Authorization URL: ${redactedUrl}`)

    
    
    if (this.onAuthorizationUrlCallback) {
      this.onAuthorizationUrlCallback(urlString)
    }

    if (!this.skipBrowserOpen) {
      logMCPDebug(this.serverName, `Opening authorization URL: ${redactedUrl}`)

      const success = await openBrowser(urlString)
      if (!success) {
        logMCPDebug(
          this.serverName,
          `Browser didn't open automatically. URL is shown in UI.`,
        )
      }
    } else {
      logMCPDebug(
        this.serverName,
        `Skipping browser open (skipBrowserOpen=true). URL: ${redactedUrl}`,
      )
    }
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    logMCPDebug(this.serverName, `Saving code verifier`)
    this._codeVerifier = codeVerifier
  }

  async codeVerifier(): Promise<string> {
    if (!this._codeVerifier) {
      logMCPDebug(this.serverName, `No code verifier saved`)
      throw new Error('No code verifier saved')
    }
    logMCPDebug(this.serverName, `Returning code verifier`)
    return this._codeVerifier
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    const storage = getSecureStorage()
    const existingData = storage.read()
    if (!existingData?.mcpOAuth) return

    const serverKey = getServerKey(this.serverName, this.serverConfig)
    const tokenData = existingData.mcpOAuth[serverKey]
    if (!tokenData) return

    switch (scope) {
      case 'all':
        delete existingData.mcpOAuth[serverKey]
        break
      case 'client':
        tokenData.clientId = undefined
        tokenData.clientSecret = undefined
        break
      case 'tokens':
        tokenData.accessToken = ''
        tokenData.refreshToken = undefined
        tokenData.expiresAt = 0
        break
      case 'verifier':
        this._codeVerifier = undefined
        return
      case 'discovery':
        tokenData.discoveryState = undefined
        tokenData.stepUpScope = undefined
        break
    }

    storage.update(existingData)
    logMCPDebug(this.serverName, `Invalidated credentials (scope: ${scope})`)
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const storage = getSecureStorage()
    const existingData = storage.read() || {}
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    logMCPDebug(
      this.serverName,
      `Saving discovery state (authServer: ${state.authorizationServerUrl})`,
    )

    
    
    
    
    
    
    
    
    
    const updatedData: SecureStorageData = {
      ...existingData,
      mcpOAuth: {
        ...existingData.mcpOAuth,
        [serverKey]: {
          ...existingData.mcpOAuth?.[serverKey],
          serverName: this.serverName,
          serverUrl: this.serverConfig.url,
          accessToken: existingData.mcpOAuth?.[serverKey]?.accessToken || '',
          expiresAt: existingData.mcpOAuth?.[serverKey]?.expiresAt || 0,
          discoveryState: {
            authorizationServerUrl: state.authorizationServerUrl,
            resourceMetadataUrl: state.resourceMetadataUrl,
          },
        },
      },
    }

    storage.update(updatedData)
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const storage = getSecureStorage()
    const data = storage.read()
    const serverKey = getServerKey(this.serverName, this.serverConfig)

    const cached = data?.mcpOAuth?.[serverKey]?.discoveryState
    if (cached?.authorizationServerUrl) {
      logMCPDebug(
        this.serverName,
        `Returning cached discovery state (authServer: ${cached.authorizationServerUrl})`,
      )

      return {
        authorizationServerUrl: cached.authorizationServerUrl,
        resourceMetadataUrl: cached.resourceMetadataUrl,
        resourceMetadata:
          cached.resourceMetadata as OAuthDiscoveryState['resourceMetadata'],
        authorizationServerMetadata:
          cached.authorizationServerMetadata as OAuthDiscoveryState['authorizationServerMetadata'],
      }
    }

    
    const metadataUrl = this.serverConfig.oauth?.authServerMetadataUrl
    if (metadataUrl) {
      logMCPDebug(
        this.serverName,
        `Fetching metadata from configured URL: ${metadataUrl}`,
      )
      try {
        const metadata = await fetchAuthServerMetadata(
          this.serverName,
          this.serverConfig.url,
          metadataUrl,
        )
        if (metadata) {
          return {
            authorizationServerUrl: metadata.issuer,
            authorizationServerMetadata:
              metadata as OAuthDiscoveryState['authorizationServerMetadata'],
          }
        }
      } catch (error) {
        logMCPDebug(
          this.serverName,
          `Failed to fetch from configured metadata URL: ${errorMessage(error)}`,
        )
      }
    }

    return undefined
  }

  async refreshAuthorization(
    refreshToken: string,
  ): Promise<OAuthTokens | undefined> {
    const serverKey = getServerKey(this.serverName, this.serverConfig)
    const claudeDir = getClaudeConfigHomeDir()
    await mkdir(claudeDir, { recursive: true })
    const sanitizedKey = serverKey.replace(/[^a-zA-Z0-9]/g, '_')
    const lockfilePath = join(claudeDir, `mcp-refresh-${sanitizedKey}.lock`)

    let release: (() => Promise<void>) | undefined
    for (let retry = 0; retry < MAX_LOCK_RETRIES; retry++) {
      try {
        logMCPDebug(
          this.serverName,
          `Acquiring refresh lock (attempt ${retry + 1})`,
        )
        release = await lockfile.lock(lockfilePath, {
          realpath: false,
          onCompromised: () => {
            logMCPDebug(this.serverName, `Refresh lock was compromised`)
          },
        })
        logMCPDebug(this.serverName, `Acquired refresh lock`)
        break
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code === 'ELOCKED') {
          logMCPDebug(
            this.serverName,
            `Refresh lock held by another process, waiting (attempt ${retry + 1}/${MAX_LOCK_RETRIES})`,
          )
          await sleep(1000 + Math.random() * 1000)
          continue
        }
        logMCPDebug(
          this.serverName,
          `Failed to acquire refresh lock: ${code}, proceeding without lock`,
        )
        break
      }
    }
    if (!release) {
      logMCPDebug(
        this.serverName,
        `Could not acquire refresh lock after ${MAX_LOCK_RETRIES} retries, proceeding without lock`,
      )
    }

    try {
      
      clearKeychainCache()
      const storage = getSecureStorage()
      const data = storage.read()
      const tokenData = data?.mcpOAuth?.[serverKey]
      if (tokenData) {
        const expiresIn = (tokenData.expiresAt - Date.now()) / 1000
        if (expiresIn > 300) {
          logMCPDebug(
            this.serverName,
            `Another process already refreshed tokens (expires in ${Math.floor(expiresIn)}s)`,
          )
          return {
            access_token: tokenData.accessToken,
            refresh_token: tokenData.refreshToken,
            expires_in: expiresIn,
            scope: tokenData.scope,
            token_type: 'Bearer',
          }
        }
        
        if (tokenData.refreshToken) {
          refreshToken = tokenData.refreshToken
        }
      }
      return await this._doRefresh(refreshToken)
    } finally {
      if (release) {
        try {
          await release()
          logMCPDebug(this.serverName, `Released refresh lock`)
        } catch {
          logMCPDebug(this.serverName, `Failed to release refresh lock`)
        }
      }
    }
  }

  private async _doRefresh(
    refreshToken: string,
  ): Promise<OAuthTokens | undefined> {
    const MAX_ATTEMPTS = 3

    const mcpServerBaseUrl = getLoggingSafeMcpBaseUrl(this.serverConfig)
    const emitRefreshEvent = (
      outcome: 'success' | 'failure',
      reason?: MCPRefreshFailureReason,
    ): void => {
      logEvent(
        outcome === 'success'
          ? 'tengu_mcp_oauth_refresh_success'
          : 'tengu_mcp_oauth_refresh_failure',
        {
          transportType: this.serverConfig
            .type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          ...(mcpServerBaseUrl
            ? {
                mcpServerBaseUrl:
                  mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(reason
            ? {
                reason:
                  reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        },
      )
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        logMCPDebug(this.serverName, `Starting token refresh`)
        const authFetch = createAuthFetch()

        
        
        
        
        
        
        
        let metadata = this._metadata
        if (!metadata) {
          const cached = await this.discoveryState()
          if (cached?.authorizationServerMetadata) {
            logMCPDebug(
              this.serverName,
              `Using persisted auth server metadata for refresh`,
            )
            metadata = cached.authorizationServerMetadata
          } else if (cached?.authorizationServerUrl) {
            logMCPDebug(
              this.serverName,
              `Re-discovering metadata from persisted auth server URL: ${cached.authorizationServerUrl}`,
            )
            metadata = await discoverAuthorizationServerMetadata(
              cached.authorizationServerUrl,
              { fetchFn: authFetch },
            )
          }
        }
        if (!metadata) {
          metadata = await fetchAuthServerMetadata(
            this.serverName,
            this.serverConfig.url,
            this.serverConfig.oauth?.authServerMetadataUrl,
            authFetch,
          )
        }
        if (!metadata) {
          logMCPDebug(this.serverName, `Failed to discover OAuth metadata`)
          emitRefreshEvent('failure', 'metadata_discovery_failed')
          return undefined
        }
        
        this._metadata = metadata

        const clientInfo = await this.clientInformation()
        if (!clientInfo) {
          logMCPDebug(this.serverName, `No client information available`)
          emitRefreshEvent('failure', 'no_client_info')
          return undefined
        }

        const newTokens = await sdkRefreshAuthorization(
          new URL(this.serverConfig.url),
          {
            metadata,
            clientInformation: clientInfo,
            refreshToken,
            resource: new URL(this.serverConfig.url),
            fetchFn: authFetch,
          },
        )

        if (newTokens) {
          logMCPDebug(this.serverName, `Token refresh successful`)
          await this.saveTokens(newTokens)
          emitRefreshEvent('success')
          return newTokens
        }

        logMCPDebug(this.serverName, `Token refresh returned no tokens`)
        emitRefreshEvent('failure', 'no_tokens_returned')
        return undefined
      } catch (error) {
        
        
        if (error instanceof InvalidGrantError) {
          logMCPDebug(
            this.serverName,
            `Token refresh failed with invalid_grant: ${error.message}`,
          )
          clearKeychainCache()
          const storage = getSecureStorage()
          const data = storage.read()
          const serverKey = getServerKey(this.serverName, this.serverConfig)
          const tokenData = data?.mcpOAuth?.[serverKey]
          if (tokenData) {
            const expiresIn = (tokenData.expiresAt - Date.now()) / 1000
            if (expiresIn > 300) {
              logMCPDebug(
                this.serverName,
                `Another process refreshed tokens, using those`,
              )
              
              
              
              return {
                access_token: tokenData.accessToken,
                refresh_token: tokenData.refreshToken,
                expires_in: expiresIn,
                scope: tokenData.scope,
                token_type: 'Bearer',
              }
            }
          }
          logMCPDebug(
            this.serverName,
            `No valid tokens in storage, clearing stored tokens`,
          )
          await this.invalidateCredentials('tokens')
          emitRefreshEvent('failure', 'invalid_grant')
          return undefined
        }

        
        const isTimeoutError =
          error instanceof Error &&
          /timeout|timed out|etimedout|econnreset/i.test(error.message)
        const isTransientServerError =
          error instanceof ServerError ||
          error instanceof TemporarilyUnavailableError ||
          error instanceof TooManyRequestsError
        const isRetryable = isTimeoutError || isTransientServerError

        if (!isRetryable || attempt >= MAX_ATTEMPTS) {
          logMCPDebug(
            this.serverName,
            `Token refresh failed: ${errorMessage(error)}`,
          )
          emitRefreshEvent(
            'failure',
            isRetryable ? 'transient_retries_exhausted' : 'request_failed',
          )
          return undefined
        }

        const delayMs = 1000 * Math.pow(2, attempt - 1) 
        logMCPDebug(
          this.serverName,
          `Token refresh failed, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`,
        )
        await sleep(delayMs)
      }
    }

    return undefined
  }
}

export async function readClientSecret(): Promise<string> {
  const envSecret = process.env.MCP_CLIENT_SECRET
  if (envSecret) {
    return envSecret
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'No TTY available to prompt for client secret. Set MCP_CLIENT_SECRET env var instead.',
    )
  }

  return new Promise((resolve, reject) => {
    process.stderr.write('Enter OAuth client secret: ')
    process.stdin.setRawMode?.(true)
    let secret = ''
    const onData = (ch: Buffer) => {
      const c = ch.toString()
      if (c === '\n' || c === '\r') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        process.stderr.write('\n')
        resolve(secret)
      } else if (c === '\u0003') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        reject(new Error('Cancelled'))
      } else if (c === '\u007F' || c === '\b') {
        secret = secret.slice(0, -1)
      } else {
        secret += c
      }
    }
    process.stdin.on('data', onData)
  })
}

export function saveMcpClientSecret(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  clientSecret: string,
): void {
  const storage = getSecureStorage()
  const existingData = storage.read() || {}
  const serverKey = getServerKey(serverName, serverConfig)
  storage.update({
    ...existingData,
    mcpOAuthClientConfig: {
      ...existingData.mcpOAuthClientConfig,
      [serverKey]: { clientSecret },
    },
  })
}

export function clearMcpClientConfig(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): void {
  const storage = getSecureStorage()
  const existingData = storage.read()
  if (!existingData?.mcpOAuthClientConfig) return
  const serverKey = getServerKey(serverName, serverConfig)
  if (existingData.mcpOAuthClientConfig[serverKey]) {
    delete existingData.mcpOAuthClientConfig[serverKey]
    storage.update(existingData)
  }
}

export function getMcpClientConfig(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): { clientSecret?: string } | undefined {
  const storage = getSecureStorage()
  const data = storage.read()
  const serverKey = getServerKey(serverName, serverConfig)
  return data?.mcpOAuthClientConfig?.[serverKey]
}

function getScopeFromMetadata(
  metadata: AuthorizationServerMetadata | undefined,
): string | undefined {
  if (!metadata) return undefined
  
  if ('scope' in metadata && typeof metadata.scope === 'string') {
    return metadata.scope
  }
  
  if (
    'default_scope' in metadata &&
    typeof metadata.default_scope === 'string'
  ) {
    return metadata.default_scope
  }
  
  if (metadata.scopes_supported && Array.isArray(metadata.scopes_supported)) {
    return metadata.scopes_supported.join(' ')
  }
  return undefined
}
