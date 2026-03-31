import { feature } from 'bun:bundle';
import React, { useCallback, useEffect, useRef } from 'react';
import { setMainLoopModelOverride } from '../bootstrap/state.js';
import { type BridgePermissionCallbacks, type BridgePermissionResponse, isBridgePermissionResponse } from '../bridge/bridgePermissionCallbacks.js';
import { buildBridgeConnectUrl } from '../bridge/bridgeStatusUtil.js';
import { extractInboundMessageFields } from '../bridge/inboundMessages.js';
import type { BridgeState, ReplBridgeHandle } from '../bridge/replBridge.js';
import { setReplBridgeHandle } from '../bridge/replBridgeHandle.js';
import type { Command } from '../commands.js';
import { getSlashCommandToolSkills, isBridgeSafeCommand } from '../commands.js';
import { getRemoteSessionUrl } from '../constants/product.js';
import { useNotifications } from '../context/notifications.js';
import type { PermissionMode, SDKMessage } from '../entrypoints/agentSdkTypes.js';
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js';
import { Text } from '../ink.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import type { Message } from '../types/message.js';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { enqueue } from '../utils/messageQueueManager.js';
import { buildSystemInitMessage } from '../utils/messages/systemInit.js';
import { createBridgeStatusMessage, createSystemMessage } from '../utils/messages.js';
import { getAutoModeUnavailableNotification, getAutoModeUnavailableReason, isAutoModeGateEnabled, isBypassPermissionsModeDisabled, transitionPermissionMode } from '../utils/permissions/permissionSetup.js';
import { getLeaderToolUseConfirmQueue } from '../utils/swarm/leaderPermissionBridge.js';

export const BRIDGE_FAILURE_DISMISS_MS = 10_000;

const MAX_CONSECUTIVE_INIT_FAILURES = 3;

export function useReplBridge(messages: Message[], setMessages: (action: React.SetStateAction<Message[]>) => void, abortControllerRef: React.RefObject<AbortController | null>, commands: readonly Command[], mainLoopModel: string): {
  sendBridgeResult: () => void;
} {
  const handleRef = useRef<ReplBridgeHandle | null>(null);
  const teardownPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const lastWrittenIndexRef = useRef(0);
  
  
  
  const flushedUUIDsRef = useRef(new Set<string>());
  const failureTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  
  
  const consecutiveFailuresRef = useRef(0);
  const setAppState = useSetAppState();
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const store = useAppStateStore();
  const {
    addNotification
  } = useNotifications();
  const replBridgeEnabled = feature('BRIDGE_MODE') ?
  
  useAppState(s => s.replBridgeEnabled) : false;
  const replBridgeConnected = feature('BRIDGE_MODE') ?
  
  useAppState(s_0 => s_0.replBridgeConnected) : false;
  const replBridgeOutboundOnly = feature('BRIDGE_MODE') ?
  
  useAppState(s_1 => s_1.replBridgeOutboundOnly) : false;
  const replBridgeInitialName = feature('BRIDGE_MODE') ?
  
  useAppState(s_2 => s_2.replBridgeInitialName) : undefined;

  
  
  
  useEffect(() => {
    
    
    
    if (feature('BRIDGE_MODE')) {
      if (!replBridgeEnabled) return;
      const outboundOnly = replBridgeOutboundOnly;
      function notifyBridgeFailed(detail?: string): void {
        if (outboundOnly) return;
        addNotification({
          key: 'bridge-failed',
          jsx: <>
              <Text color="error">Remote Control failed</Text>
              {detail && <Text dimColor> · {detail}</Text>}
            </>,
          priority: 'immediate'
        });
      }
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_INIT_FAILURES) {
        logForDebugging(`[bridge:repl] Hook: ${consecutiveFailuresRef.current} consecutive init failures, not retrying this session`);
        
        
        const fuseHint = 'disabled after repeated failures · restart to retry';
        notifyBridgeFailed(fuseHint);
        setAppState(prev => {
          if (prev.replBridgeError === fuseHint && !prev.replBridgeEnabled) return prev;
          return {
            ...prev,
            replBridgeError: fuseHint,
            replBridgeEnabled: false
          };
        });
        return;
      }
      let cancelled = false;
      
      
      const initialMessageCount = messages.length;
      void (async () => {
        try {
          
          
          
          
          if (teardownPromiseRef.current) {
            logForDebugging('[bridge:repl] Hook: waiting for previous teardown to complete before re-init');
            await teardownPromiseRef.current;
            teardownPromiseRef.current = undefined;
            logForDebugging('[bridge:repl] Hook: previous teardown complete, proceeding with re-init');
          }
          if (cancelled) return;

          
          const {
            initReplBridge
          } = await import('../bridge/initReplBridge.js');
          const {
            shouldShowAppUpgradeMessage
          } = await import('../bridge/envLessBridgeConfig.js');

          
          
          
          
          
          
          
          
          
          let perpetual = false;
          if (feature('KAIROS')) {
            const {
              isAssistantMode
            } = await import('../assistant/index.js');
            perpetual = isAssistantMode();
          }

          
          
          
          
          
          
          
          
          async function handleInboundMessage(msg: SDKMessage): Promise<void> {
            try {
              const fields = extractInboundMessageFields(msg);
              if (!fields) return;
              const {
                uuid
              } = fields;

              
              const {
                resolveAndPrepend
              } = await import('../bridge/inboundAttachments.js');
              let sanitized = fields.content;
              if (feature('KAIROS_GITHUB_WEBHOOKS')) {
                
                const {
                  sanitizeInboundWebhookContent
                } = require('../bridge/webhookSanitizer.js') as typeof import('../bridge/webhookSanitizer.js');
                
                sanitized = sanitizeInboundWebhookContent(fields.content);
              }
              const content = await resolveAndPrepend(msg, sanitized);
              const preview = typeof content === 'string' ? content.slice(0, 80) : `[${content.length} content blocks]`;
              logForDebugging(`[bridge:repl] Injecting inbound user message: ${preview}${uuid ? ` uuid=${uuid}` : ''}`);
              enqueue({
                value: content,
                mode: 'prompt' as const,
                uuid,
                
                
                
                
                
                skipSlashCommands: true,
                bridgeOrigin: true
              });
            } catch (e) {
              logForDebugging(`[bridge:repl] handleInboundMessage failed: ${e}`, {
                level: 'error'
              });
            }
          }

          
          function handleStateChange(state: BridgeState, detail_0?: string): void {
            if (cancelled) return;
            if (outboundOnly) {
              logForDebugging(`[bridge:repl] Mirror state=${state}${detail_0 ? ` detail=${detail_0}` : ''}`);
              
              
              if (state === 'failed') {
                setAppState(prev_3 => {
                  if (!prev_3.replBridgeConnected) return prev_3;
                  return {
                    ...prev_3,
                    replBridgeConnected: false
                  };
                });
              } else if (state === 'ready' || state === 'connected') {
                setAppState(prev_4 => {
                  if (prev_4.replBridgeConnected) return prev_4;
                  return {
                    ...prev_4,
                    replBridgeConnected: true
                  };
                });
              }
              return;
            }
            const handle = handleRef.current;
            switch (state) {
              case 'ready':
                setAppState(prev_9 => {
                  const connectUrl = handle && handle.environmentId !== '' ? buildBridgeConnectUrl(handle.environmentId, handle.sessionIngressUrl) : prev_9.replBridgeConnectUrl;
                  const sessionUrl = handle ? getRemoteSessionUrl(handle.bridgeSessionId, handle.sessionIngressUrl) : prev_9.replBridgeSessionUrl;
                  const envId = handle?.environmentId;
                  const sessionId = handle?.bridgeSessionId;
                  if (prev_9.replBridgeConnected && !prev_9.replBridgeSessionActive && !prev_9.replBridgeReconnecting && prev_9.replBridgeConnectUrl === connectUrl && prev_9.replBridgeSessionUrl === sessionUrl && prev_9.replBridgeEnvironmentId === envId && prev_9.replBridgeSessionId === sessionId) {
                    return prev_9;
                  }
                  return {
                    ...prev_9,
                    replBridgeConnected: true,
                    replBridgeSessionActive: false,
                    replBridgeReconnecting: false,
                    replBridgeConnectUrl: connectUrl,
                    replBridgeSessionUrl: sessionUrl,
                    replBridgeEnvironmentId: envId,
                    replBridgeSessionId: sessionId,
                    replBridgeError: undefined
                  };
                });
                break;
              case 'connected':
                {
                  setAppState(prev_8 => {
                    if (prev_8.replBridgeSessionActive) return prev_8;
                    return {
                      ...prev_8,
                      replBridgeConnected: true,
                      replBridgeSessionActive: true,
                      replBridgeReconnecting: false,
                      replBridgeError: undefined
                    };
                  });
                  
                  
                  
                  
                  
                  
                  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_bridge_system_init', false)) {
                    void (async () => {
                      try {
                        const skills = await getSlashCommandToolSkills(getCwd());
                        if (cancelled) return;
                        const state_0 = store.getState();
                        handleRef.current?.writeSdkMessages([buildSystemInitMessage({
                          
                          
                          
                          
                          
                          
                          
                          
                          tools: [],
                          mcpClients: [],
                          model: mainLoopModelRef.current,
                          permissionMode: state_0.toolPermissionContext.mode as PermissionMode,
                          
                          
                          
                          
                          commands: commandsRef.current.filter(isBridgeSafeCommand),
                          agents: state_0.agentDefinitions.activeAgents,
                          skills,
                          plugins: [],
                          fastMode: state_0.fastMode
                        })]);
                      } catch (err_0) {
                        logForDebugging(`[bridge:repl] Failed to send system/init: ${errorMessage(err_0)}`, {
                          level: 'error'
                        });
                      }
                    })();
                  }
                  break;
                }
              case 'reconnecting':
                setAppState(prev_7 => {
                  if (prev_7.replBridgeReconnecting) return prev_7;
                  return {
                    ...prev_7,
                    replBridgeReconnecting: true,
                    replBridgeSessionActive: false
                  };
                });
                break;
              case 'failed':
                
                clearTimeout(failureTimeoutRef.current);
                notifyBridgeFailed(detail_0);
                setAppState(prev_5 => ({
                  ...prev_5,
                  replBridgeError: detail_0,
                  replBridgeReconnecting: false,
                  replBridgeSessionActive: false,
                  replBridgeConnected: false
                }));
                
                failureTimeoutRef.current = setTimeout(() => {
                  if (cancelled) return;
                  failureTimeoutRef.current = undefined;
                  setAppState(prev_6 => {
                    if (!prev_6.replBridgeError) return prev_6;
                    return {
                      ...prev_6,
                      replBridgeEnabled: false,
                      replBridgeError: undefined
                    };
                  });
                }, BRIDGE_FAILURE_DISMISS_MS);
                break;
            }
          }

          
          
          const pendingPermissionHandlers = new Map<string, (response: BridgePermissionResponse) => void>();

          
          function handlePermissionResponse(msg_0: SDKControlResponse): void {
            const requestId = msg_0.response?.request_id;
            if (!requestId) return;
            const handler = pendingPermissionHandlers.get(requestId);
            if (!handler) {
              logForDebugging(`[bridge:repl] No handler for control_response request_id=${requestId}`);
              return;
            }
            pendingPermissionHandlers.delete(requestId);
            
            const inner = msg_0.response;
            if (inner.subtype === 'success' && inner.response && isBridgePermissionResponse(inner.response)) {
              handler(inner.response);
            }
          }
          const handle_0 = await initReplBridge({
            outboundOnly,
            tags: outboundOnly ? ['ccr-mirror'] : undefined,
            onInboundMessage: handleInboundMessage,
            onPermissionResponse: handlePermissionResponse,
            onInterrupt() {
              abortControllerRef.current?.abort();
            },
            onSetModel(model) {
              const resolved = model === 'default' ? null : model ?? null;
              setMainLoopModelOverride(resolved);
              setAppState(prev_10 => {
                if (prev_10.mainLoopModelForSession === resolved) return prev_10;
                return {
                  ...prev_10,
                  mainLoopModelForSession: resolved
                };
              });
            },
            onSetMaxThinkingTokens(maxTokens) {
              const enabled = maxTokens !== null;
              setAppState(prev_11 => {
                if (prev_11.thinkingEnabled === enabled) return prev_11;
                return {
                  ...prev_11,
                  thinkingEnabled: enabled
                };
              });
            },
            onSetPermissionMode(mode) {
              
              
              
              
              
              
              
              
              
              
              if (mode === 'bypassPermissions') {
                if (isBypassPermissionsModeDisabled()) {
                  return {
                    ok: false,
                    error: 'Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration'
                  };
                }
                if (!store.getState().toolPermissionContext.isBypassPermissionsModeAvailable) {
                  return {
                    ok: false,
                    error: 'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions'
                  };
                }
              }
              if (feature('TRANSCRIPT_CLASSIFIER') && mode === 'auto' && !isAutoModeGateEnabled()) {
                const reason = getAutoModeUnavailableReason();
                return {
                  ok: false,
                  error: reason ? `Cannot set permission mode to auto: ${getAutoModeUnavailableNotification(reason)}` : 'Cannot set permission mode to auto'
                };
              }
              
              
              setAppState(prev_12 => {
                const current = prev_12.toolPermissionContext.mode;
                if (current === mode) return prev_12;
                const next = transitionPermissionMode(current, mode, prev_12.toolPermissionContext);
                return {
                  ...prev_12,
                  toolPermissionContext: {
                    ...next,
                    mode
                  }
                };
              });
              
              setImmediate(() => {
                getLeaderToolUseConfirmQueue()?.(currentQueue => {
                  currentQueue.forEach(item => {
                    void item.recheckPermission();
                  });
                  return currentQueue;
                });
              });
              return {
                ok: true
              };
            },
            onStateChange: handleStateChange,
            initialMessages: messages.length > 0 ? messages : undefined,
            getMessages: () => messagesRef.current,
            previouslyFlushedUUIDs: flushedUUIDsRef.current,
            initialName: replBridgeInitialName,
            perpetual
          });
          if (cancelled) {
            
            
            
            logForDebugging(`[bridge:repl] Hook: init cancelled during flight, tearing down${handle_0 ? ` env=${handle_0.environmentId}` : ''}`);
            if (handle_0) {
              void handle_0.teardown();
            }
            return;
          }
          if (!handle_0) {
            
            
            
            
            consecutiveFailuresRef.current++;
            logForDebugging(`[bridge:repl] Init returned null (precondition or session creation failed); consecutive failures: ${consecutiveFailuresRef.current}`);
            clearTimeout(failureTimeoutRef.current);
            setAppState(prev_13 => ({
              ...prev_13,
              replBridgeError: prev_13.replBridgeError ?? 'check debug logs for details'
            }));
            failureTimeoutRef.current = setTimeout(() => {
              if (cancelled) return;
              failureTimeoutRef.current = undefined;
              setAppState(prev_14 => {
                if (!prev_14.replBridgeError) return prev_14;
                return {
                  ...prev_14,
                  replBridgeEnabled: false,
                  replBridgeError: undefined
                };
              });
            }, BRIDGE_FAILURE_DISMISS_MS);
            return;
          }
          handleRef.current = handle_0;
          setReplBridgeHandle(handle_0);
          consecutiveFailuresRef.current = 0;
          
          
          lastWrittenIndexRef.current = initialMessageCount;
          if (outboundOnly) {
            setAppState(prev_15 => {
              if (prev_15.replBridgeConnected && prev_15.replBridgeSessionId === handle_0.bridgeSessionId) return prev_15;
              return {
                ...prev_15,
                replBridgeConnected: true,
                replBridgeSessionId: handle_0.bridgeSessionId,
                replBridgeSessionUrl: undefined,
                replBridgeConnectUrl: undefined,
                replBridgeError: undefined
              };
            });
            logForDebugging(`[bridge:repl] Mirror initialized, session=${handle_0.bridgeSessionId}`);
          } else {
            
            
            const permissionCallbacks: BridgePermissionCallbacks = {
              sendRequest(requestId_0, toolName, input, toolUseId, description, permissionSuggestions, blockedPath) {
                handle_0.sendControlRequest({
                  type: 'control_request',
                  request_id: requestId_0,
                  request: {
                    subtype: 'can_use_tool',
                    tool_name: toolName,
                    input,
                    tool_use_id: toolUseId,
                    description,
                    ...(permissionSuggestions ? {
                      permission_suggestions: permissionSuggestions
                    } : {}),
                    ...(blockedPath ? {
                      blocked_path: blockedPath
                    } : {})
                  }
                });
              },
              sendResponse(requestId_1, response) {
                const payload: Record<string, unknown> = {
                  ...response
                };
                handle_0.sendControlResponse({
                  type: 'control_response',
                  response: {
                    subtype: 'success',
                    request_id: requestId_1,
                    response: payload
                  }
                });
              },
              cancelRequest(requestId_2) {
                handle_0.sendControlCancelRequest(requestId_2);
              },
              onResponse(requestId_3, handler_0) {
                pendingPermissionHandlers.set(requestId_3, handler_0);
                return () => {
                  pendingPermissionHandlers.delete(requestId_3);
                };
              }
            };
            setAppState(prev_16 => ({
              ...prev_16,
              replBridgePermissionCallbacks: permissionCallbacks
            }));
            const url = getRemoteSessionUrl(handle_0.bridgeSessionId, handle_0.sessionIngressUrl);
            
            
            const hasEnv = handle_0.environmentId !== '';
            const connectUrl_0 = hasEnv ? buildBridgeConnectUrl(handle_0.environmentId, handle_0.sessionIngressUrl) : undefined;
            setAppState(prev_17 => {
              if (prev_17.replBridgeConnected && prev_17.replBridgeSessionUrl === url) {
                return prev_17;
              }
              return {
                ...prev_17,
                replBridgeConnected: true,
                replBridgeSessionUrl: url,
                replBridgeConnectUrl: connectUrl_0 ?? prev_17.replBridgeConnectUrl,
                replBridgeEnvironmentId: handle_0.environmentId,
                replBridgeSessionId: handle_0.bridgeSessionId,
                replBridgeError: undefined
              };
            });

            
            
            
            
            const upgradeNudge = !perpetual ? await shouldShowAppUpgradeMessage().catch(() => false) : false;
            if (cancelled) return;
            setMessages(prev_18 => [...prev_18, createBridgeStatusMessage(url, upgradeNudge ? 'Please upgrade to the latest version of the Claude mobile app to see your Remote Control sessions.' : undefined)]);
            logForDebugging(`[bridge:repl] Hook initialized, session=${handle_0.bridgeSessionId}`);
          }
        } catch (err) {
          
          
          
          
          
          
          if (cancelled) return;
          consecutiveFailuresRef.current++;
          const errMsg = errorMessage(err);
          logForDebugging(`[bridge:repl] Init failed: ${errMsg}; consecutive failures: ${consecutiveFailuresRef.current}`);
          clearTimeout(failureTimeoutRef.current);
          notifyBridgeFailed(errMsg);
          setAppState(prev_0 => ({
            ...prev_0,
            replBridgeError: errMsg
          }));
          failureTimeoutRef.current = setTimeout(() => {
            if (cancelled) return;
            failureTimeoutRef.current = undefined;
            setAppState(prev_1 => {
              if (!prev_1.replBridgeError) return prev_1;
              return {
                ...prev_1,
                replBridgeEnabled: false,
                replBridgeError: undefined
              };
            });
          }, BRIDGE_FAILURE_DISMISS_MS);
          if (!outboundOnly) {
            setMessages(prev_2 => [...prev_2, createSystemMessage(`Remote Control failed to connect: ${errMsg}`, 'warning')]);
          }
        }
      })();
      return () => {
        cancelled = true;
        clearTimeout(failureTimeoutRef.current);
        failureTimeoutRef.current = undefined;
        if (handleRef.current) {
          logForDebugging(`[bridge:repl] Hook cleanup: starting teardown for env=${handleRef.current.environmentId} session=${handleRef.current.bridgeSessionId}`);
          teardownPromiseRef.current = handleRef.current.teardown();
          handleRef.current = null;
          setReplBridgeHandle(null);
        }
        setAppState(prev_19 => {
          if (!prev_19.replBridgeConnected && !prev_19.replBridgeSessionActive && !prev_19.replBridgeError) {
            return prev_19;
          }
          return {
            ...prev_19,
            replBridgeConnected: false,
            replBridgeSessionActive: false,
            replBridgeReconnecting: false,
            replBridgeConnectUrl: undefined,
            replBridgeSessionUrl: undefined,
            replBridgeEnvironmentId: undefined,
            replBridgeSessionId: undefined,
            replBridgeError: undefined,
            replBridgePermissionCallbacks: undefined
          };
        });
        lastWrittenIndexRef.current = 0;
      };
    }
  }, [replBridgeEnabled, replBridgeOutboundOnly, setAppState, setMessages, addNotification]);

  
  
  
  useEffect(() => {
    
    if (feature('BRIDGE_MODE')) {
      if (!replBridgeConnected) return;
      const handle_1 = handleRef.current;
      if (!handle_1) return;

      
      
      
      if (lastWrittenIndexRef.current > messages.length) {
        logForDebugging(`[bridge:repl] Compaction detected: lastWrittenIndex=${lastWrittenIndexRef.current} > messages.length=${messages.length}, clamping`);
      }
      const startIndex = Math.min(lastWrittenIndexRef.current, messages.length);

      
      const newMessages: Message[] = [];
      for (let i = startIndex; i < messages.length; i++) {
        const msg_1 = messages[i];
        if (msg_1 && (msg_1.type === 'user' || msg_1.type === 'assistant' || msg_1.type === 'system' && msg_1.subtype === 'local_command')) {
          newMessages.push(msg_1);
        }
      }
      lastWrittenIndexRef.current = messages.length;
      if (newMessages.length > 0) {
        handle_1.writeMessages(newMessages);
      }
    }
  }, [messages, replBridgeConnected]);
  const sendBridgeResult = useCallback(() => {
    if (feature('BRIDGE_MODE')) {
      handleRef.current?.sendResult();
    }
  }, []);
  return {
    sendBridgeResult
  };
}
