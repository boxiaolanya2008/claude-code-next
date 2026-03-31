import { feature } from "../utils/bundle-mock.ts"
import { basename } from 'path'
import { useCallback, useEffect, useRef } from 'react'
import { getSessionId } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import type { Tool } from '../../Tool.js'
import {
  clearServerCache,
  fetchCommandsForClient,
  fetchResourcesForClient,
  fetchToolsForClient,
  getMcpToolsCommandsAndResources,
  reconnectMcpServerImpl,
} from './client.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'

const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? (
      require('../../skills/mcpSkills.js') as typeof import('../../skills/mcpSkills.js')
    ).fetchMcpSkillsForClient
  : null
const clearSkillIndexCache = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (
      require('../skillSearch/localSearch.js') as typeof import('../skillSearch/localSearch.js')
    ).clearSkillIndexCache
  : null

import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import omit from 'lodash-es/omit.js'
import reject from 'lodash-es/reject.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  dedupClaudeAiMcpServers,
  doesEnterpriseMcpConfigExist,
  filterMcpServersByPolicy,
  getClaudeCodeMcpConfigs,
  isMcpServerDisabled,
  setMcpServerEnabled,
} from 'src/services/mcp/config.js'
import type { AppState } from 'src/state/AppState.js'
import type { PluginError } from 'src/types/plugin.js'
import { logForDebugging } from 'src/utils/debug.js'
import { getAllowedChannels } from '../../bootstrap/state.js'
import { useNotifications } from '../../context/notifications.js'
import {
  useAppState,
  useAppStateStore,
  useSetAppState,
} from '../../state/AppState.js'
import { errorMessage } from '../../utils/errors.js'

import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { enqueue } from '../../utils/messageQueueManager.js'
import {
  CHANNEL_PERMISSION_METHOD,
  ChannelMessageNotificationSchema,
  ChannelPermissionNotificationSchema,
  findChannelEntry,
  gateChannelServer,
  wrapChannelMessage,
} from './channelNotification.js'
import {
  type ChannelPermissionCallbacks,
  createChannelPermissionCallbacks,
  isChannelPermissionRelayEnabled,
} from './channelPermissions.js'
import {
  clearClaudeAIMcpConfigsCache,
  fetchClaudeAIMcpConfigsIfEligible,
} from './claudeai.js'
import { registerElicitationHandler } from './elicitationHandler.js'
import { getMcpPrefix } from './mcpStringUtils.js'
import { commandBelongsToServer, excludeStalePluginClients } from './utils.js'

const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

function getErrorKey(error: PluginError): string {
  const plugin = 'plugin' in error ? error.plugin : 'no-plugin'
  return `${error.type}:${error.source}:${plugin}`
}

function addErrorsToAppState(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  newErrors: PluginError[],
): void {
  if (newErrors.length === 0) return

  setAppState(prevState => {
    
    const existingKeys = new Set(
      prevState.plugins.errors.map(e => getErrorKey(e)),
    )

    
    const uniqueNewErrors = newErrors.filter(
      error => !existingKeys.has(getErrorKey(error)),
    )

    if (uniqueNewErrors.length === 0) {
      return prevState
    }

    return {
      ...prevState,
      plugins: {
        ...prevState.plugins,
        errors: [...prevState.plugins.errors, ...uniqueNewErrors],
      },
    }
  })
}

export function useManageMCPConnections(
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined,
  isStrictMcpConfig = false,
) {
  const store = useAppStateStore()
  const _authVersion = useAppState(s => s.authVersion)
  
  
  
  
  const _pluginReconnectKey = useAppState(s => s.mcp.pluginReconnectKey)
  const setAppState = useSetAppState()

  
  const reconnectTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  
  
  
  const channelWarnedKindsRef = useRef<
    Set<'disabled' | 'auth' | 'policy' | 'marketplace' | 'allowlist'>
  >(new Set())
  
  
  
  const channelPermCallbacksRef = useRef<ChannelPermissionCallbacks | null>(
    null,
  )
  if (
    (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
    channelPermCallbacksRef.current === null
  ) {
    channelPermCallbacksRef.current = createChannelPermissionCallbacks()
  }
  
  
  useEffect(() => {
    if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
      const callbacks = channelPermCallbacksRef.current
      if (!callbacks) return
      
      
      
      
      
      if (!isChannelPermissionRelayEnabled()) return
      setAppState(prev => {
        if (prev.channelPermissionCallbacks === callbacks) return prev
        return { ...prev, channelPermissionCallbacks: callbacks }
      })
      return () => {
        setAppState(prev => {
          if (prev.channelPermissionCallbacks === undefined) return prev
          return { ...prev, channelPermissionCallbacks: undefined }
        })
      }
    }
  }, [setAppState])
  const { addNotification } = useNotifications()

  
  
  
  
  const MCP_BATCH_FLUSH_MS = 16
  type PendingUpdate = MCPServerConnection & {
    tools?: Tool[]
    commands?: Command[]
    resources?: ServerResource[]
  }
  const pendingUpdatesRef = useRef<PendingUpdate[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushPendingUpdates = useCallback(() => {
    flushTimerRef.current = null
    const updates = pendingUpdatesRef.current
    if (updates.length === 0) return
    pendingUpdatesRef.current = []

    setAppState(prevState => {
      let mcp = prevState.mcp

      for (const update of updates) {
        const {
          tools: rawTools,
          commands: rawCmds,
          resources: rawRes,
          ...client
        } = update
        const tools =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawTools ?? [])
            : rawTools
        const commands =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawCmds ?? [])
            : rawCmds
        const resources =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawRes ?? [])
            : rawRes

        const prefix = getMcpPrefix(client.name)
        const existingClientIndex = mcp.clients.findIndex(
          c => c.name === client.name,
        )

        const updatedClients =
          existingClientIndex === -1
            ? [...mcp.clients, client]
            : mcp.clients.map(c => (c.name === client.name ? client : c))

        const updatedTools =
          tools === undefined
            ? mcp.tools
            : [...reject(mcp.tools, t => t.name?.startsWith(prefix)), ...tools]

        const updatedCommands =
          commands === undefined
            ? mcp.commands
            : [
                ...reject(mcp.commands, c =>
                  commandBelongsToServer(c, client.name),
                ),
                ...commands,
              ]

        const updatedResources =
          resources === undefined
            ? mcp.resources
            : {
                ...mcp.resources,
                ...(resources.length > 0
                  ? { [client.name]: resources }
                  : omit(mcp.resources, client.name)),
              }

        mcp = {
          ...mcp,
          clients: updatedClients,
          tools: updatedTools,
          commands: updatedCommands,
          resources: updatedResources,
        }
      }

      return { ...prevState, mcp }
    })
  }, [setAppState])

  
  
  
  
  const updateServer = useCallback(
    (update: PendingUpdate) => {
      pendingUpdatesRef.current.push(update)
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(
          flushPendingUpdates,
          MCP_BATCH_FLUSH_MS,
        )
      }
    },
    [flushPendingUpdates],
  )

  const onConnectionAttempt = useCallback(
    ({
      client,
      tools,
      commands,
      resources,
    }: {
      client: MCPServerConnection
      tools: Tool[]
      commands: Command[]
      resources?: ServerResource[]
    }) => {
      updateServer({ ...client, tools, commands, resources })

      
      switch (client.type) {
        case 'connected': {
          
          
          
          
          registerElicitationHandler(client.client, client.name, setAppState)

          client.client.onclose = () => {
            const configType = client.config.type ?? 'stdio'

            clearServerCache(client.name, client.config).catch(() => {
              logForDebugging(
                `Failed to invalidate the server cache: ${client.name}`,
              )
            })

            
            
            
            
            if (isMcpServerDisabled(client.name)) {
              logMCPDebug(
                client.name,
                `Server is disabled, skipping automatic reconnection`,
              )
              return
            }

            
            
            if (configType !== 'stdio' && configType !== 'sdk') {
              const transportType = getTransportDisplayName(configType)
              logMCPDebug(
                client.name,
                `${transportType} transport closed/disconnected, attempting automatic reconnection`,
              )

              
              const existingTimer = reconnectTimersRef.current.get(client.name)
              if (existingTimer) {
                clearTimeout(existingTimer)
                reconnectTimersRef.current.delete(client.name)
              }

              
              const reconnectWithBackoff = async () => {
                for (
                  let attempt = 1;
                  attempt <= MAX_RECONNECT_ATTEMPTS;
                  attempt++
                ) {
                  
                  if (isMcpServerDisabled(client.name)) {
                    logMCPDebug(
                      client.name,
                      `Server disabled during reconnection, stopping retry`,
                    )
                    reconnectTimersRef.current.delete(client.name)
                    return
                  }

                  updateServer({
                    ...client,
                    type: 'pending',
                    reconnectAttempt: attempt,
                    maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
                  })

                  const reconnectStartTime = Date.now()
                  try {
                    const result = await reconnectMcpServerImpl(
                      client.name,
                      client.config,
                    )
                    const elapsed = Date.now() - reconnectStartTime

                    if (result.client.type === 'connected') {
                      logMCPDebug(
                        client.name,
                        `${transportType} reconnection successful after ${elapsed}ms (attempt ${attempt})`,
                      )
                      reconnectTimersRef.current.delete(client.name)
                      onConnectionAttempt(result)
                      return
                    }

                    logMCPDebug(
                      client.name,
                      `${transportType} reconnection attempt ${attempt} completed with status: ${result.client.type}`,
                    )

                    
                    if (attempt === MAX_RECONNECT_ATTEMPTS) {
                      logMCPDebug(
                        client.name,
                        `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`,
                      )
                      reconnectTimersRef.current.delete(client.name)
                      onConnectionAttempt(result)
                      return
                    }
                  } catch (error) {
                    const elapsed = Date.now() - reconnectStartTime
                    logMCPError(
                      client.name,
                      `${transportType} reconnection attempt ${attempt} failed after ${elapsed}ms: ${error}`,
                    )

                    
                    if (attempt === MAX_RECONNECT_ATTEMPTS) {
                      logMCPDebug(
                        client.name,
                        `Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached, giving up`,
                      )
                      reconnectTimersRef.current.delete(client.name)
                      updateServer({ ...client, type: 'failed' })
                      return
                    }
                  }

                  
                  const backoffMs = Math.min(
                    INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1),
                    MAX_BACKOFF_MS,
                  )
                  logMCPDebug(
                    client.name,
                    `Scheduling reconnection attempt ${attempt + 1} in ${backoffMs}ms`,
                  )

                  await new Promise<void>(resolve => {
                    
                    const timer = setTimeout(resolve, backoffMs)
                    reconnectTimersRef.current.set(client.name, timer)
                  })
                }
              }

              void reconnectWithBackoff()
            } else {
              updateServer({ ...client, type: 'failed' })
            }
          }

          
          
          
          if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
            const gate = gateChannelServer(
              client.name,
              client.capabilities,
              client.config.pluginSource,
            )
            const entry = findChannelEntry(client.name, getAllowedChannels())
            
            
            
            
            
            
            const pluginId =
              entry?.kind === 'plugin'
                ? (`${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
                : undefined
            
            if (gate.action === 'register' || gate.kind !== 'capability') {
              logEvent('tengu_mcp_channel_gate', {
                registered: gate.action === 'register',
                skip_kind:
                  gate.action === 'skip'
                    ? (gate.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
                    : undefined,
                entry_kind:
                  entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                is_dev: entry?.dev ?? false,
                plugin: pluginId,
              })
            }
            switch (gate.action) {
              case 'register':
                logMCPDebug(client.name, 'Channel notifications registered')
                client.client.setNotificationHandler(
                  ChannelMessageNotificationSchema(),
                  async notification => {
                    const { content, meta } = notification.params
                    logMCPDebug(
                      client.name,
                      `notifications/claude/channel: ${content.slice(0, 80)}`,
                    )
                    logEvent('tengu_mcp_channel_message', {
                      content_length: content.length,
                      meta_key_count: Object.keys(meta ?? {}).length,
                      entry_kind:
                        entry?.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      is_dev: entry?.dev ?? false,
                      plugin: pluginId,
                    })
                    enqueue({
                      mode: 'prompt',
                      value: wrapChannelMessage(client.name, content, meta),
                      priority: 'next',
                      isMeta: true,
                      origin: { kind: 'channel', server: client.name },
                      skipSlashCommands: true,
                    })
                  },
                )
                
                
                
                
                
                
                if (
                  client.capabilities?.experimental?.[
                    'claude/channel/permission'
                  ] !== undefined
                ) {
                  client.client.setNotificationHandler(
                    ChannelPermissionNotificationSchema(),
                    async notification => {
                      const { request_id, behavior } = notification.params
                      const resolved =
                        channelPermCallbacksRef.current?.resolve(
                          request_id,
                          behavior,
                          client.name,
                        ) ?? false
                      logMCPDebug(
                        client.name,
                        `notifications/claude/channel/permission: ${request_id} → ${behavior} (${resolved ? 'matched pending' : 'no pending entry — stale or unknown ID'})`,
                      )
                    },
                  )
                }
                break
              case 'skip':
                
                
                
                
                
                client.client.removeNotificationHandler(
                  'notifications/claude/channel',
                )
                client.client.removeNotificationHandler(
                  CHANNEL_PERMISSION_METHOD,
                )
                logMCPDebug(
                  client.name,
                  `Channel notifications skipped: ${gate.reason}`,
                )
                
                
                
                
                
                
                if (
                  gate.kind !== 'capability' &&
                  gate.kind !== 'session' &&
                  !channelWarnedKindsRef.current.has(gate.kind) &&
                  (gate.kind === 'marketplace' ||
                    gate.kind === 'allowlist' ||
                    entry !== undefined)
                ) {
                  channelWarnedKindsRef.current.add(gate.kind)
                  
                  
                  
                  const text =
                    gate.kind === 'disabled'
                      ? 'Channels are not currently available'
                      : gate.kind === 'auth'
                        ? 'Channels require claude.ai authentication · run /login'
                        : gate.kind === 'policy'
                          ? 'Channels are not enabled for your org · have an administrator set channelsEnabled: true in managed settings'
                          : gate.reason
                  addNotification({
                    key: `channels-blocked-${gate.kind}`,
                    priority: 'high',
                    text,
                    color: 'warning',
                    timeoutMs: 12000,
                  })
                }
                break
            }
          }

          
          
          if (client.capabilities?.tools?.listChanged) {
            client.client.setNotificationHandler(
              ToolListChangedNotificationSchema,
              async () => {
                logMCPDebug(
                  client.name,
                  `Received tools/list_changed notification, refreshing tools`,
                )
                try {
                  
                  const previousToolsPromise = fetchToolsForClient.cache.get(
                    client.name,
                  )
                  fetchToolsForClient.cache.delete(client.name)
                  const newTools = await fetchToolsForClient(client)
                  const newCount = newTools.length
                  if (previousToolsPromise) {
                    previousToolsPromise.then(
                      (previousTools: Tool[]) => {
                        logEvent('tengu_mcp_list_changed', {
                          type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          previousCount: previousTools.length,
                          newCount,
                        })
                      },
                      () => {
                        logEvent('tengu_mcp_list_changed', {
                          type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                          newCount,
                        })
                      },
                    )
                  } else {
                    logEvent('tengu_mcp_list_changed', {
                      type: 'tools' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                      newCount,
                    })
                  }
                  updateServer({ ...client, tools: newTools })
                } catch (error) {
                  logMCPError(
                    client.name,
                    `Failed to refresh tools after list_changed notification: ${errorMessage(error)}`,
                  )
                }
              },
            )
          }

          if (client.capabilities?.prompts?.listChanged) {
            client.client.setNotificationHandler(
              PromptListChangedNotificationSchema,
              async () => {
                logMCPDebug(
                  client.name,
                  `Received prompts/list_changed notification, refreshing prompts`,
                )
                logEvent('tengu_mcp_list_changed', {
                  type: 'prompts' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                try {
                  
                  
                  fetchCommandsForClient.cache.delete(client.name)
                  const [mcpPrompts, mcpSkills] = await Promise.all([
                    fetchCommandsForClient(client),
                    feature('MCP_SKILLS')
                      ? fetchMcpSkillsForClient!(client)
                      : Promise.resolve([]),
                  ])
                  updateServer({
                    ...client,
                    commands: [...mcpPrompts, ...mcpSkills],
                  })
                  
                  
                  clearSkillIndexCache?.()
                } catch (error) {
                  logMCPError(
                    client.name,
                    `Failed to refresh prompts after list_changed notification: ${errorMessage(error)}`,
                  )
                }
              },
            )
          }

          if (client.capabilities?.resources?.listChanged) {
            client.client.setNotificationHandler(
              ResourceListChangedNotificationSchema,
              async () => {
                logMCPDebug(
                  client.name,
                  `Received resources/list_changed notification, refreshing resources`,
                )
                logEvent('tengu_mcp_list_changed', {
                  type: 'resources' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                })
                try {
                  fetchResourcesForClient.cache.delete(client.name)
                  if (feature('MCP_SKILLS')) {
                    
                    
                    
                    
                    fetchMcpSkillsForClient!.cache.delete(client.name)
                    fetchCommandsForClient.cache.delete(client.name)
                    const [newResources, mcpPrompts, mcpSkills] =
                      await Promise.all([
                        fetchResourcesForClient(client),
                        fetchCommandsForClient(client),
                        fetchMcpSkillsForClient!(client),
                      ])
                    updateServer({
                      ...client,
                      resources: newResources,
                      commands: [...mcpPrompts, ...mcpSkills],
                    })
                    
                    
                    clearSkillIndexCache?.()
                  } else {
                    const newResources = await fetchResourcesForClient(client)
                    updateServer({ ...client, resources: newResources })
                  }
                } catch (error) {
                  logMCPError(
                    client.name,
                    `Failed to refresh resources after list_changed notification: ${errorMessage(error)}`,
                  )
                }
              },
            )
          }
          break
        }

        case 'needs-auth':
        case 'failed':
        case 'pending':
        case 'disabled':
          break
      }
    },
    [updateServer],
  )

  
  
  
  
  
  
  const sessionId = getSessionId()
  useEffect(() => {
    async function initializeServersAsPending() {
      const { servers: existingConfigs, errors: mcpErrors } = isStrictMcpConfig
        ? { servers: {}, errors: [] }
        : await getClaudeCodeMcpConfigs(dynamicMcpConfig)
      const configs = { ...existingConfigs, ...dynamicMcpConfig }

      
      addErrorsToAppState(setAppState, mcpErrors)

      setAppState(prevState => {
        
        
        
        
        const { stale, ...mcpWithoutStale } = excludeStalePluginClients(
          prevState.mcp,
          configs,
        )
        
        
        
        
        
        
        
        
        
        
        
        for (const s of stale) {
          const timer = reconnectTimersRef.current.get(s.name)
          if (timer) {
            clearTimeout(timer)
            reconnectTimersRef.current.delete(s.name)
          }
          if (s.type === 'connected') {
            s.client.onclose = undefined
            void clearServerCache(s.name, s.config).catch(() => {})
          }
        }

        const existingServerNames = new Set(
          mcpWithoutStale.clients.map(c => c.name),
        )
        const newClients = Object.entries(configs)
          .filter(([name]) => !existingServerNames.has(name))
          .map(([name, config]) => ({
            name,
            type: isMcpServerDisabled(name)
              ? ('disabled' as const)
              : ('pending' as const),
            config,
          }))

        if (newClients.length === 0 && stale.length === 0) {
          return prevState
        }

        return {
          ...prevState,
          mcp: {
            ...prevState.mcp,
            ...mcpWithoutStale,
            clients: [...mcpWithoutStale.clients, ...newClients],
          },
        }
      })
    }

    void initializeServersAsPending().catch(error => {
      logMCPError(
        'useManageMCPConnections',
        `Failed to initialize servers as pending: ${errorMessage(error)}`,
      )
    })
  }, [
    isStrictMcpConfig,
    dynamicMcpConfig,
    setAppState,
    sessionId,
    _pluginReconnectKey,
  ])

  
  
  useEffect(() => {
    let cancelled = false

    async function loadAndConnectMcpConfigs() {
      
      
      
      
      
      let claudeaiPromise: Promise<Record<string, ScopedMcpServerConfig>>
      if (isStrictMcpConfig || doesEnterpriseMcpConfigExist()) {
        claudeaiPromise = Promise.resolve({})
      } else {
        clearClaudeAIMcpConfigsCache()
        claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
      }

      
      
      
      const { servers: claudeCodeConfigs, errors: mcpErrors } =
        isStrictMcpConfig
          ? { servers: {}, errors: [] }
          : await getClaudeCodeMcpConfigs(dynamicMcpConfig, claudeaiPromise)
      if (cancelled) return

      
      addErrorsToAppState(setAppState, mcpErrors)

      const configs = { ...claudeCodeConfigs, ...dynamicMcpConfig }

      
      
      const enabledConfigs = Object.fromEntries(
        Object.entries(configs).filter(([name]) => !isMcpServerDisabled(name)),
      )
      getMcpToolsCommandsAndResources(
        onConnectionAttempt,
        enabledConfigs,
      ).catch(error => {
        logMCPError(
          'useManageMcpConnections',
          `Failed to get MCP resources: ${errorMessage(error)}`,
        )
      })

      
      let claudeaiConfigs: Record<string, ScopedMcpServerConfig> = {}
      if (!isStrictMcpConfig) {
        claudeaiConfigs = filterMcpServersByPolicy(
          await claudeaiPromise,
        ).allowed
        if (cancelled) return

        
        
        
        if (Object.keys(claudeaiConfigs).length > 0) {
          const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
            claudeaiConfigs,
            configs,
          )
          claudeaiConfigs = dedupedClaudeAi
        }

        if (Object.keys(claudeaiConfigs).length > 0) {
          
          setAppState(prevState => {
            const existingServerNames = new Set(
              prevState.mcp.clients.map(c => c.name),
            )
            const newClients = Object.entries(claudeaiConfigs)
              .filter(([name]) => !existingServerNames.has(name))
              .map(([name, config]) => ({
                name,
                type: isMcpServerDisabled(name)
                  ? ('disabled' as const)
                  : ('pending' as const),
                config,
              }))
            if (newClients.length === 0) return prevState
            return {
              ...prevState,
              mcp: {
                ...prevState.mcp,
                clients: [...prevState.mcp.clients, ...newClients],
              },
            }
          })

          
          const enabledClaudeaiConfigs = Object.fromEntries(
            Object.entries(claudeaiConfigs).filter(
              ([name]) => !isMcpServerDisabled(name),
            ),
          )
          getMcpToolsCommandsAndResources(
            onConnectionAttempt,
            enabledClaudeaiConfigs,
          ).catch(error => {
            logMCPError(
              'useManageMcpConnections',
              `Failed to get claude.ai MCP resources: ${errorMessage(error)}`,
            )
          })
        }
      }

      
      const allConfigs = { ...configs, ...claudeaiConfigs }
      const counts = {
        enterprise: 0,
        global: 0,
        project: 0,
        user: 0,
        plugin: 0,
        claudeai: 0,
      }
      
      
      
      const stdioCommands: string[] = []
      for (const [name, serverConfig] of Object.entries(allConfigs)) {
        if (serverConfig.scope === 'enterprise') counts.enterprise++
        else if (serverConfig.scope === 'user') counts.global++
        else if (serverConfig.scope === 'project') counts.project++
        else if (serverConfig.scope === 'local') counts.user++
        else if (serverConfig.scope === 'dynamic') counts.plugin++
        else if (serverConfig.scope === 'claudeai') counts.claudeai++

        if (
          process.env.USER_TYPE === 'ant' &&
          !isMcpServerDisabled(name) &&
          (serverConfig.type === undefined || serverConfig.type === 'stdio') &&
          'command' in serverConfig
        ) {
          stdioCommands.push(basename(serverConfig.command))
        }
      }
      logEvent('tengu_mcp_servers', {
        ...counts,
        ...(process.env.USER_TYPE === 'ant' && stdioCommands.length > 0
          ? {
              stdio_commands: stdioCommands
                .sort()
                .join(
                  ',',
                ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
      })
    }

    void loadAndConnectMcpConfigs()

    return () => {
      cancelled = true
    }
  }, [
    isStrictMcpConfig,
    dynamicMcpConfig,
    onConnectionAttempt,
    setAppState,
    _authVersion,
    sessionId,
    _pluginReconnectKey,
  ])

  
  useEffect(() => {
    const timers = reconnectTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
        flushPendingUpdates()
      }
    }
  }, [flushPendingUpdates])

  
  
  
  const reconnectMcpServer = useCallback(
    async (serverName: string) => {
      const client = store
        .getState()
        .mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      
      const existingTimer = reconnectTimersRef.current.get(serverName)
      if (existingTimer) {
        clearTimeout(existingTimer)
        reconnectTimersRef.current.delete(serverName)
      }

      const result = await reconnectMcpServerImpl(serverName, client.config)

      onConnectionAttempt(result)

      
      
      return result
    },
    [store, onConnectionAttempt],
  )

  
  const toggleMcpServer = useCallback(
    async (serverName: string): Promise<void> => {
      const client = store
        .getState()
        .mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      const isCurrentlyDisabled = client.type === 'disabled'

      if (!isCurrentlyDisabled) {
        
        const existingTimer = reconnectTimersRef.current.get(serverName)
        if (existingTimer) {
          clearTimeout(existingTimer)
          reconnectTimersRef.current.delete(serverName)
        }

        
        
        setMcpServerEnabled(serverName, false)

        
        if (client.type === 'connected') {
          await clearServerCache(serverName, client.config)
        }

        
        updateServer({
          name: serverName,
          type: 'disabled',
          config: client.config,
        })
      } else {
        
        setMcpServerEnabled(serverName, true)

        
        updateServer({
          name: serverName,
          type: 'pending',
          config: client.config,
        })

        
        const result = await reconnectMcpServerImpl(serverName, client.config)

        onConnectionAttempt(result)
      }
    },
    [store, updateServer, onConnectionAttempt],
  )

  return { reconnectMcpServer, toggleMcpServer }
}

function getTransportDisplayName(type: string): string {
  switch (type) {
    case 'http':
      return 'HTTP'
    case 'ws':
    case 'ws-ide':
      return 'WebSocket'
    default:
      return 'SSE'
  }
}
