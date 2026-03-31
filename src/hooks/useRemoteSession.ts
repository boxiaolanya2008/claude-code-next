import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BoundedUUIDSet } from '../bridge/bridgeMessaging.js'
import type { ToolUseConfirm } from '../components/permissions/PermissionRequest.js'
import type { SpinnerMode } from '../components/Spinner/types.js'
import {
  type RemotePermissionResponse,
  type RemoteSessionConfig,
  RemoteSessionManager,
} from '../remote/RemoteSessionManager.js'
import {
  createSyntheticAssistantMessage,
  createToolStub,
} from '../remote/remotePermissionBridge.js'
import {
  convertSDKMessage,
  isSessionEndMessage,
} from '../remote/sdkMessageAdapter.js'
import { useSetAppState } from '../state/AppState.js'
import type { AppState } from '../state/AppStateStore.js'
import type { Tool } from '../Tool.js'
import { findToolByName } from '../Tool.js'
import type { Message as MessageType } from '../types/message.js'
import type { PermissionAskDecision } from '../types/permissions.js'
import { logForDebugging } from '../utils/debug.js'
import { truncateToWidth } from '../utils/format.js'
import {
  createSystemMessage,
  extractTextContent,
  handleMessageFromStream,
  type StreamingToolUse,
} from '../utils/messages.js'
import { generateSessionTitle } from '../utils/sessionTitle.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'
import { updateSessionTitle } from '../utils/teleport/api.js'

const RESPONSE_TIMEOUT_MS = 60000 

const COMPACTION_TIMEOUT_MS = 180000 

type UseRemoteSessionProps = {
  config: RemoteSessionConfig | undefined
  setMessages: React.Dispatch<React.SetStateAction<MessageType[]>>
  setIsLoading: (loading: boolean) => void
  onInit?: (slashCommands: string[]) => void
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>
  tools: Tool[]
  setStreamingToolUses?: React.Dispatch<
    React.SetStateAction<StreamingToolUse[]>
  >
  setStreamMode?: React.Dispatch<React.SetStateAction<SpinnerMode>>
  setInProgressToolUseIDs?: (f: (prev: Set<string>) => Set<string>) => void
}

type UseRemoteSessionResult = {
  isRemoteMode: boolean
  sendMessage: (
    content: RemoteMessageContent,
    opts?: { uuid?: string },
  ) => Promise<boolean>
  cancelRequest: () => void
  disconnect: () => void
}

/**
 * Hook for managing a remote CCR session in the REPL.
 *
 * Handles:
 * - WebSocket connection to CCR
 * - Converting SDK messages to REPL messages
 * - Sending user input to CCR via HTTP POST
 * - Permission request/response flow via existing ToolUseConfirm queue
 */
export function useRemoteSession({
  config,
  setMessages,
  setIsLoading,
  onInit,
  setToolUseConfirmQueue,
  tools,
  setStreamingToolUses,
  setStreamMode,
  setInProgressToolUseIDs,
}: UseRemoteSessionProps): UseRemoteSessionResult {
  const isRemoteMode = !!config

  const setAppState = useSetAppState()
  const setConnStatus = useCallback(
    (s: AppState['remoteConnectionStatus']) =>
      setAppState(prev =>
        prev.remoteConnectionStatus === s
          ? prev
          : { ...prev, remoteConnectionStatus: s },
      ),
    [setAppState],
  )

  
  
  
  const runningTaskIdsRef = useRef(new Set<string>())
  const writeTaskCount = useCallback(() => {
    const n = runningTaskIdsRef.current.size
    setAppState(prev =>
      prev.remoteBackgroundTaskCount === n
        ? prev
        : { ...prev, remoteBackgroundTaskCount: n },
    )
  }, [setAppState])

  
  const responseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  
  
  // use a longer timeout and suppress spurious "unresponsive" warnings.
  const isCompactingRef = useRef(false)

  const managerRef = useRef<RemoteSessionManager | null>(null)

  
  const hasUpdatedTitleRef = useRef(false)

  
  
  
  
  // the server may broadcast the POST directly to /subscribe, AND the worker
  
  
  
  
  
  
  const sentUUIDsRef = useRef(new BoundedUUIDSet(50))

  
  const toolsRef = useRef(tools)
  useEffect(() => {
    toolsRef.current = tools
  }, [tools])

  
  useEffect(() => {
    // Skip if not in remote mode
    if (!config) {
      return
    }

    logForDebugging(
      `[useRemoteSession] Initializing for session ${config.sessionId}`,
    )

    const manager = new RemoteSessionManager(config, {
      onMessage: sdkMessage => {
        const parts = [`type=${sdkMessage.type}`]
        if ('subtype' in sdkMessage) parts.push(`subtype=${sdkMessage.subtype}`)
        if (sdkMessage.type === 'user') {
          const c = sdkMessage.message?.content
          parts.push(
            `content=${Array.isArray(c) ? c.map(b => b.type).join(',') : typeof c}`,
          )
        }
        logForDebugging(`[useRemoteSession] Received ${parts.join(' ')}`)

        
        
        
        
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current)
          responseTimeoutRef.current = null
        }

        // Echo filter: drop user messages we already added locally before POST.
        
        
        
        
        if (
          sdkMessage.type === 'user' &&
          sdkMessage.uuid &&
          sentUUIDsRef.current.has(sdkMessage.uuid)
        ) {
          logForDebugging(
            `[useRemoteSession] Dropping echoed user message ${sdkMessage.uuid}`,
          )
          return
        }
        // Handle init message - extract available slash commands
        if (
          sdkMessage.type === 'system' &&
          sdkMessage.subtype === 'init' &&
          onInit
        ) {
          logForDebugging(
            `[useRemoteSession] Init received with ${sdkMessage.slash_commands.length} slash commands`,
          )
          onInit(sdkMessage.slash_commands)
        }

        // Track remote subagent lifecycle for the "N in background" counter.
        
        
        
        if (sdkMessage.type === 'system') {
          if (sdkMessage.subtype === 'task_started') {
            runningTaskIdsRef.current.add(sdkMessage.task_id)
            writeTaskCount()
            return
          }
          if (sdkMessage.subtype === 'task_notification') {
            runningTaskIdsRef.current.delete(sdkMessage.task_id)
            writeTaskCount()
            return
          }
          if (sdkMessage.subtype === 'task_progress') {
            return
          }
          // Track compaction state. The CLI emits status='compacting' at
          
          
          
          if (sdkMessage.subtype === 'status') {
            const wasCompacting = isCompactingRef.current
            isCompactingRef.current = sdkMessage.status === 'compacting'
            if (wasCompacting && isCompactingRef.current) {
              return
            }
          }
          if (sdkMessage.subtype === 'compact_boundary') {
            isCompactingRef.current = false
          }
        }

        // Check if session ended
        if (isSessionEndMessage(sdkMessage)) {
          isCompactingRef.current = false
          setIsLoading(false)
        }

        // Clear in-progress tool_use IDs when their tool_result arrives.
        
        // convertSDKMessage returns {type:'ignored'} for user messages, so the
        
        
        
        if (setInProgressToolUseIDs && sdkMessage.type === 'user') {
          const content = sdkMessage.message?.content
          if (Array.isArray(content)) {
            const resultIds: string[] = []
            for (const block of content) {
              if (block.type === 'tool_result') {
                resultIds.push(block.tool_use_id)
              }
            }
            if (resultIds.length > 0) {
              setInProgressToolUseIDs(prev => {
                const next = new Set(prev)
                for (const id of resultIds) next.delete(id)
                return next.size === prev.size ? prev : next
              })
            }
          }
        }

        // Convert SDK message to REPL message. In viewerOnly mode, the
        
        
        
        const converted = convertSDKMessage(
          sdkMessage,
          config.viewerOnly
            ? { convertToolResults: true, convertUserTextMessages: true }
            : undefined,
        )

        if (converted.type === 'message') {
          // When we receive a complete message, clear streaming tool uses
          
          setStreamingToolUses?.(prev => (prev.length > 0 ? [] : prev))

          
          
          // toolOrchestration.ts handles this, but remote sessions receive
          
          if (
            setInProgressToolUseIDs &&
            converted.message.type === 'assistant'
          ) {
            const toolUseIds = converted.message.message.content
              .filter(block => block.type === 'tool_use')
              .map(block => block.id)
            if (toolUseIds.length > 0) {
              setInProgressToolUseIDs(prev => {
                const next = new Set(prev)
                for (const id of toolUseIds) {
                  next.add(id)
                }
                return next
              })
            }
          }

          setMessages(prev => [...prev, converted.message])
          
          
        } else if (converted.type === 'stream_event') {
          // Process streaming events to update UI in real-time
          if (setStreamingToolUses && setStreamMode) {
            handleMessageFromStream(
              converted.event,
              message => setMessages(prev => [...prev, message]),
              () => {
                // No-op for response length - remote sessions don't track this
              },
              setStreamMode,
              setStreamingToolUses,
            )
          } else {
            logForDebugging(
              `[useRemoteSession] Stream event received but streaming callbacks not provided`,
            )
          }
        }
        // 'ignored' messages are silently dropped
      },
      onPermissionRequest: (request, requestId) => {
        logForDebugging(
          `[useRemoteSession] Permission request for tool: ${request.tool_name}`,
        )

        // Look up the Tool object by name, or create a stub for unknown tools
        const tool =
          findToolByName(toolsRef.current, request.tool_name) ??
          createToolStub(request.tool_name)

        const syntheticMessage = createSyntheticAssistantMessage(
          request,
          requestId,
        )

        const permissionResult: PermissionAskDecision = {
          behavior: 'ask',
          message:
            request.description ?? `${request.tool_name} requires permission`,
          suggestions: request.permission_suggestions,
          blockedPath: request.blocked_path,
        }

        const toolUseConfirm: ToolUseConfirm = {
          assistantMessage: syntheticMessage,
          tool,
          description:
            request.description ?? `${request.tool_name} requires permission`,
          input: request.input,
          toolUseContext: {} as ToolUseConfirm['toolUseContext'],
          toolUseID: request.tool_use_id,
          permissionResult,
          permissionPromptStartTimeMs: Date.now(),
          onUserInteraction() {
            // No-op for remote — classifier runs on the container
          },
          onAbort() {
            const response: RemotePermissionResponse = {
              behavior: 'deny',
              message: 'User aborted',
            }
            manager.respondToPermissionRequest(requestId, response)
            setToolUseConfirmQueue(queue =>
              queue.filter(item => item.toolUseID !== request.tool_use_id),
            )
          },
          onAllow(updatedInput, _permissionUpdates, _feedback) {
            const response: RemotePermissionResponse = {
              behavior: 'allow',
              updatedInput,
            }
            manager.respondToPermissionRequest(requestId, response)
            setToolUseConfirmQueue(queue =>
              queue.filter(item => item.toolUseID !== request.tool_use_id),
            )
            // Resume loading indicator after approving
            setIsLoading(true)
          },
          onReject(feedback?: string) {
            const response: RemotePermissionResponse = {
              behavior: 'deny',
              message: feedback ?? 'User denied permission',
            }
            manager.respondToPermissionRequest(requestId, response)
            setToolUseConfirmQueue(queue =>
              queue.filter(item => item.toolUseID !== request.tool_use_id),
            )
          },
          async recheckPermission() {
            // No-op for remote — permission state is on the container
          },
        }

        setToolUseConfirmQueue(queue => [...queue, toolUseConfirm])
        // Pause loading indicator while waiting for permission
        setIsLoading(false)
      },
      onPermissionCancelled: (requestId, toolUseId) => {
        logForDebugging(
          `[useRemoteSession] Permission request cancelled: ${requestId}`,
        )
        const idToRemove = toolUseId ?? requestId
        setToolUseConfirmQueue(queue =>
          queue.filter(item => item.toolUseID !== idToRemove),
        )
        setIsLoading(true)
      },
      onConnected: () => {
        logForDebugging('[useRemoteSession] Connected')
        setConnStatus('connected')
      },
      onReconnecting: () => {
        logForDebugging('[useRemoteSession] Reconnecting')
        setConnStatus('reconnecting')
        // WS gap = we may miss task_notification events. Clear rather than
        // drift high forever. Undercounts tasks that span the gap; accepted.
        runningTaskIdsRef.current.clear()
        writeTaskCount()
        // Same for tool_use IDs: missed tool_result during the gap would
        // leave stale spinner state forever.
        setInProgressToolUseIDs?.(prev => (prev.size > 0 ? new Set() : prev))
      },
      onDisconnected: () => {
        logForDebugging('[useRemoteSession] Disconnected')
        setConnStatus('disconnected')
        setIsLoading(false)
        runningTaskIdsRef.current.clear()
        writeTaskCount()
        setInProgressToolUseIDs?.(prev => (prev.size > 0 ? new Set() : prev))
      },
      onError: error => {
        logForDebugging(`[useRemoteSession] Error: ${error.message}`)
      },
    })

    managerRef.current = manager
    manager.connect()

    return () => {
      logForDebugging('[useRemoteSession] Cleanup - disconnecting')
      // Clear any pending timeout
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
        responseTimeoutRef.current = null
      }
      manager.disconnect()
      managerRef.current = null
    }
  }, [
    config,
    setMessages,
    setIsLoading,
    onInit,
    setToolUseConfirmQueue,
    setStreamingToolUses,
    setStreamMode,
    setInProgressToolUseIDs,
    setConnStatus,
    writeTaskCount,
  ])

  // Send a user message to the remote session
  const sendMessage = useCallback(
    async (
      content: RemoteMessageContent,
      opts?: { uuid?: string },
    ): Promise<boolean> => {
      const manager = managerRef.current
      if (!manager) {
        logForDebugging('[useRemoteSession] Cannot send - no manager')
        return false
      }

      // Clear any existing timeout
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
      }

      setIsLoading(true)

      // Track locally-added message UUIDs so the WS echo can be filtered.
      // Must record BEFORE the POST to close the race where the echo arrives
      // before the POST promise resolves.
      if (opts?.uuid) sentUUIDsRef.current.add(opts.uuid)

      const success = await manager.sendMessage(content, opts)

      if (!success) {
        // No need to undo the pre-POST add — BoundedUUIDSet's ring evicts it.
        setIsLoading(false)
        return false
      }

      // Update the session title after the first message when no initial prompt was provided.
      
      
      if (
        !hasUpdatedTitleRef.current &&
        config &&
        !config.hasInitialPrompt &&
        !config.viewerOnly
      ) {
        hasUpdatedTitleRef.current = true
        const sessionId = config.sessionId
        
        const description =
          typeof content === 'string'
            ? content
            : extractTextContent(content, ' ')
        if (description) {
          // generateSessionTitle never rejects (wraps body in try/catch,
          // returns null on failure), so no .catch needed on this chain.
          void generateSessionTitle(
            description,
            new AbortController().signal,
          ).then(title => {
            void updateSessionTitle(
              sessionId,
              title ?? truncateToWidth(description, 75),
            )
          })
        }
      }

      // Start timeout to detect stuck sessions. Skip in viewerOnly mode —
      
      
      
      if (!config?.viewerOnly) {
        const timeoutMs = isCompactingRef.current
          ? COMPACTION_TIMEOUT_MS
          : RESPONSE_TIMEOUT_MS
        responseTimeoutRef.current = setTimeout(
          (setMessages, manager) => {
            logForDebugging(
              '[useRemoteSession] Response timeout - attempting reconnect',
            )
            
            const warningMessage = createSystemMessage(
              'Remote session may be unresponsive. Attempting to reconnect…',
              'warning',
            )
            setMessages(prev => [...prev, warningMessage])

            
            manager.reconnect()
          },
          timeoutMs,
          setMessages,
          manager,
        )
      }

      return success
    },
    [config, setIsLoading, setMessages],
  )

  
  const cancelRequest = useCallback(() => {
    // Clear any pending timeout
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }

    // Send interrupt signal to CCR. Skip in viewerOnly mode — Ctrl+C
    
    if (!config?.viewerOnly) {
      managerRef.current?.cancelSession()
    }

    setIsLoading(false)
  }, [config, setIsLoading])

  
  const disconnect = useCallback(() => {
    // Clear any pending timeout
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }
    managerRef.current?.disconnect()
    managerRef.current = null
  }, [])

  
  
  
  
  // which in turn churns PromptInput's props and downstream memoization.
  return useMemo(
    () => ({ isRemoteMode, sendMessage, cancelRequest, disconnect }),
    [isRemoteMode, sendMessage, cancelRequest, disconnect],
  )
}
