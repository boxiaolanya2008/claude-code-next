
import { feature } from 'bun:bundle'
import { readFile, stat } from 'fs/promises'
import { dirname } from 'path'
import {
  downloadUserSettings,
  redownloadUserSettings,
} from 'src/services/settingsSync/index.js'
import { waitForRemoteManagedSettingsToLoad } from 'src/services/remoteManagedSettings/index.js'
import { StructuredIO } from 'src/cli/structuredIO.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import {
  type Command,
  formatDescriptionWithSource,
  getCommandName,
} from 'src/commands.js'
import { createStreamlinedTransformer } from 'src/utils/streamlinedTransform.js'
import { installStreamJsonStdoutGuard } from 'src/utils/streamJsonStdoutGuard.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import { assembleToolPool, filterToolsByDenyRules } from 'src/tools.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { uniq } from 'src/utils/array.js'
import { mergeAndFilterTools } from 'src/utils/toolPool.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/services/analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  logForDiagnosticsNoPII,
  withDiagnosticsTiming,
} from 'src/utils/diagLogs.js'
import { toolMatchesName, type Tool, type Tools } from 'src/Tool.js'
import {
  type AgentDefinition,
  isBuiltInAgent,
  parseAgentsFromJson,
} from 'src/tools/AgentTool/loadAgentsDir.js'
import type { Message, NormalizedUserMessage } from 'src/types/message.js'
import type { QueuedCommand } from 'src/types/textInputTypes.js'
import {
  dequeue,
  dequeueAllMatching,
  enqueue,
  hasCommandsInQueue,
  peek,
  subscribeToCommandQueue,
  getCommandsByMaxPriority,
} from 'src/utils/messageQueueManager.js'
import { notifyCommandLifecycle } from 'src/utils/commandLifecycle.js'
import {
  getSessionState,
  notifySessionStateChanged,
  notifySessionMetadataChanged,
  setPermissionModeChangedListener,
  type RequiresActionDetails,
  type SessionExternalMetadata,
} from 'src/utils/sessionState.js'
import { externalMetadataToAppState } from 'src/state/onChangeAppState.js'
import { getInMemoryErrors, logError, logMCPDebug } from 'src/utils/log.js'
import {
  writeToStdout,
  registerProcessOutputErrorHandlers,
} from 'src/utils/process.js'
import type { Stream } from 'src/utils/stream.js'
import { EMPTY_USAGE } from 'src/services/api/logging.js'
import {
  loadConversationForResume,
  type TurnInterruptionState,
} from 'src/utils/conversationRecovery.js'
import type {
  MCPServerConnection,
  McpSdkServerConfig,
  ScopedMcpServerConfig,
} from 'src/services/mcp/types.js'
import {
  ChannelMessageNotificationSchema,
  gateChannelServer,
  wrapChannelMessage,
  findChannelEntry,
} from 'src/services/mcp/channelNotification.js'
import {
  isChannelAllowlisted,
  isChannelsEnabled,
} from 'src/services/mcp/channelAllowlist.js'
import { parsePluginIdentifier } from 'src/utils/plugins/pluginIdentifier.js'
import { validateUuid } from 'src/utils/uuid.js'
import { fromArray } from 'src/utils/generators.js'
import { ask } from 'src/QueryEngine.js'
import type { PermissionPromptTool } from 'src/utils/queryHelpers.js'
import {
  createFileStateCacheWithSizeLimit,
  mergeFileStateCaches,
  READ_FILE_STATE_CACHE_SIZE,
} from 'src/utils/fileStateCache.js'
import { expandPath } from 'src/utils/path.js'
import { extractReadFilesFromMessages } from 'src/utils/queryHelpers.js'
import { registerHookEventHandler } from 'src/utils/hooks/hookEvents.js'
import { executeFilePersistence } from 'src/utils/filePersistence/filePersistence.js'
import { finalizePendingAsyncHooks } from 'src/utils/hooks/AsyncHookRegistry.js'
import {
  gracefulShutdown,
  gracefulShutdownSync,
  isShuttingDown,
} from 'src/utils/gracefulShutdown.js'
import { registerCleanup } from 'src/utils/cleanupRegistry.js'
import { createIdleTimeoutManager } from 'src/utils/idleTimeout.js'
import type {
  SDKStatus,
  ModelInfo,
  SDKMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  PermissionResult,
  McpServerConfigForProcessTransport,
  McpServerStatus,
  RewindFilesResult,
} from 'src/entrypoints/agentSdkTypes.js'
import type {
  StdoutMessage,
  SDKControlInitializeRequest,
  SDKControlInitializeResponse,
  SDKControlRequest,
  SDKControlResponse,
  SDKControlMcpSetServersResponse,
  SDKControlReloadPluginsResponse,
} from 'src/entrypoints/sdk/controlTypes.js'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionMode as InternalPermissionMode } from 'src/types/permissions.js'
import { cwd } from 'process'
import { getCwd } from 'src/utils/cwd.js'
import omit from 'lodash-es/omit.js'
import reject from 'lodash-es/reject.js'
import { isPolicyAllowed } from 'src/services/policyLimits/index.js'
import type { ReplBridgeHandle } from 'src/bridge/replBridge.js'
import { getRemoteSessionUrl } from 'src/constants/product.js'
import { buildBridgeConnectUrl } from 'src/bridge/bridgeStatusUtil.js'
import { extractInboundMessageFields } from 'src/bridge/inboundMessages.js'
import { resolveAndPrepend } from 'src/bridge/inboundAttachments.js'
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import { safeParseJSON } from 'src/utils/json.js'
import {
  outputSchema as permissionToolOutputSchema,
  permissionPromptToolResultToPermissionDecision,
} from 'src/utils/permissions/PermissionPromptToolResultSchema.js'
import { createAbortController } from 'src/utils/abortController.js'
import { createCombinedAbortSignal } from 'src/utils/combinedAbortSignal.js'
import { generateSessionTitle } from 'src/utils/sessionTitle.js'
import { buildSideQuestionFallbackParams } from 'src/utils/queryContext.js'
import { runSideQuestion } from 'src/utils/sideQuestion.js'
import {
  processSessionStartHooks,
  processSetupHooks,
  takeInitialUserMessage,
} from 'src/utils/sessionStart.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  getAllOutputStyles,
} from 'src/constants/outputStyles.js'
import { TEAMMATE_MESSAGE_TAG, TICK_TAG } from 'src/constants/xml.js'
import {
  getSettings_DEPRECATED,
  getSettingsWithSources,
} from 'src/utils/settings/settings.js'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import { applySettingsChange } from 'src/utils/settings/applySettingsChange.js'
import {
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
  getFastModeState,
} from 'src/utils/fastMode.js'
import {
  isAutoModeGateEnabled,
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isBypassPermissionsModeDisabled,
  transitionPermissionMode,
} from 'src/utils/permissions/permissionSetup.js'
import {
  tryGenerateSuggestion,
  logSuggestionOutcome,
  logSuggestionSuppressed,
  type PromptVariant,
} from 'src/services/PromptSuggestion/promptSuggestion.js'
import { getLastCacheSafeParams } from 'src/utils/forkedAgent.js'
import { getAccountInformation } from 'src/utils/auth.js'
import { OAuthService } from 'src/services/oauth/index.js'
import { installOAuthTokens } from 'src/cli/handlers/auth.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import type { HookCallbackMatcher } from 'src/types/hooks.js'
import { AwsAuthStatusManager } from 'src/utils/awsAuthStatusManager.js'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import {
  registerHookCallbacks,
  setInitJsonSchema,
  getInitJsonSchema,
  setSdkAgentProgressSummariesEnabled,
} from 'src/bootstrap/state.js'
import { createSyntheticOutputTool } from 'src/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { parseSessionIdentifier } from 'src/utils/sessionUrl.js'
import {
  hydrateRemoteSession,
  hydrateFromCCRv2InternalEvents,
  resetSessionFilePointer,
  doesMessageExistInSession,
  findUnresolvedToolUse,
  recordAttributionSnapshot,
  saveAgentSetting,
  saveMode,
  saveAiGeneratedTitle,
  restoreSessionMetadata,
} from 'src/utils/sessionStorage.js'
import { incrementPromptCount } from 'src/utils/commitAttribution.js'
import {
  setupSdkMcpClients,
  connectToServer,
  clearServerCache,
  fetchToolsForClient,
  areMcpConfigsEqual,
  reconnectMcpServerImpl,
} from 'src/services/mcp/client.js'
import {
  filterMcpServersByPolicy,
  getMcpConfigByName,
  isMcpServerDisabled,
  setMcpServerEnabled,
} from 'src/services/mcp/config.js'
import {
  performMCPOAuthFlow,
  revokeServerTokens,
} from 'src/services/mcp/auth.js'
import {
  runElicitationHooks,
  runElicitationResultHooks,
} from 'src/services/mcp/elicitationHandler.js'
import { executeNotificationHooks } from 'src/utils/hooks.js'
import {
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { getMcpPrefix } from 'src/services/mcp/mcpStringUtils.js'
import {
  commandBelongsToServer,
  filterToolsByServer,
} from 'src/services/mcp/utils.js'
import { setupVscodeSdkMcp } from 'src/services/mcp/vscodeSdkMcp.js'
import { getAllMcpConfigs } from 'src/services/mcp/config.js'
import {
  isQualifiedForGrove,
  checkGroveForNonInteractive,
} from 'src/services/api/grove.js'
import {
  toInternalMessages,
  toSDKRateLimitInfo,
} from 'src/utils/messages/mappers.js'
import { createModelSwitchBreadcrumbs } from 'src/utils/messages.js'
import { collectContextData } from 'src/commands/context/context-noninteractive.js'
import { LOCAL_COMMAND_STDOUT_TAG } from 'src/constants/xml.js'
import {
  statusListeners,
  type ClaudeAILimits,
} from 'src/services/claudeAiLimits.js'
import {
  getDefaultMainLoopModel,
  getMainLoopModel,
  modelDisplayString,
  parseUserSpecifiedModel,
} from 'src/utils/model/model.js'
import { getModelOptions } from 'src/utils/model/modelOptions.js'
import {
  modelSupportsEffort,
  modelSupportsMaxEffort,
  EFFORT_LEVELS,
  resolveAppliedEffort,
} from 'src/utils/effort.js'
import { modelSupportsAdaptiveThinking } from 'src/utils/thinking.js'
import { modelSupportsAutoMode } from 'src/utils/betas.js'
import { ensureModelStringsInitialized } from 'src/utils/model/modelStrings.js'
import {
  getSessionId,
  setMainLoopModelOverride,
  setMainThreadAgentType,
  switchSession,
  isSessionPersistenceDisabled,
  getIsRemoteMode,
  getFlagSettingsInline,
  setFlagSettingsInline,
  getMainThreadAgentType,
  getAllowedChannels,
  setAllowedChannels,
  type ChannelEntry,
} from 'src/bootstrap/state.js'
import { runWithWorkload, WORKLOAD_CRON } from 'src/utils/workloadContext.js'
import type { UUID } from 'crypto'
import { randomUUID } from 'crypto'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { AppState } from 'src/state/AppStateStore.js'
import {
  fileHistoryRewind,
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryGetDiffStats,
} from 'src/utils/fileHistory.js'
import {
  restoreAgentFromSession,
  restoreSessionStateFromLog,
} from 'src/utils/sessionRestore.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import {
  headlessProfilerStartTurn,
  headlessProfilerCheckpoint,
  logHeadlessProfilerTurn,
} from 'src/utils/headlessProfiler.js'
import {
  startQueryProfile,
  logQueryProfileReport,
} from 'src/utils/queryProfiler.js'
import { asSessionId } from 'src/types/ids.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { skillChangeDetector } from '../utils/skills/skillChangeDetector.js'
import { getCommands, clearCommandsCache } from '../commands.js'
import {
  isBareMode,
  isEnvTruthy,
  isEnvDefinedFalsy,
} from '../utils/envUtils.js'
import { installPluginsForHeadless } from '../utils/plugins/headlessPluginInstall.js'
import { refreshActivePlugins } from '../utils/plugins/refresh.js'
import { loadAllPluginsCacheOnly } from '../utils/plugins/pluginLoader.js'
import {
  isTeamLead,
  hasActiveInProcessTeammates,
  hasWorkingInProcessTeammates,
  waitForTeammatesToBecomeIdle,
} from '../utils/teammate.js'
import {
  readUnreadMessages,
  markMessagesAsRead,
  isShutdownApproved,
} from '../utils/teammateMailbox.js'
import { removeTeammateFromTeamFile } from '../utils/swarm/teamHelpers.js'
import { unassignTeammateTasks } from '../utils/tasks.js'
import { getRunningTasks } from '../utils/task/framework.js'
import { isBackgroundTask } from '../tasks/types.js'
import { stopTask } from '../tasks/stopTask.js'
import { drainSdkEvents } from '../utils/sdkEventQueue.js'
import { initializeGrowthBook } from '../services/analytics/growthbook.js'
import { errorMessage, toError } from '../utils/errors.js'
import { sleep } from '../utils/sleep.js'
import { isExtractModeActive } from '../memdir/paths.js'

const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js'))
  : null
const proactiveModule =
  feature('PROACTIVE') || feature('KAIROS')
    ? (require('../proactive/index.js') as typeof import('../proactive/index.js'))
    : null
const cronSchedulerModule = feature('AGENT_TRIGGERS')
  ? (require('../utils/cronScheduler.js') as typeof import('../utils/cronScheduler.js'))
  : null
const cronJitterConfigModule = feature('AGENT_TRIGGERS')
  ? (require('../utils/cronJitterConfig.js') as typeof import('../utils/cronJitterConfig.js'))
  : null
const cronGate = feature('AGENT_TRIGGERS')
  ? (require('../tools/ScheduleCronTool/prompt.js') as typeof import('../tools/ScheduleCronTool/prompt.js'))
  : null
const extractMemoriesModule = feature('EXTRACT_MEMORIES')
  ? (require('../services/extractMemories/extractMemories.js') as typeof import('../services/extractMemories/extractMemories.js'))
  : null

const SHUTDOWN_TEAM_PROMPT = `<system-reminder>
You are running in non-interactive mode and cannot return a response to the user until your team is shut down.

You MUST shut down your team before preparing your final response:
1. Use requestShutdown to ask each team member to shut down gracefully
2. Wait for shutdown approvals
3. Use the cleanup operation to clean up the team
4. Only then provide your final response to the user

The user cannot receive your response until the team is completely shut down.
</system-reminder>

Shut down your team and prepare your final response for the user.`

const MAX_RECEIVED_UUIDS = 10_000
const receivedMessageUuids = new Set<UUID>()
const receivedMessageUuidsOrder: UUID[] = []

function trackReceivedMessageUuid(uuid: UUID): boolean {
  if (receivedMessageUuids.has(uuid)) {
    return false 
  }
  receivedMessageUuids.add(uuid)
  receivedMessageUuidsOrder.push(uuid)
  
  if (receivedMessageUuidsOrder.length > MAX_RECEIVED_UUIDS) {
    const toEvict = receivedMessageUuidsOrder.splice(
      0,
      receivedMessageUuidsOrder.length - MAX_RECEIVED_UUIDS,
    )
    for (const old of toEvict) {
      receivedMessageUuids.delete(old)
    }
  }
  return true 
}

type PromptValue = string | ContentBlockParam[]

function toBlocks(v: PromptValue): ContentBlockParam[] {
  return typeof v === 'string' ? [{ type: 'text', text: v }] : v
}

export function joinPromptValues(values: PromptValue[]): PromptValue {
  if (values.length === 1) return values[0]!
  if (values.every(v => typeof v === 'string')) {
    return values.join('\n')
  }
  return values.flatMap(toBlocks)
}

export function canBatchWith(
  head: QueuedCommand,
  next: QueuedCommand | undefined,
): boolean {
  return (
    next !== undefined &&
    next.mode === 'prompt' &&
    next.workload === head.workload &&
    next.isMeta === head.isMeta
  )
}

export async function runHeadless(
  inputPrompt: string | AsyncIterable<string>,
  getAppState: () => AppState,
  setAppState: (f: (prev: AppState) => AppState) => void,
  commands: Command[],
  tools: Tools,
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  agents: AgentDefinition[],
  options: {
    continue: boolean | undefined
    resume: string | boolean | undefined
    resumeSessionAt: string | undefined
    verbose: boolean | undefined
    outputFormat: string | undefined
    jsonSchema: Record<string, unknown> | undefined
    permissionPromptToolName: string | undefined
    allowedTools: string[] | undefined
    thinkingConfig: ThinkingConfig | undefined
    maxTurns: number | undefined
    maxBudgetUsd: number | undefined
    taskBudget: { total: number } | undefined
    systemPrompt: string | undefined
    appendSystemPrompt: string | undefined
    userSpecifiedModel: string | undefined
    fallbackModel: string | undefined
    teleport: string | true | null | undefined
    sdkUrl: string | undefined
    replayUserMessages: boolean | undefined
    includePartialMessages: boolean | undefined
    forkSession: boolean | undefined
    rewindFiles: string | undefined
    enableAuthStatus: boolean | undefined
    agent: string | undefined
    workload: string | undefined
    setupTrigger?: 'init' | 'maintenance' | undefined
    sessionStartHooksPromise?: ReturnType<typeof processSessionStartHooks>
    setSDKStatus?: (status: SDKStatus) => void
  },
): Promise<void> {
  if (
    process.env.USER_TYPE === 'ant' &&
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_EXIT_AFTER_FIRST_RENDER)
  ) {
    process.stderr.write(
      `\nStartup time: ${Math.round(process.uptime() * 1000)}ms\n`,
    )
    
    process.exit(0)
  }

  
  
  
  
  
  if (
    feature('DOWNLOAD_USER_SETTINGS') &&
    (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE) || getIsRemoteMode())
  ) {
    void downloadUserSettings()
  }

  
  
  
  settingsChangeDetector.subscribe(source => {
    applySettingsChange(source, setAppState)

    
    
    if (isFastModeEnabled()) {
      setAppState(prev => {
        const s = prev.settings as Record<string, unknown>
        const fastMode = s.fastMode === true && !s.fastModePerSessionOptIn
        return { ...prev, fastMode }
      })
    }
  })

  
  
  
  
  if (
    (feature('PROACTIVE') || feature('KAIROS')) &&
    proactiveModule &&
    !proactiveModule.isProactiveActive() &&
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_PROACTIVE)
  ) {
    proactiveModule.activateProactive('command')
  }

  
  if (typeof Bun !== 'undefined') {
    const gcTimer = setInterval(Bun.gc, 1000)
    gcTimer.unref()
  }

  
  headlessProfilerStartTurn()
  headlessProfilerCheckpoint('runHeadless_entry')

  
  if (await isQualifiedForGrove()) {
    await checkGroveForNonInteractive()
  }
  headlessProfilerCheckpoint('after_grove_check')

  
  
  void initializeGrowthBook()

  if (options.resumeSessionAt && !options.resume) {
    process.stderr.write(`Error: --resume-session-at requires --resume\n`)
    gracefulShutdownSync(1)
    return
  }

  if (options.rewindFiles && !options.resume) {
    process.stderr.write(`Error: --rewind-files requires --resume\n`)
    gracefulShutdownSync(1)
    return
  }

  if (options.rewindFiles && inputPrompt) {
    process.stderr.write(
      `Error: --rewind-files is a standalone operation and cannot be used with a prompt\n`,
    )
    gracefulShutdownSync(1)
    return
  }

  const structuredIO = getStructuredIO(inputPrompt, options)

  
  
  
  
  
  if (options.outputFormat === 'stream-json') {
    installStreamJsonStdoutGuard()
  }

  
  
  
  const sandboxUnavailableReason = SandboxManager.getSandboxUnavailableReason()
  if (sandboxUnavailableReason) {
    if (SandboxManager.isSandboxRequired()) {
      process.stderr.write(
        `\nError: sandbox required but unavailable: ${sandboxUnavailableReason}\n` +
          `  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`,
      )
      gracefulShutdownSync(1)
      return
    }
    process.stderr.write(
      `\n⚠ Sandbox disabled: ${sandboxUnavailableReason}\n` +
        `  Commands will run WITHOUT sandboxing. Network and filesystem restrictions will NOT be enforced.\n\n`,
    )
  } else if (SandboxManager.isSandboxingEnabled()) {
    
    
    
    try {
      await SandboxManager.initialize(structuredIO.createSandboxAskCallback())
    } catch (err) {
      process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`)
      gracefulShutdownSync(1, 'other')
      return
    }
  }

  if (options.outputFormat === 'stream-json' && options.verbose) {
    registerHookEventHandler(event => {
      const message: StdoutMessage = (() => {
        switch (event.type) {
          case 'started':
            return {
              type: 'system' as const,
              subtype: 'hook_started' as const,
              hook_id: event.hookId,
              hook_name: event.hookName,
              hook_event: event.hookEvent,
              uuid: randomUUID(),
              session_id: getSessionId(),
            }
          case 'progress':
            return {
              type: 'system' as const,
              subtype: 'hook_progress' as const,
              hook_id: event.hookId,
              hook_name: event.hookName,
              hook_event: event.hookEvent,
              stdout: event.stdout,
              stderr: event.stderr,
              output: event.output,
              uuid: randomUUID(),
              session_id: getSessionId(),
            }
          case 'response':
            return {
              type: 'system' as const,
              subtype: 'hook_response' as const,
              hook_id: event.hookId,
              hook_name: event.hookName,
              hook_event: event.hookEvent,
              output: event.output,
              stdout: event.stdout,
              stderr: event.stderr,
              exit_code: event.exitCode,
              outcome: event.outcome,
              uuid: randomUUID(),
              session_id: getSessionId(),
            }
        }
      })()
      void structuredIO.write(message)
    })
  }

  if (options.setupTrigger) {
    await processSetupHooks(options.setupTrigger)
  }

  headlessProfilerCheckpoint('before_loadInitialMessages')
  const appState = getAppState()
  const {
    messages: initialMessages,
    turnInterruptionState,
    agentSetting: resumedAgentSetting,
  } = await loadInitialMessages(setAppState, {
    continue: options.continue,
    teleport: options.teleport,
    resume: options.resume,
    resumeSessionAt: options.resumeSessionAt,
    forkSession: options.forkSession,
    outputFormat: options.outputFormat,
    sessionStartHooksPromise: options.sessionStartHooksPromise,
    restoredWorkerState: structuredIO.restoredWorkerState,
  })

  
  
  
  
  
  const hookInitialUserMessage = takeInitialUserMessage()
  if (hookInitialUserMessage) {
    structuredIO.prependUserMessage(hookInitialUserMessage)
  }

  
  
  if (!options.agent && !getMainThreadAgentType() && resumedAgentSetting) {
    const { agentDefinition: restoredAgent } = restoreAgentFromSession(
      resumedAgentSetting,
      undefined,
      { activeAgents: agents, allAgents: agents },
    )
    if (restoredAgent) {
      setAppState(prev => ({ ...prev, agent: restoredAgent.agentType }))
      
      if (!options.systemPrompt && !isBuiltInAgent(restoredAgent)) {
        const agentSystemPrompt = restoredAgent.getSystemPrompt()
        if (agentSystemPrompt) {
          options.systemPrompt = agentSystemPrompt
        }
      }
      
      saveAgentSetting(restoredAgent.agentType)
    }
  }

  
  
  
  if (initialMessages.length === 0 && process.exitCode !== undefined) {
    return
  }

  
  if (options.rewindFiles) {
    
    
    const targetMessage = initialMessages.find(
      m => m.uuid === options.rewindFiles,
    )

    if (!targetMessage || targetMessage.type !== 'user') {
      process.stderr.write(
        `Error: --rewind-files requires a user message UUID, but ${options.rewindFiles} is not a user message in this session\n`,
      )
      gracefulShutdownSync(1)
      return
    }

    const currentAppState = getAppState()
    const result = await handleRewindFiles(
      options.rewindFiles as UUID,
      currentAppState,
      setAppState,
      false,
    )
    if (!result.canRewind) {
      process.stderr.write(`Error: ${result.error || 'Unexpected error'}\n`)
      gracefulShutdownSync(1)
      return
    }

    
    process.stdout.write(
      `Files rewound to state at message ${options.rewindFiles}\n`,
    )
    gracefulShutdownSync(0)
    return
  }

  
  const hasValidResumeSessionId =
    typeof options.resume === 'string' &&
    (Boolean(validateUuid(options.resume)) || options.resume.endsWith('.jsonl'))
  const isUsingSdkUrl = Boolean(options.sdkUrl)

  if (!inputPrompt && !hasValidResumeSessionId && !isUsingSdkUrl) {
    process.stderr.write(
      `Error: Input must be provided either through stdin or as a prompt argument when using --print\n`,
    )
    gracefulShutdownSync(1)
    return
  }

  if (options.outputFormat === 'stream-json' && !options.verbose) {
    process.stderr.write(
      'Error: When using --print, --output-format=stream-json requires --verbose\n',
    )
    gracefulShutdownSync(1)
    return
  }

  
  const allowedMcpTools = filterToolsByDenyRules(
    appState.mcp.tools,
    appState.toolPermissionContext,
  )
  let filteredTools = [...tools, ...allowedMcpTools]

  
  const effectivePermissionPromptToolName = options.sdkUrl
    ? 'stdio'
    : options.permissionPromptToolName

  
  const onPermissionPrompt = (details: RequiresActionDetails) => {
    if (feature('COMMIT_ATTRIBUTION')) {
      setAppState(prev => ({
        ...prev,
        attribution: {
          ...prev.attribution,
          permissionPromptCount: prev.attribution.permissionPromptCount + 1,
        },
      }))
    }
    notifySessionStateChanged('requires_action', details)
  }

  const canUseTool = getCanUseToolFn(
    effectivePermissionPromptToolName,
    structuredIO,
    () => getAppState().mcp.tools,
    onPermissionPrompt,
  )
  if (options.permissionPromptToolName) {
    
    filteredTools = filteredTools.filter(
      tool => !toolMatchesName(tool, options.permissionPromptToolName!),
    )
  }

  
  registerProcessOutputErrorHandlers()

  headlessProfilerCheckpoint('after_loadInitialMessages')

  
  
  await ensureModelStringsInitialized()
  headlessProfilerCheckpoint('after_modelStrings')

  
  

  
  
  
  
  const needsFullArray = options.outputFormat === 'json' && options.verbose
  const messages: SDKMessage[] = []
  let lastMessage: SDKMessage | undefined
  
  
  const transformToStreamlined =
    feature('STREAMLINED_OUTPUT') &&
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_STREAMLINED_OUTPUT) &&
    options.outputFormat === 'stream-json'
      ? createStreamlinedTransformer()
      : null

  headlessProfilerCheckpoint('before_runHeadlessStreaming')
  for await (const message of runHeadlessStreaming(
    structuredIO,
    appState.mcp.clients,
    [...commands, ...appState.mcp.commands],
    filteredTools,
    initialMessages,
    canUseTool,
    sdkMcpConfigs,
    getAppState,
    setAppState,
    agents,
    options,
    turnInterruptionState,
  )) {
    if (transformToStreamlined) {
      
      const transformed = transformToStreamlined(message)
      if (transformed) {
        await structuredIO.write(transformed)
      }
    } else if (options.outputFormat === 'stream-json' && options.verbose) {
      await structuredIO.write(message)
    }
    
    
    
    
    
    if (
      message.type !== 'control_response' &&
      message.type !== 'control_request' &&
      message.type !== 'control_cancel_request' &&
      !(
        message.type === 'system' &&
        (message.subtype === 'session_state_changed' ||
          message.subtype === 'task_notification' ||
          message.subtype === 'task_started' ||
          message.subtype === 'task_progress' ||
          message.subtype === 'post_turn_summary')
      ) &&
      message.type !== 'stream_event' &&
      message.type !== 'keep_alive' &&
      message.type !== 'streamlined_text' &&
      message.type !== 'streamlined_tool_use_summary' &&
      message.type !== 'prompt_suggestion'
    ) {
      if (needsFullArray) {
        messages.push(message)
      }
      lastMessage = message
    }
  }

  switch (options.outputFormat) {
    case 'json':
      if (!lastMessage || lastMessage.type !== 'result') {
        throw new Error('No messages returned')
      }
      if (options.verbose) {
        writeToStdout(jsonStringify(messages) + '\n')
        break
      }
      writeToStdout(jsonStringify(lastMessage) + '\n')
      break
    case 'stream-json':
      
      break
    default:
      if (!lastMessage || lastMessage.type !== 'result') {
        throw new Error('No messages returned')
      }
      switch (lastMessage.subtype) {
        case 'success':
          writeToStdout(
            lastMessage.result.endsWith('\n')
              ? lastMessage.result
              : lastMessage.result + '\n',
          )
          break
        case 'error_during_execution':
          writeToStdout(`Execution error`)
          break
        case 'error_max_turns':
          writeToStdout(`Error: Reached max turns (${options.maxTurns})`)
          break
        case 'error_max_budget_usd':
          writeToStdout(`Error: Exceeded USD budget (${options.maxBudgetUsd})`)
          break
        case 'error_max_structured_output_retries':
          writeToStdout(
            `Error: Failed to provide valid structured output after maximum retries`,
          )
      }
  }

  
  logHeadlessProfilerTurn()

  
  
  
  
  
  if (feature('EXTRACT_MEMORIES') && isExtractModeActive()) {
    await extractMemoriesModule!.drainPendingExtraction()
  }

  gracefulShutdownSync(
    lastMessage?.type === 'result' && lastMessage?.is_error ? 1 : 0,
  )
}

function runHeadlessStreaming(
  structuredIO: StructuredIO,
  mcpClients: MCPServerConnection[],
  commands: Command[],
  tools: Tools,
  initialMessages: Message[],
  canUseTool: CanUseToolFn,
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  getAppState: () => AppState,
  setAppState: (f: (prev: AppState) => AppState) => void,
  agents: AgentDefinition[],
  options: {
    verbose: boolean | undefined
    jsonSchema: Record<string, unknown> | undefined
    permissionPromptToolName: string | undefined
    allowedTools: string[] | undefined
    thinkingConfig: ThinkingConfig | undefined
    maxTurns: number | undefined
    maxBudgetUsd: number | undefined
    taskBudget: { total: number } | undefined
    systemPrompt: string | undefined
    appendSystemPrompt: string | undefined
    userSpecifiedModel: string | undefined
    fallbackModel: string | undefined
    replayUserMessages?: boolean | undefined
    includePartialMessages?: boolean | undefined
    enableAuthStatus?: boolean | undefined
    agent?: string | undefined
    setSDKStatus?: (status: SDKStatus) => void
    promptSuggestions?: boolean | undefined
    workload?: string | undefined
  },
  turnInterruptionState?: TurnInterruptionState,
): AsyncIterable<StdoutMessage> {
  let running = false
  let runPhase:
    | 'draining_commands'
    | 'waiting_for_agents'
    | 'finally_flush'
    | 'finally_post_flush'
    | undefined
  let inputClosed = false
  let shutdownPromptInjected = false
  let heldBackResult: StdoutMessage | null = null
  let abortController: AbortController | undefined
  
  const output = structuredIO.outbound

  
  
  
  const sigintHandler = () => {
    logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGINT' })
    if (abortController && !abortController.signal.aborted) {
      abortController.abort()
    }
    void gracefulShutdown(0)
  }
  process.on('SIGINT', sigintHandler)

  
  
  registerCleanup(async () => {
    const bg: Record<string, number> = {}
    for (const t of getRunningTasks(getAppState())) {
      if (isBackgroundTask(t)) bg[t.type] = (bg[t.type] ?? 0) + 1
    }
    logForDiagnosticsNoPII('info', 'run_state_at_shutdown', {
      run_active: running,
      run_phase: runPhase,
      worker_status: getSessionState(),
      internal_events_pending: structuredIO.internalEventsPending,
      bg_tasks: bg,
    })
  })

  
  
  
  
  
  
  
  
  setPermissionModeChangedListener(newMode => {
    
    if (
      newMode === 'default' ||
      newMode === 'acceptEdits' ||
      newMode === 'bypassPermissions' ||
      newMode === 'plan' ||
      newMode === (feature('TRANSCRIPT_CLASSIFIER') && 'auto') ||
      newMode === 'dontAsk'
    ) {
      output.enqueue({
        type: 'system',
        subtype: 'status',
        status: null,
        permissionMode: newMode as PermissionMode,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    }
  })

  
  const suggestionState: {
    abortController: AbortController | null
    inflightPromise: Promise<void> | null
    lastEmitted: {
      text: string
      emittedAt: number
      promptId: PromptVariant
      generationRequestId: string | null
    } | null
    pendingSuggestion: {
      type: 'prompt_suggestion'
      suggestion: string
      uuid: UUID
      session_id: string
    } | null
    pendingLastEmittedEntry: {
      text: string
      promptId: PromptVariant
      generationRequestId: string | null
    } | null
  } = {
    abortController: null,
    inflightPromise: null,
    lastEmitted: null,
    pendingSuggestion: null,
    pendingLastEmittedEntry: null,
  }

  
  let unsubscribeAuthStatus: (() => void) | undefined
  if (options.enableAuthStatus) {
    const authStatusManager = AwsAuthStatusManager.getInstance()
    unsubscribeAuthStatus = authStatusManager.subscribe(status => {
      output.enqueue({
        type: 'auth_status',
        isAuthenticating: status.isAuthenticating,
        output: status.output,
        error: status.error,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    })
  }

  
  
  
  const rateLimitListener = (limits: ClaudeAILimits) => {
    const rateLimitInfo = toSDKRateLimitInfo(limits)
    if (rateLimitInfo) {
      output.enqueue({
        type: 'rate_limit_event',
        rate_limit_info: rateLimitInfo,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    }
  }
  statusListeners.add(rateLimitListener)

  
  
  
  const mutableMessages: Message[] = initialMessages

  
  
  
  
  let readFileState = extractReadFilesFromMessages(
    initialMessages,
    cwd(),
    READ_FILE_STATE_CACHE_SIZE,
  )

  
  
  
  
  
  
  
  
  const pendingSeeds = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )

  
  
  const resumeInterruptedTurnEnv =
    process.env.CLAUDE_CODE_NEXT_RESUME_INTERRUPTED_TURN
  if (
    turnInterruptionState &&
    turnInterruptionState.kind !== 'none' &&
    resumeInterruptedTurnEnv
  ) {
    logForDebugging(
      `[print.ts] Auto-resuming interrupted turn (kind: ${turnInterruptionState.kind})`,
    )

    
    
    
    
    removeInterruptedMessage(mutableMessages, turnInterruptionState.message)
    enqueue({
      mode: 'prompt',
      value: turnInterruptionState.message.message.content,
      uuid: randomUUID(),
    })
  }

  const modelOptions = getModelOptions()
  const modelInfos = modelOptions.map(option => {
    const modelId = option.value === null ? 'default' : option.value
    const resolvedModel =
      modelId === 'default'
        ? getDefaultMainLoopModel()
        : parseUserSpecifiedModel(modelId)
    const hasEffort = modelSupportsEffort(resolvedModel)
    const hasAdaptiveThinking = modelSupportsAdaptiveThinking(resolvedModel)
    const hasFastMode = isFastModeSupportedByModel(option.value)
    const hasAutoMode = modelSupportsAutoMode(resolvedModel)
    return {
      value: modelId,
      displayName: option.label,
      description: option.description,
      ...(hasEffort && {
        supportsEffort: true,
        supportedEffortLevels: modelSupportsMaxEffort(resolvedModel)
          ? [...EFFORT_LEVELS]
          : EFFORT_LEVELS.filter(l => l !== 'max'),
      }),
      ...(hasAdaptiveThinking && { supportsAdaptiveThinking: true }),
      ...(hasFastMode && { supportsFastMode: true }),
      ...(hasAutoMode && { supportsAutoMode: true }),
    }
  })
  let activeUserSpecifiedModel = options.userSpecifiedModel

  function injectModelSwitchBreadcrumbs(
    modelArg: string,
    resolvedModel: string,
  ): void {
    const breadcrumbs = createModelSwitchBreadcrumbs(
      modelArg,
      modelDisplayString(resolvedModel),
    )
    mutableMessages.push(...breadcrumbs)
    for (const crumb of breadcrumbs) {
      if (
        typeof crumb.message.content === 'string' &&
        crumb.message.content.includes(`<${LOCAL_COMMAND_STDOUT_TAG}>`)
      ) {
        output.enqueue({
          type: 'user',
          message: crumb.message,
          session_id: getSessionId(),
          parent_tool_use_id: null,
          uuid: crumb.uuid,
          timestamp: crumb.timestamp,
          isReplay: true,
        } satisfies SDKUserMessageReplay)
      }
    }
  }

  
  let sdkClients: MCPServerConnection[] = []
  let sdkTools: Tools = []

  
  const elicitationRegistered = new Set<string>()

  

  function registerElicitationHandlers(clients: MCPServerConnection[]): void {
    for (const connection of clients) {
      if (
        connection.type !== 'connected' ||
        elicitationRegistered.has(connection.name)
      ) {
        continue
      }
      
      if (connection.config.type === 'sdk') {
        continue
      }
      const serverName = connection.name

      
      
      try {
        connection.client.setRequestHandler(
          ElicitRequestSchema,
          async (request, extra) => {
            logMCPDebug(
              serverName,
              `Elicitation request received in print mode: ${jsonStringify(request)}`,
            )

            const mode = request.params.mode === 'url' ? 'url' : 'form'

            logEvent('tengu_mcp_elicitation_shown', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })

            
            const hookResponse = await runElicitationHooks(
              serverName,
              request.params,
              extra.signal,
            )
            if (hookResponse) {
              logMCPDebug(
                serverName,
                `Elicitation resolved by hook: ${jsonStringify(hookResponse)}`,
              )
              logEvent('tengu_mcp_elicitation_response', {
                mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                action:
                  hookResponse.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              })
              return hookResponse
            }

            
            const url =
              'url' in request.params
                ? (request.params.url as string)
                : undefined
            const requestedSchema =
              'requestedSchema' in request.params
                ? (request.params.requestedSchema as
                    | Record<string, unknown>
                    | undefined)
                : undefined

            const elicitationId =
              'elicitationId' in request.params
                ? (request.params.elicitationId as string | undefined)
                : undefined

            const rawResult = await structuredIO.handleElicitation(
              serverName,
              request.params.message,
              requestedSchema,
              extra.signal,
              mode,
              url,
              elicitationId,
            )

            const result = await runElicitationResultHooks(
              serverName,
              rawResult,
              extra.signal,
              mode,
              elicitationId,
            )

            logEvent('tengu_mcp_elicitation_response', {
              mode: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              action:
                result.action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            return result
          },
        )

        
        connection.client.setNotificationHandler(
          ElicitationCompleteNotificationSchema,
          notification => {
            const { elicitationId } = notification.params
            logMCPDebug(
              serverName,
              `Elicitation completion notification: ${elicitationId}`,
            )
            void executeNotificationHooks({
              message: `MCP server "${serverName}" confirmed elicitation ${elicitationId} complete`,
              notificationType: 'elicitation_complete',
            })
            output.enqueue({
              type: 'system',
              subtype: 'elicitation_complete',
              mcp_server_name: serverName,
              elicitation_id: elicitationId,
              uuid: randomUUID(),
              session_id: getSessionId(),
            })
          },
        )

        elicitationRegistered.add(serverName)
      } catch {
        
        
      }
    }
  }

  async function updateSdkMcp() {
    
    const currentServerNames = new Set(Object.keys(sdkMcpConfigs))
    const connectedServerNames = new Set(sdkClients.map(c => c.name))

    
    const hasNewServers = Array.from(currentServerNames).some(
      name => !connectedServerNames.has(name),
    )
    const hasRemovedServers = Array.from(connectedServerNames).some(
      name => !currentServerNames.has(name),
    )
    
    const hasPendingSdkClients = sdkClients.some(c => c.type === 'pending')
    
    
    
    
    const hasFailedSdkClients = sdkClients.some(c => c.type === 'failed')

    const haveServersChanged =
      hasNewServers ||
      hasRemovedServers ||
      hasPendingSdkClients ||
      hasFailedSdkClients

    if (haveServersChanged) {
      
      for (const client of sdkClients) {
        if (!currentServerNames.has(client.name)) {
          if (client.type === 'connected') {
            await client.cleanup()
          }
        }
      }

      
      const sdkSetup = await setupSdkMcpClients(
        sdkMcpConfigs,
        (serverName, message) =>
          structuredIO.sendMcpMessage(serverName, message),
      )
      sdkClients = sdkSetup.clients
      sdkTools = sdkSetup.tools

      
      
      
      
      
      const allSdkNames = uniq([...connectedServerNames, ...currentServerNames])
      setAppState(prev => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          tools: [
            ...prev.mcp.tools.filter(
              t =>
                !allSdkNames.some(name =>
                  t.name.startsWith(getMcpPrefix(name)),
                ),
            ),
            ...sdkTools,
          ],
        },
      }))

      
      setupVscodeSdkMcp(sdkClients)
    }
  }

  void updateSdkMcp()

  
  
  let dynamicMcpState: DynamicMcpState = {
    clients: [],
    tools: [],
    configs: {},
  }

  
  
  
  const buildAllTools = (appState: AppState): Tools => {
    const assembledTools = assembleToolPool(
      appState.toolPermissionContext,
      appState.mcp.tools,
    )
    let allTools = uniqBy(
      mergeAndFilterTools(
        [...tools, ...sdkTools, ...dynamicMcpState.tools],
        assembledTools,
        appState.toolPermissionContext.mode,
      ),
      'name',
    )
    if (options.permissionPromptToolName) {
      allTools = allTools.filter(
        tool => !toolMatchesName(tool, options.permissionPromptToolName!),
      )
    }
    const initJsonSchema = getInitJsonSchema()
    if (initJsonSchema && !options.jsonSchema) {
      const syntheticOutputResult = createSyntheticOutputTool(initJsonSchema)
      if ('tool' in syntheticOutputResult) {
        allTools = [...allTools, syntheticOutputResult.tool]
      }
    }
    return allTools
  }

  
  
  
  let bridgeHandle: ReplBridgeHandle | null = null
  
  
  let bridgeLastForwardedIndex = 0

  
  
  
  
  
  
  
  function forwardMessagesToBridge(): void {
    if (!bridgeHandle) return
    
    const startIndex = Math.min(
      bridgeLastForwardedIndex,
      mutableMessages.length,
    )
    const newMessages = mutableMessages
      .slice(startIndex)
      .filter(m => m.type === 'user' || m.type === 'assistant')
    bridgeLastForwardedIndex = mutableMessages.length
    if (newMessages.length > 0) {
      bridgeHandle.writeMessages(newMessages)
    }
  }

  
  
  
  let mcpChangesPromise: Promise<{
    response: SDKControlMcpSetServersResponse
    sdkServersChanged: boolean
  }> = Promise.resolve({
    response: {
      added: [] as string[],
      removed: [] as string[],
      errors: {} as Record<string, string>,
    },
    sdkServersChanged: false,
  })

  function applyMcpServerChanges(
    servers: Record<string, McpServerConfigForProcessTransport>,
  ): Promise<{
    response: SDKControlMcpSetServersResponse
    sdkServersChanged: boolean
  }> {
    
    
    const doWork = async (): Promise<{
      response: SDKControlMcpSetServersResponse
      sdkServersChanged: boolean
    }> => {
      const oldSdkClientNames = new Set(sdkClients.map(c => c.name))

      const result = await handleMcpSetServers(
        servers,
        { configs: sdkMcpConfigs, clients: sdkClients, tools: sdkTools },
        dynamicMcpState,
        setAppState,
      )

      
      for (const key of Object.keys(sdkMcpConfigs)) {
        delete sdkMcpConfigs[key]
      }
      Object.assign(sdkMcpConfigs, result.newSdkState.configs)
      sdkClients = result.newSdkState.clients
      sdkTools = result.newSdkState.tools
      dynamicMcpState = result.newDynamicState

      
      
      if (result.sdkServersChanged) {
        const newSdkClientNames = new Set(sdkClients.map(c => c.name))
        const allSdkNames = uniq([...oldSdkClientNames, ...newSdkClientNames])
        setAppState(prev => ({
          ...prev,
          mcp: {
            ...prev.mcp,
            tools: [
              ...prev.mcp.tools.filter(
                t =>
                  !allSdkNames.some(name =>
                    t.name.startsWith(getMcpPrefix(name)),
                  ),
              ),
              ...sdkTools,
            ],
          },
        }))
      }

      return {
        response: result.response,
        sdkServersChanged: result.sdkServersChanged,
      }
    }

    mcpChangesPromise = mcpChangesPromise.then(doWork, doWork)
    return mcpChangesPromise
  }

  
  
  function buildMcpServerStatuses(): McpServerStatus[] {
    const currentAppState = getAppState()
    const currentMcpClients = currentAppState.mcp.clients
    const allMcpTools = uniqBy(
      [...currentAppState.mcp.tools, ...dynamicMcpState.tools],
      'name',
    )
    const existingNames = new Set([
      ...currentMcpClients.map(c => c.name),
      ...sdkClients.map(c => c.name),
    ])
    return [
      ...currentMcpClients,
      ...sdkClients,
      ...dynamicMcpState.clients.filter(c => !existingNames.has(c.name)),
    ].map(connection => {
      let config
      if (
        connection.config.type === 'sse' ||
        connection.config.type === 'http'
      ) {
        config = {
          type: connection.config.type,
          url: connection.config.url,
          headers: connection.config.headers,
          oauth: connection.config.oauth,
        }
      } else if (connection.config.type === 'claudeai-proxy') {
        config = {
          type: 'claudeai-proxy' as const,
          url: connection.config.url,
          id: connection.config.id,
        }
      } else if (
        connection.config.type === 'stdio' ||
        connection.config.type === undefined
      ) {
        config = {
          type: 'stdio' as const,
          command: connection.config.command,
          args: connection.config.args,
        }
      }
      const serverTools =
        connection.type === 'connected'
          ? filterToolsByServer(allMcpTools, connection.name).map(tool => ({
              name: tool.mcpInfo?.toolName ?? tool.name,
              annotations: {
                readOnly: tool.isReadOnly({}) || undefined,
                destructive: tool.isDestructive?.({}) || undefined,
                openWorld: tool.isOpenWorld?.({}) || undefined,
              },
            }))
          : undefined
      
      
      
      
      
      let capabilities: { experimental?: Record<string, unknown> } | undefined
      if (
        (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
        connection.type === 'connected' &&
        connection.capabilities.experimental
      ) {
        const exp = { ...connection.capabilities.experimental }
        if (
          exp['claude/channel'] &&
          (!isChannelsEnabled() ||
            !isChannelAllowlisted(connection.config.pluginSource))
        ) {
          delete exp['claude/channel']
        }
        if (Object.keys(exp).length > 0) {
          capabilities = { experimental: exp }
        }
      }
      return {
        name: connection.name,
        status: connection.type,
        serverInfo:
          connection.type === 'connected' ? connection.serverInfo : undefined,
        error: connection.type === 'failed' ? connection.error : undefined,
        config,
        scope: connection.config.scope,
        tools: serverTools,
        capabilities,
      }
    })
  }

  
  async function installPluginsAndApplyMcpInBackground(): Promise<void> {
    try {
      
      
      
      await Promise.all([
        feature('DOWNLOAD_USER_SETTINGS') &&
        (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE) || getIsRemoteMode())
          ? withDiagnosticsTiming('headless_user_settings_download', () =>
              downloadUserSettings(),
            )
          : Promise.resolve(),
        withDiagnosticsTiming('headless_managed_settings_wait', () =>
          waitForRemoteManagedSettingsToLoad(),
        ),
      ])

      const pluginsInstalled = await installPluginsForHeadless()

      if (pluginsInstalled) {
        await applyPluginMcpDiff()
      }
    } catch (error) {
      logError(error)
    }
  }

  
  
  
  
  let pluginInstallPromise: Promise<void> | null = null
  
  
  if (!isBareMode()) {
    if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SYNC_PLUGIN_INSTALL)) {
      pluginInstallPromise = installPluginsAndApplyMcpInBackground()
    } else {
      void installPluginsAndApplyMcpInBackground()
    }
  }

  
  const idleTimeout = createIdleTimeoutManager(() => !running)

  
  let currentCommands = commands
  let currentAgents = agents

  
  
  
  
  
  
  
  async function refreshPluginState(): Promise<void> {
    
    
    
    const { agentDefinitions: freshAgentDefs } =
      await refreshActivePlugins(setAppState)

    
    
    
    currentCommands = await getCommands(cwd())

    
    
    
    
    
    
    
    
    
    
    
    const sdkAgents = currentAgents.filter(a => a.source === 'flagSettings')
    currentAgents = [...freshAgentDefs.allAgents, ...sdkAgents]
  }

  
  
  
  
  
  async function applyPluginMcpDiff(): Promise<void> {
    const { servers: newConfigs } = await getAllMcpConfigs()
    const supportedConfigs: Record<string, McpServerConfigForProcessTransport> =
      {}
    for (const [name, config] of Object.entries(newConfigs)) {
      const type = config.type
      if (
        type === undefined ||
        type === 'stdio' ||
        type === 'sse' ||
        type === 'http' ||
        type === 'sdk'
      ) {
        supportedConfigs[name] = config
      }
    }
    for (const [name, config] of Object.entries(sdkMcpConfigs)) {
      if (config.type === 'sdk' && !(name in supportedConfigs)) {
        supportedConfigs[name] = config
      }
    }
    const { response, sdkServersChanged } =
      await applyMcpServerChanges(supportedConfigs)
    if (sdkServersChanged) {
      void updateSdkMcp()
    }
    logForDebugging(
      `Headless MCP refresh: added=${response.added.length}, removed=${response.removed.length}`,
    )
  }

  
  const unsubscribeSkillChanges = skillChangeDetector.subscribe(() => {
    clearCommandsCache()
    void getCommands(cwd()).then(newCommands => {
      currentCommands = newCommands
    })
  })

  
  
  
  const scheduleProactiveTick =
    feature('PROACTIVE') || feature('KAIROS')
      ? () => {
          setTimeout(() => {
            if (
              !proactiveModule?.isProactiveActive() ||
              proactiveModule.isProactivePaused() ||
              inputClosed
            ) {
              return
            }
            const tickContent = `<${TICK_TAG}>${new Date().toLocaleTimeString()}</${TICK_TAG}>`
            enqueue({
              mode: 'prompt' as const,
              value: tickContent,
              uuid: randomUUID(),
              priority: 'later',
              isMeta: true,
            })
            void run()
          }, 0)
        }
      : undefined

  
  subscribeToCommandQueue(() => {
    if (abortController && getCommandsByMaxPriority('now').length > 0) {
      abortController.abort('interrupt')
    }
  })

  const run = async () => {
    if (running) {
      return
    }

    running = true
    runPhase = undefined
    notifySessionStateChanged('running')
    idleTimeout.stop()

    headlessProfilerCheckpoint('run_entry')
    

    await updateSdkMcp()
    headlessProfilerCheckpoint('after_updateSdkMcp')

    
    
    
    
    
    if (pluginInstallPromise) {
      const timeoutMs = parseInt(
        process.env.CLAUDE_CODE_NEXT_SYNC_PLUGIN_INSTALL_TIMEOUT_MS || '',
        10,
      )
      if (timeoutMs > 0) {
        const timeout = sleep(timeoutMs).then(() => 'timeout' as const)
        const result = await Promise.race([pluginInstallPromise, timeout])
        if (result === 'timeout') {
          logError(
            new Error(
              `CLAUDE_CODE_NEXT_SYNC_PLUGIN_INSTALL: plugin installation timed out after ${timeoutMs}ms`,
            ),
          )
          logEvent('tengu_sync_plugin_install_timeout', {
            timeout_ms: timeoutMs,
          })
        }
      } else {
        await pluginInstallPromise
      }
      pluginInstallPromise = null

      
      await refreshPluginState()

      
      
      const { setupPluginHookHotReload } = await import(
        '../utils/plugins/loadPluginHooks.js'
      )
      setupPluginHookHotReload()
    }

    
    
    
    
    const isMainThread = (cmd: QueuedCommand) => cmd.agentId === undefined

    try {
      let command: QueuedCommand | undefined
      let waitingForAgents = false

      
      
      
      
      const drainCommandQueue = async () => {
        while ((command = dequeue(isMainThread))) {
          if (
            command.mode !== 'prompt' &&
            command.mode !== 'orphaned-permission' &&
            command.mode !== 'task-notification'
          ) {
            throw new Error(
              'only prompt commands are supported in streaming mode',
            )
          }

          
          
          
          const batch: QueuedCommand[] = [command]
          if (command.mode === 'prompt') {
            while (canBatchWith(command, peek(isMainThread))) {
              batch.push(dequeue(isMainThread)!)
            }
            if (batch.length > 1) {
              command = {
                ...command,
                value: joinPromptValues(batch.map(c => c.value)),
                uuid: batch.findLast(c => c.uuid)?.uuid ?? command.uuid,
              }
            }
          }
          const batchUuids = batch.map(c => c.uuid).filter(u => u !== undefined)

          
          
          
          
          
          if (options.replayUserMessages && batch.length > 1) {
            for (const c of batch) {
              if (c.uuid && c.uuid !== command.uuid) {
                output.enqueue({
                  type: 'user',
                  message: { role: 'user', content: c.value },
                  session_id: getSessionId(),
                  parent_tool_use_id: null,
                  uuid: c.uuid,
                  isReplay: true,
                } satisfies SDKUserMessageReplay)
              }
            }
          }

          
          
          
          
          const appState = getAppState()
          const allMcpClients = [
            ...appState.mcp.clients,
            ...sdkClients,
            ...dynamicMcpState.clients,
          ]
          registerElicitationHandlers(allMcpClients)
          
          
          
          
          
          for (const client of allMcpClients) {
            reregisterChannelHandlerAfterReconnect(client)
          }

          const allTools = buildAllTools(appState)

          for (const uuid of batchUuids) {
            notifyCommandLifecycle(uuid, 'started')
          }

          
          
          
          
          
          if (command.mode === 'task-notification') {
            const notificationText =
              typeof command.value === 'string' ? command.value : ''
            
            const taskIdMatch = notificationText.match(
              /<task-id>([^<]+)<\/task-id>/,
            )
            const toolUseIdMatch = notificationText.match(
              /<tool-use-id>([^<]+)<\/tool-use-id>/,
            )
            const outputFileMatch = notificationText.match(
              /<output-file>([^<]+)<\/output-file>/,
            )
            const statusMatch = notificationText.match(
              /<status>([^<]+)<\/status>/,
            )
            const summaryMatch = notificationText.match(
              /<summary>([^<]+)<\/summary>/,
            )

            const isValidStatus = (
              s: string | undefined,
            ): s is 'completed' | 'failed' | 'stopped' | 'killed' =>
              s === 'completed' ||
              s === 'failed' ||
              s === 'stopped' ||
              s === 'killed'
            const rawStatus = statusMatch?.[1]
            const status = isValidStatus(rawStatus)
              ? rawStatus === 'killed'
                ? 'stopped'
                : rawStatus
              : 'completed'

            const usageMatch = notificationText.match(
              /<usage>([\s\S]*?)<\/usage>/,
            )
            const usageContent = usageMatch?.[1] ?? ''
            const totalTokensMatch = usageContent.match(
              /<total_tokens>(\d+)<\/total_tokens>/,
            )
            const toolUsesMatch = usageContent.match(
              /<tool_uses>(\d+)<\/tool_uses>/,
            )
            const durationMsMatch = usageContent.match(
              /<duration_ms>(\d+)<\/duration_ms>/,
            )

            
            
            
            
            
            
            
            if (statusMatch) {
              output.enqueue({
                type: 'system',
                subtype: 'task_notification',
                task_id: taskIdMatch?.[1] ?? '',
                tool_use_id: toolUseIdMatch?.[1],
                status,
                output_file: outputFileMatch?.[1] ?? '',
                summary: summaryMatch?.[1] ?? '',
                usage:
                  totalTokensMatch && toolUsesMatch
                    ? {
                        total_tokens: parseInt(totalTokensMatch[1]!, 10),
                        tool_uses: parseInt(toolUsesMatch[1]!, 10),
                        duration_ms: durationMsMatch
                          ? parseInt(durationMsMatch[1]!, 10)
                          : 0,
                      }
                    : undefined,
                session_id: getSessionId(),
                uuid: randomUUID(),
              })
            }
            
          }

          const input = command.value

          if (structuredIO instanceof RemoteIO && command.mode === 'prompt') {
            logEvent('tengu_bridge_message_received', {
              is_repl: false,
            })
          }

          
          suggestionState.abortController?.abort()
          suggestionState.abortController = null
          suggestionState.pendingSuggestion = null
          suggestionState.pendingLastEmittedEntry = null
          if (suggestionState.lastEmitted) {
            if (command.mode === 'prompt') {
              
              const inputText =
                typeof input === 'string'
                  ? input
                  : (
                      input.find(b => b.type === 'text') as
                        | { type: 'text'; text: string }
                        | undefined
                    )?.text
              if (typeof inputText === 'string') {
                logSuggestionOutcome(
                  suggestionState.lastEmitted.text,
                  inputText,
                  suggestionState.lastEmitted.emittedAt,
                  suggestionState.lastEmitted.promptId,
                  suggestionState.lastEmitted.generationRequestId,
                )
              }
              suggestionState.lastEmitted = null
            }
          }

          abortController = createAbortController()
          const turnStartTime = feature('FILE_PERSISTENCE')
            ? Date.now()
            : undefined

          headlessProfilerCheckpoint('before_ask')
          startQueryProfile()
          
          
          
          
          
          const cmd = command
          await runWithWorkload(cmd.workload ?? options.workload, async () => {
            for await (const message of ask({
              commands: uniqBy(
                [...currentCommands, ...appState.mcp.commands],
                'name',
              ),
              prompt: input,
              promptUuid: cmd.uuid,
              isMeta: cmd.isMeta,
              cwd: cwd(),
              tools: allTools,
              verbose: options.verbose,
              mcpClients: allMcpClients,
              thinkingConfig: options.thinkingConfig,
              maxTurns: options.maxTurns,
              maxBudgetUsd: options.maxBudgetUsd,
              taskBudget: options.taskBudget,
              canUseTool,
              userSpecifiedModel: activeUserSpecifiedModel,
              fallbackModel: options.fallbackModel,
              jsonSchema: getInitJsonSchema() ?? options.jsonSchema,
              mutableMessages,
              getReadFileCache: () =>
                pendingSeeds.size === 0
                  ? readFileState
                  : mergeFileStateCaches(readFileState, pendingSeeds),
              setReadFileCache: cache => {
                readFileState = cache
                for (const [path, seed] of pendingSeeds.entries()) {
                  const existing = readFileState.get(path)
                  if (!existing || seed.timestamp > existing.timestamp) {
                    readFileState.set(path, seed)
                  }
                }
                pendingSeeds.clear()
              },
              customSystemPrompt: options.systemPrompt,
              appendSystemPrompt: options.appendSystemPrompt,
              getAppState,
              setAppState,
              abortController,
              replayUserMessages: options.replayUserMessages,
              includePartialMessages: options.includePartialMessages,
              handleElicitation: (serverName, params, elicitSignal) =>
                structuredIO.handleElicitation(
                  serverName,
                  params.message,
                  undefined,
                  elicitSignal,
                  params.mode,
                  params.url,
                  'elicitationId' in params ? params.elicitationId : undefined,
                ),
              agents: currentAgents,
              orphanedPermission: cmd.orphanedPermission,
              setSDKStatus: status => {
                output.enqueue({
                  type: 'system',
                  subtype: 'status',
                  status,
                  session_id: getSessionId(),
                  uuid: randomUUID(),
                })
              },
            })) {
              
              
              
              forwardMessagesToBridge()

              if (message.type === 'result') {
                
                for (const event of drainSdkEvents()) {
                  output.enqueue(event)
                }

                
                const currentState = getAppState()
                if (
                  getRunningTasks(currentState).some(
                    t =>
                      (t.type === 'local_agent' ||
                        t.type === 'local_workflow') &&
                      isBackgroundTask(t),
                  )
                ) {
                  heldBackResult = message
                } else {
                  heldBackResult = null
                  output.enqueue(message)
                }
              } else {
                
                
                for (const event of drainSdkEvents()) {
                  output.enqueue(event)
                }
                output.enqueue(message)
              }
            }
          }) 

          for (const uuid of batchUuids) {
            notifyCommandLifecycle(uuid, 'completed')
          }

          
          forwardMessagesToBridge()
          bridgeHandle?.sendResult()

          if (feature('FILE_PERSISTENCE') && turnStartTime !== undefined) {
            void executeFilePersistence(
              turnStartTime,
              abortController.signal,
              result => {
                output.enqueue({
                  type: 'system' as const,
                  subtype: 'files_persisted' as const,
                  files: result.files,
                  failed: result.failed,
                  processed_at: new Date().toISOString(),
                  uuid: randomUUID(),
                  session_id: getSessionId(),
                })
              },
            )
          }

          
          if (
            options.promptSuggestions &&
            !isEnvDefinedFalsy(process.env.CLAUDE_CODE_NEXT_ENABLE_PROMPT_SUGGESTION)
          ) {
            
            
            const state = suggestionState as unknown as typeof suggestionState
            state.abortController?.abort()
            const localAbort = new AbortController()
            suggestionState.abortController = localAbort

            const cacheSafeParams = getLastCacheSafeParams()
            if (!cacheSafeParams) {
              logSuggestionSuppressed(
                'sdk_no_params',
                undefined,
                undefined,
                'sdk',
              )
            } else {
              
              
              const ref: { promise: Promise<void> | null } = { promise: null }
              ref.promise = (async () => {
                try {
                  const result = await tryGenerateSuggestion(
                    localAbort,
                    mutableMessages,
                    getAppState,
                    cacheSafeParams,
                    'sdk',
                  )
                  if (!result || localAbort.signal.aborted) return
                  const suggestionMsg = {
                    type: 'prompt_suggestion' as const,
                    suggestion: result.suggestion,
                    uuid: randomUUID(),
                    session_id: getSessionId(),
                  }
                  const lastEmittedEntry = {
                    text: result.suggestion,
                    emittedAt: Date.now(),
                    promptId: result.promptId,
                    generationRequestId: result.generationRequestId,
                  }
                  
                  
                  
                  
                  
                  if (heldBackResult) {
                    suggestionState.pendingSuggestion = suggestionMsg
                    suggestionState.pendingLastEmittedEntry = {
                      text: lastEmittedEntry.text,
                      promptId: lastEmittedEntry.promptId,
                      generationRequestId: lastEmittedEntry.generationRequestId,
                    }
                  } else {
                    suggestionState.lastEmitted = lastEmittedEntry
                    output.enqueue(suggestionMsg)
                  }
                } catch (error) {
                  if (
                    error instanceof Error &&
                    (error.name === 'AbortError' ||
                      error.name === 'APIUserAbortError')
                  ) {
                    logSuggestionSuppressed(
                      'aborted',
                      undefined,
                      undefined,
                      'sdk',
                    )
                    return
                  }
                  logError(toError(error))
                } finally {
                  if (suggestionState.inflightPromise === ref.promise) {
                    suggestionState.inflightPromise = null
                  }
                }
              })()
              suggestionState.inflightPromise = ref.promise
            }
          }

          
          logHeadlessProfilerTurn()
          logQueryProfileReport()
          headlessProfilerStartTurn()
        }
      }

      
      
      
      do {
        
        
        for (const event of drainSdkEvents()) {
          output.enqueue(event)
        }

        runPhase = 'draining_commands'
        await drainCommandQueue()

        
        
        
        
        
        
        
        
        waitingForAgents = false
        {
          const state = getAppState()
          const hasRunningBg = getRunningTasks(state).some(
            t => isBackgroundTask(t) && t.type !== 'in_process_teammate',
          )
          const hasMainThreadQueued = peek(isMainThread) !== undefined
          if (hasRunningBg || hasMainThreadQueued) {
            waitingForAgents = true
            if (!hasMainThreadQueued) {
              runPhase = 'waiting_for_agents'
              
              await sleep(100)
            }
            
          }
        }
      } while (waitingForAgents)

      if (heldBackResult) {
        output.enqueue(heldBackResult)
        heldBackResult = null
        if (suggestionState.pendingSuggestion) {
          output.enqueue(suggestionState.pendingSuggestion)
          
          if (suggestionState.pendingLastEmittedEntry) {
            suggestionState.lastEmitted = {
              ...suggestionState.pendingLastEmittedEntry,
              emittedAt: Date.now(),
            }
            suggestionState.pendingLastEmittedEntry = null
          }
          suggestionState.pendingSuggestion = null
        }
      }
    } catch (error) {
      
      
      try {
        await structuredIO.write({
          type: 'result',
          subtype: 'error_during_execution',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: true,
          num_turns: 0,
          stop_reason: null,
          session_id: getSessionId(),
          total_cost_usd: 0,
          usage: EMPTY_USAGE,
          modelUsage: {},
          permission_denials: [],
          uuid: randomUUID(),
          errors: [
            errorMessage(error),
            ...getInMemoryErrors().map(_ => _.error),
          ],
        })
      } catch {
        
      }
      suggestionState.abortController?.abort()
      gracefulShutdownSync(1)
      return
    } finally {
      runPhase = 'finally_flush'
      
      await structuredIO.flushInternalEvents()
      runPhase = 'finally_post_flush'
      if (!isShuttingDown()) {
        notifySessionStateChanged('idle')
        
        
        
        
        
        
        for (const event of drainSdkEvents()) {
          output.enqueue(event)
        }
      }
      running = false
      
      idleTimeout.start()
    }

    
    if (
      (feature('PROACTIVE') || feature('KAIROS')) &&
      proactiveModule?.isProactiveActive() &&
      !proactiveModule.isProactivePaused()
    ) {
      if (peek(isMainThread) === undefined && !inputClosed) {
        scheduleProactiveTick!()
        return
      }
    }

    
    
    
    
    
    if (peek(isMainThread) !== undefined) {
      void run()
      return
    }

    
    
    
    {
      const currentAppState = getAppState()
      const teamContext = currentAppState.teamContext

      if (teamContext && isTeamLead(teamContext)) {
        const agentName = 'team-lead'

        
        
        
        const POLL_INTERVAL_MS = 500

        while (true) {
          
          const refreshedState = getAppState()
          const hasActiveTeammates =
            hasActiveInProcessTeammates(refreshedState) ||
            (refreshedState.teamContext &&
              Object.keys(refreshedState.teamContext.teammates).length > 0)

          if (!hasActiveTeammates) {
            logForDebugging(
              '[print.ts] No more active teammates, stopping poll',
            )
            break
          }

          const unread = await readUnreadMessages(
            agentName,
            refreshedState.teamContext?.teamName,
          )

          if (unread.length > 0) {
            logForDebugging(
              `[print.ts] Team-lead found ${unread.length} unread messages`,
            )

            
            await markMessagesAsRead(
              agentName,
              refreshedState.teamContext?.teamName,
            )

            
            
            const teamName = refreshedState.teamContext?.teamName
            for (const m of unread) {
              const shutdownApproval = isShutdownApproved(m.text)
              if (shutdownApproval && teamName) {
                const teammateToRemove = shutdownApproval.from
                logForDebugging(
                  `[print.ts] Processing shutdown_approved from ${teammateToRemove}`,
                )

                
                const teammateId = refreshedState.teamContext?.teammates
                  ? Object.entries(refreshedState.teamContext.teammates).find(
                      ([, t]) => t.name === teammateToRemove,
                    )?.[0]
                  : undefined

                if (teammateId) {
                  
                  removeTeammateFromTeamFile(teamName, {
                    agentId: teammateId,
                    name: teammateToRemove,
                  })
                  logForDebugging(
                    `[print.ts] Removed ${teammateToRemove} from team file`,
                  )

                  
                  await unassignTeammateTasks(
                    teamName,
                    teammateId,
                    teammateToRemove,
                    'shutdown',
                  )

                  
                  setAppState(prev => {
                    if (!prev.teamContext?.teammates) return prev
                    if (!(teammateId in prev.teamContext.teammates)) return prev
                    const { [teammateId]: _, ...remainingTeammates } =
                      prev.teamContext.teammates
                    return {
                      ...prev,
                      teamContext: {
                        ...prev.teamContext,
                        teammates: remainingTeammates,
                      },
                    }
                  })
                }
              }
            }

            
            const formatted = unread
              .map(
                (m: { from: string; text: string; color?: string }) =>
                  `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${m.color ? ` color="${m.color}"` : ''}>\n${m.text}\n</${TEAMMATE_MESSAGE_TAG}>`,
              )
              .join('\n\n')

            
            enqueue({
              mode: 'prompt',
              value: formatted,
              uuid: randomUUID(),
            })
            void run()
            return 
          }

          
          
          if (inputClosed && !shutdownPromptInjected) {
            shutdownPromptInjected = true
            logForDebugging(
              '[print.ts] Input closed with active teammates, injecting shutdown prompt',
            )
            enqueue({
              mode: 'prompt',
              value: SHUTDOWN_TEAM_PROMPT,
              uuid: randomUUID(),
            })
            void run()
            return 
          }

          
          await sleep(POLL_INTERVAL_MS)
        }
      }
    }

    if (inputClosed) {
      
      const hasActiveSwarm = await (async () => {
        
        const currentAppState = getAppState()
        if (hasWorkingInProcessTeammates(currentAppState)) {
          await waitForTeammatesToBecomeIdle(setAppState, currentAppState)
        }

        
        const refreshedAppState = getAppState()
        const refreshedTeamContext = refreshedAppState.teamContext
        const hasTeamMembersNotCleanedUp =
          refreshedTeamContext &&
          Object.keys(refreshedTeamContext.teammates).length > 0

        return (
          hasTeamMembersNotCleanedUp ||
          hasActiveInProcessTeammates(refreshedAppState)
        )
      })()

      if (hasActiveSwarm) {
        
        enqueue({
          mode: 'prompt',
          value: SHUTDOWN_TEAM_PROMPT,
          uuid: randomUUID(),
        })
        void run()
      } else {
        
        if (suggestionState.inflightPromise) {
          await Promise.race([suggestionState.inflightPromise, sleep(5000)])
        }
        suggestionState.abortController?.abort()
        suggestionState.abortController = null
        await finalizePendingAsyncHooks()
        unsubscribeSkillChanges()
        unsubscribeAuthStatus?.()
        statusListeners.delete(rateLimitListener)
        output.done()
      }
    }
  }

  
  
  if (feature('UDS_INBOX')) {
    
    const { setOnEnqueue } = require('../utils/udsMessaging.js')
    
    setOnEnqueue(() => {
      if (!inputClosed) {
        void run()
      }
    })
  }

  
  
  
  
  
  
  let cronScheduler: import('../utils/cronScheduler.js').CronScheduler | null =
    null
  if (
    feature('AGENT_TRIGGERS') &&
    cronSchedulerModule &&
    cronGate?.isKairosCronEnabled()
  ) {
    cronScheduler = cronSchedulerModule.createCronScheduler({
      onFire: prompt => {
        if (inputClosed) return
        enqueue({
          mode: 'prompt',
          value: prompt,
          uuid: randomUUID(),
          priority: 'later',
          
          
          
          isMeta: true,
          
          
          
          
          workload: WORKLOAD_CRON,
        })
        void run()
      },
      isLoading: () => running || inputClosed,
      getJitterConfig: cronJitterConfigModule?.getCronJitterConfig,
      isKilled: () => !cronGate?.isKairosCronEnabled(),
    })
    cronScheduler.start()
  }

  const sendControlResponseSuccess = function (
    message: SDKControlRequest,
    response?: Record<string, unknown>,
  ) {
    output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response: response,
      },
    })
  }

  const sendControlResponseError = function (
    message: SDKControlRequest,
    errorMessage: string,
  ) {
    output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: message.request_id,
        error: errorMessage,
      },
    })
  }

  
  
  const handledOrphanedToolUseIds = new Set<string>()
  structuredIO.setUnexpectedResponseCallback(async message => {
    await handleOrphanedPermissionResponse({
      message,
      setAppState,
      handledToolUseIds: handledOrphanedToolUseIds,
      onEnqueued: () => {
        
        
        void run()
      },
    })
  })

  
  
  const activeOAuthFlows = new Map<string, AbortController>()
  
  
  const oauthCallbackSubmitters = new Map<
    string,
    (callbackUrl: string) => void
  >()
  
  
  const oauthManualCallbackUsed = new Set<string>()
  
  
  
  const oauthAuthPromises = new Map<string, Promise<void>>()

  
  
  
  
  
  let claudeOAuth: {
    service: OAuthService
    flow: Promise<void>
  } | null = null

  
  
  
  
  
  
  void (async () => {
    let initialized = false
    logForDiagnosticsNoPII('info', 'cli_message_loop_started')
    for await (const message of structuredIO.structuredInput) {
      
      
      
      
      const eventId = 'uuid' in message ? message.uuid : undefined
      if (
        eventId &&
        message.type !== 'user' &&
        message.type !== 'control_response'
      ) {
        notifyCommandLifecycle(eventId, 'completed')
      }

      if (message.type === 'control_request') {
        if (message.request.subtype === 'interrupt') {
          
          if (feature('COMMIT_ATTRIBUTION')) {
            setAppState(prev => ({
              ...prev,
              attribution: {
                ...prev.attribution,
                escapeCount: prev.attribution.escapeCount + 1,
              },
            }))
          }
          if (abortController) {
            abortController.abort()
          }
          suggestionState.abortController?.abort()
          suggestionState.abortController = null
          suggestionState.lastEmitted = null
          suggestionState.pendingSuggestion = null
          sendControlResponseSuccess(message)
        } else if (message.request.subtype === 'end_session') {
          logForDebugging(
            `[print.ts] end_session received, reason=${message.request.reason ?? 'unspecified'}`,
          )
          if (abortController) {
            abortController.abort()
          }
          suggestionState.abortController?.abort()
          suggestionState.abortController = null
          suggestionState.lastEmitted = null
          suggestionState.pendingSuggestion = null
          sendControlResponseSuccess(message)
          break 
        } else if (message.request.subtype === 'initialize') {
          
          
          if (
            message.request.sdkMcpServers &&
            message.request.sdkMcpServers.length > 0
          ) {
            for (const serverName of message.request.sdkMcpServers) {
              
              
              sdkMcpConfigs[serverName] = {
                type: 'sdk',
                name: serverName,
              }
            }
          }

          await handleInitializeRequest(
            message.request,
            message.request_id,
            initialized,
            output,
            commands,
            modelInfos,
            structuredIO,
            !!options.enableAuthStatus,
            options,
            agents,
            getAppState,
          )

          
          
          
          if (message.request.promptSuggestions) {
            setAppState(prev => {
              if (prev.promptSuggestionEnabled) return prev
              return { ...prev, promptSuggestionEnabled: true }
            })
          }

          if (
            message.request.agentProgressSummaries &&
            getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_prism', true)
          ) {
            setSdkAgentProgressSummariesEnabled(true)
          }

          initialized = true

          
          
          if (hasCommandsInQueue()) {
            void run()
          }
        } else if (message.request.subtype === 'set_permission_mode') {
          const m = message.request 
          setAppState(prev => ({
            ...prev,
            toolPermissionContext: handleSetPermissionMode(
              m,
              message.request_id,
              prev.toolPermissionContext,
              output,
            ),
            isUltraplanMode: m.ultraplan ?? prev.isUltraplanMode,
          }))
          
          
          
        } else if (message.request.subtype === 'set_model') {
          const requestedModel = message.request.model ?? 'default'
          const model =
            requestedModel === 'default'
              ? getDefaultMainLoopModel()
              : requestedModel
          activeUserSpecifiedModel = model
          setMainLoopModelOverride(model)
          notifySessionMetadataChanged({ model })
          injectModelSwitchBreadcrumbs(requestedModel, model)

          sendControlResponseSuccess(message)
        } else if (message.request.subtype === 'set_max_thinking_tokens') {
          if (message.request.max_thinking_tokens === null) {
            options.thinkingConfig = undefined
          } else if (message.request.max_thinking_tokens === 0) {
            options.thinkingConfig = { type: 'disabled' }
          } else {
            options.thinkingConfig = {
              type: 'enabled',
              budgetTokens: message.request.max_thinking_tokens,
            }
          }
          sendControlResponseSuccess(message)
        } else if (message.request.subtype === 'mcp_status') {
          sendControlResponseSuccess(message, {
            mcpServers: buildMcpServerStatuses(),
          })
        } else if (message.request.subtype === 'get_context_usage') {
          try {
            const appState = getAppState()
            const data = await collectContextData({
              messages: mutableMessages,
              getAppState,
              options: {
                mainLoopModel: getMainLoopModel(),
                tools: buildAllTools(appState),
                agentDefinitions: appState.agentDefinitions,
                customSystemPrompt: options.systemPrompt,
                appendSystemPrompt: options.appendSystemPrompt,
              },
            })
            sendControlResponseSuccess(message, { ...data })
          } catch (error) {
            sendControlResponseError(message, errorMessage(error))
          }
        } else if (message.request.subtype === 'mcp_message') {
          
          const mcpRequest = message.request
          const sdkClient = sdkClients.find(
            client => client.name === mcpRequest.server_name,
          )
          
          
          if (
            sdkClient &&
            sdkClient.type === 'connected' &&
            sdkClient.client?.transport?.onmessage
          ) {
            sdkClient.client.transport.onmessage(mcpRequest.message)
          }
          sendControlResponseSuccess(message)
        } else if (message.request.subtype === 'rewind_files') {
          const appState = getAppState()
          const result = await handleRewindFiles(
            message.request.user_message_id as UUID,
            appState,
            setAppState,
            message.request.dry_run ?? false,
          )
          if (result.canRewind || message.request.dry_run) {
            sendControlResponseSuccess(message, result)
          } else {
            sendControlResponseError(
              message,
              result.error ?? 'Unexpected error',
            )
          }
        } else if (message.request.subtype === 'cancel_async_message') {
          const targetUuid = message.request.message_uuid
          const removed = dequeueAllMatching(cmd => cmd.uuid === targetUuid)
          sendControlResponseSuccess(message, {
            cancelled: removed.length > 0,
          })
        } else if (message.request.subtype === 'seed_read_state') {
          
          
          
          try {
            
            
            
            const normalizedPath = expandPath(message.request.path)
            
            
            
            
            
            
            
            
            const diskMtime = Math.floor((await stat(normalizedPath)).mtimeMs)
            if (diskMtime <= message.request.mtime) {
              const raw = await readFile(normalizedPath, 'utf-8')
              
              
              
              
              const content = (
                raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
              ).replaceAll('\r\n', '\n')
              pendingSeeds.set(normalizedPath, {
                content,
                timestamp: diskMtime,
                offset: undefined,
                limit: undefined,
              })
            }
          } catch {
            
          }
          sendControlResponseSuccess(message)
        } else if (message.request.subtype === 'mcp_set_servers') {
          const { response, sdkServersChanged } = await applyMcpServerChanges(
            message.request.servers,
          )
          sendControlResponseSuccess(message, response)

          
          if (sdkServersChanged) {
            void updateSdkMcp()
          }
        } else if (message.request.subtype === 'reload_plugins') {
          try {
            if (
              feature('DOWNLOAD_USER_SETTINGS') &&
              (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE) || getIsRemoteMode())
            ) {
              
              
              const applied = await redownloadUserSettings()
              if (applied) {
                settingsChangeDetector.notifyChange('userSettings')
              }
            }

            const r = await refreshActivePlugins(setAppState)

            const sdkAgents = currentAgents.filter(
              a => a.source === 'flagSettings',
            )
            currentAgents = [...r.agentDefinitions.allAgents, ...sdkAgents]

            
            
            
            let plugins: SDKControlReloadPluginsResponse['plugins'] = []
            const [cmdsR, mcpR, pluginsR] = await Promise.allSettled([
              getCommands(cwd()),
              applyPluginMcpDiff(),
              loadAllPluginsCacheOnly(),
            ])
            if (cmdsR.status === 'fulfilled') {
              currentCommands = cmdsR.value
            } else {
              logError(cmdsR.reason)
            }
            if (mcpR.status === 'rejected') {
              logError(mcpR.reason)
            }
            if (pluginsR.status === 'fulfilled') {
              plugins = pluginsR.value.enabled.map(p => ({
                name: p.name,
                path: p.path,
                source: p.source,
              }))
            } else {
              logError(pluginsR.reason)
            }

            sendControlResponseSuccess(message, {
              commands: currentCommands
                .filter(cmd => cmd.userInvocable !== false)
                .map(cmd => ({
                  name: getCommandName(cmd),
                  description: formatDescriptionWithSource(cmd),
                  argumentHint: cmd.argumentHint || '',
                })),
              agents: currentAgents.map(a => ({
                name: a.agentType,
                description: a.whenToUse,
                model: a.model === 'inherit' ? undefined : a.model,
              })),
              plugins,
              mcpServers: buildMcpServerStatuses(),
              error_count: r.error_count,
            } satisfies SDKControlReloadPluginsResponse)
          } catch (error) {
            sendControlResponseError(message, errorMessage(error))
          }
        } else if (message.request.subtype === 'mcp_reconnect') {
          const currentAppState = getAppState()
          const { serverName } = message.request
          elicitationRegistered.delete(serverName)
          
          
          
          
          
          const config =
            getMcpConfigByName(serverName) ??
            mcpClients.find(c => c.name === serverName)?.config ??
            sdkClients.find(c => c.name === serverName)?.config ??
            dynamicMcpState.clients.find(c => c.name === serverName)?.config ??
            currentAppState.mcp.clients.find(c => c.name === serverName)
              ?.config ??
            null
          if (!config) {
            sendControlResponseError(message, `Server not found: ${serverName}`)
          } else {
            const result = await reconnectMcpServerImpl(serverName, config)
            
            const prefix = getMcpPrefix(serverName)
            setAppState(prev => ({
              ...prev,
              mcp: {
                ...prev.mcp,
                clients: prev.mcp.clients.map(c =>
                  c.name === serverName ? result.client : c,
                ),
                tools: [
                  ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
                  ...result.tools,
                ],
                commands: [
                  ...reject(prev.mcp.commands, c =>
                    commandBelongsToServer(c, serverName),
                  ),
                  ...result.commands,
                ],
                resources:
                  result.resources && result.resources.length > 0
                    ? { ...prev.mcp.resources, [serverName]: result.resources }
                    : omit(prev.mcp.resources, serverName),
              },
            }))
            
            
            dynamicMcpState = {
              ...dynamicMcpState,
              clients: [
                ...dynamicMcpState.clients.filter(c => c.name !== serverName),
                result.client,
              ],
              tools: [
                ...dynamicMcpState.tools.filter(
                  t => !t.name?.startsWith(prefix),
                ),
                ...result.tools,
              ],
            }
            if (result.client.type === 'connected') {
              registerElicitationHandlers([result.client])
              reregisterChannelHandlerAfterReconnect(result.client)
              sendControlResponseSuccess(message)
            } else {
              const errorMessage =
                result.client.type === 'failed'
                  ? (result.client.error ?? 'Connection failed')
                  : `Server status: ${result.client.type}`
              sendControlResponseError(message, errorMessage)
            }
          }
        } else if (message.request.subtype === 'mcp_toggle') {
          const currentAppState = getAppState()
          const { serverName, enabled } = message.request
          elicitationRegistered.delete(serverName)
          
          
          
          const config =
            getMcpConfigByName(serverName) ??
            mcpClients.find(c => c.name === serverName)?.config ??
            sdkClients.find(c => c.name === serverName)?.config ??
            dynamicMcpState.clients.find(c => c.name === serverName)?.config ??
            currentAppState.mcp.clients.find(c => c.name === serverName)
              ?.config ??
            null

          if (!config) {
            sendControlResponseError(message, `Server not found: ${serverName}`)
          } else if (!enabled) {
            
            setMcpServerEnabled(serverName, false)
            const client = [
              ...mcpClients,
              ...sdkClients,
              ...dynamicMcpState.clients,
              ...currentAppState.mcp.clients,
            ].find(c => c.name === serverName)
            if (client && client.type === 'connected') {
              await clearServerCache(serverName, config)
            }
            
            const prefix = getMcpPrefix(serverName)
            setAppState(prev => ({
              ...prev,
              mcp: {
                ...prev.mcp,
                clients: prev.mcp.clients.map(c =>
                  c.name === serverName
                    ? { name: serverName, type: 'disabled' as const, config }
                    : c,
                ),
                tools: reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
                commands: reject(prev.mcp.commands, c =>
                  commandBelongsToServer(c, serverName),
                ),
                resources: omit(prev.mcp.resources, serverName),
              },
            }))
            sendControlResponseSuccess(message)
          } else {
            
            setMcpServerEnabled(serverName, true)
            const result = await reconnectMcpServerImpl(serverName, config)
            
            
            const prefix = getMcpPrefix(serverName)
            setAppState(prev => ({
              ...prev,
              mcp: {
                ...prev.mcp,
                clients: prev.mcp.clients.map(c =>
                  c.name === serverName ? result.client : c,
                ),
                tools: [
                  ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
                  ...result.tools,
                ],
                commands: [
                  ...reject(prev.mcp.commands, c =>
                    commandBelongsToServer(c, serverName),
                  ),
                  ...result.commands,
                ],
                resources:
                  result.resources && result.resources.length > 0
                    ? { ...prev.mcp.resources, [serverName]: result.resources }
                    : omit(prev.mcp.resources, serverName),
              },
            }))
            if (result.client.type === 'connected') {
              registerElicitationHandlers([result.client])
              reregisterChannelHandlerAfterReconnect(result.client)
              sendControlResponseSuccess(message)
            } else {
              const errorMessage =
                result.client.type === 'failed'
                  ? (result.client.error ?? 'Connection failed')
                  : `Server status: ${result.client.type}`
              sendControlResponseError(message, errorMessage)
            }
          }
        } else if (message.request.subtype === 'channel_enable') {
          const currentAppState = getAppState()
          handleChannelEnable(
            message.request_id,
            message.request.serverName,
            
            [
              ...currentAppState.mcp.clients,
              ...sdkClients,
              ...dynamicMcpState.clients,
            ],
            output,
          )
        } else if (message.request.subtype === 'mcp_authenticate') {
          const { serverName } = message.request
          const currentAppState = getAppState()
          const config =
            getMcpConfigByName(serverName) ??
            mcpClients.find(c => c.name === serverName)?.config ??
            currentAppState.mcp.clients.find(c => c.name === serverName)
              ?.config ??
            null
          if (!config) {
            sendControlResponseError(message, `Server not found: ${serverName}`)
          } else if (config.type !== 'sse' && config.type !== 'http') {
            sendControlResponseError(
              message,
              `Server type "${config.type}" does not support OAuth authentication`,
            )
          } else {
            try {
              
              activeOAuthFlows.get(serverName)?.abort()
              const controller = new AbortController()
              activeOAuthFlows.set(serverName, controller)

              
              let resolveAuthUrl: (url: string) => void
              const authUrlPromise = new Promise<string>(resolve => {
                resolveAuthUrl = resolve
              })

              
              const oauthPromise = performMCPOAuthFlow(
                serverName,
                config,
                url => resolveAuthUrl!(url),
                controller.signal,
                {
                  skipBrowserOpen: true,
                  onWaitingForCallback: submit => {
                    oauthCallbackSubmitters.set(serverName, submit)
                  },
                },
              )

              
              const authUrl = await Promise.race([
                authUrlPromise,
                oauthPromise.then(() => null as string | null),
              ])

              if (authUrl) {
                sendControlResponseSuccess(message, {
                  authUrl,
                  requiresUserAction: true,
                })
              } else {
                sendControlResponseSuccess(message, {
                  requiresUserAction: false,
                })
              }

              
              
              
              oauthAuthPromises.set(serverName, oauthPromise)

              
              
              
              
              const fullFlowPromise = oauthPromise
                .then(async () => {
                  
                  if (isMcpServerDisabled(serverName)) {
                    return
                  }
                  
                  
                  
                  if (oauthManualCallbackUsed.has(serverName)) {
                    return
                  }
                  
                  const result = await reconnectMcpServerImpl(
                    serverName,
                    config,
                  )
                  const prefix = getMcpPrefix(serverName)
                  setAppState(prev => ({
                    ...prev,
                    mcp: {
                      ...prev.mcp,
                      clients: prev.mcp.clients.map(c =>
                        c.name === serverName ? result.client : c,
                      ),
                      tools: [
                        ...reject(prev.mcp.tools, t =>
                          t.name?.startsWith(prefix),
                        ),
                        ...result.tools,
                      ],
                      commands: [
                        ...reject(prev.mcp.commands, c =>
                          commandBelongsToServer(c, serverName),
                        ),
                        ...result.commands,
                      ],
                      resources:
                        result.resources && result.resources.length > 0
                          ? {
                              ...prev.mcp.resources,
                              [serverName]: result.resources,
                            }
                          : omit(prev.mcp.resources, serverName),
                    },
                  }))
                  
                  
                  dynamicMcpState = {
                    ...dynamicMcpState,
                    clients: [
                      ...dynamicMcpState.clients.filter(
                        c => c.name !== serverName,
                      ),
                      result.client,
                    ],
                    tools: [
                      ...dynamicMcpState.tools.filter(
                        t => !t.name?.startsWith(prefix),
                      ),
                      ...result.tools,
                    ],
                  }
                })
                .catch(error => {
                  logForDebugging(
                    `MCP OAuth failed for ${serverName}: ${error}`,
                    { level: 'error' },
                  )
                })
                .finally(() => {
                  
                  if (activeOAuthFlows.get(serverName) === controller) {
                    activeOAuthFlows.delete(serverName)
                    oauthCallbackSubmitters.delete(serverName)
                    oauthManualCallbackUsed.delete(serverName)
                    oauthAuthPromises.delete(serverName)
                  }
                })
              void fullFlowPromise
            } catch (error) {
              sendControlResponseError(message, errorMessage(error))
            }
          }
        } else if (message.request.subtype === 'mcp_oauth_callback_url') {
          const { serverName, callbackUrl } = message.request
          const submit = oauthCallbackSubmitters.get(serverName)
          if (submit) {
            
            
            
            
            let hasCodeOrError = false
            try {
              const parsed = new URL(callbackUrl)
              hasCodeOrError =
                parsed.searchParams.has('code') ||
                parsed.searchParams.has('error')
            } catch {
              
            }
            if (!hasCodeOrError) {
              sendControlResponseError(
                message,
                'Invalid callback URL: missing authorization code. Please paste the full redirect URL including the code parameter.',
              )
            } else {
              oauthManualCallbackUsed.add(serverName)
              submit(callbackUrl)
              
              
              
              const authPromise = oauthAuthPromises.get(serverName)
              if (authPromise) {
                try {
                  await authPromise
                  sendControlResponseSuccess(message)
                } catch (error) {
                  sendControlResponseError(
                    message,
                    error instanceof Error
                      ? error.message
                      : 'OAuth authentication failed',
                  )
                }
              } else {
                sendControlResponseSuccess(message)
              }
            }
          } else {
            sendControlResponseError(
              message,
              `No active OAuth flow for server: ${serverName}`,
            )
          }
        } else if (message.request.subtype === 'claude_authenticate') {
          
          
          
          
          
          const { loginWithClaudeAi } = message.request

          
          
          
          
          
          claudeOAuth?.service.cleanup()

          logEvent('tengu_oauth_flow_start', {
            loginWithClaudeAi: loginWithClaudeAi ?? true,
          })

          const service = new OAuthService()
          let urlResolver!: (urls: {
            manualUrl: string
            automaticUrl: string
          }) => void
          const urlPromise = new Promise<{
            manualUrl: string
            automaticUrl: string
          }>(resolve => {
            urlResolver = resolve
          })

          const flow = service
            .startOAuthFlow(
              async (manualUrl, automaticUrl) => {
                
                
                urlResolver({ manualUrl, automaticUrl: automaticUrl! })
              },
              {
                loginWithClaudeAi: loginWithClaudeAi ?? true,
                skipBrowserOpen: true,
              },
            )
            .then(async tokens => {
              
              
              
              
              
              await installOAuthTokens(tokens)
              logEvent('tengu_oauth_success', {
                loginWithClaudeAi: loginWithClaudeAi ?? true,
              })
            })
            .finally(() => {
              service.cleanup()
              if (claudeOAuth?.service === service) {
                claudeOAuth = null
              }
            })

          claudeOAuth = { service, flow }

          
          
          
          
          void flow.catch(err =>
            logForDebugging(`claude_authenticate flow ended: ${err}`, {
              level: 'info',
            }),
          )

          try {
            
            
            
            
            
            const { manualUrl, automaticUrl } = await Promise.race([
              urlPromise,
              flow.then(() => {
                throw new Error(
                  'OAuth flow completed without producing auth URLs',
                )
              }),
            ])
            sendControlResponseSuccess(message, {
              manualUrl,
              automaticUrl,
            })
          } catch (error) {
            sendControlResponseError(message, errorMessage(error))
          }
        } else if (
          message.request.subtype === 'claude_oauth_callback' ||
          message.request.subtype === 'claude_oauth_wait_for_completion'
        ) {
          if (!claudeOAuth) {
            sendControlResponseError(
              message,
              'No active claude_authenticate flow',
            )
          } else {
            
            
            
            if (message.request.subtype === 'claude_oauth_callback') {
              claudeOAuth.service.handleManualAuthCodeInput({
                authorizationCode: message.request.authorizationCode,
                state: message.request.state,
              })
            }
            
            
            
            
            
            const { flow } = claudeOAuth
            void flow.then(
              () => {
                const accountInfo = getAccountInformation()
                sendControlResponseSuccess(message, {
                  account: {
                    email: accountInfo?.email,
                    organization: accountInfo?.organization,
                    subscriptionType: accountInfo?.subscription,
                    tokenSource: accountInfo?.tokenSource,
                    apiKeySource: accountInfo?.apiKeySource,
                    apiProvider: getAPIProvider(),
                  },
                })
              },
              (error: unknown) =>
                sendControlResponseError(message, errorMessage(error)),
            )
          }
        } else if (message.request.subtype === 'mcp_clear_auth') {
          const { serverName } = message.request
          const currentAppState = getAppState()
          const config =
            getMcpConfigByName(serverName) ??
            mcpClients.find(c => c.name === serverName)?.config ??
            currentAppState.mcp.clients.find(c => c.name === serverName)
              ?.config ??
            null
          if (!config) {
            sendControlResponseError(message, `Server not found: ${serverName}`)
          } else if (config.type !== 'sse' && config.type !== 'http') {
            sendControlResponseError(
              message,
              `Cannot clear auth for server type "${config.type}"`,
            )
          } else {
            await revokeServerTokens(serverName, config)
            const result = await reconnectMcpServerImpl(serverName, config)
            const prefix = getMcpPrefix(serverName)
            setAppState(prev => ({
              ...prev,
              mcp: {
                ...prev.mcp,
                clients: prev.mcp.clients.map(c =>
                  c.name === serverName ? result.client : c,
                ),
                tools: [
                  ...reject(prev.mcp.tools, t => t.name?.startsWith(prefix)),
                  ...result.tools,
                ],
                commands: [
                  ...reject(prev.mcp.commands, c =>
                    commandBelongsToServer(c, serverName),
                  ),
                  ...result.commands,
                ],
                resources:
                  result.resources && result.resources.length > 0
                    ? {
                        ...prev.mcp.resources,
                        [serverName]: result.resources,
                      }
                    : omit(prev.mcp.resources, serverName),
              },
            }))
            sendControlResponseSuccess(message, {})
          }
        } else if (message.request.subtype === 'apply_flag_settings') {
          
          
          const prevModel = getMainLoopModel()

          
          const existing = getFlagSettingsInline() ?? {}
          const incoming = message.request.settings
          
          
          
          
          
          
          const merged = { ...existing, ...incoming }
          for (const key of Object.keys(merged)) {
            if (merged[key as keyof typeof merged] === null) {
              delete merged[key as keyof typeof merged]
            }
          }
          setFlagSettingsInline(merged)
          
          
          
          
          
          
          
          
          
          settingsChangeDetector.notifyChange('flagSettings')

          
          
          
          
          
          
          if ('model' in incoming) {
            if (incoming.model != null) {
              setMainLoopModelOverride(String(incoming.model))
            } else {
              setMainLoopModelOverride(undefined)
            }
          }

          
          
          const newModel = getMainLoopModel()
          if (newModel !== prevModel) {
            activeUserSpecifiedModel = newModel
            const modelArg = incoming.model ? String(incoming.model) : 'default'
            notifySessionMetadataChanged({ model: newModel })
            injectModelSwitchBreadcrumbs(modelArg, newModel)
          }

          sendControlResponseSuccess(message)
        } else if (message.request.subtype === 'get_settings') {
          const currentAppState = getAppState()
          const model = getMainLoopModel()
          
          
          const effort = modelSupportsEffort(model)
            ? resolveAppliedEffort(model, currentAppState.effortValue)
            : undefined
          sendControlResponseSuccess(message, {
            ...getSettingsWithSources(),
            applied: {
              model,
              
              effort: typeof effort === 'string' ? effort : null,
            },
          })
        } else if (message.request.subtype === 'stop_task') {
          const { task_id: taskId } = message.request
          try {
            await stopTask(taskId, {
              getAppState,
              setAppState,
            })
            sendControlResponseSuccess(message, {})
          } catch (error) {
            sendControlResponseError(message, errorMessage(error))
          }
        } else if (message.request.subtype === 'generate_session_title') {
          
          
          
          const { description, persist } = message.request
          
          
          
          const titleSignal = (
            abortController && !abortController.signal.aborted
              ? abortController
              : createAbortController()
          ).signal
          void (async () => {
            try {
              const title = await generateSessionTitle(description, titleSignal)
              if (title && persist) {
                try {
                  saveAiGeneratedTitle(getSessionId() as UUID, title)
                } catch (e) {
                  logError(e)
                }
              }
              sendControlResponseSuccess(message, { title })
            } catch (e) {
              
              
              
              
              sendControlResponseError(message, errorMessage(e))
            }
          })()
        } else if (message.request.subtype === 'side_question') {
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          const { question } = message.request
          void (async () => {
            try {
              const saved = getLastCacheSafeParams()
              const cacheSafeParams = saved
                ? {
                    ...saved,
                    
                    
                    
                    
                    
                    
                    toolUseContext: {
                      ...saved.toolUseContext,
                      abortController: createAbortController(),
                    },
                  }
                : await buildSideQuestionFallbackParams({
                    tools: buildAllTools(getAppState()),
                    commands: currentCommands,
                    mcpClients: [
                      ...getAppState().mcp.clients,
                      ...sdkClients,
                      ...dynamicMcpState.clients,
                    ],
                    messages: mutableMessages,
                    readFileState,
                    getAppState,
                    setAppState,
                    customSystemPrompt: options.systemPrompt,
                    appendSystemPrompt: options.appendSystemPrompt,
                    thinkingConfig: options.thinkingConfig,
                    agents: currentAgents,
                  })
              const result = await runSideQuestion({
                question,
                cacheSafeParams,
              })
              sendControlResponseSuccess(message, { response: result.response })
            } catch (e) {
              sendControlResponseError(message, errorMessage(e))
            }
          })()
        } else if (
          (feature('PROACTIVE') || feature('KAIROS')) &&
          (message.request as { subtype: string }).subtype === 'set_proactive'
        ) {
          const req = message.request as unknown as {
            subtype: string
            enabled: boolean
          }
          if (req.enabled) {
            if (!proactiveModule!.isProactiveActive()) {
              proactiveModule!.activateProactive('command')
              scheduleProactiveTick!()
            }
          } else {
            proactiveModule!.deactivateProactive()
          }
          sendControlResponseSuccess(message)
        } else if (message.request.subtype === 'remote_control') {
          if (message.request.enabled) {
            if (bridgeHandle) {
              
              sendControlResponseSuccess(message, {
                session_url: getRemoteSessionUrl(
                  bridgeHandle.bridgeSessionId,
                  bridgeHandle.sessionIngressUrl,
                ),
                connect_url: buildBridgeConnectUrl(
                  bridgeHandle.environmentId,
                  bridgeHandle.sessionIngressUrl,
                ),
                environment_id: bridgeHandle.environmentId,
              })
            } else {
              
              
              
              
              
              let bridgeFailureDetail: string | undefined
              try {
                const { initReplBridge } = await import(
                  'src/bridge/initReplBridge.js'
                )
                const handle = await initReplBridge({
                  onInboundMessage(msg) {
                    const fields = extractInboundMessageFields(msg)
                    if (!fields) return
                    const { content, uuid } = fields
                    enqueue({
                      value: content,
                      mode: 'prompt' as const,
                      uuid,
                      skipSlashCommands: true,
                    })
                    void run()
                  },
                  onPermissionResponse(response) {
                    
                    
                    
                    structuredIO.injectControlResponse(response)
                  },
                  onInterrupt() {
                    abortController?.abort()
                  },
                  onSetModel(model) {
                    const resolved =
                      model === 'default' ? getDefaultMainLoopModel() : model
                    activeUserSpecifiedModel = resolved
                    setMainLoopModelOverride(resolved)
                  },
                  onSetMaxThinkingTokens(maxTokens) {
                    if (maxTokens === null) {
                      options.thinkingConfig = undefined
                    } else if (maxTokens === 0) {
                      options.thinkingConfig = { type: 'disabled' }
                    } else {
                      options.thinkingConfig = {
                        type: 'enabled',
                        budgetTokens: maxTokens,
                      }
                    }
                  },
                  onStateChange(state, detail) {
                    if (state === 'failed') {
                      bridgeFailureDetail = detail
                    }
                    logForDebugging(
                      `[bridge:sdk] State change: ${state}${detail ? ` — ${detail}` : ''}`,
                    )
                    output.enqueue({
                      type: 'system' as StdoutMessage['type'],
                      subtype: 'bridge_state' as string,
                      state,
                      detail,
                      uuid: randomUUID(),
                      session_id: getSessionId(),
                    } as StdoutMessage)
                  },
                  initialMessages:
                    mutableMessages.length > 0 ? mutableMessages : undefined,
                })
                if (!handle) {
                  sendControlResponseError(
                    message,
                    bridgeFailureDetail ??
                      'Remote Control initialization failed',
                  )
                } else {
                  bridgeHandle = handle
                  bridgeLastForwardedIndex = mutableMessages.length
                  
                  structuredIO.setOnControlRequestSent(request => {
                    handle.sendControlRequest(request)
                  })
                  
                  
                  structuredIO.setOnControlRequestResolved(requestId => {
                    handle.sendControlCancelRequest(requestId)
                  })
                  sendControlResponseSuccess(message, {
                    session_url: getRemoteSessionUrl(
                      handle.bridgeSessionId,
                      handle.sessionIngressUrl,
                    ),
                    connect_url: buildBridgeConnectUrl(
                      handle.environmentId,
                      handle.sessionIngressUrl,
                    ),
                    environment_id: handle.environmentId,
                  })
                }
              } catch (err) {
                sendControlResponseError(message, errorMessage(err))
              }
            }
          } else {
            
            if (bridgeHandle) {
              structuredIO.setOnControlRequestSent(undefined)
              structuredIO.setOnControlRequestResolved(undefined)
              await bridgeHandle.teardown()
              bridgeHandle = null
            }
            sendControlResponseSuccess(message)
          }
        } else {
          
          
          sendControlResponseError(
            message,
            `Unsupported control request subtype: ${(message.request as { subtype: string }).subtype}`,
          )
        }
        continue
      } else if (message.type === 'control_response') {
        
        if (options.replayUserMessages) {
          output.enqueue(message)
        }
        continue
      } else if (message.type === 'keep_alive') {
        
        continue
      } else if (message.type === 'update_environment_variables') {
        
        continue
      } else if (message.type === 'assistant' || message.type === 'system') {
        
        
        const internalMsgs = toInternalMessages([message])
        mutableMessages.push(...internalMsgs)
        
        if (message.type === 'assistant' && options.replayUserMessages) {
          output.enqueue(message)
        }
        continue
      }
      
      
      if (message.type !== 'user') {
        continue
      }

      
      initialized = true

      
      if (message.uuid) {
        const sessionId = getSessionId() as UUID
        const existsInSession = await doesMessageExistInSession(
          sessionId,
          message.uuid,
        )

        
        if (existsInSession || receivedMessageUuids.has(message.uuid)) {
          logForDebugging(`Skipping duplicate user message: ${message.uuid}`)
          
          if (options.replayUserMessages) {
            logForDebugging(
              `Sending acknowledgment for duplicate user message: ${message.uuid}`,
            )
            output.enqueue({
              type: 'user',
              message: message.message,
              session_id: sessionId,
              parent_tool_use_id: null,
              uuid: message.uuid,
              timestamp: message.timestamp,
              isReplay: true,
            } as SDKUserMessageReplay)
          }
          
          
          
          if (existsInSession) {
            notifyCommandLifecycle(message.uuid, 'completed')
          }
          
          continue
        }

        
        trackReceivedMessageUuid(message.uuid)
      }

      enqueue({
        mode: 'prompt' as const,
        
        
        value: await resolveAndPrepend(message, message.message.content),
        uuid: message.uuid,
        priority: message.priority,
      })
      
      
      if (feature('COMMIT_ATTRIBUTION')) {
        setAppState(prev => ({
          ...prev,
          attribution: incrementPromptCount(prev.attribution, snapshot => {
            void recordAttributionSnapshot(snapshot).catch(error => {
              logForDebugging(`Attribution: Failed to save snapshot: ${error}`)
            })
          }),
        }))
      }
      void run()
    }
    inputClosed = true
    cronScheduler?.stop()
    if (!running) {
      
      
      if (suggestionState.inflightPromise) {
        await Promise.race([suggestionState.inflightPromise, sleep(5000)])
      }
      suggestionState.abortController?.abort()
      suggestionState.abortController = null
      await finalizePendingAsyncHooks()
      unsubscribeSkillChanges()
      unsubscribeAuthStatus?.()
      statusListeners.delete(rateLimitListener)
      output.done()
    }
  })()

  return output
}

export function createCanUseToolWithPermissionPrompt(
  permissionPromptTool: PermissionPromptTool,
): CanUseToolFn {
  const canUseTool: CanUseToolFn = async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseId,
    forceDecision,
  ) => {
    const mainPermissionResult =
      forceDecision ??
      (await hasPermissionsToUseTool(
        tool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseId,
      ))

    
    if (
      mainPermissionResult.behavior === 'allow' ||
      mainPermissionResult.behavior === 'deny'
    ) {
      return mainPermissionResult
    }

    
    
    
    
    
    
    
    
    
    
    const { signal: combinedSignal, cleanup: cleanupAbortListener } =
      createCombinedAbortSignal(toolUseContext.abortController.signal)

    
    if (combinedSignal.aborted) {
      cleanupAbortListener()
      return {
        behavior: 'deny',
        message: 'Permission prompt was aborted.',
        decisionReason: {
          type: 'permissionPromptTool' as const,
          permissionPromptToolName: tool.name,
          toolResult: undefined,
        },
      }
    }

    const abortPromise = new Promise<'aborted'>(resolve => {
      combinedSignal.addEventListener('abort', () => resolve('aborted'), {
        once: true,
      })
    })

    const toolCallPromise = permissionPromptTool.call(
      {
        tool_name: tool.name,
        input,
        tool_use_id: toolUseId,
      },
      toolUseContext,
      canUseTool,
      assistantMessage,
    )

    const raceResult = await Promise.race([toolCallPromise, abortPromise])
    cleanupAbortListener()

    if (raceResult === 'aborted' || combinedSignal.aborted) {
      return {
        behavior: 'deny',
        message: 'Permission prompt was aborted.',
        decisionReason: {
          type: 'permissionPromptTool' as const,
          permissionPromptToolName: tool.name,
          toolResult: undefined,
        },
      }
    }

    
    const result = raceResult as Awaited<typeof toolCallPromise>

    const permissionToolResultBlockParam =
      permissionPromptTool.mapToolResultToToolResultBlockParam(result.data, '1')
    if (
      !permissionToolResultBlockParam.content ||
      !Array.isArray(permissionToolResultBlockParam.content) ||
      !permissionToolResultBlockParam.content[0] ||
      permissionToolResultBlockParam.content[0].type !== 'text' ||
      typeof permissionToolResultBlockParam.content[0].text !== 'string'
    ) {
      throw new Error(
        'Permission prompt tool returned an invalid result. Expected a single text block param with type="text" and a string text value.',
      )
    }
    return permissionPromptToolResultToPermissionDecision(
      permissionToolOutputSchema().parse(
        safeParseJSON(permissionToolResultBlockParam.content[0].text),
      ),
      permissionPromptTool,
      input,
      toolUseContext,
    )
  }
  return canUseTool
}

export function getCanUseToolFn(
  permissionPromptToolName: string | undefined,
  structuredIO: StructuredIO,
  getMcpTools: () => Tool[],
  onPermissionPrompt?: (details: RequiresActionDetails) => void,
): CanUseToolFn {
  if (permissionPromptToolName === 'stdio') {
    return structuredIO.createCanUseTool(onPermissionPrompt)
  }
  if (!permissionPromptToolName) {
    return async (
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseId,
      forceDecision,
    ) =>
      forceDecision ??
      (await hasPermissionsToUseTool(
        tool,
        input,
        toolUseContext,
        assistantMessage,
        toolUseId,
      ))
  }
  
  
  
  let resolved: CanUseToolFn | null = null
  return async (
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseId,
    forceDecision,
  ) => {
    if (!resolved) {
      const mcpTools = getMcpTools()
      const permissionPromptTool = mcpTools.find(t =>
        toolMatchesName(t, permissionPromptToolName),
      ) as PermissionPromptTool | undefined
      if (!permissionPromptTool) {
        const error = `Error: MCP tool ${permissionPromptToolName} (passed via --permission-prompt-tool) not found. Available MCP tools: ${mcpTools.map(t => t.name).join(', ') || 'none'}`
        process.stderr.write(`${error}\n`)
        gracefulShutdownSync(1)
        throw new Error(error)
      }
      if (!permissionPromptTool.inputJSONSchema) {
        const error = `Error: tool ${permissionPromptToolName} (passed via --permission-prompt-tool) must be an MCP tool`
        process.stderr.write(`${error}\n`)
        gracefulShutdownSync(1)
        throw new Error(error)
      }
      resolved = createCanUseToolWithPermissionPrompt(permissionPromptTool)
    }
    return resolved(
      tool,
      input,
      toolUseContext,
      assistantMessage,
      toolUseId,
      forceDecision,
    )
  }
}

async function handleInitializeRequest(
  request: SDKControlInitializeRequest,
  requestId: string,
  initialized: boolean,
  output: Stream<StdoutMessage>,
  commands: Command[],
  modelInfos: ModelInfo[],
  structuredIO: StructuredIO,
  enableAuthStatus: boolean,
  options: {
    systemPrompt: string | undefined
    appendSystemPrompt: string | undefined
    agent?: string | undefined
    userSpecifiedModel?: string | undefined
    [key: string]: unknown
  },
  agents: AgentDefinition[],
  getAppState: () => AppState,
): Promise<void> {
  if (initialized) {
    output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'error',
        error: 'Already initialized',
        request_id: requestId,
        pending_permission_requests:
          structuredIO.getPendingPermissionRequests(),
      },
    })
    return
  }

  
  if (request.systemPrompt !== undefined) {
    options.systemPrompt = request.systemPrompt
  }
  if (request.appendSystemPrompt !== undefined) {
    options.appendSystemPrompt = request.appendSystemPrompt
  }
  if (request.promptSuggestions !== undefined) {
    options.promptSuggestions = request.promptSuggestions
  }

  
  if (request.agents) {
    const stdinAgents = parseAgentsFromJson(request.agents, 'flagSettings')
    agents.push(...stdinAgents)
  }

  
  
  if (options.agent) {
    
    
    const alreadyResolved = getMainThreadAgentType() === options.agent
    const mainThreadAgent = agents.find(a => a.agentType === options.agent)
    if (mainThreadAgent && !alreadyResolved) {
      
      setMainThreadAgentType(mainThreadAgent.agentType)

      
      
      if (!options.systemPrompt && !isBuiltInAgent(mainThreadAgent)) {
        const agentSystemPrompt = mainThreadAgent.getSystemPrompt()
        if (agentSystemPrompt) {
          options.systemPrompt = agentSystemPrompt
        }
      }

      
      if (
        !options.userSpecifiedModel &&
        mainThreadAgent.model &&
        mainThreadAgent.model !== 'inherit'
      ) {
        const agentModel = parseUserSpecifiedModel(mainThreadAgent.model)
        setMainLoopModelOverride(agentModel)
      }

      
      if (mainThreadAgent.initialPrompt) {
        structuredIO.prependUserMessage(mainThreadAgent.initialPrompt)
      }
    } else if (mainThreadAgent?.initialPrompt) {
      
      
      
      
      structuredIO.prependUserMessage(mainThreadAgent.initialPrompt)
    }
  }

  const settings = getSettings_DEPRECATED()
  const outputStyle = settings?.outputStyle || DEFAULT_OUTPUT_STYLE_NAME
  const availableOutputStyles = await getAllOutputStyles(getCwd())

  
  const accountInfo = getAccountInformation()
  if (request.hooks) {
    const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {}
    for (const [event, matchers] of Object.entries(request.hooks)) {
      hooks[event as HookEvent] = matchers.map(matcher => {
        const callbacks = matcher.hookCallbackIds.map(callbackId => {
          return structuredIO.createHookCallback(callbackId, matcher.timeout)
        })
        return {
          matcher: matcher.matcher,
          hooks: callbacks,
        }
      })
    }
    registerHookCallbacks(hooks)
  }
  if (request.jsonSchema) {
    setInitJsonSchema(request.jsonSchema)
  }
  const initResponse: SDKControlInitializeResponse = {
    commands: commands
      .filter(cmd => cmd.userInvocable !== false)
      .map(cmd => ({
        name: getCommandName(cmd),
        description: formatDescriptionWithSource(cmd),
        argumentHint: cmd.argumentHint || '',
      })),
    agents: agents.map(agent => ({
      name: agent.agentType,
      description: agent.whenToUse,
      
      model: agent.model === 'inherit' ? undefined : agent.model,
    })),
    output_style: outputStyle,
    available_output_styles: Object.keys(availableOutputStyles),
    models: modelInfos,
    account: {
      email: accountInfo?.email,
      organization: accountInfo?.organization,
      subscriptionType: accountInfo?.subscription,
      tokenSource: accountInfo?.tokenSource,
      apiKeySource: accountInfo?.apiKeySource,
      
      
      
      apiProvider: getAPIProvider(),
    },
    pid: process.pid,
  }

  if (isFastModeEnabled() && isFastModeAvailable()) {
    const appState = getAppState()
    initResponse.fast_mode_state = getFastModeState(
      options.userSpecifiedModel ?? null,
      appState.fastMode,
    )
  }

  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: initResponse,
    },
  })

  
  
  
  if (enableAuthStatus) {
    const authStatusManager = AwsAuthStatusManager.getInstance()
    const status = authStatusManager.getStatus()
    if (status) {
      output.enqueue({
        type: 'auth_status',
        isAuthenticating: status.isAuthenticating,
        output: status.output,
        error: status.error,
        uuid: randomUUID(),
        session_id: getSessionId(),
      })
    }
  }
}

async function handleRewindFiles(
  userMessageId: UUID,
  appState: AppState,
  setAppState: (updater: (prev: AppState) => AppState) => void,
  dryRun: boolean,
): Promise<RewindFilesResult> {
  if (!fileHistoryEnabled()) {
    return { canRewind: false, error: 'File rewinding is not enabled.' }
  }
  if (!fileHistoryCanRestore(appState.fileHistory, userMessageId)) {
    return {
      canRewind: false,
      error: 'No file checkpoint found for this message.',
    }
  }

  if (dryRun) {
    const diffStats = await fileHistoryGetDiffStats(
      appState.fileHistory,
      userMessageId,
    )
    return {
      canRewind: true,
      filesChanged: diffStats?.filesChanged,
      insertions: diffStats?.insertions,
      deletions: diffStats?.deletions,
    }
  }

  try {
    await fileHistoryRewind(
      updater =>
        setAppState(prev => ({
          ...prev,
          fileHistory: updater(prev.fileHistory),
        })),
      userMessageId,
    )
  } catch (error) {
    return {
      canRewind: false,
      error: `Failed to rewind: ${errorMessage(error)}`,
    }
  }

  return { canRewind: true }
}

function handleSetPermissionMode(
  request: { mode: InternalPermissionMode },
  requestId: string,
  toolPermissionContext: ToolPermissionContext,
  output: Stream<StdoutMessage>,
): ToolPermissionContext {
  
  if (request.mode === 'bypassPermissions') {
    if (isBypassPermissionsModeDisabled()) {
      output.enqueue({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: requestId,
          error:
            'Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration',
        },
      })
      return toolPermissionContext
    }
    if (!toolPermissionContext.isBypassPermissionsModeAvailable) {
      output.enqueue({
        type: 'control_response',
        response: {
          subtype: 'error',
          request_id: requestId,
          error:
            'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions',
        },
      })
      return toolPermissionContext
    }
  }

  
  if (
    feature('TRANSCRIPT_CLASSIFIER') &&
    request.mode === 'auto' &&
    !isAutoModeGateEnabled()
  ) {
    const reason = getAutoModeUnavailableReason()
    output.enqueue({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: reason
          ? `Cannot set permission mode to auto: ${getAutoModeUnavailableNotification(reason)}`
          : 'Cannot set permission mode to auto',
      },
    })
    return toolPermissionContext
  }

  
  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        mode: request.mode,
      },
    },
  })

  return {
    ...transitionPermissionMode(
      toolPermissionContext.mode,
      request.mode,
      toolPermissionContext,
    ),
    mode: request.mode,
  }
}

function handleChannelEnable(
  requestId: string,
  serverName: string,
  connectionPool: readonly MCPServerConnection[],
  output: Stream<StdoutMessage>,
): void {
  const respondError = (error: string) =>
    output.enqueue({
      type: 'control_response',
      response: { subtype: 'error', request_id: requestId, error },
    })

  if (!(feature('KAIROS') || feature('KAIROS_CHANNELS'))) {
    return respondError('channels feature not available in this build')
  }

  
  
  const connection = connectionPool.find(
    c => c.name === serverName && c.type === 'connected',
  )
  if (!connection || connection.type !== 'connected') {
    return respondError(`server ${serverName} is not connected`)
  }

  const pluginSource = connection.config.pluginSource
  const parsed = pluginSource ? parsePluginIdentifier(pluginSource) : undefined
  if (!parsed?.marketplace) {
    
    
    
    return respondError(
      `server ${serverName} is not plugin-sourced; channel_enable requires a marketplace plugin`,
    )
  }

  const entry: ChannelEntry = {
    kind: 'plugin',
    name: parsed.name,
    marketplace: parsed.marketplace,
  }
  
  const prior = getAllowedChannels()
  const already = prior.some(
    e =>
      e.kind === 'plugin' &&
      e.name === entry.name &&
      e.marketplace === entry.marketplace,
  )
  if (!already) setAllowedChannels([...prior, entry])

  const gate = gateChannelServer(
    serverName,
    connection.capabilities,
    pluginSource,
  )
  if (gate.action === 'skip') {
    
    if (!already) setAllowedChannels(prior)
    return respondError(gate.reason)
  }

  const pluginId =
    `${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  logMCPDebug(serverName, 'Channel notifications registered')
  logEvent('tengu_mcp_channel_enable', { plugin: pluginId })

  
  
  
  
  connection.client.setNotificationHandler(
    ChannelMessageNotificationSchema(),
    async notification => {
      const { content, meta } = notification.params
      logMCPDebug(
        serverName,
        `notifications/claude/channel: ${content.slice(0, 80)}`,
      )
      logEvent('tengu_mcp_channel_message', {
        content_length: content.length,
        meta_key_count: Object.keys(meta ?? {}).length,
        entry_kind:
          'plugin' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        is_dev: false,
        plugin: pluginId,
      })
      enqueue({
        mode: 'prompt',
        value: wrapChannelMessage(serverName, content, meta),
        priority: 'next',
        isMeta: true,
        origin: { kind: 'channel', server: serverName },
        skipSlashCommands: true,
      })
    },
  )

  output.enqueue({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: undefined,
    },
  })
}

function reregisterChannelHandlerAfterReconnect(
  connection: MCPServerConnection,
): void {
  if (!(feature('KAIROS') || feature('KAIROS_CHANNELS'))) return
  if (connection.type !== 'connected') return

  const gate = gateChannelServer(
    connection.name,
    connection.capabilities,
    connection.config.pluginSource,
  )
  if (gate.action !== 'register') return

  const entry = findChannelEntry(connection.name, getAllowedChannels())
  const pluginId =
    entry?.kind === 'plugin'
      ? (`${entry.name}@${entry.marketplace}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS)
      : undefined

  logMCPDebug(
    connection.name,
    'Channel notifications re-registered after reconnect',
  )
  connection.client.setNotificationHandler(
    ChannelMessageNotificationSchema(),
    async notification => {
      const { content, meta } = notification.params
      logMCPDebug(
        connection.name,
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
        value: wrapChannelMessage(connection.name, content, meta),
        priority: 'next',
        isMeta: true,
        origin: { kind: 'channel', server: connection.name },
        skipSlashCommands: true,
      })
    },
  )
}

function emitLoadError(
  message: string,
  outputFormat: string | undefined,
): void {
  if (outputFormat === 'stream-json') {
    const errorResult = {
      type: 'result',
      subtype: 'error_during_execution',
      duration_ms: 0,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 0,
      stop_reason: null,
      session_id: getSessionId(),
      total_cost_usd: 0,
      usage: EMPTY_USAGE,
      modelUsage: {},
      permission_denials: [],
      uuid: randomUUID(),
      errors: [message],
    }
    process.stdout.write(jsonStringify(errorResult) + '\n')
  } else {
    process.stderr.write(message + '\n')
  }
}

export function removeInterruptedMessage(
  messages: Message[],
  interruptedUserMessage: NormalizedUserMessage,
): void {
  const idx = messages.findIndex(m => m.uuid === interruptedUserMessage.uuid)
  if (idx !== -1) {
    
    
    messages.splice(idx, 2)
  }
}

type LoadInitialMessagesResult = {
  messages: Message[]
  turnInterruptionState?: TurnInterruptionState
  agentSetting?: string
}

async function loadInitialMessages(
  setAppState: (f: (prev: AppState) => AppState) => void,
  options: {
    continue: boolean | undefined
    teleport: string | true | null | undefined
    resume: string | boolean | undefined
    resumeSessionAt: string | undefined
    forkSession: boolean | undefined
    outputFormat: string | undefined
    sessionStartHooksPromise?: ReturnType<typeof processSessionStartHooks>
    restoredWorkerState: Promise<SessionExternalMetadata | null>
  },
): Promise<LoadInitialMessagesResult> {
  const persistSession = !isSessionPersistenceDisabled()
  
  if (options.continue) {
    try {
      logEvent('tengu_continue_print', {})

      const result = await loadConversationForResume(
        undefined ,
        undefined ,
      )
      if (result) {
        
        if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
          const warning = coordinatorModeModule.matchSessionMode(result.mode)
          if (warning) {
            process.stderr.write(warning + '\n')
            
            const {
              getAgentDefinitionsWithOverrides,
              getActiveAgentsFromList,
            } =
              
              require('../tools/AgentTool/loadAgentsDir.js') as typeof import('../tools/AgentTool/loadAgentsDir.js')
            getAgentDefinitionsWithOverrides.cache.clear?.()
            const freshAgentDefs = await getAgentDefinitionsWithOverrides(
              getCwd(),
            )

            setAppState(prev => ({
              ...prev,
              agentDefinitions: {
                ...freshAgentDefs,
                allAgents: freshAgentDefs.allAgents,
                activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
              },
            }))
          }
        }

        
        if (!options.forkSession) {
          if (result.sessionId) {
            switchSession(
              asSessionId(result.sessionId),
              result.fullPath ? dirname(result.fullPath) : null,
            )
            if (persistSession) {
              await resetSessionFilePointer()
            }
          }
        }
        restoreSessionStateFromLog(result, setAppState)

        
        restoreSessionMetadata(
          options.forkSession
            ? { ...result, worktreeSession: undefined }
            : result,
        )

        
        if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
          saveMode(
            coordinatorModeModule.isCoordinatorMode()
              ? 'coordinator'
              : 'normal',
          )
        }

        return {
          messages: result.messages,
          turnInterruptionState: result.turnInterruptionState,
          agentSetting: result.agentSetting,
        }
      }
    } catch (error) {
      logError(error)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  
  if (options.teleport) {
    try {
      if (!isPolicyAllowed('allow_remote_sessions')) {
        throw new Error(
          "Remote sessions are disabled by your organization's policy.",
        )
      }

      logEvent('tengu_teleport_print', {})

      if (typeof options.teleport !== 'string') {
        throw new Error('No session ID provided for teleport')
      }

      const {
        checkOutTeleportedSessionBranch,
        processMessagesForTeleportResume,
        teleportResumeCodeSession,
        validateGitState,
      } = await import('src/utils/teleport.js')
      await validateGitState()
      const teleportResult = await teleportResumeCodeSession(options.teleport)
      const { branchError } = await checkOutTeleportedSessionBranch(
        teleportResult.branch,
      )
      return {
        messages: processMessagesForTeleportResume(
          teleportResult.log,
          branchError,
        ),
      }
    } catch (error) {
      logError(error)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  
  
  if (options.resume) {
    try {
      logEvent('tengu_resume_print', {})

      
      const parsedSessionId = parseSessionIdentifier(
        typeof options.resume === 'string' ? options.resume : '',
      )
      if (!parsedSessionId) {
        let errorMessage =
          'Error: --resume requires a valid session ID when used with --print. Usage: claude -p --resume <session-id>'
        if (typeof options.resume === 'string') {
          errorMessage += `. Session IDs must be in UUID format (e.g., 550e8400-e29b-41d4-a716-446655440000). Provided value "${options.resume}" is not a valid UUID`
        }
        emitLoadError(errorMessage, options.outputFormat)
        gracefulShutdownSync(1)
        return { messages: [] }
      }

      
      if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_CCR_V2)) {
        
        
        const [, metadata] = await Promise.all([
          hydrateFromCCRv2InternalEvents(parsedSessionId.sessionId),
          options.restoredWorkerState,
        ])
        if (metadata) {
          setAppState(externalMetadataToAppState(metadata))
          if (typeof metadata.model === 'string') {
            setMainLoopModelOverride(metadata.model)
          }
        }
      } else if (
        parsedSessionId.isUrl &&
        parsedSessionId.ingressUrl &&
        isEnvTruthy(process.env.ENABLE_SESSION_PERSISTENCE)
      ) {
        
        await hydrateRemoteSession(
          parsedSessionId.sessionId,
          parsedSessionId.ingressUrl,
        )
      }

      
      const result = await loadConversationForResume(
        parsedSessionId.sessionId,
        parsedSessionId.jsonlFile || undefined,
      )

      
      
      
      
      if (!result || result.messages.length === 0) {
        
        if (
          parsedSessionId.isUrl ||
          isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_CCR_V2)
        ) {
          
          return {
            messages: await (options.sessionStartHooksPromise ??
              processSessionStartHooks('startup')),
          }
        } else {
          emitLoadError(
            `No conversation found with session ID: ${parsedSessionId.sessionId}`,
            options.outputFormat,
          )
          gracefulShutdownSync(1)
          return { messages: [] }
        }
      }

      
      if (options.resumeSessionAt) {
        const index = result.messages.findIndex(
          m => m.uuid === options.resumeSessionAt,
        )
        if (index < 0) {
          emitLoadError(
            `No message found with message.uuid of: ${options.resumeSessionAt}`,
            options.outputFormat,
          )
          gracefulShutdownSync(1)
          return { messages: [] }
        }

        result.messages = index >= 0 ? result.messages.slice(0, index + 1) : []
      }

      
      if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
        const warning = coordinatorModeModule.matchSessionMode(result.mode)
        if (warning) {
          process.stderr.write(warning + '\n')
          
          const { getAgentDefinitionsWithOverrides, getActiveAgentsFromList } =
            
            require('../tools/AgentTool/loadAgentsDir.js') as typeof import('../tools/AgentTool/loadAgentsDir.js')
          getAgentDefinitionsWithOverrides.cache.clear?.()
          const freshAgentDefs = await getAgentDefinitionsWithOverrides(
            getCwd(),
          )

          setAppState(prev => ({
            ...prev,
            agentDefinitions: {
              ...freshAgentDefs,
              allAgents: freshAgentDefs.allAgents,
              activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents),
            },
          }))
        }
      }

      
      if (!options.forkSession && result.sessionId) {
        switchSession(
          asSessionId(result.sessionId),
          result.fullPath ? dirname(result.fullPath) : null,
        )
        if (persistSession) {
          await resetSessionFilePointer()
        }
      }
      restoreSessionStateFromLog(result, setAppState)

      
      restoreSessionMetadata(
        options.forkSession
          ? { ...result, worktreeSession: undefined }
          : result,
      )

      
      if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
        saveMode(
          coordinatorModeModule.isCoordinatorMode() ? 'coordinator' : 'normal',
        )
      }

      return {
        messages: result.messages,
        turnInterruptionState: result.turnInterruptionState,
        agentSetting: result.agentSetting,
      }
    } catch (error) {
      logError(error)
      const errorMessage =
        error instanceof Error
          ? `Failed to resume session: ${error.message}`
          : 'Failed to resume session with --print mode'
      emitLoadError(errorMessage, options.outputFormat)
      gracefulShutdownSync(1)
      return { messages: [] }
    }
  }

  
  
  
  return {
    messages: await (options.sessionStartHooksPromise ??
      processSessionStartHooks('startup')),
  }
}

function getStructuredIO(
  inputPrompt: string | AsyncIterable<string>,
  options: {
    sdkUrl: string | undefined
    replayUserMessages?: boolean
  },
): StructuredIO {
  let inputStream: AsyncIterable<string>
  if (typeof inputPrompt === 'string') {
    if (inputPrompt.trim() !== '') {
      
      inputStream = fromArray([
        jsonStringify({
          type: 'user',
          session_id: '',
          message: {
            role: 'user',
            content: inputPrompt,
          },
          parent_tool_use_id: null,
        } satisfies SDKUserMessage),
      ])
    } else {
      
      inputStream = fromArray([])
    }
  } else {
    inputStream = inputPrompt
  }

  
  return options.sdkUrl
    ? new RemoteIO(options.sdkUrl, inputStream, options.replayUserMessages)
    : new StructuredIO(inputStream, options.replayUserMessages)
}

export async function handleOrphanedPermissionResponse({
  message,
  setAppState,
  onEnqueued,
  handledToolUseIds,
}: {
  message: SDKControlResponse
  setAppState: (f: (prev: AppState) => AppState) => void
  onEnqueued?: () => void
  handledToolUseIds: Set<string>
}): Promise<boolean> {
  if (
    message.response.subtype === 'success' &&
    message.response.response?.toolUseID &&
    typeof message.response.response.toolUseID === 'string'
  ) {
    const permissionResult = message.response.response as PermissionResult
    const { toolUseID } = permissionResult
    if (!toolUseID) {
      return false
    }

    logForDebugging(
      `handleOrphanedPermissionResponse: received orphaned control_response for toolUseID=${toolUseID} request_id=${message.response.request_id}`,
    )

    
    
    
    
    
    if (handledToolUseIds.has(toolUseID)) {
      logForDebugging(
        `handleOrphanedPermissionResponse: skipping duplicate orphaned permission for toolUseID=${toolUseID} (already handled)`,
      )
      return false
    }

    const assistantMessage = await findUnresolvedToolUse(toolUseID)
    if (!assistantMessage) {
      logForDebugging(
        `handleOrphanedPermissionResponse: no unresolved tool_use found for toolUseID=${toolUseID} (already resolved in transcript)`,
      )
      return false
    }

    handledToolUseIds.add(toolUseID)
    logForDebugging(
      `handleOrphanedPermissionResponse: enqueuing orphaned permission for toolUseID=${toolUseID} messageID=${assistantMessage.message.id}`,
    )
    enqueue({
      mode: 'orphaned-permission' as const,
      value: [],
      orphanedPermission: {
        permissionResult,
        assistantMessage,
      },
    })

    onEnqueued?.()
    return true
  }
  return false
}

export type DynamicMcpState = {
  clients: MCPServerConnection[]
  tools: Tools
  configs: Record<string, ScopedMcpServerConfig>
}

function toScopedConfig(
  config: McpServerConfigForProcessTransport,
): ScopedMcpServerConfig {
  
  
  
  return { ...config, scope: 'dynamic' } as ScopedMcpServerConfig
}

export type SdkMcpState = {
  configs: Record<string, McpSdkServerConfig>
  clients: MCPServerConnection[]
  tools: Tools
}

export type McpSetServersResult = {
  response: SDKControlMcpSetServersResponse
  newSdkState: SdkMcpState
  newDynamicState: DynamicMcpState
  sdkServersChanged: boolean
}

export async function handleMcpSetServers(
  servers: Record<string, McpServerConfigForProcessTransport>,
  sdkState: SdkMcpState,
  dynamicState: DynamicMcpState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<McpSetServersResult> {
  
  
  
  
  
  const { allowed: allowedServers, blocked } = filterMcpServersByPolicy(servers)
  const policyErrors: Record<string, string> = {}
  for (const name of blocked) {
    policyErrors[name] =
      'Blocked by enterprise policy (allowedMcpServers/deniedMcpServers)'
  }

  
  const sdkServers: Record<string, McpSdkServerConfig> = {}
  const processServers: Record<string, McpServerConfigForProcessTransport> = {}

  for (const [name, config] of Object.entries(allowedServers)) {
    if (config.type === 'sdk') {
      sdkServers[name] = config
    } else {
      processServers[name] = config
    }
  }

  
  const currentSdkNames = new Set(Object.keys(sdkState.configs))
  const newSdkNames = new Set(Object.keys(sdkServers))
  const sdkAdded: string[] = []
  const sdkRemoved: string[] = []

  const newSdkConfigs = { ...sdkState.configs }
  let newSdkClients = [...sdkState.clients]
  let newSdkTools = [...sdkState.tools]

  
  for (const name of currentSdkNames) {
    if (!newSdkNames.has(name)) {
      const client = newSdkClients.find(c => c.name === name)
      if (client && client.type === 'connected') {
        await client.cleanup()
      }
      newSdkClients = newSdkClients.filter(c => c.name !== name)
      const prefix = `mcp__${name}__`
      newSdkTools = newSdkTools.filter(t => !t.name.startsWith(prefix))
      delete newSdkConfigs[name]
      sdkRemoved.push(name)
    }
  }

  
  
  for (const [name, config] of Object.entries(sdkServers)) {
    if (!currentSdkNames.has(name)) {
      newSdkConfigs[name] = config
      const pendingClient: MCPServerConnection = {
        type: 'pending',
        name,
        config: { ...config, scope: 'dynamic' as const },
      }
      newSdkClients = [...newSdkClients, pendingClient]
      sdkAdded.push(name)
    }
  }

  
  const processResult = await reconcileMcpServers(
    processServers,
    dynamicState,
    setAppState,
  )

  return {
    response: {
      added: [...sdkAdded, ...processResult.response.added],
      removed: [...sdkRemoved, ...processResult.response.removed],
      errors: { ...policyErrors, ...processResult.response.errors },
    },
    newSdkState: {
      configs: newSdkConfigs,
      clients: newSdkClients,
      tools: newSdkTools,
    },
    newDynamicState: processResult.newState,
    sdkServersChanged: sdkAdded.length > 0 || sdkRemoved.length > 0,
  }
}

export async function reconcileMcpServers(
  desiredConfigs: Record<string, McpServerConfigForProcessTransport>,
  currentState: DynamicMcpState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<{
  response: SDKControlMcpSetServersResponse
  newState: DynamicMcpState
}> {
  const currentNames = new Set(Object.keys(currentState.configs))
  const desiredNames = new Set(Object.keys(desiredConfigs))

  const toRemove = [...currentNames].filter(n => !desiredNames.has(n))
  const toAdd = [...desiredNames].filter(n => !currentNames.has(n))

  
  const toCheck = [...currentNames].filter(n => desiredNames.has(n))
  const toReplace = toCheck.filter(name => {
    const currentConfig = currentState.configs[name]
    const desiredConfigRaw = desiredConfigs[name]
    if (!currentConfig || !desiredConfigRaw) return true
    const desiredConfig = toScopedConfig(desiredConfigRaw)
    return !areMcpConfigsEqual(currentConfig, desiredConfig)
  })

  const removed: string[] = []
  const added: string[] = []
  const errors: Record<string, string> = {}

  let newClients = [...currentState.clients]
  let newTools = [...currentState.tools]

  
  for (const name of [...toRemove, ...toReplace]) {
    const client = newClients.find(c => c.name === name)
    const config = currentState.configs[name]
    if (client && config) {
      if (client.type === 'connected') {
        try {
          await client.cleanup()
        } catch (e) {
          logError(e)
        }
      }
      
      await clearServerCache(name, config)
    }

    
    const prefix = `mcp__${name}__`
    newTools = newTools.filter(t => !t.name.startsWith(prefix))

    
    newClients = newClients.filter(c => c.name !== name)

    
    if (toRemove.includes(name)) {
      removed.push(name)
    }
  }

  
  for (const name of [...toAdd, ...toReplace]) {
    const config = desiredConfigs[name]
    if (!config) continue
    const scopedConfig = toScopedConfig(config)

    
    
    if (config.type === 'sdk') {
      added.push(name)
      continue
    }

    try {
      const client = await connectToServer(name, scopedConfig)
      newClients.push(client)

      if (client.type === 'connected') {
        const serverTools = await fetchToolsForClient(client)
        newTools.push(...serverTools)
      } else if (client.type === 'failed') {
        errors[name] = client.error || 'Connection failed'
      }

      added.push(name)
    } catch (e) {
      const err = toError(e)
      errors[name] = err.message
      logError(err)
    }
  }

  
  const newConfigs: Record<string, ScopedMcpServerConfig> = {}
  for (const name of desiredNames) {
    const config = desiredConfigs[name]
    if (config) {
      newConfigs[name] = toScopedConfig(config)
    }
  }

  const newState: DynamicMcpState = {
    clients: newClients,
    tools: newTools,
    configs: newConfigs,
  }

  
  setAppState(prev => {
    
    const allDynamicServerNames = new Set([
      ...Object.keys(currentState.configs),
      ...Object.keys(newConfigs),
    ])

    
    const nonDynamicTools = prev.mcp.tools.filter(t => {
      for (const serverName of allDynamicServerNames) {
        if (t.name.startsWith(`mcp__${serverName}__`)) {
          return false
        }
      }
      return true
    })

    
    const nonDynamicClients = prev.mcp.clients.filter(c => {
      return !allDynamicServerNames.has(c.name)
    })

    return {
      ...prev,
      mcp: {
        ...prev.mcp,
        tools: [...nonDynamicTools, ...newTools],
        clients: [...nonDynamicClients, ...newClients],
      },
    }
  })

  return {
    response: { added, removed, errors },
    newState,
  }
}
