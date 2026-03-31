import { feature } from 'bun:bundle'
import type {
  Base64ImageSource,
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  createFetchWithInit,
  type FetchLike,
  type Transport,
} from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  type ElicitRequestURLParams,
  type ElicitResult,
  ErrorCode,
  type JSONRPCMessage,
  type ListPromptsResult,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListRootsRequestSchema,
  type ListToolsResult,
  ListToolsResultSchema,
  McpError,
  type PromptMessage,
  type ResourceLink,
} from '@modelcontextprotocol/sdk/types.js'
import mapValues from 'lodash-es/mapValues.js'
import memoize from 'lodash-es/memoize.js'
import zipObject from 'lodash-es/zipObject.js'
import pMap from 'p-map'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { PRODUCT_URL } from '../../constants/product.js'
import type { AppState } from '../../state/AppState.js'
import {
  type Tool,
  type ToolCallProgress,
  toolMatchesName,
} from '../../Tool.js'
import { ListMcpResourcesTool } from '../../tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { type MCPProgress, MCPTool } from '../../tools/MCPTool/MCPTool.js'
import { createMcpAuthTool } from '../../tools/McpAuthTool/McpAuthTool.js'
import { ReadMcpResourceTool } from '../../tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { createAbortController } from '../../utils/abortController.js'
import { count } from '../../utils/array.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
} from '../../utils/auth.js'
import { registerCleanup } from '../../utils/cleanupRegistry.js'
import { detectCodeIndexingFromMcpServerName } from '../../utils/codeIndexing.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import {
  errorMessage,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../utils/errors.js'
import { getMCPUserAgent } from '../../utils/http.js'
import { maybeNotifyIDEConnected } from '../../utils/ide.js'
import { maybeResizeAndDownsampleImageBuffer } from '../../utils/imageResizer.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import {
  getBinaryBlobSavedMessage,
  getFormatDescription,
  getLargeOutputInstructions,
  persistBinaryContent,
} from '../../utils/mcpOutputStorage.js'
import {
  getContentSizeEstimate,
  type MCPToolResult,
  mcpContentNeedsTruncation,
  truncateMcpContentIfNeeded,
} from '../../utils/mcpValidation.js'
import { WebSocketTransport } from '../../utils/mcpWebSocketTransport.js'
import { memoizeWithLRU } from '../../utils/memoize.js'
import { getWebSocketTLSOptions } from '../../utils/mtls.js'
import {
  getProxyFetchOptions,
  getWebSocketProxyAgent,
  getWebSocketProxyUrl,
} from '../../utils/proxy.js'
import { recursivelySanitizeUnicode } from '../../utils/sanitization.js'
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js'
import { subprocessEnv } from '../../utils/subprocessEnv.js'
import {
  isPersistError,
  persistToolResult,
} from '../../utils/toolResultStorage.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import {
  type ElicitationWaitingState,
  runElicitationHooks,
  runElicitationResultHooks,
} from './elicitationHandler.js'
import { buildMcpToolName } from './mcpStringUtils.js'
import { normalizeNameForMCP } from './normalization.js'
import { getLoggingSafeMcpBaseUrl } from './utils.js'

const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? (
      require('../../skills/mcpSkills.js') as typeof import('../../skills/mcpSkills.js')
    ).fetchMcpSkillsForClient
  : null

import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { AssistantMessage } from 'src/types/message.js'

import { classifyMcpToolForCollapse } from '../../tools/MCPTool/classifyForCollapse.js'
import { clearKeychainCache } from '../../utils/secureStorage/macOsKeychainHelpers.js'
import { sleep } from '../../utils/sleep.js'
import {
  ClaudeAuthProvider,
  hasMcpDiscoveryButNoToken,
  wrapFetchWithStepUpDetection,
} from './auth.js'
import { markClaudeAiMcpConnected } from './claudeai.js'
import { getAllMcpConfigs, isMcpServerDisabled } from './config.js'
import { getMcpServerHeaders } from './headersHelper.js'
import { SdkControlClientTransport } from './SdkControlTransport.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  McpSdkServerConfig,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'

export class McpAuthError extends Error {
  serverName: string
  constructor(serverName: string, message: string) {
    super(message)
    this.name = 'McpAuthError'
    this.serverName = serverName
  }
}

class McpSessionExpiredError extends Error {
  constructor(serverName: string) {
    super(`MCP server "${serverName}" session expired`)
    this.name = 'McpSessionExpiredError'
  }
}

export class McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(
    message: string,
    telemetryMessage: string,
    readonly mcpMeta?: { _meta?: Record<string, unknown> },
  ) {
    super(message, telemetryMessage)
    this.name = 'McpToolCallError'
  }
}

export function isMcpSessionExpiredError(error: Error): boolean {
  const httpStatus =
    'code' in error ? (error as Error & { code?: number }).code : undefined
  if (httpStatus !== 404) {
    return false
  }
  
  
  
  return (
    error.message.includes('"code":-32001') ||
    error.message.includes('"code": -32001')
  )
}

const DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000

const MAX_MCP_DESCRIPTION_LENGTH = 2048

function getMcpToolTimeoutMs(): number {
  return (
    parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10) ||
    DEFAULT_MCP_TOOL_TIMEOUT_MS
  )
}

import { isClaudeInChromeMCPServer } from '../../utils/claudeInChrome/common.js'

const claudeInChromeToolRendering =
  (): typeof import('../../utils/claudeInChrome/toolRendering.js') =>
    require('../../utils/claudeInChrome/toolRendering.js')

const computerUseWrapper = feature('CHICAGO_MCP')
  ? (): typeof import('../../utils/computerUse/wrapper.js') =>
      require('../../utils/computerUse/wrapper.js')
  : undefined
const isComputerUseMCPServer = feature('CHICAGO_MCP')
  ? (
      require('../../utils/computerUse/common.js') as typeof import('../../utils/computerUse/common.js')
    ).isComputerUseMCPServer
  : undefined

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'

const MCP_AUTH_CACHE_TTL_MS = 15 * 60 * 1000 

type McpAuthCacheData = Record<string, { timestamp: number }>

function getMcpAuthCachePath(): string {
  return join(getClaudeConfigHomeDir(), 'mcp-needs-auth-cache.json')
}

let authCachePromise: Promise<McpAuthCacheData> | null = null

function getMcpAuthCache(): Promise<McpAuthCacheData> {
  if (!authCachePromise) {
    authCachePromise = readFile(getMcpAuthCachePath(), 'utf-8')
      .then(data => jsonParse(data) as McpAuthCacheData)
      .catch(() => ({}))
  }
  return authCachePromise
}

async function isMcpAuthCached(serverId: string): Promise<boolean> {
  const cache = await getMcpAuthCache()
  const entry = cache[serverId]
  if (!entry) {
    return false
  }
  return Date.now() - entry.timestamp < MCP_AUTH_CACHE_TTL_MS
}

let writeChain = Promise.resolve()

function setMcpAuthCacheEntry(serverId: string): void {
  writeChain = writeChain
    .then(async () => {
      const cache = await getMcpAuthCache()
      cache[serverId] = { timestamp: Date.now() }
      const cachePath = getMcpAuthCachePath()
      await mkdir(dirname(cachePath), { recursive: true })
      await writeFile(cachePath, jsonStringify(cache))
      
      
      
      authCachePromise = null
    })
    .catch(() => {
      
    })
}

export function clearMcpAuthCache(): void {
  authCachePromise = null
  void unlink(getMcpAuthCachePath()).catch(() => {
    
  })
}

function mcpBaseUrlAnalytics(serverRef: ScopedMcpServerConfig): {
  mcpServerBaseUrl?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  const url = getLoggingSafeMcpBaseUrl(serverRef)
  return url
    ? {
        mcpServerBaseUrl:
          url as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }
    : {}
}

function handleRemoteAuthFailure(
  name: string,
  serverRef: ScopedMcpServerConfig,
  transportType: 'sse' | 'http' | 'claudeai-proxy',
): MCPServerConnection {
  logEvent('tengu_mcp_server_needs_auth', {
    transportType:
      transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...mcpBaseUrlAnalytics(serverRef),
  })
  const label: Record<typeof transportType, string> = {
    sse: 'SSE',
    http: 'HTTP',
    'claudeai-proxy': 'claude.ai proxy',
  }
  logMCPDebug(
    name,
    `Authentication required for ${label[transportType]} server`,
  )
  setMcpAuthCacheEntry(name)
  return { name, type: 'needs-auth', config: serverRef }
}

export function createClaudeAiProxyFetch(innerFetch: FetchLike): FetchLike {
  return async (url, init) => {
    const doRequest = async () => {
      await checkAndRefreshOAuthTokenIfNeeded()
      const currentTokens = getClaudeAIOAuthTokens()
      if (!currentTokens) {
        throw new Error('No claude.ai OAuth token available')
      }
      
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${currentTokens.accessToken}`)
      const response = await innerFetch(url, { ...init, headers })
      
      
      
      
      
      
      return { response, sentToken: currentTokens.accessToken }
    }

    const { response, sentToken } = await doRequest()
    if (response.status !== 401) {
      return response
    }
    
    
    
    
    
    const tokenChanged = await handleOAuth401Error(sentToken).catch(() => false)
    logEvent('tengu_mcp_claudeai_proxy_401', {
      tokenChanged:
        tokenChanged as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (!tokenChanged) {
      
      const now = getClaudeAIOAuthTokens()?.accessToken
      if (!now || now === sentToken) {
        return response
      }
    }
    try {
      return (await doRequest()).response
    } catch {
      
      
      return response
    }
  }
}

type WsClientLike = {
  readonly readyState: number
  close(): void
  send(data: string): void
}

async function createNodeWsClient(
  url: string,
  options: Record<string, unknown>,
): Promise<WsClientLike> {
  const wsModule = await import('ws')
  const WS = wsModule.default as unknown as new (
    url: string,
    protocols: string[],
    options: Record<string, unknown>,
  ) => WsClientLike
  return new WS(url, ['mcp'], options)
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

function getConnectionTimeoutMs(): number {
  return parseInt(process.env.MCP_TIMEOUT || '', 10) || 30000
}

const MCP_REQUEST_TIMEOUT_MS = 60000

const MCP_STREAMABLE_HTTP_ACCEPT = 'application/json, text/event-stream'

export function wrapFetchWithTimeout(baseFetch: FetchLike): FetchLike {
  return async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()

    
    
    if (method === 'GET') {
      return baseFetch(url, init)
    }

    
    
    
    
    
    const headers = new Headers(init?.headers)
    if (!headers.has('accept')) {
      headers.set('accept', MCP_STREAMABLE_HTTP_ACCEPT)
    }

    
    
    
    
    const controller = new AbortController()
    const timer = setTimeout(
      c =>
        c.abort(new DOMException('The operation timed out.', 'TimeoutError')),
      MCP_REQUEST_TIMEOUT_MS,
      controller,
    )
    timer.unref?.()

    const parentSignal = init?.signal
    const abort = () => controller.abort(parentSignal?.reason)
    parentSignal?.addEventListener('abort', abort)
    if (parentSignal?.aborted) {
      controller.abort(parentSignal.reason)
    }

    const cleanup = () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    }

    try {
      const response = await baseFetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      })
      cleanup()
      return response
    } catch (error) {
      cleanup()
      throw error
    }
  }
}

export function getMcpServerConnectionBatchSize(): number {
  return parseInt(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE || '', 10) || 3
}

function getRemoteMcpServerConnectionBatchSize(): number {
  return (
    parseInt(process.env.MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE || '', 10) ||
    20
  )
}

function isLocalMcpServer(config: ScopedMcpServerConfig): boolean {
  return !config.type || config.type === 'stdio' || config.type === 'sdk'
}

const ALLOWED_IDE_TOOLS = ['mcp__ide__executeCode', 'mcp__ide__getDiagnostics']
function isIncludedMcpTool(tool: Tool): boolean {
  return (
    !tool.name.startsWith('mcp__ide__') || ALLOWED_IDE_TOOLS.includes(tool.name)
  )
}

export function getServerCacheKey(
  name: string,
  serverRef: ScopedMcpServerConfig,
): string {
  return `${name}-${jsonStringify(serverRef)}`
}

export const connectToServer = memoize(
  async (
    name: string,
    serverRef: ScopedMcpServerConfig,
    serverStats?: {
      totalServers: number
      stdioCount: number
      sseCount: number
      httpCount: number
      sseIdeCount: number
      wsIdeCount: number
    },
  ): Promise<MCPServerConnection> => {
    const connectStartTime = Date.now()
    let inProcessServer:
      | { connect(t: Transport): Promise<void>; close(): Promise<void> }
      | undefined
    try {
      let transport

      
      
      const sessionIngressToken = getSessionIngressAuthToken()

      if (serverRef.type === 'sse') {
        
        const authProvider = new ClaudeAuthProvider(name, serverRef)

        
        const combinedHeaders = await getMcpServerHeaders(name, serverRef)

        
        const transportOptions: SSEClientTransportOptions = {
          authProvider,
          
          
          
          fetch: wrapFetchWithTimeout(
            wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
          ),
          requestInit: {
            headers: {
              'User-Agent': getMCPUserAgent(),
              ...combinedHeaders,
            },
          },
        }

        
        
        
        
        
        transportOptions.eventSourceInit = {
          fetch: async (url: string | URL, init?: RequestInit) => {
            
            const authHeaders: Record<string, string> = {}
            const tokens = await authProvider.tokens()
            if (tokens) {
              authHeaders.Authorization = `Bearer ${tokens.access_token}`
            }

            const proxyOptions = getProxyFetchOptions()
            
            return fetch(url, {
              ...init,
              ...proxyOptions,
              headers: {
                'User-Agent': getMCPUserAgent(),
                ...authHeaders,
                ...init?.headers,
                ...combinedHeaders,
                Accept: 'text/event-stream',
              },
            })
          },
        }

        transport = new SSEClientTransport(
          new URL(serverRef.url),
          transportOptions,
        )
        logMCPDebug(name, `SSE transport initialized, awaiting connection`)
      } else if (serverRef.type === 'sse-ide') {
        logMCPDebug(name, `Setting up SSE-IDE transport to ${serverRef.url}`)
        
        
        const proxyOptions = getProxyFetchOptions()
        const transportOptions: SSEClientTransportOptions =
          proxyOptions.dispatcher
            ? {
                eventSourceInit: {
                  fetch: async (url: string | URL, init?: RequestInit) => {
                    
                    return fetch(url, {
                      ...init,
                      ...proxyOptions,
                      headers: {
                        'User-Agent': getMCPUserAgent(),
                        ...init?.headers,
                      },
                    })
                  },
                },
              }
            : {}

        transport = new SSEClientTransport(
          new URL(serverRef.url),
          Object.keys(transportOptions).length > 0
            ? transportOptions
            : undefined,
        )
      } else if (serverRef.type === 'ws-ide') {
        const tlsOptions = getWebSocketTLSOptions()
        const wsHeaders = {
          'User-Agent': getMCPUserAgent(),
          ...(serverRef.authToken && {
            'X-Claude-Code-Ide-Authorization': serverRef.authToken,
          }),
        }

        let wsClient: WsClientLike
        if (typeof Bun !== 'undefined') {
          
          
          wsClient = new globalThis.WebSocket(serverRef.url, {
            protocols: ['mcp'],
            headers: wsHeaders,
            proxy: getWebSocketProxyUrl(serverRef.url),
            tls: tlsOptions || undefined,
          } as unknown as string[])
        } else {
          wsClient = await createNodeWsClient(serverRef.url, {
            headers: wsHeaders,
            agent: getWebSocketProxyAgent(serverRef.url),
            ...(tlsOptions || {}),
          })
        }
        transport = new WebSocketTransport(wsClient)
      } else if (serverRef.type === 'ws') {
        logMCPDebug(
          name,
          `Initializing WebSocket transport to ${serverRef.url}`,
        )

        const combinedHeaders = await getMcpServerHeaders(name, serverRef)

        const tlsOptions = getWebSocketTLSOptions()
        const wsHeaders = {
          'User-Agent': getMCPUserAgent(),
          ...(sessionIngressToken && {
            Authorization: `Bearer ${sessionIngressToken}`,
          }),
          ...combinedHeaders,
        }

        
        const wsHeadersForLogging = mapValues(wsHeaders, (value, key) =>
          key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
        )

        logMCPDebug(
          name,
          `WebSocket transport options: ${jsonStringify({
            url: serverRef.url,
            headers: wsHeadersForLogging,
            hasSessionAuth: !!sessionIngressToken,
          })}`,
        )

        let wsClient: WsClientLike
        if (typeof Bun !== 'undefined') {
          
          
          wsClient = new globalThis.WebSocket(serverRef.url, {
            protocols: ['mcp'],
            headers: wsHeaders,
            proxy: getWebSocketProxyUrl(serverRef.url),
            tls: tlsOptions || undefined,
          } as unknown as string[])
        } else {
          wsClient = await createNodeWsClient(serverRef.url, {
            headers: wsHeaders,
            agent: getWebSocketProxyAgent(serverRef.url),
            ...(tlsOptions || {}),
          })
        }
        transport = new WebSocketTransport(wsClient)
      } else if (serverRef.type === 'http') {
        logMCPDebug(name, `Initializing HTTP transport to ${serverRef.url}`)
        logMCPDebug(
          name,
          `Node version: ${process.version}, Platform: ${process.platform}`,
        )
        logMCPDebug(
          name,
          `Environment: ${jsonStringify({
            NODE_OPTIONS: process.env.NODE_OPTIONS || 'not set',
            UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || 'default',
            HTTP_PROXY: process.env.HTTP_PROXY || 'not set',
            HTTPS_PROXY: process.env.HTTPS_PROXY || 'not set',
            NO_PROXY: process.env.NO_PROXY || 'not set',
          })}`,
        )

        
        const authProvider = new ClaudeAuthProvider(name, serverRef)

        
        const combinedHeaders = await getMcpServerHeaders(name, serverRef)

        
        
        
        
        
        const hasOAuthTokens = !!(await authProvider.tokens())

        
        const proxyOptions = getProxyFetchOptions()
        logMCPDebug(
          name,
          `Proxy options: ${proxyOptions.dispatcher ? 'custom dispatcher' : 'default'}`,
        )

        const transportOptions: StreamableHTTPClientTransportOptions = {
          authProvider,
          
          
          
          fetch: wrapFetchWithTimeout(
            wrapFetchWithStepUpDetection(createFetchWithInit(), authProvider),
          ),
          requestInit: {
            ...proxyOptions,
            headers: {
              'User-Agent': getMCPUserAgent(),
              ...(sessionIngressToken &&
                !hasOAuthTokens && {
                  Authorization: `Bearer ${sessionIngressToken}`,
                }),
              ...combinedHeaders,
            },
          },
        }

        
        const headersForLogging = transportOptions.requestInit?.headers
          ? mapValues(
              transportOptions.requestInit.headers as Record<string, string>,
              (value, key) =>
                key.toLowerCase() === 'authorization' ? '[REDACTED]' : value,
            )
          : undefined

        logMCPDebug(
          name,
          `HTTP transport options: ${jsonStringify({
            url: serverRef.url,
            headers: headersForLogging,
            hasAuthProvider: !!authProvider,
            timeoutMs: MCP_REQUEST_TIMEOUT_MS,
          })}`,
        )

        transport = new StreamableHTTPClientTransport(
          new URL(serverRef.url),
          transportOptions,
        )
        logMCPDebug(name, `HTTP transport created successfully`)
      } else if (serverRef.type === 'sdk') {
        throw new Error('SDK servers should be handled in print.ts')
      } else if (serverRef.type === 'claudeai-proxy') {
        logMCPDebug(
          name,
          `Initializing claude.ai proxy transport for server ${serverRef.id}`,
        )

        const tokens = getClaudeAIOAuthTokens()
        if (!tokens) {
          throw new Error('No claude.ai OAuth token found')
        }

        const oauthConfig = getOauthConfig()
        const proxyUrl = `${oauthConfig.MCP_PROXY_URL}${oauthConfig.MCP_PROXY_PATH.replace('{server_id}', serverRef.id)}`

        logMCPDebug(name, `Using claude.ai proxy at ${proxyUrl}`)

        
        const fetchWithAuth = createClaudeAiProxyFetch(globalThis.fetch)

        const proxyOptions = getProxyFetchOptions()
        const transportOptions: StreamableHTTPClientTransportOptions = {
          
          fetch: wrapFetchWithTimeout(fetchWithAuth),
          requestInit: {
            ...proxyOptions,
            headers: {
              'User-Agent': getMCPUserAgent(),
              'X-Mcp-Client-Session-Id': getSessionId(),
            },
          },
        }

        transport = new StreamableHTTPClientTransport(
          new URL(proxyUrl),
          transportOptions,
        )
        logMCPDebug(name, `claude.ai proxy transport created successfully`)
      } else if (
        (serverRef.type === 'stdio' || !serverRef.type) &&
        isClaudeInChromeMCPServer(name)
      ) {
        
        const { createChromeContext } = await import(
          '../../utils/claudeInChrome/mcpServer.js'
        )
        const { createClaudeForChromeMcpServer } = await import(
          '@ant/claude-for-chrome-mcp'
        )
        const { createLinkedTransportPair } = await import(
          './InProcessTransport.js'
        )
        const context = createChromeContext(serverRef.env)
        inProcessServer = createClaudeForChromeMcpServer(context)
        const [clientTransport, serverTransport] = createLinkedTransportPair()
        await inProcessServer.connect(serverTransport)
        transport = clientTransport
        logMCPDebug(name, `In-process Chrome MCP server started`)
      } else if (
        feature('CHICAGO_MCP') &&
        (serverRef.type === 'stdio' || !serverRef.type) &&
        isComputerUseMCPServer!(name)
      ) {
        
        
        
        const { createComputerUseMcpServerForCli } = await import(
          '../../utils/computerUse/mcpServer.js'
        )
        const { createLinkedTransportPair } = await import(
          './InProcessTransport.js'
        )
        inProcessServer = await createComputerUseMcpServerForCli()
        const [clientTransport, serverTransport] = createLinkedTransportPair()
        await inProcessServer.connect(serverTransport)
        transport = clientTransport
        logMCPDebug(name, `In-process Computer Use MCP server started`)
      } else if (serverRef.type === 'stdio' || !serverRef.type) {
        const finalCommand =
          process.env.CLAUDE_CODE_NEXT_SHELL_PREFIX || serverRef.command
        const finalArgs = process.env.CLAUDE_CODE_NEXT_SHELL_PREFIX
          ? [[serverRef.command, ...serverRef.args].join(' ')]
          : serverRef.args
        transport = new StdioClientTransport({
          command: finalCommand,
          args: finalArgs,
          env: {
            ...subprocessEnv(),
            ...serverRef.env,
          } as Record<string, string>,
          stderr: 'pipe', 
        })
      } else {
        throw new Error(`Unsupported server type: ${serverRef.type}`)
      }

      
      
      
      let stderrHandler: ((data: Buffer) => void) | undefined
      let stderrOutput = ''
      if (serverRef.type === 'stdio' || !serverRef.type) {
        const stdioTransport = transport as StdioClientTransport
        if (stdioTransport.stderr) {
          stderrHandler = (data: Buffer) => {
            
            if (stderrOutput.length < 64 * 1024 * 1024) {
              try {
                stderrOutput += data.toString()
              } catch {
                
              }
            }
          }
          stdioTransport.stderr.on('data', stderrHandler)
        }
      }

      const client = new Client(
        {
          name: 'claude-code-next',
          title: 'Claude Code Next',
          version: MACRO.VERSION ?? 'unknown',
          description: "Anthropic's agentic coding tool",
          websiteUrl: PRODUCT_URL,
        },
        {
          capabilities: {
            roots: {},
            
            
            
            elicitation: {},
          },
        },
      )

      
      if (serverRef.type === 'http') {
        logMCPDebug(name, `Client created, setting up request handler`)
      }

      client.setRequestHandler(ListRootsRequestSchema, async () => {
        logMCPDebug(name, `Received ListRoots request from server`)
        return {
          roots: [
            {
              uri: `file://${getOriginalCwd()}`,
            },
          ],
        }
      })

      
      logMCPDebug(
        name,
        `Starting connection with timeout of ${getConnectionTimeoutMs()}ms`,
      )

      
      if (serverRef.type === 'http') {
        logMCPDebug(name, `Testing basic HTTP connectivity to ${serverRef.url}`)
        try {
          const testUrl = new URL(serverRef.url)
          logMCPDebug(
            name,
            `Parsed URL: host=${testUrl.hostname}, port=${testUrl.port || 'default'}, protocol=${testUrl.protocol}`,
          )

          
          if (
            testUrl.hostname === '127.0.0.1' ||
            testUrl.hostname === 'localhost'
          ) {
            logMCPDebug(name, `Using loopback address: ${testUrl.hostname}`)
          }
        } catch (urlError) {
          logMCPDebug(name, `Failed to parse URL: ${urlError}`)
        }
      }

      const connectPromise = client.connect(transport)
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          const elapsed = Date.now() - connectStartTime
          logMCPDebug(
            name,
            `Connection timeout triggered after ${elapsed}ms (limit: ${getConnectionTimeoutMs()}ms)`,
          )
          if (inProcessServer) {
            inProcessServer.close().catch(() => {})
          }
          transport.close().catch(() => {})
          reject(
            new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
              `MCP server "${name}" connection timed out after ${getConnectionTimeoutMs()}ms`,
              'MCP connection timeout',
            ),
          )
        }, getConnectionTimeoutMs())

        
        connectPromise.then(
          () => {
            clearTimeout(timeoutId)
          },
          _error => {
            clearTimeout(timeoutId)
          },
        )
      })

      try {
        await Promise.race([connectPromise, timeoutPromise])
        if (stderrOutput) {
          logMCPError(name, `Server stderr: ${stderrOutput}`)
          stderrOutput = '' 
        }
        const elapsed = Date.now() - connectStartTime
        logMCPDebug(
          name,
          `Successfully connected (transport: ${serverRef.type || 'stdio'}) in ${elapsed}ms`,
        )
      } catch (error) {
        const elapsed = Date.now() - connectStartTime
        
        if (serverRef.type === 'sse' && error instanceof Error) {
          logMCPDebug(
            name,
            `SSE Connection failed after ${elapsed}ms: ${jsonStringify({
              url: serverRef.url,
              error: error.message,
              errorType: error.constructor.name,
              stack: error.stack,
            })}`,
          )
          logMCPError(name, error)

          if (error instanceof UnauthorizedError) {
            return handleRemoteAuthFailure(name, serverRef, 'sse')
          }
        } else if (serverRef.type === 'http' && error instanceof Error) {
          const errorObj = error as Error & {
            cause?: unknown
            code?: string
            errno?: string | number
            syscall?: string
          }
          logMCPDebug(
            name,
            `HTTP Connection failed after ${elapsed}ms: ${error.message} (code: ${errorObj.code || 'none'}, errno: ${errorObj.errno || 'none'})`,
          )
          logMCPError(name, error)

          if (error instanceof UnauthorizedError) {
            return handleRemoteAuthFailure(name, serverRef, 'http')
          }
        } else if (
          serverRef.type === 'claudeai-proxy' &&
          error instanceof Error
        ) {
          logMCPDebug(
            name,
            `claude.ai proxy connection failed after ${elapsed}ms: ${error.message}`,
          )
          logMCPError(name, error)

          
          const errorCode = (error as Error & { code?: number }).code
          if (errorCode === 401) {
            return handleRemoteAuthFailure(name, serverRef, 'claudeai-proxy')
          }
        } else if (
          serverRef.type === 'sse-ide' ||
          serverRef.type === 'ws-ide'
        ) {
          logEvent('tengu_mcp_ide_server_connection_failed', {
            connectionDurationMs: elapsed,
          })
        }
        if (inProcessServer) {
          inProcessServer.close().catch(() => {})
        }
        transport.close().catch(() => {})
        if (stderrOutput) {
          logMCPError(name, `Server stderr: ${stderrOutput}`)
        }
        throw error
      }

      const capabilities = client.getServerCapabilities()
      const serverVersion = client.getServerVersion()
      const rawInstructions = client.getInstructions()
      let instructions = rawInstructions
      if (
        rawInstructions &&
        rawInstructions.length > MAX_MCP_DESCRIPTION_LENGTH
      ) {
        instructions =
          rawInstructions.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '… [truncated]'
        logMCPDebug(
          name,
          `Server instructions truncated from ${rawInstructions.length} to ${MAX_MCP_DESCRIPTION_LENGTH} chars`,
        )
      }

      
      logMCPDebug(
        name,
        `Connection established with capabilities: ${jsonStringify({
          hasTools: !!capabilities?.tools,
          hasPrompts: !!capabilities?.prompts,
          hasResources: !!capabilities?.resources,
          hasResourceSubscribe: !!capabilities?.resources?.subscribe,
          serverVersion: serverVersion || 'unknown',
        })}`,
      )
      logForDebugging(
        `[MCP] Server "${name}" connected with subscribe=${!!capabilities?.resources?.subscribe}`,
      )

      
      
      
      client.setRequestHandler(ElicitRequestSchema, async request => {
        logMCPDebug(
          name,
          `Elicitation request received during initialization: ${jsonStringify(request)}`,
        )
        return { action: 'cancel' as const }
      })

      if (serverRef.type === 'sse-ide' || serverRef.type === 'ws-ide') {
        const ideConnectionDurationMs = Date.now() - connectStartTime
        logEvent('tengu_mcp_ide_server_connection_succeeded', {
          connectionDurationMs: ideConnectionDurationMs,
          serverVersion:
            serverVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        try {
          void maybeNotifyIDEConnected(client)
        } catch (error) {
          logMCPError(
            name,
            `Failed to send ide_connected notification: ${error}`,
          )
        }
      }

      
      const connectionStartTime = Date.now()
      let hasErrorOccurred = false

      
      const originalOnerror = client.onerror
      const originalOnclose = client.onclose

      
      
      
      let consecutiveConnectionErrors = 0
      const MAX_ERRORS_BEFORE_RECONNECT = 3

      
      
      let hasTriggeredClose = false

      
      
      
      
      
      
      const closeTransportAndRejectPending = (reason: string) => {
        if (hasTriggeredClose) return
        hasTriggeredClose = true
        logMCPDebug(name, `Closing transport (${reason})`)
        void client.close().catch(e => {
          logMCPDebug(name, `Error during close: ${errorMessage(e)}`)
        })
      }

      const isTerminalConnectionError = (msg: string): boolean => {
        return (
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('EPIPE') ||
          msg.includes('EHOSTUNREACH') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('Body Timeout Error') ||
          msg.includes('terminated') ||
          
          
          msg.includes('SSE stream disconnected') ||
          msg.includes('Failed to reconnect SSE stream')
        )
      }

      
      client.onerror = (error: Error) => {
        const uptime = Date.now() - connectionStartTime
        hasErrorOccurred = true
        const transportType = serverRef.type || 'stdio'

        
        logMCPDebug(
          name,
          `${transportType.toUpperCase()} connection dropped after ${Math.floor(uptime / 1000)}s uptime`,
        )

        
        if (error.message) {
          if (error.message.includes('ECONNRESET')) {
            logMCPDebug(
              name,
              `Connection reset - server may have crashed or restarted`,
            )
          } else if (error.message.includes('ETIMEDOUT')) {
            logMCPDebug(
              name,
              `Connection timeout - network issue or server unresponsive`,
            )
          } else if (error.message.includes('ECONNREFUSED')) {
            logMCPDebug(name, `Connection refused - server may be down`)
          } else if (error.message.includes('EPIPE')) {
            logMCPDebug(
              name,
              `Broken pipe - server closed connection unexpectedly`,
            )
          } else if (error.message.includes('EHOSTUNREACH')) {
            logMCPDebug(name, `Host unreachable - network connectivity issue`)
          } else if (error.message.includes('ESRCH')) {
            logMCPDebug(
              name,
              `Process not found - stdio server process terminated`,
            )
          } else if (error.message.includes('spawn')) {
            logMCPDebug(
              name,
              `Failed to spawn process - check command and permissions`,
            )
          } else {
            logMCPDebug(name, `Connection error: ${error.message}`)
          }
        }

        
        
        
        if (
          (transportType === 'http' || transportType === 'claudeai-proxy') &&
          isMcpSessionExpiredError(error)
        ) {
          logMCPDebug(
            name,
            `MCP session expired (server returned 404 with session-not-found), triggering reconnection`,
          )
          closeTransportAndRejectPending('session expired')
          if (originalOnerror) {
            originalOnerror(error)
          }
          return
        }

        
        
        if (
          transportType === 'sse' ||
          transportType === 'http' ||
          transportType === 'claudeai-proxy'
        ) {
          
          
          
          
          if (error.message.includes('Maximum reconnection attempts')) {
            closeTransportAndRejectPending('SSE reconnection exhausted')
            if (originalOnerror) {
              originalOnerror(error)
            }
            return
          }

          if (isTerminalConnectionError(error.message)) {
            consecutiveConnectionErrors++
            logMCPDebug(
              name,
              `Terminal connection error ${consecutiveConnectionErrors}/${MAX_ERRORS_BEFORE_RECONNECT}`,
            )

            if (consecutiveConnectionErrors >= MAX_ERRORS_BEFORE_RECONNECT) {
              consecutiveConnectionErrors = 0
              closeTransportAndRejectPending('max consecutive terminal errors')
            }
          } else {
            
            consecutiveConnectionErrors = 0
          }
        }

        
        if (originalOnerror) {
          originalOnerror(error)
        }
      }

      
      client.onclose = () => {
        const uptime = Date.now() - connectionStartTime
        const transportType = serverRef.type ?? 'unknown'

        logMCPDebug(
          name,
          `${transportType.toUpperCase()} connection closed after ${Math.floor(uptime / 1000)}s (${hasErrorOccurred ? 'with errors' : 'cleanly'})`,
        )

        
        const key = getServerCacheKey(name, serverRef)

        
        
        
        fetchToolsForClient.cache.delete(name)
        fetchResourcesForClient.cache.delete(name)
        fetchCommandsForClient.cache.delete(name)
        if (feature('MCP_SKILLS')) {
          fetchMcpSkillsForClient!.cache.delete(name)
        }

        connectToServer.cache.delete(key)
        logMCPDebug(name, `Cleared connection cache for reconnection`)

        if (originalOnclose) {
          originalOnclose()
        }
      }

      const cleanup = async () => {
        
        if (inProcessServer) {
          try {
            await inProcessServer.close()
          } catch (error) {
            logMCPDebug(name, `Error closing in-process server: ${error}`)
          }
          try {
            await client.close()
          } catch (error) {
            logMCPDebug(name, `Error closing client: ${error}`)
          }
          return
        }

        
        if (stderrHandler && (serverRef.type === 'stdio' || !serverRef.type)) {
          const stdioTransport = transport as StdioClientTransport
          stdioTransport.stderr?.off('data', stderrHandler)
        }

        
        
        
        if (serverRef.type === 'stdio') {
          try {
            const stdioTransport = transport as StdioClientTransport
            const childPid = stdioTransport.pid

            if (childPid) {
              logMCPDebug(name, 'Sending SIGINT to MCP server process')

              
              try {
                process.kill(childPid, 'SIGINT')
              } catch (error) {
                logMCPDebug(name, `Error sending SIGINT: ${error}`)
                return
              }

              
              await new Promise<void>(async resolve => {
                let resolved = false

                
                const checkInterval = setInterval(() => {
                  try {
                    
                    process.kill(childPid, 0)
                  } catch {
                    
                    if (!resolved) {
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      logMCPDebug(name, 'MCP server process exited cleanly')
                      resolve()
                    }
                  }
                }, 50)

                
                const failsafeTimeout = setTimeout(() => {
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    logMCPDebug(
                      name,
                      'Cleanup timeout reached, stopping process monitoring',
                    )
                    resolve()
                  }
                }, 600)

                try {
                  
                  await sleep(100)

                  if (!resolved) {
                    
                    try {
                      process.kill(childPid, 0)
                      
                      logMCPDebug(
                        name,
                        'SIGINT failed, sending SIGTERM to MCP server process',
                      )
                      try {
                        process.kill(childPid, 'SIGTERM')
                      } catch (termError) {
                        logMCPDebug(name, `Error sending SIGTERM: ${termError}`)
                        resolved = true
                        clearInterval(checkInterval)
                        clearTimeout(failsafeTimeout)
                        resolve()
                        return
                      }
                    } catch {
                      
                      resolved = true
                      clearInterval(checkInterval)
                      clearTimeout(failsafeTimeout)
                      resolve()
                      return
                    }

                    
                    await sleep(400)

                    if (!resolved) {
                      
                      try {
                        process.kill(childPid, 0)
                        
                        logMCPDebug(
                          name,
                          'SIGTERM failed, sending SIGKILL to MCP server process',
                        )
                        try {
                          process.kill(childPid, 'SIGKILL')
                        } catch (killError) {
                          logMCPDebug(
                            name,
                            `Error sending SIGKILL: ${killError}`,
                          )
                        }
                      } catch {
                        
                        resolved = true
                        clearInterval(checkInterval)
                        clearTimeout(failsafeTimeout)
                        resolve()
                      }
                    }
                  }

                  
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    resolve()
                  }
                } catch {
                  
                  if (!resolved) {
                    resolved = true
                    clearInterval(checkInterval)
                    clearTimeout(failsafeTimeout)
                    resolve()
                  }
                }
              })
            }
          } catch (processError) {
            logMCPDebug(name, `Error terminating process: ${processError}`)
          }
        }

        
        try {
          await client.close()
        } catch (error) {
          logMCPDebug(name, `Error closing client: ${error}`)
        }
      }

      
      
      const cleanupUnregister = registerCleanup(cleanup)

      
      const wrappedCleanup = async () => {
        cleanupUnregister?.()
        await cleanup()
      }

      const connectionDurationMs = Date.now() - connectStartTime
      logEvent('tengu_mcp_server_connection_succeeded', {
        connectionDurationMs,
        transportType: (serverRef.type ??
          'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        totalServers: serverStats?.totalServers,
        stdioCount: serverStats?.stdioCount,
        sseCount: serverStats?.sseCount,
        httpCount: serverStats?.httpCount,
        sseIdeCount: serverStats?.sseIdeCount,
        wsIdeCount: serverStats?.wsIdeCount,
        ...mcpBaseUrlAnalytics(serverRef),
      })
      return {
        name,
        client,
        type: 'connected' as const,
        capabilities: capabilities ?? {},
        serverInfo: serverVersion,
        instructions,
        config: serverRef,
        cleanup: wrappedCleanup,
      }
    } catch (error) {
      const connectionDurationMs = Date.now() - connectStartTime
      logEvent('tengu_mcp_server_connection_failed', {
        connectionDurationMs,
        totalServers: serverStats?.totalServers || 1,
        stdioCount:
          serverStats?.stdioCount || (serverRef.type === 'stdio' ? 1 : 0),
        sseCount: serverStats?.sseCount || (serverRef.type === 'sse' ? 1 : 0),
        httpCount:
          serverStats?.httpCount || (serverRef.type === 'http' ? 1 : 0),
        sseIdeCount:
          serverStats?.sseIdeCount || (serverRef.type === 'sse-ide' ? 1 : 0),
        wsIdeCount:
          serverStats?.wsIdeCount || (serverRef.type === 'ws-ide' ? 1 : 0),
        transportType: (serverRef.type ??
          'stdio') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...mcpBaseUrlAnalytics(serverRef),
      })
      logMCPDebug(
        name,
        `Connection failed after ${connectionDurationMs}ms: ${errorMessage(error)}`,
      )
      logMCPError(name, `Connection failed: ${errorMessage(error)}`)

      if (inProcessServer) {
        inProcessServer.close().catch(() => {})
      }
      return {
        name,
        type: 'failed' as const,
        config: serverRef,
        error: errorMessage(error),
      }
    }
  },
  getServerCacheKey,
)

export async function clearServerCache(
  name: string,
  serverRef: ScopedMcpServerConfig,
): Promise<void> {
  const key = getServerCacheKey(name, serverRef)

  try {
    const wrappedClient = await connectToServer(name, serverRef)

    if (wrappedClient.type === 'connected') {
      await wrappedClient.cleanup()
    }
  } catch {
    
  }

  
  
  connectToServer.cache.delete(key)
  fetchToolsForClient.cache.delete(name)
  fetchResourcesForClient.cache.delete(name)
  fetchCommandsForClient.cache.delete(name)
  if (feature('MCP_SKILLS')) {
    fetchMcpSkillsForClient!.cache.delete(name)
  }
}

export async function ensureConnectedClient(
  client: ConnectedMCPServer,
): Promise<ConnectedMCPServer> {
  
  if (client.config.type === 'sdk') {
    return client
  }

  const connectedClient = await connectToServer(client.name, client.config)
  if (connectedClient.type !== 'connected') {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      `MCP server "${client.name}" is not connected`,
      'MCP server not connected',
    )
  }
  return connectedClient
}

export function areMcpConfigsEqual(
  a: ScopedMcpServerConfig,
  b: ScopedMcpServerConfig,
): boolean {
  
  if (a.type !== b.type) return false

  
  
  const { scope: _scopeA, ...configA } = a
  const { scope: _scopeB, ...configB } = b
  return jsonStringify(configA) === jsonStringify(configB)
}

const MCP_FETCH_CACHE_SIZE = 20

export function mcpToolInputToAutoClassifierInput(
  input: Record<string, unknown>,
  toolName: string,
): string {
  const keys = Object.keys(input)
  return keys.length > 0
    ? keys.map(k => `${k}=${String(input[k])}`).join(' ')
    : toolName
}

export const fetchToolsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Tool[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.tools) {
        return []
      }

      const result = (await client.client.request(
        { method: 'tools/list' },
        ListToolsResultSchema,
      )) as ListToolsResult

      
      const toolsToProcess = recursivelySanitizeUnicode(result.tools)

      
      const skipPrefix =
        client.config.type === 'sdk' &&
        isEnvTruthy(process.env.CLAUDE_AGENT_SDK_MCP_NO_PREFIX)

      
      return toolsToProcess
        .map((tool): Tool => {
          const fullyQualifiedName = buildMcpToolName(client.name, tool.name)
          return {
            ...MCPTool,
            
            
            name: skipPrefix ? tool.name : fullyQualifiedName,
            mcpInfo: { serverName: client.name, toolName: tool.name },
            isMcp: true,
            
            
            
            searchHint:
              typeof tool._meta?.['anthropic/searchHint'] === 'string'
                ? tool._meta['anthropic/searchHint']
                    .replace(/\s+/g, ' ')
                    .trim() || undefined
                : undefined,
            alwaysLoad: tool._meta?.['anthropic/alwaysLoad'] === true,
            async description() {
              return tool.description ?? ''
            },
            async prompt() {
              const desc = tool.description ?? ''
              return desc.length > MAX_MCP_DESCRIPTION_LENGTH
                ? desc.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '… [truncated]'
                : desc
            },
            isConcurrencySafe() {
              return tool.annotations?.readOnlyHint ?? false
            },
            isReadOnly() {
              return tool.annotations?.readOnlyHint ?? false
            },
            toAutoClassifierInput(input) {
              return mcpToolInputToAutoClassifierInput(input, tool.name)
            },
            isDestructive() {
              return tool.annotations?.destructiveHint ?? false
            },
            isOpenWorld() {
              return tool.annotations?.openWorldHint ?? false
            },
            isSearchOrReadCommand() {
              return classifyMcpToolForCollapse(client.name, tool.name)
            },
            inputJSONSchema: tool.inputSchema as Tool['inputJSONSchema'],
            async checkPermissions() {
              return {
                behavior: 'passthrough' as const,
                message: 'MCPTool requires permission.',
                suggestions: [
                  {
                    type: 'addRules' as const,
                    rules: [
                      {
                        toolName: fullyQualifiedName,
                        ruleContent: undefined,
                      },
                    ],
                    behavior: 'allow' as const,
                    destination: 'localSettings' as const,
                  },
                ],
              }
            },
            async call(
              args: Record<string, unknown>,
              context,
              _canUseTool,
              parentMessage,
              onProgress?: ToolCallProgress<MCPProgress>,
            ) {
              const toolUseId = extractToolUseId(parentMessage)
              const meta = toolUseId
                ? { 'claudecode/toolUseId': toolUseId }
                : {}

              
              if (onProgress && toolUseId) {
                onProgress({
                  toolUseID: toolUseId,
                  data: {
                    type: 'mcp_progress',
                    status: 'started',
                    serverName: client.name,
                    toolName: tool.name,
                  },
                })
              }

              const startTime = Date.now()
              const MAX_SESSION_RETRIES = 1
              for (let attempt = 0; ; attempt++) {
                try {
                  const connectedClient = await ensureConnectedClient(client)
                  const mcpResult = await callMCPToolWithUrlElicitationRetry({
                    client: connectedClient,
                    clientConnection: client,
                    tool: tool.name,
                    args,
                    meta,
                    signal: context.abortController.signal,
                    setAppState: context.setAppState,
                    onProgress:
                      onProgress && toolUseId
                        ? progressData => {
                            onProgress({
                              toolUseID: toolUseId,
                              data: progressData,
                            })
                          }
                        : undefined,
                    handleElicitation: context.handleElicitation,
                  })

                  
                  if (onProgress && toolUseId) {
                    onProgress({
                      toolUseID: toolUseId,
                      data: {
                        type: 'mcp_progress',
                        status: 'completed',
                        serverName: client.name,
                        toolName: tool.name,
                        elapsedTimeMs: Date.now() - startTime,
                      },
                    })
                  }

                  return {
                    data: mcpResult.content,
                    ...((mcpResult._meta || mcpResult.structuredContent) && {
                      mcpMeta: {
                        ...(mcpResult._meta && {
                          _meta: mcpResult._meta,
                        }),
                        ...(mcpResult.structuredContent && {
                          structuredContent: mcpResult.structuredContent,
                        }),
                      },
                    }),
                  }
                } catch (error) {
                  
                  
                  if (
                    error instanceof McpSessionExpiredError &&
                    attempt < MAX_SESSION_RETRIES
                  ) {
                    logMCPDebug(
                      client.name,
                      `Retrying tool '${tool.name}' after session recovery`,
                    )
                    continue
                  }

                  
                  if (onProgress && toolUseId) {
                    onProgress({
                      toolUseID: toolUseId,
                      data: {
                        type: 'mcp_progress',
                        status: 'failed',
                        serverName: client.name,
                        toolName: tool.name,
                        elapsedTimeMs: Date.now() - startTime,
                      },
                    })
                  }
                  
                  
                  
                  
                  if (
                    error instanceof Error &&
                    !(
                      error instanceof
                      TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
                    )
                  ) {
                    const name = error.constructor.name
                    if (name === 'Error') {
                      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                        error.message,
                        error.message.slice(0, 200),
                      )
                    }
                    
                    
                    if (
                      name === 'McpError' &&
                      'code' in error &&
                      typeof error.code === 'number'
                    ) {
                      throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
                        error.message,
                        `McpError ${error.code}`,
                      )
                    }
                  }
                  throw error
                }
              }
            },
            userFacingName() {
              
              const displayName = tool.annotations?.title || tool.name
              return `${client.name} - ${displayName} (MCP)`
            },
            ...(isClaudeInChromeMCPServer(client.name) &&
            (client.config.type === 'stdio' || !client.config.type)
              ? claudeInChromeToolRendering().getClaudeInChromeMCPToolOverrides(
                  tool.name,
                )
              : {}),
            ...(feature('CHICAGO_MCP') &&
            (client.config.type === 'stdio' || !client.config.type) &&
            isComputerUseMCPServer!(client.name)
              ? computerUseWrapper!().getComputerUseMCPToolOverrides(tool.name)
              : {}),
          }
        })
        .filter(isIncludedMcpTool)
    } catch (error) {
      logMCPError(client.name, `Failed to fetch tools: ${errorMessage(error)}`)
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_FETCH_CACHE_SIZE,
)

export const fetchResourcesForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<ServerResource[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.resources) {
        return []
      }

      const result = await client.client.request(
        { method: 'resources/list' },
        ListResourcesResultSchema,
      )

      if (!result.resources) return []

      
      return result.resources.map(resource => ({
        ...resource,
        server: client.name,
      }))
    } catch (error) {
      logMCPError(
        client.name,
        `Failed to fetch resources: ${errorMessage(error)}`,
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_FETCH_CACHE_SIZE,
)

export const fetchCommandsForClient = memoizeWithLRU(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.prompts) {
        return []
      }

      
      const result = (await client.client.request(
        { method: 'prompts/list' },
        ListPromptsResultSchema,
      )) as ListPromptsResult

      if (!result.prompts) return []

      
      const promptsToProcess = recursivelySanitizeUnicode(result.prompts)

      
      return promptsToProcess.map(prompt => {
        const argNames = Object.values(prompt.arguments ?? {}).map(k => k.name)
        return {
          type: 'prompt' as const,
          name: 'mcp__' + normalizeNameForMCP(client.name) + '__' + prompt.name,
          description: prompt.description ?? '',
          hasUserSpecifiedDescription: !!prompt.description,
          contentLength: 0, 
          isEnabled: () => true,
          isHidden: false,
          isMcp: true,
          progressMessage: 'running',
          userFacingName() {
            
            
            return `${client.name}:${prompt.name} (MCP)`
          },
          argNames,
          source: 'mcp',
          async getPromptForCommand(args: string) {
            const argsArray = args.split(' ')
            try {
              const connectedClient = await ensureConnectedClient(client)
              const result = await connectedClient.client.getPrompt({
                name: prompt.name,
                arguments: zipObject(argNames, argsArray),
              })
              const transformed = await Promise.all(
                result.messages.map(message =>
                  transformResultContent(message.content, connectedClient.name),
                ),
              )
              return transformed.flat()
            } catch (error) {
              logMCPError(
                client.name,
                `Error running command '${prompt.name}': ${errorMessage(error)}`,
              )
              throw error
            }
          },
        }
      })
    } catch (error) {
      logMCPError(
        client.name,
        `Failed to fetch commands: ${errorMessage(error)}`,
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
  MCP_FETCH_CACHE_SIZE,
)

export async function callIdeRpc(
  toolName: string,
  args: Record<string, unknown>,
  client: ConnectedMCPServer,
): Promise<string | ContentBlockParam[] | undefined> {
  const result = await callMCPTool({
    client,
    tool: toolName,
    args,
    signal: createAbortController().signal,
  })
  return result.content
}

export async function reconnectMcpServerImpl(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<{
  client: MCPServerConnection
  tools: Tool[]
  commands: Command[]
  resources?: ServerResource[]
}> {
  try {
    
    
    
    
    
    clearKeychainCache()

    await clearServerCache(name, config)
    const client = await connectToServer(name, config)

    if (client.type !== 'connected') {
      return {
        client,
        tools: [],
        commands: [],
      }
    }

    if (config.type === 'claudeai-proxy') {
      markClaudeAiMcpConnected(name)
    }

    const supportsResources = !!client.capabilities?.resources

    const [tools, mcpCommands, mcpSkills, resources] = await Promise.all([
      fetchToolsForClient(client),
      fetchCommandsForClient(client),
      feature('MCP_SKILLS') && supportsResources
        ? fetchMcpSkillsForClient!(client)
        : Promise.resolve([]),
      supportsResources ? fetchResourcesForClient(client) : Promise.resolve([]),
    ])
    const commands = [...mcpCommands, ...mcpSkills]

    
    const resourceTools: Tool[] = []
    if (supportsResources) {
      
      const hasResourceTools = [ListMcpResourcesTool, ReadMcpResourceTool].some(
        tool => tools.some(t => toolMatchesName(t, tool.name)),
      )
      if (!hasResourceTools) {
        resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
      }
    }

    return {
      client,
      tools: [...tools, ...resourceTools],
      commands,
      resources: resources.length > 0 ? resources : undefined,
    }
  } catch (error) {
    
    logMCPError(name, `Error during reconnection: ${errorMessage(error)}`)

    
    return {
      client: { name, type: 'failed' as const, config },
      tools: [],
      commands: [],
    }
  }
}

async function processBatched<T>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<void>,
): Promise<void> {
  await pMap(items, processor, { concurrency })
}

export async function getMcpToolsCommandsAndResources(
  onConnectionAttempt: (params: {
    client: MCPServerConnection
    tools: Tool[]
    commands: Command[]
    resources?: ServerResource[]
  }) => void,
  mcpConfigs?: Record<string, ScopedMcpServerConfig>,
): Promise<void> {
  let resourceToolsAdded = false

  const allConfigEntries = Object.entries(
    mcpConfigs ?? (await getAllMcpConfigs()).servers,
  )

  
  
  const configEntries: typeof allConfigEntries = []
  for (const entry of allConfigEntries) {
    if (isMcpServerDisabled(entry[0])) {
      onConnectionAttempt({
        client: { name: entry[0], type: 'disabled', config: entry[1] },
        tools: [],
        commands: [],
      })
    } else {
      configEntries.push(entry)
    }
  }

  
  const totalServers = configEntries.length
  const stdioCount = count(configEntries, ([_, c]) => c.type === 'stdio')
  const sseCount = count(configEntries, ([_, c]) => c.type === 'sse')
  const httpCount = count(configEntries, ([_, c]) => c.type === 'http')
  const sseIdeCount = count(configEntries, ([_, c]) => c.type === 'sse-ide')
  const wsIdeCount = count(configEntries, ([_, c]) => c.type === 'ws-ide')

  
  
  const localServers = configEntries.filter(([_, config]) =>
    isLocalMcpServer(config),
  )
  const remoteServers = configEntries.filter(
    ([_, config]) => !isLocalMcpServer(config),
  )

  const serverStats = {
    totalServers,
    stdioCount,
    sseCount,
    httpCount,
    sseIdeCount,
    wsIdeCount,
  }

  const processServer = async ([name, config]: [
    string,
    ScopedMcpServerConfig,
  ]): Promise<void> => {
    try {
      
      if (isMcpServerDisabled(name)) {
        onConnectionAttempt({
          client: {
            name,
            type: 'disabled',
            config,
          },
          tools: [],
          commands: [],
        })
        return
      }

      
      
      
      
      
      
      if (
        (config.type === 'claudeai-proxy' ||
          config.type === 'http' ||
          config.type === 'sse') &&
        ((await isMcpAuthCached(name)) ||
          ((config.type === 'http' || config.type === 'sse') &&
            hasMcpDiscoveryButNoToken(name, config)))
      ) {
        logMCPDebug(name, `Skipping connection (cached needs-auth)`)
        onConnectionAttempt({
          client: { name, type: 'needs-auth' as const, config },
          tools: [createMcpAuthTool(name, config)],
          commands: [],
        })
        return
      }

      const client = await connectToServer(name, config, serverStats)

      if (client.type !== 'connected') {
        onConnectionAttempt({
          client,
          tools:
            client.type === 'needs-auth'
              ? [createMcpAuthTool(name, config)]
              : [],
          commands: [],
        })
        return
      }

      if (config.type === 'claudeai-proxy') {
        markClaudeAiMcpConnected(name)
      }

      const supportsResources = !!client.capabilities?.resources

      const [tools, mcpCommands, mcpSkills, resources] = await Promise.all([
        fetchToolsForClient(client),
        fetchCommandsForClient(client),
        
        feature('MCP_SKILLS') && supportsResources
          ? fetchMcpSkillsForClient!(client)
          : Promise.resolve([]),
        
        supportsResources
          ? fetchResourcesForClient(client)
          : Promise.resolve([]),
      ])
      const commands = [...mcpCommands, ...mcpSkills]

      
      
      const resourceTools: Tool[] = []
      if (supportsResources && !resourceToolsAdded) {
        resourceToolsAdded = true
        resourceTools.push(ListMcpResourcesTool, ReadMcpResourceTool)
      }

      onConnectionAttempt({
        client,
        tools: [...tools, ...resourceTools],
        commands,
        resources: resources.length > 0 ? resources : undefined,
      })
    } catch (error) {
      
      logMCPError(
        name,
        `Error fetching tools/commands/resources: ${errorMessage(error)}`,
      )

      
      onConnectionAttempt({
        client: { name, type: 'failed' as const, config },
        tools: [],
        commands: [],
      })
    }
  }

  
  
  
  await Promise.all([
    processBatched(
      localServers,
      getMcpServerConnectionBatchSize(),
      processServer,
    ),
    processBatched(
      remoteServers,
      getRemoteMcpServerConnectionBatchSize(),
      processServer,
    ),
  ])
}

export function prefetchAllMcpResources(
  mcpConfigs: Record<string, ScopedMcpServerConfig>,
): Promise<{
  clients: MCPServerConnection[]
  tools: Tool[]
  commands: Command[]
}> {
  return new Promise(resolve => {
    let pendingCount = 0
    let completedCount = 0

    pendingCount = Object.keys(mcpConfigs).length

    if (pendingCount === 0) {
      void resolve({
        clients: [],
        tools: [],
        commands: [],
      })
      return
    }

    const clients: MCPServerConnection[] = []
    const tools: Tool[] = []
    const commands: Command[] = []

    getMcpToolsCommandsAndResources(result => {
      clients.push(result.client)
      tools.push(...result.tools)
      commands.push(...result.commands)

      completedCount++
      if (completedCount >= pendingCount) {
        const commandsMetadataLength = commands.reduce((sum, command) => {
          const commandMetadataLength =
            command.name.length +
            (command.description ?? '').length +
            (command.argumentHint ?? '').length
          return sum + commandMetadataLength
        }, 0)
        logEvent('tengu_mcp_tools_commands_loaded', {
          tools_count: tools.length,
          commands_count: commands.length,
          commands_metadata_length: commandsMetadataLength,
        })

        void resolve({
          clients,
          tools,
          commands,
        })
      }
    }, mcpConfigs).catch(error => {
      logMCPError(
        'prefetchAllMcpResources',
        `Failed to get MCP resources: ${errorMessage(error)}`,
      )
      
      void resolve({
        clients: [],
        tools: [],
        commands: [],
      })
    })
  })
}

export async function transformResultContent(
  resultContent: PromptMessage['content'],
  serverName: string,
): Promise<Array<ContentBlockParam>> {
  switch (resultContent.type) {
    case 'text':
      return [
        {
          type: 'text',
          text: resultContent.text,
        },
      ]
    case 'audio': {
      const audioData = resultContent as {
        type: 'audio'
        data: string
        mimeType?: string
      }
      return await persistBlobToTextBlock(
        Buffer.from(audioData.data, 'base64'),
        audioData.mimeType,
        serverName,
        `[Audio from ${serverName}] `,
      )
    }
    case 'image': {
      
      const imageBuffer = Buffer.from(String(resultContent.data), 'base64')
      const ext = resultContent.mimeType?.split('/')[1] || 'png'
      const resized = await maybeResizeAndDownsampleImageBuffer(
        imageBuffer,
        imageBuffer.length,
        ext,
      )
      return [
        {
          type: 'image',
          source: {
            data: resized.buffer.toString('base64'),
            media_type:
              `image/${resized.mediaType}` as Base64ImageSource['media_type'],
            type: 'base64',
          },
        },
      ]
    }
    case 'resource': {
      const resource = resultContent.resource
      const prefix = `[Resource from ${serverName} at ${resource.uri}] `

      if ('text' in resource) {
        return [
          {
            type: 'text',
            text: `${prefix}${resource.text}`,
          },
        ]
      } else if ('blob' in resource) {
        const isImage = IMAGE_MIME_TYPES.has(resource.mimeType ?? '')

        if (isImage) {
          
          const imageBuffer = Buffer.from(resource.blob, 'base64')
          const ext = resource.mimeType?.split('/')[1] || 'png'
          const resized = await maybeResizeAndDownsampleImageBuffer(
            imageBuffer,
            imageBuffer.length,
            ext,
          )
          const content: MessageParam['content'] = []
          if (prefix) {
            content.push({
              type: 'text',
              text: prefix,
            })
          }
          content.push({
            type: 'image',
            source: {
              data: resized.buffer.toString('base64'),
              media_type:
                `image/${resized.mediaType}` as Base64ImageSource['media_type'],
              type: 'base64',
            },
          })
          return content
        } else {
          return await persistBlobToTextBlock(
            Buffer.from(resource.blob, 'base64'),
            resource.mimeType,
            serverName,
            prefix,
          )
        }
      }
      return []
    }
    case 'resource_link': {
      const resourceLink = resultContent as ResourceLink
      let text = `[Resource link: ${resourceLink.name}] ${resourceLink.uri}`
      if (resourceLink.description) {
        text += ` (${resourceLink.description})`
      }
      return [
        {
          type: 'text',
          text,
        },
      ]
    }
    default:
      return []
  }
}

async function persistBlobToTextBlock(
  bytes: Buffer,
  mimeType: string | undefined,
  serverName: string,
  sourceDescription: string,
): Promise<Array<ContentBlockParam>> {
  const persistId = `mcp-${normalizeNameForMCP(serverName)}-blob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const result = await persistBinaryContent(bytes, mimeType, persistId)

  if ('error' in result) {
    return [
      {
        type: 'text',
        text: `${sourceDescription}Binary content (${mimeType || 'unknown type'}, ${bytes.length} bytes) could not be saved to disk: ${result.error}`,
      },
    ]
  }

  return [
    {
      type: 'text',
      text: getBinaryBlobSavedMessage(
        result.filepath,
        mimeType,
        result.size,
        sourceDescription,
      ),
    },
  ]
}

export type MCPResultType = 'toolResult' | 'structuredContent' | 'contentArray'

export type TransformedMCPResult = {
  content: MCPToolResult
  type: MCPResultType
  schema?: string
}

export function inferCompactSchema(value: unknown, depth = 2): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return `[${inferCompactSchema(value[0], depth - 1)}]`
  }
  if (typeof value === 'object') {
    if (depth <= 0) return '{...}'
    const entries = Object.entries(value).slice(0, 10)
    const props = entries.map(
      ([k, v]) => `${k}: ${inferCompactSchema(v, depth - 1)}`,
    )
    const suffix = Object.keys(value).length > 10 ? ', ...' : ''
    return `{${props.join(', ')}${suffix}}`
  }
  return typeof value
}

export async function transformMCPResult(
  result: unknown,
  tool: string, 
  name: string, 
): Promise<TransformedMCPResult> {
  if (result && typeof result === 'object') {
    if ('toolResult' in result) {
      return {
        content: String(result.toolResult),
        type: 'toolResult',
      }
    }

    if (
      'structuredContent' in result &&
      result.structuredContent !== undefined
    ) {
      return {
        content: jsonStringify(result.structuredContent),
        type: 'structuredContent',
        schema: inferCompactSchema(result.structuredContent),
      }
    }

    if ('content' in result && Array.isArray(result.content)) {
      const transformedContent = (
        await Promise.all(
          result.content.map(item => transformResultContent(item, name)),
        )
      ).flat()
      return {
        content: transformedContent,
        type: 'contentArray',
        schema: inferCompactSchema(transformedContent),
      }
    }
  }

  const errorMessage = `MCP server "${name}" tool "${tool}": unexpected response format`
  logMCPError(name, errorMessage)
  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    errorMessage,
    'MCP tool unexpected response format',
  )
}

function contentContainsImages(content: MCPToolResult): boolean {
  if (!content || typeof content === 'string') {
    return false
  }
  return content.some(block => block.type === 'image')
}

export async function processMCPResult(
  result: unknown,
  tool: string, 
  name: string, 
): Promise<MCPToolResult> {
  const { content, type, schema } = await transformMCPResult(result, tool, name)

  
  
  if (name === 'ide') {
    return content
  }

  
  if (!(await mcpContentNeedsTruncation(content))) {
    return content
  }

  const sizeEstimateTokens = getContentSizeEstimate(content)

  
  if (isEnvDefinedFalsy(process.env.ENABLE_MCP_LARGE_OUTPUT_FILES)) {
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'env_disabled',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return await truncateMcpContentIfNeeded(content)
  }

  
  
  if (!content) {
    return content
  }

  
  
  if (contentContainsImages(content)) {
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'contains_images',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return await truncateMcpContentIfNeeded(content)
  }

  
  const timestamp = Date.now()
  const persistId = `mcp-${normalizeNameForMCP(name)}-${normalizeNameForMCP(tool)}-${timestamp}`
  
  const contentStr =
    typeof content === 'string' ? content : jsonStringify(content, null, 2)
  const persistResult = await persistToolResult(contentStr, persistId)

  if (isPersistError(persistResult)) {
    
    const contentLength = contentStr.length
    logEvent('tengu_mcp_large_result_handled', {
      outcome: 'truncated',
      reason: 'persist_failed',
      sizeEstimateTokens,
    } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
    return `Error: result (${contentLength.toLocaleString()} characters) exceeds maximum allowed tokens. Failed to save output to file: ${persistResult.error}. If this MCP server provides pagination or filtering tools, use them to retrieve specific portions of the data.`
  }

  logEvent('tengu_mcp_large_result_handled', {
    outcome: 'persisted',
    reason: 'file_saved',
    sizeEstimateTokens,
    persistedSizeChars: persistResult.originalSize,
  } as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)

  const formatDescription = getFormatDescription(type, schema)
  return getLargeOutputInstructions(
    persistResult.filepath,
    persistResult.originalSize,
    formatDescription,
  )
}

type MCPToolCallResult = {
  content: MCPToolResult
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
}

export async function callMCPToolWithUrlElicitationRetry({
  client: connectedClient,
  clientConnection,
  tool,
  args,
  meta,
  signal,
  setAppState,
  onProgress,
  callToolFn = callMCPTool,
  handleElicitation,
}: {
  client: ConnectedMCPServer
  clientConnection: MCPServerConnection
  tool: string
  args: Record<string, unknown>
  meta?: Record<string, unknown>
  signal: AbortSignal
  setAppState: (f: (prev: AppState) => AppState) => void
  onProgress?: (data: MCPProgress) => void
  
  callToolFn?: (opts: {
    client: ConnectedMCPServer
    tool: string
    args: Record<string, unknown>
    meta?: Record<string, unknown>
    signal: AbortSignal
    onProgress?: (data: MCPProgress) => void
  }) => Promise<MCPToolCallResult>
  

  handleElicitation?: (
    serverName: string,
    params: ElicitRequestURLParams,
    signal: AbortSignal,
  ) => Promise<ElicitResult>
}): Promise<MCPToolCallResult> {
  const MAX_URL_ELICITATION_RETRIES = 3
  for (let attempt = 0; ; attempt++) {
    try {
      return await callToolFn({
        client: connectedClient,
        tool,
        args,
        meta,
        signal,
        onProgress,
      })
    } catch (error) {
      
      
      if (
        !(error instanceof McpError) ||
        error.code !== ErrorCode.UrlElicitationRequired
      ) {
        throw error
      }

      
      if (attempt >= MAX_URL_ELICITATION_RETRIES) {
        throw error
      }

      const errorData = error.data
      const rawElicitations =
        errorData != null &&
        typeof errorData === 'object' &&
        'elicitations' in errorData &&
        Array.isArray(errorData.elicitations)
          ? (errorData.elicitations as unknown[])
          : []

      
      const elicitations = rawElicitations.filter(
        (e): e is ElicitRequestURLParams => {
          if (e == null || typeof e !== 'object') return false
          const obj = e as Record<string, unknown>
          return (
            obj.mode === 'url' &&
            typeof obj.url === 'string' &&
            typeof obj.elicitationId === 'string' &&
            typeof obj.message === 'string'
          )
        },
      )

      const serverName =
        clientConnection.type === 'connected'
          ? clientConnection.name
          : 'unknown'

      if (elicitations.length === 0) {
        logMCPDebug(
          serverName,
          `Tool '${tool}' returned -32042 but no valid elicitations in error data`,
        )
        throw error
      }

      logMCPDebug(
        serverName,
        `Tool '${tool}' requires URL elicitation (error -32042, attempt ${attempt + 1}), processing ${elicitations.length} elicitation(s)`,
      )

      
      
      
      for (const elicitation of elicitations) {
        const { elicitationId } = elicitation

        
        const hookResponse = await runElicitationHooks(
          serverName,
          elicitation,
          signal,
        )
        if (hookResponse) {
          logMCPDebug(
            serverName,
            `URL elicitation ${elicitationId} resolved by hook: ${jsonStringify(hookResponse)}`,
          )
          if (hookResponse.action !== 'accept') {
            return {
              content: `URL elicitation was ${hookResponse.action === 'decline' ? 'declined' : hookResponse.action + 'ed'} by a hook. The tool "${tool}" could not complete because it requires the user to open a URL.`,
            }
          }
          
          continue
        }

        
        let userResult: ElicitResult
        if (handleElicitation) {
          
          userResult = await handleElicitation(serverName, elicitation, signal)
        } else {
          
          const waitingState: ElicitationWaitingState = {
            actionLabel: 'Retry now',
            showCancel: true,
          }
          userResult = await new Promise<ElicitResult>(resolve => {
            const onAbort = () => {
              void resolve({ action: 'cancel' })
            }
            if (signal.aborted) {
              onAbort()
              return
            }
            signal.addEventListener('abort', onAbort, { once: true })

            setAppState(prev => ({
              ...prev,
              elicitation: {
                queue: [
                  ...prev.elicitation.queue,
                  {
                    serverName,
                    requestId: `error-elicit-${elicitationId}`,
                    params: elicitation,
                    signal,
                    waitingState,
                    respond: result => {
                      
                      if (result.action === 'accept') {
                        return
                      }
                      
                      signal.removeEventListener('abort', onAbort)
                      void resolve(result)
                    },
                    onWaitingDismiss: action => {
                      signal.removeEventListener('abort', onAbort)
                      if (action === 'retry') {
                        void resolve({ action: 'accept' })
                      } else {
                        void resolve({ action: 'cancel' })
                      }
                    },
                  },
                ],
              },
            }))
          })
        }

        
        const finalResult = await runElicitationResultHooks(
          serverName,
          userResult,
          signal,
          'url',
          elicitationId,
        )

        if (finalResult.action !== 'accept') {
          logMCPDebug(
            serverName,
            `User ${finalResult.action === 'decline' ? 'declined' : finalResult.action + 'ed'} URL elicitation ${elicitationId}`,
          )
          return {
            content: `URL elicitation was ${finalResult.action === 'decline' ? 'declined' : finalResult.action + 'ed'} by the user. The tool "${tool}" could not complete because it requires the user to open a URL.`,
          }
        }

        logMCPDebug(
          serverName,
          `Elicitation ${elicitationId} completed, retrying tool call`,
        )
      }

      
    }
  }
}

async function callMCPTool({
  client: { client, name, config },
  tool,
  args,
  meta,
  signal,
  onProgress,
}: {
  client: ConnectedMCPServer
  tool: string
  args: Record<string, unknown>
  meta?: Record<string, unknown>
  signal: AbortSignal
  onProgress?: (data: MCPProgress) => void
}): Promise<{
  content: MCPToolResult
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
}> {
  const toolStartTime = Date.now()
  let progressInterval: NodeJS.Timeout | undefined

  try {
    logMCPDebug(name, `Calling MCP tool: ${tool}`)

    
    progressInterval = setInterval(
      (startTime, name, tool) => {
        const elapsed = Date.now() - startTime
        const elapsedSeconds = Math.floor(elapsed / 1000)
        const duration = `${elapsedSeconds}s`
        logMCPDebug(name, `Tool '${tool}' still running (${duration} elapsed)`)
      },
      30000, 
      toolStartTime,
      name,
      tool,
    )

    
    
    const timeoutMs = getMcpToolTimeoutMs()
    let timeoutId: NodeJS.Timeout | undefined

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        (reject, name, tool, timeoutMs) => {
          reject(
            new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
              `MCP server "${name}" tool "${tool}" timed out after ${Math.floor(timeoutMs / 1000)}s`,
              'MCP tool timeout',
            ),
          )
        },
        timeoutMs,
        reject,
        name,
        tool,
        timeoutMs,
      )
    })

    const result = await Promise.race([
      client.callTool(
        {
          name: tool,
          arguments: args,
          _meta: meta,
        },
        CallToolResultSchema,
        {
          signal,
          timeout: timeoutMs,
          onprogress: onProgress
            ? sdkProgress => {
                onProgress({
                  type: 'mcp_progress',
                  status: 'progress',
                  serverName: name,
                  toolName: tool,
                  progress: sdkProgress.progress,
                  total: sdkProgress.total,
                  progressMessage: sdkProgress.message,
                })
              }
            : undefined,
        },
      ),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    })

    if ('isError' in result && result.isError) {
      let errorDetails = 'Unknown error'
      if (
        'content' in result &&
        Array.isArray(result.content) &&
        result.content.length > 0
      ) {
        const firstContent = result.content[0]
        if (
          firstContent &&
          typeof firstContent === 'object' &&
          'text' in firstContent
        ) {
          errorDetails = firstContent.text
        }
      } else if ('error' in result) {
        
        errorDetails = String(result.error)
      }
      logMCPError(name, errorDetails)
      throw new McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        errorDetails,
        'MCP tool returned error',
        '_meta' in result && result._meta ? { _meta: result._meta } : undefined,
      )
    }
    const elapsed = Date.now() - toolStartTime
    const duration =
      elapsed < 1000
        ? `${elapsed}ms`
        : elapsed < 60000
          ? `${Math.floor(elapsed / 1000)}s`
          : `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`

    logMCPDebug(name, `Tool '${tool}' completed successfully in ${duration}`)

    
    const codeIndexingTool = detectCodeIndexingFromMcpServerName(name)
    if (codeIndexingTool) {
      logEvent('tengu_code_indexing_tool_used', {
        tool: codeIndexingTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source:
          'mcp' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: true,
      })
    }

    const content = await processMCPResult(result, tool, name)
    return {
      content,
      _meta: result._meta as Record<string, unknown> | undefined,
      structuredContent: result.structuredContent as
        | Record<string, unknown>
        | undefined,
    }
  } catch (e) {
    
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }

    const elapsed = Date.now() - toolStartTime

    if (e instanceof Error && e.name !== 'AbortError') {
      logMCPDebug(
        name,
        `Tool '${tool}' failed after ${Math.floor(elapsed / 1000)}s: ${e.message}`,
      )
    }

    
    
    if (e instanceof Error) {
      const errorCode = 'code' in e ? (e.code as number | undefined) : undefined
      if (errorCode === 401 || e instanceof UnauthorizedError) {
        logMCPDebug(
          name,
          `Tool call returned 401 Unauthorized - token may have expired`,
        )
        logEvent('tengu_mcp_tool_call_auth_error', {})
        throw new McpAuthError(
          name,
          `MCP server "${name}" requires re-authorization (token expired)`,
        )
      }

      
      
      
      
      
      
      
      const isSessionExpired = isMcpSessionExpiredError(e)
      const isConnectionClosedOnHttp =
        'code' in e &&
        (e as Error & { code?: number }).code === -32000 &&
        e.message.includes('Connection closed') &&
        (config.type === 'http' || config.type === 'claudeai-proxy')
      if (isSessionExpired || isConnectionClosedOnHttp) {
        logMCPDebug(
          name,
          `MCP session expired during tool call (${isSessionExpired ? '404/-32001' : 'connection closed'}), clearing connection cache for re-initialization`,
        )
        logEvent('tengu_mcp_session_expired', {})
        await clearServerCache(name, config)
        throw new McpSessionExpiredError(name)
      }
    }

    
    if (!(e instanceof Error) || e.name !== 'AbortError') {
      throw e
    }
    return { content: undefined }
  } finally {
    
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }
  }
}

function extractToolUseId(message: AssistantMessage): string | undefined {
  if (message.message.content[0]?.type !== 'tool_use') {
    return undefined
  }
  return message.message.content[0].id
}

export async function setupSdkMcpClients(
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  sendMcpMessage: (
    serverName: string,
    message: JSONRPCMessage,
  ) => Promise<JSONRPCMessage>,
): Promise<{
  clients: MCPServerConnection[]
  tools: Tool[]
}> {
  const clients: MCPServerConnection[] = []
  const tools: Tool[] = []

  
  const results = await Promise.allSettled(
    Object.entries(sdkMcpConfigs).map(async ([name, config]) => {
      const transport = new SdkControlClientTransport(name, sendMcpMessage)

      const client = new Client(
        {
          name: 'claude-code-next',
          title: 'Claude Code Next',
          version: MACRO.VERSION ?? 'unknown',
          description: "Anthropic's agentic coding tool",
          websiteUrl: PRODUCT_URL,
        },
        {
          capabilities: {},
        },
      )

      try {
        
        await client.connect(transport)

        
        const capabilities = client.getServerCapabilities()

        
        const connectedClient: MCPServerConnection = {
          type: 'connected',
          name,
          capabilities: capabilities || {},
          client,
          config: { ...config, scope: 'dynamic' as const },
          cleanup: async () => {
            await client.close()
          },
        }

        
        const serverTools: Tool[] = []
        if (capabilities?.tools) {
          const sdkTools = await fetchToolsForClient(connectedClient)
          serverTools.push(...sdkTools)
        }

        return {
          client: connectedClient,
          tools: serverTools,
        }
      } catch (error) {
        
        logMCPError(name, `Failed to connect SDK MCP server: ${error}`)
        return {
          client: {
            type: 'failed' as const,
            name,
            config: { ...config, scope: 'user' as const },
          },
          tools: [],
        }
      }
    }),
  )

  
  for (const result of results) {
    if (result.status === 'fulfilled') {
      clients.push(result.value.client)
      tools.push(...result.value.tools)
    }
    
  }

  return { clients, tools }
}
