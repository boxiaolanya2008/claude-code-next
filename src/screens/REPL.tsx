import { c as _c } from "react/compiler-runtime";

import { feature } from 'bun:bundle';
import { spawnSync } from 'child_process';
import { snapshotOutputTokensForTurn, getCurrentTurnTokenBudget, getTurnOutputTokens, getBudgetContinuationCount, getTotalInputTokens } from '../bootstrap/state.js';
import { parseTokenBudget } from '../utils/tokenBudget.js';
import { count } from '../utils/array.js';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import figures from 'figures';

import { useInput } from '../ink.js';
import { useSearchInput } from '../hooks/useSearchInput.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useSearchHighlight } from '../ink/hooks/use-search-highlight.js';
import type { JumpHandle } from '../components/VirtualMessageList.js';
import { renderMessagesToPlainText } from '../utils/exportRenderer.js';
import { openFileInExternalEditor } from '../utils/editor.js';
import { writeFile } from 'fs/promises';
import { Box, Text, useStdin, useTheme, useTerminalFocus, useTerminalTitle, useTabStatus } from '../ink.js';
import type { TabStatusKind } from '../ink/hooks/use-tab-status.js';
import { CostThresholdDialog } from '../components/CostThresholdDialog.js';
import { IdleReturnDialog } from '../components/IdleReturnDialog.js';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue, useLayoutEffect, type RefObject } from 'react';
import { useNotifications } from '../context/notifications.js';
import { sendNotification } from '../services/notifier.js';
import { startPreventSleep, stopPreventSleep } from '../services/preventSleep.js';
import { useTerminalNotification } from '../ink/useTerminalNotification.js';
import { hasCursorUpViewportYankBug } from '../ink/terminal.js';
import { createFileStateCacheWithSizeLimit, mergeFileStateCaches, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js';
import { updateLastInteractionTime, getLastInteractionTime, getOriginalCwd, getProjectRoot, getSessionId, switchSession, setCostStateForRestore, getTurnHookDurationMs, getTurnHookCount, resetTurnHookDuration, getTurnToolDurationMs, getTurnToolCount, resetTurnToolDuration, getTurnClassifierDurationMs, getTurnClassifierCount, resetTurnClassifierDuration } from '../bootstrap/state.js';
import { asSessionId, asAgentId } from '../types/ids.js';
import { logForDebugging } from '../utils/debug.js';
import { QueryGuard } from '../utils/QueryGuard.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { formatTokens, truncateToWidth } from '../utils/format.js';
import { consumeEarlyInput } from '../utils/earlyInput.js';
import { setMemberActive } from '../utils/swarm/teamHelpers.js';
import { isSwarmWorker, generateSandboxRequestId, sendSandboxPermissionRequestViaMailbox, sendSandboxPermissionResponseViaMailbox } from '../utils/swarm/permissionSync.js';
import { registerSandboxPermissionCallback } from '../hooks/useSwarmPermissionPoller.js';
import { getTeamName, getAgentName } from '../utils/teammate.js';
import { WorkerPendingPermission } from '../components/permissions/WorkerPendingPermission.js';
import { injectUserMessageToTeammate, getAllInProcessTeammateTasks } from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import { isLocalAgentTask, queuePendingMessage, appendMessageToLocalAgent, type LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js';
import { registerLeaderToolUseConfirmQueue, unregisterLeaderToolUseConfirmQueue, registerLeaderSetToolPermissionContext, unregisterLeaderSetToolPermissionContext } from '../utils/swarm/leaderPermissionBridge.js';
import { endInteractionSpan } from '../utils/telemetry/sessionTracing.js';
import { useLogMessages } from '../hooks/useLogMessages.js';
import { useReplBridge } from '../hooks/useReplBridge.js';
import { type Command, type CommandResultDisplay, type ResumeEntrypoint, getCommandName, isCommandEnabled } from '../commands.js';
import type { PromptInputMode, QueuedCommand, VimMode } from '../types/textInputTypes.js';
import { MessageSelector, selectableUserMessagesFilter, messagesAfterAreOnlySynthetic } from '../components/MessageSelector.js';
import { useIdeLogging } from '../hooks/useIdeLogging.js';
import { PermissionRequest, type ToolUseConfirm } from '../components/permissions/PermissionRequest.js';
import { ElicitationDialog } from '../components/mcp/ElicitationDialog.js';
import { PromptDialog } from '../components/hooks/PromptDialog.js';
import type { PromptRequest, PromptResponse } from '../types/hooks.js';
import PromptInput from '../components/PromptInput/PromptInput.js';
import { PromptInputQueuedCommands } from '../components/PromptInput/PromptInputQueuedCommands.js';
import { useRemoteSession } from '../hooks/useRemoteSession.js';
import { useDirectConnect } from '../hooks/useDirectConnect.js';
import type { DirectConnectConfig } from '../server/directConnectManager.js';
import { useSSHSession } from '../hooks/useSSHSession.js';
import { useAssistantHistory } from '../hooks/useAssistantHistory.js';
import type { SSHSession } from '../ssh/createSSHSession.js';
import { SkillImprovementSurvey } from '../components/SkillImprovementSurvey.js';
import { useSkillImprovementSurvey } from '../hooks/useSkillImprovementSurvey.js';
import { useMoreRight } from '../moreright/useMoreRight.js';
import { SpinnerWithVerb, BriefIdleStatus, type SpinnerMode } from '../components/Spinner.js';
import { getSystemPrompt } from '../constants/prompts.js';
import { buildEffectiveSystemPrompt } from '../utils/systemPrompt.js';
import { getSystemContext, getUserContext } from '../context.js';
import { getMemoryFiles } from '../utils/claudemd.js';
import { startBackgroundHousekeeping } from '../utils/backgroundHousekeeping.js';
import { getTotalCost, saveCurrentSessionCosts, resetCostState, getStoredSessionCosts } from '../cost-tracker.js';
import { useCostSummary } from '../costHook.js';
import { useFpsMetrics } from '../context/fpsMetrics.js';
import { useAfterFirstRender } from '../hooks/useAfterFirstRender.js';
import { useDeferredHookMessages } from '../hooks/useDeferredHookMessages.js';
import { addToHistory, removeLastFromHistory, expandPastedTextRefs, parseReferences } from '../history.js';
import { prependModeCharacterToInput } from '../components/PromptInput/inputModes.js';
import { prependToShellHistoryCache } from '../utils/suggestions/shellHistoryCompletion.js';
import { useApiKeyVerification } from '../hooks/useApiKeyVerification.js';
import { GlobalKeybindingHandlers } from '../hooks/useGlobalKeybindings.js';
import { CommandKeybindingHandlers } from '../hooks/useCommandKeybindings.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';
import { CancelRequestHandler } from '../hooks/useCancelRequest.js';
import { useBackgroundTaskNavigation } from '../hooks/useBackgroundTaskNavigation.js';
import { useSwarmInitialization } from '../hooks/useSwarmInitialization.js';
import { useTeammateViewAutoExit } from '../hooks/useTeammateViewAutoExit.js';
import { errorMessage } from '../utils/errors.js';
import { isHumanTurn } from '../utils/messagePredicates.js';
import { logError } from '../utils/log.js';

const useVoiceIntegration: typeof import('../hooks/useVoiceIntegration.js').useVoiceIntegration = feature('VOICE_MODE') ? require('../hooks/useVoiceIntegration.js').useVoiceIntegration : () => ({
  stripTrailing: () => 0,
  handleKeyEvent: () => {},
  resetAnchor: () => {}
});
const VoiceKeybindingHandler: typeof import('../hooks/useVoiceIntegration.js').VoiceKeybindingHandler = feature('VOICE_MODE') ? require('../hooks/useVoiceIntegration.js').VoiceKeybindingHandler : () => null;

const useFrustrationDetection: typeof import('../components/FeedbackSurvey/useFrustrationDetection.js').useFrustrationDetection = "external" === 'ant' ? require('../components/FeedbackSurvey/useFrustrationDetection.js').useFrustrationDetection : () => ({
  state: 'closed',
  handleTranscriptSelect: () => {}
});

const useAntOrgWarningNotification: typeof import('../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification = "external" === 'ant' ? require('../hooks/notifs/useAntOrgWarningNotification.js').useAntOrgWarningNotification : () => {};

const getCoordinatorUserContext: (mcpClients: ReadonlyArray<{
  name: string;
}>, scratchpadDir?: string) => {
  [k: string]: string;
} = feature('COORDINATOR_MODE') ? require('../coordinator/coordinatorMode.js').getCoordinatorUserContext : () => ({});

import useCanUseTool from '../hooks/useCanUseTool.js';
import type { ToolPermissionContext, Tool } from '../Tool.js';
import { applyPermissionUpdate, applyPermissionUpdates, persistPermissionUpdate } from '../utils/permissions/PermissionUpdate.js';
import { buildPermissionUpdates } from '../components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js';
import { stripDangerousPermissionsForAutoMode } from '../utils/permissions/permissionSetup.js';
import { getScratchpadDir, isScratchpadEnabled } from '../utils/permissions/filesystem.js';
import { WEB_FETCH_TOOL_NAME } from '../tools/WebFetchTool/prompt.js';
import { SLEEP_TOOL_NAME } from '../tools/SleepTool/prompt.js';
import { clearSpeculativeChecks } from '../tools/BashTool/bashPermissions.js';
import type { AutoUpdaterResult } from '../utils/autoUpdater.js';
import { getGlobalConfig, saveGlobalConfig, getGlobalConfigWriteCount } from '../utils/config.js';
import { hasConsoleBillingAccess } from '../utils/billing.js';
import { logEvent, type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { textForResubmit, handleMessageFromStream, type StreamingToolUse, type StreamingThinking, isCompactBoundaryMessage, getMessagesAfterCompactBoundary, getContentText, createUserMessage, createAssistantMessage, createTurnDurationMessage, createAgentsKilledMessage, createApiMetricsMessage, createSystemMessage, createCommandInputMessage, formatCommandInputTags } from '../utils/messages.js';
import { generateSessionTitle } from '../utils/sessionTitle.js';
import { BASH_INPUT_TAG, COMMAND_MESSAGE_TAG, COMMAND_NAME_TAG, LOCAL_COMMAND_STDOUT_TAG } from '../constants/xml.js';
import { escapeXml } from '../utils/xml.js';
import type { ThinkingConfig } from '../utils/thinking.js';
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js';
import { handlePromptSubmit, type PromptInputHelpers } from '../utils/handlePromptSubmit.js';
import { useQueueProcessor } from '../hooks/useQueueProcessor.js';
import { useMailboxBridge } from '../hooks/useMailboxBridge.js';
import { queryCheckpoint, logQueryProfileReport } from '../utils/queryProfiler.js';
import type { Message as MessageType, UserMessage, ProgressMessage, HookResultMessage, PartialCompactDirection } from '../types/message.js';
import { query } from '../query.js';
import { mergeClients, useMergedClients } from '../hooks/useMergedClients.js';
import { getQuerySourceForREPL } from '../utils/promptCategory.js';
import { useMergedTools } from '../hooks/useMergedTools.js';
import { mergeAndFilterTools } from '../utils/toolPool.js';
import { useMergedCommands } from '../hooks/useMergedCommands.js';
import { useSkillsChange } from '../hooks/useSkillsChange.js';
import { useManagePlugins } from '../hooks/useManagePlugins.js';
import { Messages } from '../components/Messages.js';
import { TaskListV2 } from '../components/TaskListV2.js';
import { TeammateViewHeader } from '../components/TeammateViewHeader.js';
import { useTasksV2WithCollapseEffect } from '../hooks/useTasksV2.js';
import { maybeMarkProjectOnboardingComplete } from '../projectOnboardingState.js';
import type { MCPServerConnection } from '../services/mcp/types.js';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { randomUUID, type UUID } from 'crypto';
import { processSessionStartHooks } from '../utils/sessionStart.js';
import { executeSessionEndHooks, getSessionEndHookTimeoutMs } from '../utils/hooks.js';
import { type IDESelection, useIdeSelection } from '../hooks/useIdeSelection.js';
import { getTools, assembleToolPool } from '../tools.js';
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js';
import { resolveAgentTools } from '../tools/AgentTool/agentToolUtils.js';
import { resumeAgentBackground } from '../tools/AgentTool/resumeAgent.js';
import { useMainLoopModel } from '../hooks/useMainLoopModel.js';
import { useAppState, useSetAppState, useAppStateStore } from '../state/AppState.js';
import type { ContentBlockParam, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { ProcessUserInputContext } from '../utils/processUserInput/processUserInput.js';
import type { PastedContent } from '../utils/config.js';
import { copyPlanForFork, copyPlanForResume, getPlanSlug, setPlanSlug } from '../utils/plans.js';
import { clearSessionMetadata, resetSessionFilePointer, adoptResumedSessionFile, removeTranscriptMessage, restoreSessionMetadata, getCurrentSessionTitle, isEphemeralToolProgress, isLoggableMessage, saveWorktreeState, getAgentTranscript } from '../utils/sessionStorage.js';
import { deserializeMessages } from '../utils/conversationRecovery.js';
import { extractReadFilesFromMessages, extractBashToolsFromMessages } from '../utils/queryHelpers.js';
import { resetMicrocompactState } from '../services/compact/microCompact.js';
import { runPostCompactCleanup } from '../services/compact/postCompactCleanup.js';
import { provisionContentReplacementState, reconstructContentReplacementState, type ContentReplacementRecord } from '../utils/toolResultStorage.js';
import { partialCompactConversation } from '../services/compact/compact.js';
import type { LogOption } from '../types/logs.js';
import type { AgentColorName } from '../tools/AgentTool/agentColorManager.js';
import { fileHistoryMakeSnapshot, type FileHistoryState, fileHistoryRewind, type FileHistorySnapshot, copyFileHistoryForResume, fileHistoryEnabled, fileHistoryHasAnyChanges } from '../utils/fileHistory.js';
import { type AttributionState, incrementPromptCount } from '../utils/commitAttribution.js';
import { recordAttributionSnapshot } from '../utils/sessionStorage.js';
import { computeStandaloneAgentContext, restoreAgentFromSession, restoreSessionStateFromLog, restoreWorktreeForResume, exitRestoredWorktree } from '../utils/sessionRestore.js';
import { isBgSession, updateSessionName, updateSessionActivity } from '../utils/concurrentSessions.js';
import { isInProcessTeammateTask, type InProcessTeammateTaskState } from '../tasks/InProcessTeammateTask/types.js';
import { restoreRemoteAgentTasks } from '../tasks/RemoteAgentTask/RemoteAgentTask.js';
import { useInboxPoller } from '../hooks/useInboxPoller.js';

const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../proactive/index.js') : null;
const PROACTIVE_NO_OP_SUBSCRIBE = (_cb: () => void) => () => {};
const PROACTIVE_FALSE = () => false;
const SUGGEST_BG_PR_NOOP = (_p: string, _n: string): boolean => false;
const useProactive = feature('PROACTIVE') || feature('KAIROS') ? require('../proactive/useProactive.js').useProactive : null;
const useScheduledTasks = feature('AGENT_TRIGGERS') ? require('../hooks/useScheduledTasks.js').useScheduledTasks : null;

import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js';
import { useTaskListWatcher } from '../hooks/useTaskListWatcher.js';
import type { SandboxAskCallback, NetworkHostPattern } from '../utils/sandbox/sandbox-adapter.js';
import { type IDEExtensionInstallationStatus, closeOpenDiffs, getConnectedIdeClient, type IdeType } from '../utils/ide.js';
import { useIDEIntegration } from '../hooks/useIDEIntegration.js';
import exit from '../commands/exit/index.js';
import { ExitFlow } from '../components/ExitFlow.js';
import { getCurrentWorktreeSession } from '../utils/worktree.js';
import { popAllEditable, enqueue, type SetAppState, getCommandQueue, getCommandQueueLength, removeByFilter } from '../utils/messageQueueManager.js';
import { useCommandQueue } from '../hooks/useCommandQueue.js';
import { SessionBackgroundHint } from '../components/SessionBackgroundHint.js';
import { startBackgroundSession } from '../tasks/LocalMainSessionTask.js';
import { useSessionBackgrounding } from '../hooks/useSessionBackgrounding.js';
import { diagnosticTracker } from '../services/diagnosticTracking.js';
import { handleSpeculationAccept, type ActiveSpeculationState } from '../services/PromptSuggestion/speculation.js';
import { IdeOnboardingDialog } from '../components/IdeOnboardingDialog.js';
import { EffortCallout, shouldShowEffortCallout } from '../components/EffortCallout.js';
import type { EffortValue } from '../utils/effort.js';
import { RemoteCallout } from '../components/RemoteCallout.js';

const AntModelSwitchCallout = "external" === 'ant' ? require('../components/AntModelSwitchCallout.js').AntModelSwitchCallout : null;
const shouldShowAntModelSwitch = "external" === 'ant' ? require('../components/AntModelSwitchCallout.js').shouldShowModelSwitchCallout : (): boolean => false;
const UndercoverAutoCallout = "external" === 'ant' ? require('../components/UndercoverAutoCallout.js').UndercoverAutoCallout : null;

import { activityManager } from '../utils/activityManager.js';
import { createAbortController } from '../utils/abortController.js';
import { MCPConnectionManager } from 'src/services/mcp/MCPConnectionManager.js';
import { useFeedbackSurvey } from 'src/components/FeedbackSurvey/useFeedbackSurvey.js';
import { useMemorySurvey } from 'src/components/FeedbackSurvey/useMemorySurvey.js';
import { usePostCompactSurvey } from 'src/components/FeedbackSurvey/usePostCompactSurvey.js';
import { FeedbackSurvey } from 'src/components/FeedbackSurvey/FeedbackSurvey.js';
import { useInstallMessages } from 'src/hooks/notifs/useInstallMessages.js';
import { useAwaySummary } from 'src/hooks/useAwaySummary.js';
import { useChromeExtensionNotification } from 'src/hooks/useChromeExtensionNotification.js';
import { useOfficialMarketplaceNotification } from 'src/hooks/useOfficialMarketplaceNotification.js';
import { usePromptsFromClaudeInChrome } from 'src/hooks/usePromptsFromClaudeInChrome.js';
import { getTipToShowOnSpinner, recordShownTip } from 'src/services/tips/tipScheduler.js';
import type { Theme } from 'src/utils/theme.js';
import { checkAndDisableBypassPermissionsIfNeeded, checkAndDisableAutoModeIfNeeded, useKickOffCheckAndDisableBypassPermissionsIfNeeded, useKickOffCheckAndDisableAutoModeIfNeeded } from 'src/utils/permissions/bypassPermissionsKillswitch.js';
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js';
import { SANDBOX_NETWORK_ACCESS_TOOL_NAME } from 'src/cli/structuredIO.js';
import { useFileHistorySnapshotInit } from 'src/hooks/useFileHistorySnapshotInit.js';
import { SandboxPermissionRequest } from 'src/components/permissions/SandboxPermissionRequest.js';
import { SandboxViolationExpandedView } from 'src/components/SandboxViolationExpandedView.js';
import { useSettingsErrors } from 'src/hooks/notifs/useSettingsErrors.js';
import { useMcpConnectivityStatus } from 'src/hooks/notifs/useMcpConnectivityStatus.js';
import { useAutoModeUnavailableNotification } from 'src/hooks/notifs/useAutoModeUnavailableNotification.js';
import { AUTO_MODE_DESCRIPTION } from 'src/components/AutoModeOptInDialog.js';
import { useLspInitializationNotification } from 'src/hooks/notifs/useLspInitializationNotification.js';
import { useLspPluginRecommendation } from 'src/hooks/useLspPluginRecommendation.js';
import { LspRecommendationMenu } from 'src/components/LspRecommendation/LspRecommendationMenu.js';
import { useClaudeCodeHintRecommendation } from 'src/hooks/useClaudeCodeHintRecommendation.js';
import { PluginHintMenu } from 'src/components/ClaudeCodeHint/PluginHintMenu.js';
import { DesktopUpsellStartup, shouldShowDesktopUpsellStartup } from 'src/components/DesktopUpsell/DesktopUpsellStartup.js';
import { usePluginInstallationStatus } from 'src/hooks/notifs/usePluginInstallationStatus.js';
import { usePluginAutoupdateNotification } from 'src/hooks/notifs/usePluginAutoupdateNotification.js';
import { performStartupChecks } from 'src/utils/plugins/performStartupChecks.js';
import { UserTextMessage } from 'src/components/messages/UserTextMessage.js';
import { AwsAuthStatusBox } from '../components/AwsAuthStatusBox.js';
import { useRateLimitWarningNotification } from 'src/hooks/notifs/useRateLimitWarningNotification.js';
import { useDeprecationWarningNotification } from 'src/hooks/notifs/useDeprecationWarningNotification.js';
import { useNpmDeprecationNotification } from 'src/hooks/notifs/useNpmDeprecationNotification.js';
import { useIDEStatusIndicator } from 'src/hooks/notifs/useIDEStatusIndicator.js';
import { useModelMigrationNotifications } from 'src/hooks/notifs/useModelMigrationNotifications.js';
import { useCanSwitchToExistingSubscription } from 'src/hooks/notifs/useCanSwitchToExistingSubscription.js';
import { useTeammateLifecycleNotification } from 'src/hooks/notifs/useTeammateShutdownNotification.js';
import { useFastModeNotification } from 'src/hooks/notifs/useFastModeNotification.js';
import { AutoRunIssueNotification, shouldAutoRunIssue, getAutoRunIssueReasonText, getAutoRunCommand, type AutoRunIssueReason } from '../utils/autoRunIssue.js';
import type { HookProgress } from '../types/hooks.js';
import { TungstenLiveMonitor } from '../tools/TungstenTool/TungstenLiveMonitor.js';

const WebBrowserPanelModule = feature('WEB_BROWSER_TOOL') ? require('../tools/WebBrowserTool/WebBrowserPanel.js') as typeof import('../tools/WebBrowserTool/WebBrowserPanel.js') : null;

import { IssueFlagBanner } from '../components/PromptInput/IssueFlagBanner.js';
import { useIssueFlagBanner } from '../hooks/useIssueFlagBanner.js';
import { CompanionSprite, CompanionFloatingBubble, MIN_COLS_FOR_FULL_SPRITE } from '../buddy/CompanionSprite.js';
import { DevBar } from '../components/DevBar.js';

import type { RemoteSessionConfig } from '../remote/RemoteSessionManager.js';
import { REMOTE_SAFE_COMMANDS } from '../commands.js';
import type { RemoteMessageContent } from '../utils/teleport/api.js';
import { FullscreenLayout, useUnseenDivider, computeUnseenDivider } from '../components/FullscreenLayout.js';
import { isFullscreenEnvEnabled, maybeGetTmuxMouseHint, isMouseTrackingEnabled } from '../utils/fullscreen.js';
import { AlternateScreen } from '../ink/components/AlternateScreen.js';
import { ScrollKeybindingHandler } from '../components/ScrollKeybindingHandler.js';
import { useMessageActions, MessageActionsKeybindings, MessageActionsBar, type MessageActionsState, type MessageActionsNav, type MessageActionCaps } from '../components/messageActions.js';
import { setClipboard } from '../ink/termio/osc.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import { createAttachmentMessage, getQueuedCommandAttachments } from '../utils/attachments.js';

const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

const HISTORY_STUB = {
  maybeLoadOlder: (_: ScrollBoxHandle) => {}
};

const RECENT_SCROLL_REPIN_WINDOW_MS = 3000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function TranscriptModeFooter(t0) {
  const $ = _c(9);
  const {
    showAllInTranscript,
    virtualScroll,
    searchBadge,
    suppressShowAll: t1,
    status
  } = t0;
  const suppressShowAll = t1 === undefined ? false : t1;
  const toggleShortcut = useShortcutDisplay("app:toggleTranscript", "Global", "ctrl+o");
  const showAllShortcut = useShortcutDisplay("transcript:toggleShowAll", "Transcript", "ctrl+e");
  const t2 = searchBadge ? " \xB7 n/N to navigate" : virtualScroll ? ` · ${figures.arrowUp}${figures.arrowDown} scroll · home/end top/bottom` : suppressShowAll ? "" : ` · ${showAllShortcut} to ${showAllInTranscript ? "collapse" : "show all"}`;
  let t3;
  if ($[0] !== t2 || $[1] !== toggleShortcut) {
    t3 = <Text dimColor={true}>Showing detailed transcript · {toggleShortcut} to toggle{t2}</Text>;
    $[0] = t2;
    $[1] = toggleShortcut;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  let t4;
  if ($[3] !== searchBadge || $[4] !== status) {
    t4 = status ? <><Box flexGrow={1} /><Text>{status} </Text></> : searchBadge ? <><Box flexGrow={1} /><Text dimColor={true}>{searchBadge.current}/{searchBadge.count}{"  "}</Text></> : null;
    $[3] = searchBadge;
    $[4] = status;
    $[5] = t4;
  } else {
    t4 = $[5];
  }
  let t5;
  if ($[6] !== t3 || $[7] !== t4) {
    t5 = <Box noSelect={true} alignItems="center" alignSelf="center" borderTopDimColor={true} borderBottom={false} borderLeft={false} borderRight={false} borderStyle="single" marginTop={1} paddingLeft={2} width="100%">{t3}{t4}</Box>;
    $[6] = t3;
    $[7] = t4;
    $[8] = t5;
  } else {
    t5 = $[8];
  }
  return t5;
}

function TranscriptSearchBar({
  jumpRef,
  count,
  current,
  onClose,
  onCancel,
  setHighlight,
  initialQuery
}: {
  jumpRef: RefObject<JumpHandle | null>;
  count: number;
  current: number;
  
  onClose: (lastQuery: string) => void;
  
  onCancel: () => void;
  setHighlight: (query: string) => void;
  
  
  
  initialQuery: string;
}): React.ReactNode {
  const {
    query,
    cursorOffset
  } = useSearchInput({
    isActive: true,
    initialQuery,
    onExit: () => onClose(query),
    onCancel
  });
  
  
  
  
  
  
  
  
  
  
  
  const [indexStatus, setIndexStatus] = React.useState<'building' | {
    ms: number;
  } | null>('building');
  React.useEffect(() => {
    let alive = true;
    const warm = jumpRef.current?.warmSearchIndex;
    if (!warm) {
      setIndexStatus(null); 
      return;
    }
    setIndexStatus('building');
    warm().then(ms => {
      if (!alive) return;
      
      if (ms < 20) {
        setIndexStatus(null);
      } else {
        setIndexStatus({
          ms
        });
        setTimeout(() => alive && setIndexStatus(null), 2000);
      }
    });
    return () => {
      alive = false;
    };
    
  }, []); 
  
  
  const warmDone = indexStatus !== 'building';
  useEffect(() => {
    if (!warmDone) return;
    jumpRef.current?.setSearchQuery(query);
    setHighlight(query);
    
  }, [query, warmDone]);
  const off = cursorOffset;
  const cursorChar = off < query.length ? query[off] : ' ';
  return <Box borderTopDimColor borderBottom={false} borderLeft={false} borderRight={false} borderStyle="single" marginTop={1} paddingLeft={2} width="100%"
  
  
  
  
  
  
  noSelect>
      <Text>/</Text>
      <Text>{query.slice(0, off)}</Text>
      <Text inverse>{cursorChar}</Text>
      {off < query.length && <Text>{query.slice(off + 1)}</Text>}
      <Box flexGrow={1} />
      {indexStatus === 'building' ? <Text dimColor>indexing… </Text> : indexStatus ? <Text dimColor>indexed in {indexStatus.ms}ms </Text> : count === 0 && query ? <Text color="error">no matches </Text> : count > 0 ?
    
    
    
    
    <Text dimColor>
          {current}/{count}
          {'  '}
        </Text> : null}
    </Box>;
}
const TITLE_ANIMATION_FRAMES = ['⠂', '⠐'];
const TITLE_STATIC_PREFIX = '✳';
const TITLE_ANIMATION_INTERVAL_MS = 960;

function AnimatedTerminalTitle(t0) {
  const $ = _c(6);
  const {
    isAnimating,
    title,
    disabled,
    noPrefix
  } = t0;
  const terminalFocused = useTerminalFocus();
  const [frame, setFrame] = useState(0);
  let t1;
  let t2;
  if ($[0] !== disabled || $[1] !== isAnimating || $[2] !== noPrefix || $[3] !== terminalFocused) {
    t1 = () => {
      if (disabled || noPrefix || !isAnimating || !terminalFocused) {
        return;
      }
      const interval = setInterval(_temp2, TITLE_ANIMATION_INTERVAL_MS, setFrame);
      return () => clearInterval(interval);
    };
    t2 = [disabled, noPrefix, isAnimating, terminalFocused];
    $[0] = disabled;
    $[1] = isAnimating;
    $[2] = noPrefix;
    $[3] = terminalFocused;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  useEffect(t1, t2);
  const prefix = isAnimating ? TITLE_ANIMATION_FRAMES[frame] ?? TITLE_STATIC_PREFIX : TITLE_STATIC_PREFIX;
  useTerminalTitle(disabled ? null : noPrefix ? title : `${prefix} ${title}`);
  return null;
}
function _temp2(setFrame_0) {
  return setFrame_0(_temp);
}
function _temp(f) {
  return (f + 1) % TITLE_ANIMATION_FRAMES.length;
}
export type Props = {
  commands: Command[];
  debug: boolean;
  initialTools: Tool[];
  
  initialMessages?: MessageType[];
  
  
  pendingHookMessages?: Promise<HookResultMessage[]>;
  initialFileHistorySnapshots?: FileHistorySnapshot[];
  
  
  initialContentReplacements?: ContentReplacementRecord[];
  
  initialAgentName?: string;
  initialAgentColor?: AgentColorName;
  mcpClients?: MCPServerConnection[];
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>;
  autoConnectIdeFlag?: boolean;
  strictMcpConfig?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  
  
  
  onBeforeQuery?: (input: string, newMessages: MessageType[]) => Promise<boolean>;
  
  onTurnComplete?: (messages: MessageType[]) => void | Promise<void>;
  
  disabled?: boolean;
  
  mainThreadAgentDefinition?: AgentDefinition;
  
  disableSlashCommands?: boolean;
  
  taskListId?: string;
  
  remoteSessionConfig?: RemoteSessionConfig;
  
  directConnectConfig?: DirectConnectConfig;
  
  sshSession?: SSHSession;
  
  thinkingConfig: ThinkingConfig;
};
export type Screen = 'prompt' | 'transcript';
export function REPL({
  commands: initialCommands,
  debug,
  initialTools,
  initialMessages,
  pendingHookMessages,
  initialFileHistorySnapshots,
  initialContentReplacements,
  initialAgentName,
  initialAgentColor,
  mcpClients: initialMcpClients,
  dynamicMcpConfig: initialDynamicMcpConfig,
  autoConnectIdeFlag,
  strictMcpConfig = false,
  systemPrompt: customSystemPrompt,
  appendSystemPrompt,
  onBeforeQuery,
  onTurnComplete,
  disabled = false,
  mainThreadAgentDefinition: initialMainThreadAgentDefinition,
  disableSlashCommands = false,
  taskListId,
  remoteSessionConfig,
  directConnectConfig,
  sshSession,
  thinkingConfig
}: Props): React.ReactNode {
  const isRemoteSession = !!remoteSessionConfig;

  
  
  const titleDisabled = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_TERMINAL_TITLE), []);
  const moreRightEnabled = useMemo(() => "external" === 'ant' && isEnvTruthy(process.env.CLAUDE_MORERIGHT), []);
  const disableVirtualScroll = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_VIRTUAL_SCROLL), []);
  const disableMessageActions = feature('MESSAGE_ACTIONS') ?
  
  useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_MESSAGE_ACTIONS), []) : false;

  
  useEffect(() => {
    logForDebugging(`[REPL:mount] REPL mounted, disabled=${disabled}`);
    return () => logForDebugging(`[REPL:unmount] REPL unmounting`);
  }, [disabled]);

  
  const [mainThreadAgentDefinition, setMainThreadAgentDefinition] = useState(initialMainThreadAgentDefinition);
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const verbose = useAppState(s => s.verbose);
  const mcp = useAppState(s => s.mcp);
  const plugins = useAppState(s => s.plugins);
  const agentDefinitions = useAppState(s => s.agentDefinitions);
  const fileHistory = useAppState(s => s.fileHistory);
  const initialMessage = useAppState(s => s.initialMessage);
  const queuedCommands = useCommandQueue();
  
  
  
  const spinnerTip = useAppState(s => s.spinnerTip);
  const showExpandedTodos = useAppState(s => s.expandedView) === 'tasks';
  const pendingWorkerRequest = useAppState(s => s.pendingWorkerRequest);
  const pendingSandboxRequest = useAppState(s => s.pendingSandboxRequest);
  const teamContext = useAppState(s => s.teamContext);
  const tasks = useAppState(s => s.tasks);
  const workerSandboxPermissions = useAppState(s => s.workerSandboxPermissions);
  const elicitation = useAppState(s => s.elicitation);
  const ultraplanPendingChoice = useAppState(s => s.ultraplanPendingChoice);
  const ultraplanLaunchPending = useAppState(s => s.ultraplanLaunchPending);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const setAppState = useSetAppState();

  
  
  
  
  const viewedLocalAgent = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const needsBootstrap = isLocalAgentTask(viewedLocalAgent) && viewedLocalAgent.retain && !viewedLocalAgent.diskLoaded;
  useEffect(() => {
    if (!viewingAgentTaskId || !needsBootstrap) return;
    const taskId = viewingAgentTaskId;
    void getAgentTranscript(asAgentId(taskId)).then(result => {
      setAppState(prev => {
        const t = prev.tasks[taskId];
        if (!isLocalAgentTask(t) || t.diskLoaded || !t.retain) return prev;
        const live = t.messages ?? [];
        const liveUuids = new Set(live.map(m => m.uuid));
        const diskOnly = result ? result.messages.filter(m => !liveUuids.has(m.uuid)) : [];
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [taskId]: {
              ...t,
              messages: [...diskOnly, ...live],
              diskLoaded: true
            }
          }
        };
      });
    });
  }, [viewingAgentTaskId, needsBootstrap, setAppState]);
  const store = useAppStateStore();
  const terminal = useTerminalNotification();
  const mainLoopModel = useMainLoopModel();

  
  
  

  
  const [localCommands, setLocalCommands] = useState(initialCommands);

  
  useSkillsChange(isRemoteSession ? undefined : getProjectRoot(), setLocalCommands);

  
  const proactiveActive = React.useSyncExternalStore(proactiveModule?.subscribeToProactiveChanges ?? PROACTIVE_NO_OP_SUBSCRIBE, proactiveModule?.isProactiveActive ?? PROACTIVE_FALSE);

  
  
  
  
  
  
  const isBriefOnly = useAppState(s => s.isBriefOnly);
  const localTools = useMemo(() => getTools(toolPermissionContext), [toolPermissionContext, proactiveActive, isBriefOnly]);
  useKickOffCheckAndDisableBypassPermissionsIfNeeded();
  useKickOffCheckAndDisableAutoModeIfNeeded();
  const [dynamicMcpConfig, setDynamicMcpConfig] = useState<Record<string, ScopedMcpServerConfig> | undefined>(initialDynamicMcpConfig);
  const onChangeDynamicMcpConfig = useCallback((config: Record<string, ScopedMcpServerConfig>) => {
    setDynamicMcpConfig(config);
  }, [setDynamicMcpConfig]);
  const [screen, setScreen] = useState<Screen>('prompt');
  const [showAllInTranscript, setShowAllInTranscript] = useState(false);
  
  
  
  
  const [dumpMode, setDumpMode] = useState(false);
  
  
  const [editorStatus, setEditorStatus] = useState('');
  
  
  
  
  const editorGenRef = useRef(0);
  const editorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorRenderingRef = useRef(false);
  const {
    addNotification,
    removeNotification
  } = useNotifications();

  
  let trySuggestBgPRIntercept = SUGGEST_BG_PR_NOOP;
  const mcpClients = useMergedClients(initialMcpClients, mcp.clients);

  
  const [ideSelection, setIDESelection] = useState<IDESelection | undefined>(undefined);
  const [ideToInstallExtension, setIDEToInstallExtension] = useState<IdeType | null>(null);
  const [ideInstallationStatus, setIDEInstallationStatus] = useState<IDEExtensionInstallationStatus | null>(null);
  const [showIdeOnboarding, setShowIdeOnboarding] = useState(false);
  
  const [showModelSwitchCallout, setShowModelSwitchCallout] = useState(() => {
    if ("external" === 'ant') {
      return shouldShowAntModelSwitch();
    }
    return false;
  });
  const [showEffortCallout, setShowEffortCallout] = useState(() => shouldShowEffortCallout(mainLoopModel));
  const showRemoteCallout = useAppState(s => s.showRemoteCallout);
  const [showDesktopUpsellStartup, setShowDesktopUpsellStartup] = useState(() => shouldShowDesktopUpsellStartup());
  
  useModelMigrationNotifications();
  useCanSwitchToExistingSubscription();
  useIDEStatusIndicator({
    ideSelection,
    mcpClients,
    ideInstallationStatus
  });
  useMcpConnectivityStatus({
    mcpClients
  });
  useAutoModeUnavailableNotification();
  usePluginInstallationStatus();
  usePluginAutoupdateNotification();
  useSettingsErrors();
  useRateLimitWarningNotification(mainLoopModel);
  useFastModeNotification();
  useDeprecationWarningNotification(mainLoopModel);
  useNpmDeprecationNotification();
  useAntOrgWarningNotification();
  useInstallMessages();
  useChromeExtensionNotification();
  useOfficialMarketplaceNotification();
  useLspInitializationNotification();
  useTeammateLifecycleNotification();
  const {
    recommendation: lspRecommendation,
    handleResponse: handleLspResponse
  } = useLspPluginRecommendation();
  const {
    recommendation: hintRecommendation,
    handleResponse: handleHintResponse
  } = useClaudeCodeHintRecommendation();

  
  const combinedInitialTools = useMemo(() => {
    return [...localTools, ...initialTools];
  }, [localTools, initialTools]);

  
  useManagePlugins({
    enabled: !isRemoteSession
  });
  const tasksV2 = useTasksV2WithCollapseEffect();

  

  
  
  
  
  
  
  useEffect(() => {
    if (isRemoteSession) return;
    void performStartupChecks(setAppState);
  }, [setAppState, isRemoteSession]);

  
  
  usePromptsFromClaudeInChrome(isRemoteSession ? EMPTY_MCP_CLIENTS : mcpClients, toolPermissionContext.mode);

  
  
  useSwarmInitialization(setAppState, initialMessages, {
    enabled: !isRemoteSession
  });
  const mergedTools = useMergedTools(combinedInitialTools, mcp.tools, toolPermissionContext);

  
  const {
    tools,
    allowedAgentTypes
  } = useMemo(() => {
    if (!mainThreadAgentDefinition) {
      return {
        tools: mergedTools,
        allowedAgentTypes: undefined as string[] | undefined
      };
    }
    const resolved = resolveAgentTools(mainThreadAgentDefinition, mergedTools, false, true);
    return {
      tools: resolved.resolvedTools,
      allowedAgentTypes: resolved.allowedAgentTypes
    };
  }, [mainThreadAgentDefinition, mergedTools]);

  
  const commandsWithPlugins = useMergedCommands(localCommands, plugins.commands as Command[]);
  const mergedCommands = useMergedCommands(commandsWithPlugins, mcp.commands as Command[]);
  
  const commands = useMemo(() => disableSlashCommands ? [] : mergedCommands, [disableSlashCommands, mergedCommands]);
  useIdeLogging(isRemoteSession ? EMPTY_MCP_CLIENTS : mcp.clients);
  useIdeSelection(isRemoteSession ? EMPTY_MCP_CLIENTS : mcp.clients, setIDESelection);
  const [streamMode, setStreamMode] = useState<SpinnerMode>('responding');
  
  
  
  
  
  
  
  
  const streamModeRef = useRef(streamMode);
  streamModeRef.current = streamMode;
  const [streamingToolUses, setStreamingToolUses] = useState<StreamingToolUse[]>([]);
  const [streamingThinking, setStreamingThinking] = useState<StreamingThinking | null>(null);

  
  useEffect(() => {
    if (streamingThinking && !streamingThinking.isStreaming && streamingThinking.streamingEndedAt) {
      const elapsed = Date.now() - streamingThinking.streamingEndedAt;
      const remaining = 30000 - elapsed;
      if (remaining > 0) {
        const timer = setTimeout(setStreamingThinking, remaining, null);
        return () => clearTimeout(timer);
      } else {
        setStreamingThinking(null);
      }
    }
  }, [streamingThinking]);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  
  
  const abortControllerRef = useRef<AbortController | null>(null);
  abortControllerRef.current = abortController;

  
  
  const sendBridgeResultRef = useRef<() => void>(() => {});

  
  
  const restoreMessageSyncRef = useRef<(m: UserMessage) => void>(() => {});

  
  
  const scrollRef = useRef<ScrollBoxHandle>(null);
  
  
  
  
  
  
  const modalScrollRef = useRef<ScrollBoxHandle>(null);
  
  
  
  
  
  
  const lastUserScrollTsRef = useRef(0);

  
  
  
  const queryGuard = React.useRef(new QueryGuard()).current;

  
  
  const isQueryActive = React.useSyncExternalStore(queryGuard.subscribe, queryGuard.getSnapshot);

  
  
  
  
  
  const [isExternalLoading, setIsExternalLoadingRaw] = React.useState(remoteSessionConfig?.hasInitialPrompt ?? false);

  
  
  
  const isLoading = isQueryActive || isExternalLoading;

  
  
  const [userInputOnProcessing, setUserInputOnProcessingRaw] = React.useState<string | undefined>(undefined);
  
  
  
  const userInputBaselineRef = React.useRef(0);
  
  
  
  
  const userMessagePendingRef = React.useRef(false);

  
  const loadingStartTimeRef = React.useRef<number>(0);
  const totalPausedMsRef = React.useRef(0);
  const pauseStartTimeRef = React.useRef<number | null>(null);
  const resetTimingRefs = React.useCallback(() => {
    loadingStartTimeRef.current = Date.now();
    totalPausedMsRef.current = 0;
    pauseStartTimeRef.current = null;
  }, []);

  
  
  
  
  
  
  
  
  const wasQueryActiveRef = React.useRef(false);
  if (isQueryActive && !wasQueryActiveRef.current) {
    resetTimingRefs();
  }
  wasQueryActiveRef.current = isQueryActive;

  
  
  
  
  
  const setIsExternalLoading = React.useCallback((value: boolean) => {
    setIsExternalLoadingRaw(value);
    if (value) resetTimingRefs();
  }, [resetTimingRefs]);

  
  
  const swarmStartTimeRef = React.useRef<number | null>(null);
  const swarmBudgetInfoRef = React.useRef<{
    tokens: number;
    limit: number;
    nudges: number;
  } | undefined>(undefined);

  
  
  const focusedInputDialogRef = React.useRef<ReturnType<typeof getFocusedInputDialog>>(undefined);

  
  const PROMPT_SUPPRESSION_MS = 1500;
  
  
  const [isPromptInputActive, setIsPromptInputActive] = React.useState(false);
  const [autoUpdaterResult, setAutoUpdaterResult] = useState<AutoUpdaterResult | null>(null);
  useEffect(() => {
    if (autoUpdaterResult?.notifications) {
      autoUpdaterResult.notifications.forEach(notification => {
        addNotification({
          key: 'auto-updater-notification',
          text: notification,
          priority: 'low'
        });
      });
    }
  }, [autoUpdaterResult, addNotification]);

  
  
  
  useEffect(() => {
    if (isFullscreenEnvEnabled()) {
      void maybeGetTmuxMouseHint().then(hint => {
        if (hint) {
          addNotification({
            key: 'tmux-mouse-hint',
            text: hint,
            priority: 'low'
          });
        }
      });
    }
    
  }, []);
  const [showUndercoverCallout, setShowUndercoverCallout] = useState(false);
  useEffect(() => {
    if ("external" === 'ant') {
      void (async () => {
        
        const {
          isInternalModelRepo
        } = await import('../utils/commitAttribution.js');
        await isInternalModelRepo();
        const {
          shouldShowUndercoverAutoNotice
        } = await import('../utils/undercover.js');
        if (shouldShowUndercoverAutoNotice()) {
          setShowUndercoverCallout(true);
        }
      })();
    }
    
  }, []);
  const [toolJSX, setToolJSXInternal] = useState<{
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
    showSpinner?: boolean;
    isLocalJSXCommand?: boolean;
    isImmediate?: boolean;
  } | null>(null);

  
  
  const localJSXCommandRef = useRef<{
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
    showSpinner?: boolean;
    isLocalJSXCommand: true;
  } | null>(null);

  
  
  
  
  
  
  
  
  
  const setToolJSX = useCallback((args: {
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
    showSpinner?: boolean;
    isLocalJSXCommand?: boolean;
    clearLocalJSX?: boolean;
  } | null) => {
    
    if (args?.isLocalJSXCommand) {
      const {
        clearLocalJSX: _,
        ...rest
      } = args;
      localJSXCommandRef.current = {
        ...rest,
        isLocalJSXCommand: true
      };
      setToolJSXInternal(rest);
      return;
    }

    
    if (localJSXCommandRef.current) {
      
      if (args?.clearLocalJSX) {
        localJSXCommandRef.current = null;
        setToolJSXInternal(null);
        return;
      }
      
      return;
    }

    
    if (args?.clearLocalJSX) {
      setToolJSXInternal(null);
      return;
    }
    setToolJSXInternal(args);
  }, []);
  const [toolUseConfirmQueue, setToolUseConfirmQueue] = useState<ToolUseConfirm[]>([]);
  
  
  
  const [permissionStickyFooter, setPermissionStickyFooter] = useState<React.ReactNode | null>(null);
  const [sandboxPermissionRequestQueue, setSandboxPermissionRequestQueue] = useState<Array<{
    hostPattern: NetworkHostPattern;
    resolvePromise: (allowConnection: boolean) => void;
  }>>([]);
  const [promptQueue, setPromptQueue] = useState<Array<{
    request: PromptRequest;
    title: string;
    toolInputSummary?: string | null;
    resolve: (response: PromptResponse) => void;
    reject: (error: Error) => void;
  }>>([]);

  
  
  
  const sandboxBridgeCleanupRef = useRef<Map<string, Array<() => void>>>(new Map());

  
  
  
  
  const terminalTitleFromRename = useAppState(s => s.settings.terminalTitleFromRename) !== false;
  const sessionTitle = terminalTitleFromRename ? getCurrentSessionTitle(getSessionId()) : undefined;
  const [haikuTitle, setHaikuTitle] = useState<string>();
  
  
  
  const haikuTitleAttemptedRef = useRef((initialMessages?.length ?? 0) > 0);
  const agentTitle = mainThreadAgentDefinition?.agentType;
  const terminalTitle = sessionTitle ?? agentTitle ?? haikuTitle ?? 'Claude Code Next';
  const isWaitingForApproval = toolUseConfirmQueue.length > 0 || promptQueue.length > 0 || pendingWorkerRequest || pendingSandboxRequest;
  
  
  
  
  const isShowingLocalJSXCommand = toolJSX?.isLocalJSXCommand === true && toolJSX?.jsx != null;
  const titleIsAnimating = isLoading && !isWaitingForApproval && !isShowingLocalJSXCommand;
  
  
  
  

  
  useEffect(() => {
    if (isLoading && !isWaitingForApproval && !isShowingLocalJSXCommand) {
      startPreventSleep();
      return () => stopPreventSleep();
    }
  }, [isLoading, isWaitingForApproval, isShowingLocalJSXCommand]);
  const sessionStatus: TabStatusKind = isWaitingForApproval || isShowingLocalJSXCommand ? 'waiting' : isLoading ? 'busy' : 'idle';
  const waitingFor = sessionStatus !== 'waiting' ? undefined : toolUseConfirmQueue.length > 0 ? `approve ${toolUseConfirmQueue[0]!.tool.name}` : pendingWorkerRequest ? 'worker request' : pendingSandboxRequest ? 'sandbox request' : isShowingLocalJSXCommand ? 'dialog open' : 'input needed';

  
  
  useEffect(() => {
    if (feature('BG_SESSIONS')) {
      void updateSessionActivity({
        status: sessionStatus,
        waitingFor
      });
    }
  }, [sessionStatus, waitingFor]);

  
  
  
  
  const tabStatusGateEnabled = getFeatureValue_CACHED_MAY_BE_STALE('tengu_terminal_sidebar', false);
  const showStatusInTerminalTab = tabStatusGateEnabled && (getGlobalConfig().showStatusInTerminalTab ?? false);
  useTabStatus(titleDisabled || !showStatusInTerminalTab ? null : sessionStatus);

  
  useEffect(() => {
    registerLeaderToolUseConfirmQueue(setToolUseConfirmQueue);
    return () => unregisterLeaderToolUseConfirmQueue();
  }, [setToolUseConfirmQueue]);
  const [messages, rawSetMessages] = useState<MessageType[]>(initialMessages ?? []);
  const messagesRef = useRef(messages);
  
  
  
  
  const idleHintShownRef = useRef<string | false>(false);
  
  
  
  
  
  
  
  
  
  const setMessages = useCallback((action: React.SetStateAction<MessageType[]>) => {
    const prev = messagesRef.current;
    const next = typeof action === 'function' ? action(messagesRef.current) : action;
    messagesRef.current = next;
    if (next.length < userInputBaselineRef.current) {
      
      
      userInputBaselineRef.current = 0;
    } else if (next.length > prev.length && userMessagePendingRef.current) {
      
      
      
      
      
      
      const delta = next.length - prev.length;
      const added = prev.length === 0 || next[0] === prev[0] ? next.slice(-delta) : next.slice(0, delta);
      if (added.some(isHumanTurn)) {
        userMessagePendingRef.current = false;
      } else {
        userInputBaselineRef.current = next.length;
      }
    }
    rawSetMessages(next);
  }, []);
  
  
  const setUserInputOnProcessing = useCallback((input: string | undefined) => {
    if (input !== undefined) {
      userInputBaselineRef.current = messagesRef.current.length;
      userMessagePendingRef.current = true;
    } else {
      userMessagePendingRef.current = false;
    }
    setUserInputOnProcessingRaw(input);
  }, []);
  
  
  
  
  const {
    dividerIndex,
    dividerYRef,
    onScrollAway,
    onRepin,
    jumpToNew,
    shiftDivider
  } = useUnseenDivider(messages.length);
  if (feature('AWAY_SUMMARY')) {
    
    useAwaySummary(messages, setMessages, isLoading);
  }
  const [cursor, setCursor] = useState<MessageActionsState | null>(null);
  const cursorNavRef = useRef<MessageActionsNav | null>(null);
  
  const unseenDivider = useMemo(() => computeUnseenDivider(messages, dividerIndex),
  
  [dividerIndex, messages.length]);
  
  
  
  const repinScroll = useCallback(() => {
    scrollRef.current?.scrollToBottom();
    onRepin();
    setCursor(null);
  }, [onRepin, setCursor]);
  
  
  
  
  
  
  const lastMsg = messages.at(-1);
  const lastMsgIsHuman = lastMsg != null && isHumanTurn(lastMsg);
  useEffect(() => {
    if (lastMsgIsHuman) {
      repinScroll();
    }
  }, [lastMsgIsHuman, lastMsg, repinScroll]);
  
  
  
  
  const {
    maybeLoadOlder
  } = feature('KAIROS') ?
  
  useAssistantHistory({
    config: remoteSessionConfig,
    setMessages,
    scrollRef,
    onPrepend: shiftDivider
  }) : HISTORY_STUB;
  
  const composedOnScroll = useCallback((sticky: boolean, handle: ScrollBoxHandle) => {
    lastUserScrollTsRef.current = Date.now();
    if (sticky) {
      onRepin();
    } else {
      onScrollAway(handle);
      if (feature('KAIROS')) maybeLoadOlder(handle);
      
      
      
      if (feature('BUDDY')) {
        setAppState(prev => prev.companionReaction === undefined ? prev : {
          ...prev,
          companionReaction: undefined
        });
      }
    }
  }, [onRepin, onScrollAway, maybeLoadOlder, setAppState]);
  
  
  
  const awaitPendingHooks = useDeferredHookMessages(pendingHookMessages, setMessages);

  
  
  
  const deferredMessages = useDeferredValue(messages);
  const deferredBehind = messages.length - deferredMessages.length;
  if (deferredBehind > 0) {
    logForDebugging(`[useDeferredValue] Messages deferred by ${deferredBehind} (${deferredMessages.length}→${messages.length})`);
  }

  
  const [frozenTranscriptState, setFrozenTranscriptState] = useState<{
    messagesLength: number;
    streamingToolUsesLength: number;
  } | null>(null);
  
  
  const [inputValue, setInputValueRaw] = useState(() => consumeEarlyInput());
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const insertTextRef = useRef<{
    insert: (text: string) => void;
    setInputWithCursor: (value: string, cursor: number) => void;
    cursorOffset: number;
  } | null>(null);

  
  
  
  
  const setInputValue = useCallback((value: string) => {
    if (trySuggestBgPRIntercept(inputValueRef.current, value)) return;
    
    
    
    
    
    
    
    
    if (inputValueRef.current === '' && value !== '' && Date.now() - lastUserScrollTsRef.current >= RECENT_SCROLL_REPIN_WINDOW_MS) {
      repinScroll();
    }
    
    
    
    inputValueRef.current = value;
    setInputValueRaw(value);
    setIsPromptInputActive(value.trim().length > 0);
  }, [setIsPromptInputActive, repinScroll, trySuggestBgPRIntercept]);

  
  
  useEffect(() => {
    if (inputValue.trim().length === 0) return;
    const timer = setTimeout(setIsPromptInputActive, PROMPT_SUPPRESSION_MS, false);
    return () => clearTimeout(timer);
  }, [inputValue]);
  const [inputMode, setInputMode] = useState<PromptInputMode>('prompt');
  const [stashedPrompt, setStashedPrompt] = useState<{
    text: string;
    cursorOffset: number;
    pastedContents: Record<number, PastedContent>;
  } | undefined>();

  
  const handleRemoteInit = useCallback((remoteSlashCommands: string[]) => {
    const remoteCommandSet = new Set(remoteSlashCommands);
    
    setLocalCommands(prev => prev.filter(cmd => remoteCommandSet.has(cmd.name) || REMOTE_SAFE_COMMANDS.has(cmd)));
  }, [setLocalCommands]);
  const [inProgressToolUseIDs, setInProgressToolUseIDs] = useState<Set<string>>(new Set());
  const hasInterruptibleToolInProgressRef = useRef(false);

  
  const remoteSession = useRemoteSession({
    config: remoteSessionConfig,
    setMessages,
    setIsLoading: setIsExternalLoading,
    onInit: handleRemoteInit,
    setToolUseConfirmQueue,
    tools: combinedInitialTools,
    setStreamingToolUses,
    setStreamMode,
    setInProgressToolUseIDs
  });

  
  const directConnect = useDirectConnect({
    config: directConnectConfig,
    setMessages,
    setIsLoading: setIsExternalLoading,
    setToolUseConfirmQueue,
    tools: combinedInitialTools
  });

  
  
  
  const sshRemote = useSSHSession({
    session: sshSession,
    setMessages,
    setIsLoading: setIsExternalLoading,
    setToolUseConfirmQueue,
    tools: combinedInitialTools
  });

  
  const activeRemote = sshRemote.isRemoteMode ? sshRemote : directConnect.isRemoteMode ? directConnect : remoteSession;
  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
  const [submitCount, setSubmitCount] = useState(0);
  
  
  const responseLengthRef = useRef(0);
  
  
  const apiMetricsRef = useRef<Array<{
    ttftMs: number;
    firstTokenTime: number;
    lastTokenTime: number;
    responseLengthBaseline: number;
    
    
    
    
    endResponseLength: number;
  }>>([]);
  const setResponseLength = useCallback((f: (prev: number) => number) => {
    const prev = responseLengthRef.current;
    responseLengthRef.current = f(prev);
    
    
    
    
    if (responseLengthRef.current > prev) {
      const entries = apiMetricsRef.current;
      if (entries.length > 0) {
        const lastEntry = entries.at(-1)!;
        lastEntry.lastTokenTime = Date.now();
        lastEntry.endResponseLength = responseLengthRef.current;
      }
    }
  }, []);

  
  
  
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const reducedMotion = useAppState(s => s.settings.prefersReducedMotion) ?? false;
  const showStreamingText = !reducedMotion && !hasCursorUpViewportYankBug();
  const onStreamingText = useCallback((f: (current: string | null) => string | null) => {
    if (!showStreamingText) return;
    setStreamingText(f);
  }, [showStreamingText]);

  
  
  
  
  const visibleStreamingText = streamingText && showStreamingText ? streamingText.substring(0, streamingText.lastIndexOf('\n') + 1) || null : null;
  const [lastQueryCompletionTime, setLastQueryCompletionTime] = useState(0);
  const [spinnerMessage, setSpinnerMessage] = useState<string | null>(null);
  const [spinnerColor, setSpinnerColor] = useState<keyof Theme | null>(null);
  const [spinnerShimmerColor, setSpinnerShimmerColor] = useState<keyof Theme | null>(null);
  const [isMessageSelectorVisible, setIsMessageSelectorVisible] = useState(false);
  const [messageSelectorPreselect, setMessageSelectorPreselect] = useState<UserMessage | undefined>(undefined);
  const [showCostDialog, setShowCostDialog] = useState(false);
  const [conversationId, setConversationId] = useState(randomUUID());

  
  const [idleReturnPending, setIdleReturnPending] = useState<{
    input: string;
    idleMinutes: number;
  } | null>(null);
  const skipIdleCheckRef = useRef(false);
  const lastQueryCompletionTimeRef = useRef(lastQueryCompletionTime);
  lastQueryCompletionTimeRef.current = lastQueryCompletionTime;

  
  
  
  
  
  
  
  
  
  
  
  const [contentReplacementStateRef] = useState(() => ({
    current: provisionContentReplacementState(initialMessages, initialContentReplacements)
  }));
  const [haveShownCostDialog, setHaveShownCostDialog] = useState(getGlobalConfig().hasAcknowledgedCostThreshold);
  const [vimMode, setVimMode] = useState<VimMode>('INSERT');
  const [showBashesDialog, setShowBashesDialog] = useState<string | boolean>(false);
  const [isSearchingHistory, setIsSearchingHistory] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  
  
  
  
  
  useEffect(() => {
    if (ultraplanPendingChoice && showBashesDialog) {
      setShowBashesDialog(false);
    }
  }, [ultraplanPendingChoice, showBashesDialog]);
  const isTerminalFocused = useTerminalFocus();
  const terminalFocusRef = useRef(isTerminalFocused);
  terminalFocusRef.current = isTerminalFocused;
  const [theme] = useTheme();

  
  
  
  const tipPickedThisTurnRef = React.useRef(false);
  const pickNewSpinnerTip = useCallback(() => {
    if (tipPickedThisTurnRef.current) return;
    tipPickedThisTurnRef.current = true;
    const newMessages = messagesRef.current.slice(bashToolsProcessedIdx.current);
    for (const tool of extractBashToolsFromMessages(newMessages)) {
      bashTools.current.add(tool);
    }
    bashToolsProcessedIdx.current = messagesRef.current.length;
    void getTipToShowOnSpinner({
      theme,
      readFileState: readFileState.current,
      bashTools: bashTools.current
    }).then(async tip => {
      if (tip) {
        const content = await tip.content({
          theme
        });
        setAppState(prev => ({
          ...prev,
          spinnerTip: content
        }));
        recordShownTip(tip);
      } else {
        setAppState(prev => {
          if (prev.spinnerTip === undefined) return prev;
          return {
            ...prev,
            spinnerTip: undefined
          };
        });
      }
    });
  }, [setAppState, theme]);

  
  
  const resetLoadingState = useCallback(() => {
    
    
    
    
    setIsExternalLoading(false);
    setUserInputOnProcessing(undefined);
    responseLengthRef.current = 0;
    apiMetricsRef.current = [];
    setStreamingText(null);
    setStreamingToolUses([]);
    setSpinnerMessage(null);
    setSpinnerColor(null);
    setSpinnerShimmerColor(null);
    pickNewSpinnerTip();
    endInteractionSpan();
    
    
    
    clearSpeculativeChecks();
  }, [pickNewSpinnerTip]);

  

  const hasRunningTeammates = useMemo(() => getAllInProcessTeammateTasks(tasks).some(t => t.status === 'running'), [tasks]);

  
  useEffect(() => {
    if (!hasRunningTeammates && swarmStartTimeRef.current !== null) {
      const totalMs = Date.now() - swarmStartTimeRef.current;
      const deferredBudget = swarmBudgetInfoRef.current;
      swarmStartTimeRef.current = null;
      swarmBudgetInfoRef.current = undefined;
      setMessages(prev => [...prev, createTurnDurationMessage(totalMs, deferredBudget,
      
      
      
      
      
      count(prev, isLoggableMessage))]);
    }
  }, [hasRunningTeammates, setMessages]);

  
  
  
  
  const safeYoloMessageShownRef = useRef(false);
  useEffect(() => {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (toolPermissionContext.mode !== 'auto') {
        safeYoloMessageShownRef.current = false;
        return;
      }
      if (safeYoloMessageShownRef.current) return;
      const config = getGlobalConfig();
      const count = config.autoPermissionsNotificationCount ?? 0;
      if (count >= 3) return;
      const timer = setTimeout((ref, setMessages) => {
        ref.current = true;
        saveGlobalConfig(prev => {
          const prevCount = prev.autoPermissionsNotificationCount ?? 0;
          if (prevCount >= 3) return prev;
          return {
            ...prev,
            autoPermissionsNotificationCount: prevCount + 1
          };
        });
        setMessages(prev => [...prev, createSystemMessage(AUTO_MODE_DESCRIPTION, 'warning')]);
      }, 800, safeYoloMessageShownRef, setMessages);
      return () => clearTimeout(timer);
    }
  }, [toolPermissionContext.mode, setMessages]);

  
  
  const worktreeTipShownRef = useRef(false);
  useEffect(() => {
    if (worktreeTipShownRef.current) return;
    const wt = getCurrentWorktreeSession();
    if (!wt?.creationDurationMs || wt.usedSparsePaths) return;
    if (wt.creationDurationMs < 15_000) return;
    worktreeTipShownRef.current = true;
    const secs = Math.round(wt.creationDurationMs / 1000);
    setMessages(prev => [...prev, createSystemMessage(`Worktree creation took ${secs}s. For large repos, set \`worktree.sparsePaths\` in .claude/settings.json to check out only the directories you need — e.g. \`{"worktree": {"sparsePaths": ["src", "packages/foo"]}}\`.`, 'info')]);
  }, [setMessages]);

  
  const onlySleepToolActive = useMemo(() => {
    const lastAssistant = messages.findLast(m => m.type === 'assistant');
    if (lastAssistant?.type !== 'assistant') return false;
    const inProgressToolUses = lastAssistant.message.content.filter(b => b.type === 'tool_use' && inProgressToolUseIDs.has(b.id));
    return inProgressToolUses.length > 0 && inProgressToolUses.every(b => b.type === 'tool_use' && b.name === SLEEP_TOOL_NAME);
  }, [messages, inProgressToolUseIDs]);
  const {
    onBeforeQuery: mrOnBeforeQuery,
    onTurnComplete: mrOnTurnComplete,
    render: mrRender
  } = useMoreRight({
    enabled: moreRightEnabled,
    setMessages,
    inputValue,
    setInputValue,
    setToolJSX
  });
  const showSpinner = (!toolJSX || toolJSX.showSpinner === true) && toolUseConfirmQueue.length === 0 && promptQueue.length === 0 && (
  
  
  isLoading || userInputOnProcessing || hasRunningTeammates ||
  
  
  
  
  getCommandQueueLength() > 0) &&
  
  !pendingWorkerRequest && !onlySleepToolActive && (
  
  
  !visibleStreamingText || isBriefOnly);

  
  
  const hasActivePrompt = toolUseConfirmQueue.length > 0 || promptQueue.length > 0 || sandboxPermissionRequestQueue.length > 0 || elicitation.queue.length > 0 || workerSandboxPermissions.queue.length > 0;
  const feedbackSurveyOriginal = useFeedbackSurvey(messages, isLoading, submitCount, 'session', hasActivePrompt);
  const skillImprovementSurvey = useSkillImprovementSurvey(setMessages);
  const showIssueFlagBanner = useIssueFlagBanner(messages, submitCount);

  
  const feedbackSurvey = useMemo(() => ({
    ...feedbackSurveyOriginal,
    handleSelect: (selected: 'dismissed' | 'bad' | 'fine' | 'good') => {
      
      didAutoRunIssueRef.current = false;
      const showedTranscriptPrompt = feedbackSurveyOriginal.handleSelect(selected);
      
      if (selected === 'bad' && !showedTranscriptPrompt && shouldAutoRunIssue('feedback_survey_bad')) {
        setAutoRunIssueReason('feedback_survey_bad');
        didAutoRunIssueRef.current = true;
      }
    }
  }), [feedbackSurveyOriginal]);

  
  const postCompactSurvey = usePostCompactSurvey(messages, isLoading, hasActivePrompt, {
    enabled: !isRemoteSession
  });

  
  
  const memorySurvey = useMemorySurvey(messages, isLoading, hasActivePrompt, {
    enabled: !isRemoteSession
  });

  
  const frustrationDetection = useFrustrationDetection(messages, isLoading, hasActivePrompt, feedbackSurvey.state !== 'closed' || postCompactSurvey.state !== 'closed' || memorySurvey.state !== 'closed');

  
  useIDEIntegration({
    autoConnectIdeFlag,
    ideToInstallExtension,
    setDynamicMcpConfig,
    setShowIdeOnboarding,
    setIDEInstallationState: setIDEInstallationStatus
  });
  useFileHistorySnapshotInit(initialFileHistorySnapshots, fileHistory, fileHistoryState => setAppState(prev => ({
    ...prev,
    fileHistory: fileHistoryState
  })));
  const resume = useCallback(async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
    const resumeStart = performance.now();
    try {
      
      
      const messages = deserializeMessages(log.messages);

      
      if (feature('COORDINATOR_MODE')) {
        
        const coordinatorModule = require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js');
        
        const warning = coordinatorModule.matchSessionMode(log.mode);
        if (warning) {
          
          
          
          const {
            getAgentDefinitionsWithOverrides,
            getActiveAgentsFromList
          } = require('../tools/AgentTool/loadAgentsDir.js') as typeof import('../tools/AgentTool/loadAgentsDir.js');
          
          getAgentDefinitionsWithOverrides.cache.clear?.();
          const freshAgentDefs = await getAgentDefinitionsWithOverrides(getOriginalCwd());
          setAppState(prev => ({
            ...prev,
            agentDefinitions: {
              ...freshAgentDefs,
              allAgents: freshAgentDefs.allAgents,
              activeAgents: getActiveAgentsFromList(freshAgentDefs.allAgents)
            }
          }));
          messages.push(createSystemMessage(warning, 'warning'));
        }
      }

      
      
      const sessionEndTimeoutMs = getSessionEndHookTimeoutMs();
      await executeSessionEndHooks('resume', {
        getAppState: () => store.getState(),
        setAppState,
        signal: AbortSignal.timeout(sessionEndTimeoutMs),
        timeoutMs: sessionEndTimeoutMs
      });

      
      const hookMessages = await processSessionStartHooks('resume', {
        sessionId,
        agentType: mainThreadAgentDefinition?.agentType,
        model: mainLoopModel
      });

      
      messages.push(...hookMessages);
      
      
      
      if (entrypoint === 'fork') {
        void copyPlanForFork(log, asSessionId(sessionId));
      } else {
        void copyPlanForResume(log, asSessionId(sessionId));
      }

      
      restoreSessionStateFromLog(log, setAppState);
      if (log.fileHistorySnapshots) {
        void copyFileHistoryForResume(log);
      }

      
      
      
      const {
        agentDefinition: restoredAgent
      } = restoreAgentFromSession(log.agentSetting, initialMainThreadAgentDefinition, agentDefinitions);
      setMainThreadAgentDefinition(restoredAgent);
      setAppState(prev => ({
        ...prev,
        agent: restoredAgent?.agentType
      }));

      
      
      setAppState(prev => ({
        ...prev,
        standaloneAgentContext: computeStandaloneAgentContext(log.agentName, log.agentColor)
      }));
      void updateSessionName(log.agentName);

      
      restoreReadFileState(messages, log.projectPath ?? getOriginalCwd());

      
      resetLoadingState();
      setAbortController(null);
      setConversationId(sessionId);

      
      
      const targetSessionCosts = getStoredSessionCosts(sessionId);

      
      saveCurrentSessionCosts();

      
      resetCostState();

      
      
      
      switchSession(asSessionId(sessionId), log.fullPath ? dirname(log.fullPath) : null);
      
      const {
        renameRecordingForSession
      } = await import('../utils/asciicast.js');
      await renameRecordingForSession();
      await resetSessionFilePointer();

      
      
      
      
      
      clearSessionMetadata();
      restoreSessionMetadata(log);
      
      
      
      haikuTitleAttemptedRef.current = true;
      setHaikuTitle(undefined);

      
      
      
      
      
      
      
      
      
      
      if (entrypoint !== 'fork') {
        exitRestoredWorktree();
        restoreWorktreeForResume(log.worktreeSession);
        adoptResumedSessionFile();
        void restoreRemoteAgentTasks({
          abortController: new AbortController(),
          getAppState: () => store.getState(),
          setAppState
        });
      } else {
        
        
        
        const ws = getCurrentWorktreeSession();
        if (ws) saveWorktreeState(ws);
      }

      
      if (feature('COORDINATOR_MODE')) {
        
        const {
          saveMode
        } = require('../utils/sessionStorage.js');
        const {
          isCoordinatorMode
        } = require('../coordinator/coordinatorMode.js') as typeof import('../coordinator/coordinatorMode.js');
        
        saveMode(isCoordinatorMode() ? 'coordinator' : 'normal');
      }

      
      if (targetSessionCosts) {
        setCostStateForRestore(targetSessionCosts);
      }

      
      
      
      
      
      
      
      
      
      
      
      if (contentReplacementStateRef.current && entrypoint !== 'fork') {
        contentReplacementStateRef.current = reconstructContentReplacementState(messages, log.contentReplacements ?? []);
      }

      
      
      setMessages(() => messages);

      
      setToolJSX(null);

      
      setInputValue('');
      logEvent('tengu_session_resumed', {
        entrypoint: entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: true,
        resume_duration_ms: Math.round(performance.now() - resumeStart)
      });
    } catch (error) {
      logEvent('tengu_session_resumed', {
        entrypoint: entrypoint as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: false
      });
      throw error;
    }
  }, [resetLoadingState, setAppState]);

  
  
  
  
  const [initialReadFileState] = useState(() => createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE));
  const readFileState = useRef(initialReadFileState);
  const bashTools = useRef(new Set<string>());
  const bashToolsProcessedIdx = useRef(0);
  
  
  
  
  
  const discoveredSkillNamesRef = useRef(new Set<string>());
  
  
  
  const loadedNestedMemoryPathsRef = useRef(new Set<string>());

  
  
  const restoreReadFileState = useCallback((messages: MessageType[], cwd: string) => {
    const extracted = extractReadFilesFromMessages(messages, cwd, READ_FILE_STATE_CACHE_SIZE);
    readFileState.current = mergeFileStateCaches(readFileState.current, extracted);
    for (const tool of extractBashToolsFromMessages(messages)) {
      bashTools.current.add(tool);
    }
  }, []);

  
  
  
  useEffect(() => {
    if (initialMessages && initialMessages.length > 0) {
      restoreReadFileState(initialMessages, getOriginalCwd());
      void restoreRemoteAgentTasks({
        abortController: new AbortController(),
        getAppState: () => store.getState(),
        setAppState
      });
    }
    
    
  }, []);
  const {
    status: apiKeyStatus,
    reverify
  } = useApiKeyVerification();

  
  const [autoRunIssueReason, setAutoRunIssueReason] = useState<AutoRunIssueReason | null>(null);
  
  
  
  const didAutoRunIssueRef = useRef(false);

  
  const [exitFlow, setExitFlow] = useState<React.ReactNode>(null);
  const [isExiting, setIsExiting] = useState(false);

  
  const showingCostDialog = !isLoading && showCostDialog;

  
  
  
  
  function getFocusedInputDialog(): 'message-selector' | 'sandbox-permission' | 'tool-permission' | 'prompt' | 'worker-sandbox-permission' | 'elicitation' | 'cost' | 'idle-return' | 'init-onboarding' | 'ide-onboarding' | 'model-switch' | 'undercover-callout' | 'effort-callout' | 'remote-callout' | 'lsp-recommendation' | 'plugin-hint' | 'desktop-upsell' | 'ultraplan-choice' | 'ultraplan-launch' | undefined {
    
    if (isExiting || exitFlow) return undefined;

    
    if (isMessageSelectorVisible) return 'message-selector';

    
    if (isPromptInputActive) return undefined;
    if (sandboxPermissionRequestQueue[0]) return 'sandbox-permission';

    
    const allowDialogsWithAnimation = !toolJSX || toolJSX.shouldContinueAnimation;
    if (allowDialogsWithAnimation && toolUseConfirmQueue[0]) return 'tool-permission';
    if (allowDialogsWithAnimation && promptQueue[0]) return 'prompt';
    
    if (allowDialogsWithAnimation && workerSandboxPermissions.queue[0]) return 'worker-sandbox-permission';
    if (allowDialogsWithAnimation && elicitation.queue[0]) return 'elicitation';
    if (allowDialogsWithAnimation && showingCostDialog) return 'cost';
    if (allowDialogsWithAnimation && idleReturnPending) return 'idle-return';
    if (feature('ULTRAPLAN') && allowDialogsWithAnimation && !isLoading && ultraplanPendingChoice) return 'ultraplan-choice';
    if (feature('ULTRAPLAN') && allowDialogsWithAnimation && !isLoading && ultraplanLaunchPending) return 'ultraplan-launch';

    
    if (allowDialogsWithAnimation && showIdeOnboarding) return 'ide-onboarding';

    
    if ("external" === 'ant' && allowDialogsWithAnimation && showModelSwitchCallout) return 'model-switch';

    
    if ("external" === 'ant' && allowDialogsWithAnimation && showUndercoverCallout) return 'undercover-callout';

    
    if (allowDialogsWithAnimation && showEffortCallout) return 'effort-callout';

    
    if (allowDialogsWithAnimation && showRemoteCallout) return 'remote-callout';

    
    if (allowDialogsWithAnimation && lspRecommendation) return 'lsp-recommendation';

    
    if (allowDialogsWithAnimation && hintRecommendation) return 'plugin-hint';

    
    if (allowDialogsWithAnimation && showDesktopUpsellStartup) return 'desktop-upsell';
    return undefined;
  }
  const focusedInputDialog = getFocusedInputDialog();

  
  const hasSuppressedDialogs = isPromptInputActive && (sandboxPermissionRequestQueue[0] || toolUseConfirmQueue[0] || promptQueue[0] || workerSandboxPermissions.queue[0] || elicitation.queue[0] || showingCostDialog);

  
  focusedInputDialogRef.current = focusedInputDialog;

  
  
  
  useEffect(() => {
    if (!isLoading) return;
    const isPaused = focusedInputDialog === 'tool-permission';
    const now = Date.now();
    if (isPaused && pauseStartTimeRef.current === null) {
      
      pauseStartTimeRef.current = now;
    } else if (!isPaused && pauseStartTimeRef.current !== null) {
      
      totalPausedMsRef.current += now - pauseStartTimeRef.current;
      pauseStartTimeRef.current = null;
    }
  }, [focusedInputDialog, isLoading]);

  
  
  
  
  
  
  
  
  
  const prevDialogRef = useRef(focusedInputDialog);
  useLayoutEffect(() => {
    const was = prevDialogRef.current === 'tool-permission';
    const now = focusedInputDialog === 'tool-permission';
    if (was !== now) repinScroll();
    prevDialogRef.current = focusedInputDialog;
  }, [focusedInputDialog, repinScroll]);
  function onCancel() {
    if (focusedInputDialog === 'elicitation') {
      
      return;
    }
    logForDebugging(`[onCancel] focusedInputDialog=${focusedInputDialog} streamMode=${streamMode}`);

    
    
    if (feature('PROACTIVE') || feature('KAIROS')) {
      proactiveModule?.pauseProactive();
    }
    queryGuard.forceEnd();
    skipIdleCheckRef.current = false;

    
    
    
    
    if (streamingText?.trim()) {
      setMessages(prev => [...prev, createAssistantMessage({
        content: streamingText
      })]);
    }
    resetLoadingState();

    
    
    if (feature('TOKEN_BUDGET')) {
      snapshotOutputTokensForTurn(null);
    }
    if (focusedInputDialog === 'tool-permission') {
      
      toolUseConfirmQueue[0]?.onAbort();
      setToolUseConfirmQueue([]);
    } else if (focusedInputDialog === 'prompt') {
      
      for (const item of promptQueue) {
        item.reject(new Error('Prompt cancelled by user'));
      }
      setPromptQueue([]);
      abortController?.abort('user-cancel');
    } else if (activeRemote.isRemoteMode) {
      
      activeRemote.cancelRequest();
    } else {
      abortController?.abort('user-cancel');
    }

    
    
    
    
    setAbortController(null);

    
    void mrOnTurnComplete(messagesRef.current, true);
  }

  
  const handleQueuedCommandOnCancel = useCallback(() => {
    const result = popAllEditable(inputValue, 0);
    if (!result) return;
    setInputValue(result.text);
    setInputMode('prompt');

    
    if (result.images.length > 0) {
      setPastedContents(prev => {
        const newContents = {
          ...prev
        };
        for (const image of result.images) {
          newContents[image.id] = image;
        }
        return newContents;
      });
    }
  }, [setInputValue, setInputMode, inputValue, setPastedContents]);

  
  const cancelRequestProps = {
    setToolUseConfirmQueue,
    onCancel,
    onAgentsKilled: () => setMessages(prev => [...prev, createAgentsKilledMessage()]),
    isMessageSelectorVisible: isMessageSelectorVisible || !!showBashesDialog,
    screen,
    abortSignal: abortController?.signal,
    popCommandFromQueue: handleQueuedCommandOnCancel,
    vimMode,
    isLocalJSXCommand: toolJSX?.isLocalJSXCommand,
    isSearchingHistory,
    isHelpOpen,
    inputMode,
    inputValue,
    streamMode
  };
  useEffect(() => {
    const totalCost = getTotalCost();
    if (totalCost >= 5  && !showCostDialog && !haveShownCostDialog) {
      logEvent('tengu_cost_threshold_reached', {});
      
      
      
      setHaveShownCostDialog(true);
      if (hasConsoleBillingAccess()) {
        setShowCostDialog(true);
      }
    }
  }, [messages, showCostDialog, haveShownCostDialog]);
  const sandboxAskCallback: SandboxAskCallback = useCallback(async (hostPattern: NetworkHostPattern) => {
    
    if (isAgentSwarmsEnabled() && isSwarmWorker()) {
      const requestId = generateSandboxRequestId();

      
      const sent = await sendSandboxPermissionRequestViaMailbox(hostPattern.host, requestId);
      return new Promise(resolveShouldAllowHost => {
        if (!sent) {
          
          setSandboxPermissionRequestQueue(prev => [...prev, {
            hostPattern,
            resolvePromise: resolveShouldAllowHost
          }]);
          return;
        }

        
        registerSandboxPermissionCallback({
          requestId,
          host: hostPattern.host,
          resolve: resolveShouldAllowHost
        });

        
        setAppState(prev => ({
          ...prev,
          pendingSandboxRequest: {
            requestId,
            host: hostPattern.host
          }
        }));
      });
    }

    
    
    return new Promise(resolveShouldAllowHost => {
      let resolved = false;
      function resolveOnce(allow: boolean): void {
        if (resolved) return;
        resolved = true;
        resolveShouldAllowHost(allow);
      }

      
      setSandboxPermissionRequestQueue(prev => [...prev, {
        hostPattern,
        resolvePromise: resolveOnce
      }]);

      
      
      
      if (feature('BRIDGE_MODE')) {
        const bridgeCallbacks = store.getState().replBridgePermissionCallbacks;
        if (bridgeCallbacks) {
          const bridgeRequestId = randomUUID();
          bridgeCallbacks.sendRequest(bridgeRequestId, SANDBOX_NETWORK_ACCESS_TOOL_NAME, {
            host: hostPattern.host
          }, randomUUID(), `Allow network connection to ${hostPattern.host}?`);
          const unsubscribe = bridgeCallbacks.onResponse(bridgeRequestId, response => {
            unsubscribe();
            const allow = response.behavior === 'allow';
            
            
            setSandboxPermissionRequestQueue(queue => {
              queue.filter(item => item.hostPattern.host === hostPattern.host).forEach(item => item.resolvePromise(allow));
              return queue.filter(item => item.hostPattern.host !== hostPattern.host);
            });
            
            
            const siblingCleanups = sandboxBridgeCleanupRef.current.get(hostPattern.host);
            if (siblingCleanups) {
              for (const fn of siblingCleanups) {
                fn();
              }
              sandboxBridgeCleanupRef.current.delete(hostPattern.host);
            }
          });

          
          
          
          const cleanup = () => {
            unsubscribe();
            bridgeCallbacks.cancelRequest(bridgeRequestId);
          };
          const existing = sandboxBridgeCleanupRef.current.get(hostPattern.host) ?? [];
          existing.push(cleanup);
          sandboxBridgeCleanupRef.current.set(hostPattern.host, existing);
        }
      }
    });
  }, [setAppState, store]);

  
  
  
  
  
  useEffect(() => {
    const reason = SandboxManager.getSandboxUnavailableReason();
    if (!reason) return;
    if (SandboxManager.isSandboxRequired()) {
      process.stderr.write(`\nError: sandbox required but unavailable: ${reason}\n` + `  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`);
      gracefulShutdownSync(1, 'other');
      return;
    }
    logForDebugging(`sandbox disabled: ${reason}`, {
      level: 'warn'
    });
    addNotification({
      key: 'sandbox-unavailable',
      jsx: <>
          <Text color="warning">sandbox disabled</Text>
          <Text dimColor> · /sandbox</Text>
        </>,
      priority: 'medium'
    });
  }, [addNotification]);
  if (SandboxManager.isSandboxingEnabled()) {
    
    SandboxManager.initialize(sandboxAskCallback).catch(err => {
      
      process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`);
      gracefulShutdownSync(1, 'other');
    });
  }
  const setToolPermissionContext = useCallback((context: ToolPermissionContext, options?: {
    preserveMode?: boolean;
  }) => {
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: {
        ...context,
        
        
        
        
        
        
        mode: options?.preserveMode ? prev.toolPermissionContext.mode : context.mode
      }
    }));

    
    
    
    setImmediate(setToolUseConfirmQueue => {
      
      
      setToolUseConfirmQueue(currentQueue => {
        currentQueue.forEach(item => {
          void item.recheckPermission();
        });
        return currentQueue;
      });
    }, setToolUseConfirmQueue);
  }, [setAppState, setToolUseConfirmQueue]);

  
  useEffect(() => {
    registerLeaderSetToolPermissionContext(setToolPermissionContext);
    return () => unregisterLeaderSetToolPermissionContext();
  }, [setToolPermissionContext]);
  const canUseTool = useCanUseTool(setToolUseConfirmQueue, setToolPermissionContext);
  const requestPrompt = useCallback((title: string, toolInputSummary?: string | null) => (request: PromptRequest): Promise<PromptResponse> => new Promise<PromptResponse>((resolve, reject) => {
    setPromptQueue(prev => [...prev, {
      request,
      title,
      toolInputSummary,
      resolve,
      reject
    }]);
  }), []);
  const getToolUseContext = useCallback((messages: MessageType[], newMessages: MessageType[], abortController: AbortController, mainLoopModel: string): ProcessUserInputContext => {
    
    
    
    
    const s = store.getState();

    
    
    
    
    
    const computeTools = () => {
      const state = store.getState();
      const assembled = assembleToolPool(state.toolPermissionContext, state.mcp.tools);
      const merged = mergeAndFilterTools(combinedInitialTools, assembled, state.toolPermissionContext.mode);
      if (!mainThreadAgentDefinition) return merged;
      return resolveAgentTools(mainThreadAgentDefinition, merged, false, true).resolvedTools;
    };
    return {
      abortController,
      options: {
        commands,
        tools: computeTools(),
        debug,
        verbose: s.verbose,
        mainLoopModel,
        thinkingConfig: s.thinkingEnabled !== false ? thinkingConfig : {
          type: 'disabled'
        },
        
        
        mcpClients: mergeClients(initialMcpClients, s.mcp.clients),
        mcpResources: s.mcp.resources,
        ideInstallationStatus: ideInstallationStatus,
        isNonInteractiveSession: false,
        dynamicMcpConfig,
        theme,
        agentDefinitions: allowedAgentTypes ? {
          ...s.agentDefinitions,
          allowedAgentTypes
        } : s.agentDefinitions,
        customSystemPrompt,
        appendSystemPrompt,
        refreshTools: computeTools
      },
      getAppState: () => store.getState(),
      setAppState,
      messages,
      setMessages,
      updateFileHistoryState(updater: (prev: FileHistoryState) => FileHistoryState) {
        
        
        
        setAppState(prev => {
          const updated = updater(prev.fileHistory);
          if (updated === prev.fileHistory) return prev;
          return {
            ...prev,
            fileHistory: updated
          };
        });
      },
      updateAttributionState(updater: (prev: AttributionState) => AttributionState) {
        setAppState(prev => {
          const updated = updater(prev.attribution);
          if (updated === prev.attribution) return prev;
          return {
            ...prev,
            attribution: updated
          };
        });
      },
      openMessageSelector: () => {
        if (!disabled) {
          setIsMessageSelectorVisible(true);
        }
      },
      onChangeAPIKey: reverify,
      readFileState: readFileState.current,
      setToolJSX,
      addNotification,
      appendSystemMessage: msg => setMessages(prev => [...prev, msg]),
      sendOSNotification: opts => {
        void sendNotification(opts, terminal);
      },
      onChangeDynamicMcpConfig,
      onInstallIDEExtension: setIDEToInstallExtension,
      nestedMemoryAttachmentTriggers: new Set<string>(),
      loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
      dynamicSkillDirTriggers: new Set<string>(),
      discoveredSkillNames: discoveredSkillNamesRef.current,
      setResponseLength,
      pushApiMetricsEntry: "external" === 'ant' ? (ttftMs: number) => {
        const now = Date.now();
        const baseline = responseLengthRef.current;
        apiMetricsRef.current.push({
          ttftMs,
          firstTokenTime: now,
          lastTokenTime: now,
          responseLengthBaseline: baseline,
          endResponseLength: baseline
        });
      } : undefined,
      setStreamMode,
      onCompactProgress: event => {
        switch (event.type) {
          case 'hooks_start':
            setSpinnerColor('claudeBlue_FOR_SYSTEM_SPINNER');
            setSpinnerShimmerColor('claudeBlueShimmer_FOR_SYSTEM_SPINNER');
            setSpinnerMessage(event.hookType === 'pre_compact' ? 'Running PreCompact hooks\u2026' : event.hookType === 'post_compact' ? 'Running PostCompact hooks\u2026' : 'Running SessionStart hooks\u2026');
            break;
          case 'compact_start':
            setSpinnerMessage('Compacting conversation');
            break;
          case 'compact_end':
            setSpinnerMessage(null);
            setSpinnerColor(null);
            setSpinnerShimmerColor(null);
            break;
        }
      },
      setInProgressToolUseIDs,
      setHasInterruptibleToolInProgress: (v: boolean) => {
        hasInterruptibleToolInProgressRef.current = v;
      },
      resume,
      setConversationId,
      requestPrompt: feature('HOOK_PROMPTS') ? requestPrompt : undefined,
      contentReplacementState: contentReplacementStateRef.current
    };
  }, [commands, combinedInitialTools, mainThreadAgentDefinition, debug, initialMcpClients, ideInstallationStatus, dynamicMcpConfig, theme, allowedAgentTypes, store, setAppState, reverify, addNotification, setMessages, onChangeDynamicMcpConfig, resume, requestPrompt, disabled, customSystemPrompt, appendSystemPrompt, setConversationId]);

  
  const handleBackgroundQuery = useCallback(() => {
    
    abortController?.abort('background');
    
    
    
    const removedNotifications = removeByFilter(cmd => cmd.mode === 'task-notification');
    void (async () => {
      const toolUseContext = getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel);
      const [defaultSystemPrompt, userContext, systemContext] = await Promise.all([getSystemPrompt(toolUseContext.options.tools, mainLoopModel, Array.from(toolPermissionContext.additionalWorkingDirectories.keys()), toolUseContext.options.mcpClients), getUserContext(), getSystemContext()]);
      const systemPrompt = buildEffectiveSystemPrompt({
        mainThreadAgentDefinition,
        toolUseContext,
        customSystemPrompt,
        defaultSystemPrompt,
        appendSystemPrompt
      });
      toolUseContext.renderedSystemPrompt = systemPrompt;
      const notificationAttachments = await getQueuedCommandAttachments(removedNotifications).catch(() => []);
      const notificationMessages = notificationAttachments.map(createAttachmentMessage);

      
      
      
      
      
      const existingPrompts = new Set<string>();
      for (const m of messagesRef.current) {
        if (m.type === 'attachment' && m.attachment.type === 'queued_command' && m.attachment.commandMode === 'task-notification' && typeof m.attachment.prompt === 'string') {
          existingPrompts.add(m.attachment.prompt);
        }
      }
      const uniqueNotifications = notificationMessages.filter(m => m.attachment.type === 'queued_command' && (typeof m.attachment.prompt !== 'string' || !existingPrompts.has(m.attachment.prompt)));
      startBackgroundSession({
        messages: [...messagesRef.current, ...uniqueNotifications],
        queryParams: {
          systemPrompt,
          userContext,
          systemContext,
          canUseTool,
          toolUseContext,
          querySource: getQuerySourceForREPL()
        },
        description: terminalTitle,
        setAppState,
        agentDefinition: mainThreadAgentDefinition
      });
    })();
  }, [abortController, mainLoopModel, toolPermissionContext, mainThreadAgentDefinition, getToolUseContext, customSystemPrompt, appendSystemPrompt, canUseTool, setAppState]);
  const {
    handleBackgroundSession
  } = useSessionBackgrounding({
    setMessages,
    setIsLoading: setIsExternalLoading,
    resetLoadingState,
    setAbortController,
    onBackgroundQuery: handleBackgroundQuery
  });
  const onQueryEvent = useCallback((event: Parameters<typeof handleMessageFromStream>[0]) => {
    handleMessageFromStream(event, newMessage => {
      if (isCompactBoundaryMessage(newMessage)) {
        
        
        
        
        
        
        
        if (isFullscreenEnvEnabled()) {
          setMessages(old => [...getMessagesAfterCompactBoundary(old, {
            includeSnipped: true
          }), newMessage]);
        } else {
          setMessages(() => [newMessage]);
        }
        
        
        setConversationId(randomUUID());
        
        if (feature('PROACTIVE') || feature('KAIROS')) {
          proactiveModule?.setContextBlocked(false);
        }
      } else if (newMessage.type === 'progress' && isEphemeralToolProgress(newMessage.data.type)) {
        
        
        
        
        
        
        
        
        
        
        setMessages(oldMessages => {
          const last = oldMessages.at(-1);
          if (last?.type === 'progress' && last.parentToolUseID === newMessage.parentToolUseID && last.data.type === newMessage.data.type) {
            const copy = oldMessages.slice();
            copy[copy.length - 1] = newMessage;
            return copy;
          }
          return [...oldMessages, newMessage];
        });
      } else {
        setMessages(oldMessages => [...oldMessages, newMessage]);
      }
      
      
      
      if (feature('PROACTIVE') || feature('KAIROS')) {
        if (newMessage.type === 'assistant' && 'isApiErrorMessage' in newMessage && newMessage.isApiErrorMessage) {
          proactiveModule?.setContextBlocked(true);
        } else if (newMessage.type === 'assistant') {
          proactiveModule?.setContextBlocked(false);
        }
      }
    }, newContent => {
      
      
      
      setResponseLength(length => length + newContent.length);
    }, setStreamMode, setStreamingToolUses, tombstonedMessage => {
      setMessages(oldMessages => oldMessages.filter(m => m !== tombstonedMessage));
      void removeTranscriptMessage(tombstonedMessage.uuid);
    }, setStreamingThinking, metrics => {
      const now = Date.now();
      const baseline = responseLengthRef.current;
      apiMetricsRef.current.push({
        ...metrics,
        firstTokenTime: now,
        lastTokenTime: now,
        responseLengthBaseline: baseline,
        endResponseLength: baseline
      });
    }, onStreamingText);
  }, [setMessages, setResponseLength, setStreamMode, setStreamingToolUses, setStreamingThinking, onStreamingText]);
  const onQueryImpl = useCallback(async (messagesIncludingNewMessages: MessageType[], newMessages: MessageType[], abortController: AbortController, shouldQuery: boolean, additionalAllowedTools: string[], mainLoopModelParam: string, effort?: EffortValue) => {
    
    
    
    if (shouldQuery) {
      const freshClients = mergeClients(initialMcpClients, store.getState().mcp.clients);
      void diagnosticTracker.handleQueryStart(freshClients);
      const ideClient = getConnectedIdeClient(freshClients);
      if (ideClient) {
        void closeOpenDiffs(ideClient);
      }
    }

    
    void maybeMarkProjectOnboardingComplete();

    
    
    
    
    
    
    
    if (!titleDisabled && !sessionTitle && !agentTitle && !haikuTitleAttemptedRef.current) {
      const firstUserMessage = newMessages.find(m => m.type === 'user' && !m.isMeta);
      const text = firstUserMessage?.type === 'user' ? getContentText(firstUserMessage.message.content) : null;
      
      
      
      
      if (text && !text.startsWith(`<${LOCAL_COMMAND_STDOUT_TAG}>`) && !text.startsWith(`<${COMMAND_MESSAGE_TAG}>`) && !text.startsWith(`<${COMMAND_NAME_TAG}>`) && !text.startsWith(`<${BASH_INPUT_TAG}>`)) {
        haikuTitleAttemptedRef.current = true;
        void generateSessionTitle(text, new AbortController().signal).then(title => {
          if (title) setHaikuTitle(title);else haikuTitleAttemptedRef.current = false;
        }, () => {
          haikuTitleAttemptedRef.current = false;
        });
      }
    }

    
    
    
    
    
    
    
    
    
    
    store.setState(prev => {
      const cur = prev.toolPermissionContext.alwaysAllowRules.command;
      if (cur === additionalAllowedTools || cur?.length === additionalAllowedTools.length && cur.every((v, i) => v === additionalAllowedTools[i])) {
        return prev;
      }
      return {
        ...prev,
        toolPermissionContext: {
          ...prev.toolPermissionContext,
          alwaysAllowRules: {
            ...prev.toolPermissionContext.alwaysAllowRules,
            command: additionalAllowedTools
          }
        }
      };
    });

    
    
    if (!shouldQuery) {
      
      
      
      if (newMessages.some(isCompactBoundaryMessage)) {
        
        
        setConversationId(randomUUID());
        if (feature('PROACTIVE') || feature('KAIROS')) {
          proactiveModule?.setContextBlocked(false);
        }
      }
      resetLoadingState();
      setAbortController(null);
      return;
    }
    const toolUseContext = getToolUseContext(messagesIncludingNewMessages, newMessages, abortController, mainLoopModelParam);
    
    
    
    
    
    const {
      tools: freshTools,
      mcpClients: freshMcpClients
    } = toolUseContext.options;

    
    
    
    if (effort !== undefined) {
      const previousGetAppState = toolUseContext.getAppState;
      toolUseContext.getAppState = () => ({
        ...previousGetAppState(),
        effortValue: effort
      });
    }
    queryCheckpoint('query_context_loading_start');
    const [,, defaultSystemPrompt, baseUserContext, systemContext] = await Promise.all([
    
    checkAndDisableBypassPermissionsIfNeeded(toolPermissionContext, setAppState),
    
    feature('TRANSCRIPT_CLASSIFIER') ? checkAndDisableAutoModeIfNeeded(toolPermissionContext, setAppState, store.getState().fastMode) : undefined, getSystemPrompt(freshTools, mainLoopModelParam, Array.from(toolPermissionContext.additionalWorkingDirectories.keys()), freshMcpClients), getUserContext(), getSystemContext()]);
    const userContext = {
      ...baseUserContext,
      ...getCoordinatorUserContext(freshMcpClients, isScratchpadEnabled() ? getScratchpadDir() : undefined),
      ...((feature('PROACTIVE') || feature('KAIROS')) && proactiveModule?.isProactiveActive() && !terminalFocusRef.current ? {
        terminalFocus: 'The terminal is unfocused \u2014 the user is not actively watching.'
      } : {})
    };
    queryCheckpoint('query_context_loading_end');
    const systemPrompt = buildEffectiveSystemPrompt({
      mainThreadAgentDefinition,
      toolUseContext,
      customSystemPrompt,
      defaultSystemPrompt,
      appendSystemPrompt
    });
    toolUseContext.renderedSystemPrompt = systemPrompt;
    queryCheckpoint('query_query_start');
    resetTurnHookDuration();
    resetTurnToolDuration();
    resetTurnClassifierDuration();
    for await (const event of query({
      messages: messagesIncludingNewMessages,
      systemPrompt,
      userContext,
      systemContext,
      canUseTool,
      toolUseContext,
      querySource: getQuerySourceForREPL()
    })) {
      onQueryEvent(event);
    }
    if (feature('BUDDY')) {
      void fireCompanionObserver(messagesRef.current, reaction => setAppState(prev => prev.companionReaction === reaction ? prev : {
        ...prev,
        companionReaction: reaction
      }));
    }
    queryCheckpoint('query_end');

    
    
    if ("external" === 'ant' && apiMetricsRef.current.length > 0) {
      const entries = apiMetricsRef.current;
      const ttfts = entries.map(e => e.ttftMs);
      
      
      
      const otpsValues = entries.map(e => {
        const delta = Math.round((e.endResponseLength - e.responseLengthBaseline) / 4);
        const samplingMs = e.lastTokenTime - e.firstTokenTime;
        return samplingMs > 0 ? Math.round(delta / (samplingMs / 1000)) : 0;
      });
      const isMultiRequest = entries.length > 1;
      const hookMs = getTurnHookDurationMs();
      const hookCount = getTurnHookCount();
      const toolMs = getTurnToolDurationMs();
      const toolCount = getTurnToolCount();
      const classifierMs = getTurnClassifierDurationMs();
      const classifierCount = getTurnClassifierCount();
      const turnMs = Date.now() - loadingStartTimeRef.current;
      setMessages(prev => [...prev, createApiMetricsMessage({
        ttftMs: isMultiRequest ? median(ttfts) : ttfts[0]!,
        otps: isMultiRequest ? median(otpsValues) : otpsValues[0]!,
        isP50: isMultiRequest,
        hookDurationMs: hookMs > 0 ? hookMs : undefined,
        hookCount: hookCount > 0 ? hookCount : undefined,
        turnDurationMs: turnMs > 0 ? turnMs : undefined,
        toolDurationMs: toolMs > 0 ? toolMs : undefined,
        toolCount: toolCount > 0 ? toolCount : undefined,
        classifierDurationMs: classifierMs > 0 ? classifierMs : undefined,
        classifierCount: classifierCount > 0 ? classifierCount : undefined,
        configWriteCount: getGlobalConfigWriteCount()
      })]);
    }
    resetLoadingState();

    
    logQueryProfileReport();

    
    await onTurnComplete?.(messagesRef.current);
  }, [initialMcpClients, resetLoadingState, getToolUseContext, toolPermissionContext, setAppState, customSystemPrompt, onTurnComplete, appendSystemPrompt, canUseTool, mainThreadAgentDefinition, onQueryEvent, sessionTitle, titleDisabled]);
  const onQuery = useCallback(async (newMessages: MessageType[], abortController: AbortController, shouldQuery: boolean, additionalAllowedTools: string[], mainLoopModelParam: string, onBeforeQueryCallback?: (input: string, newMessages: MessageType[]) => Promise<boolean>, input?: string, effort?: EffortValue): Promise<void> => {
    
    if (isAgentSwarmsEnabled()) {
      const teamName = getTeamName();
      const agentName = getAgentName();
      if (teamName && agentName) {
        
        void setMemberActive(teamName, agentName, true);
      }
    }

    
    
    
    const thisGeneration = queryGuard.tryStart();
    if (thisGeneration === null) {
      logEvent('tengu_concurrent_onquery_detected', {});

      
      
      
      newMessages.filter((m): m is UserMessage => m.type === 'user' && !m.isMeta).map(_ => getContentText(_.message.content)).filter(_ => _ !== null).forEach((msg, i) => {
        enqueue({
          value: msg,
          mode: 'prompt'
        });
        if (i === 0) {
          logEvent('tengu_concurrent_onquery_enqueued', {});
        }
      });
      return;
    }
    try {
      
      
      resetTimingRefs();
      setMessages(oldMessages => [...oldMessages, ...newMessages]);
      responseLengthRef.current = 0;
      if (feature('TOKEN_BUDGET')) {
        const parsedBudget = input ? parseTokenBudget(input) : null;
        snapshotOutputTokensForTurn(parsedBudget ?? getCurrentTurnTokenBudget());
      }
      apiMetricsRef.current = [];
      setStreamingToolUses([]);
      setStreamingText(null);

      
      
      
      
      
      const latestMessages = messagesRef.current;
      if (input) {
        await mrOnBeforeQuery(input, latestMessages, newMessages.length);
      }

      
      if (onBeforeQueryCallback && input) {
        const shouldProceed = await onBeforeQueryCallback(input, latestMessages);
        if (!shouldProceed) {
          return;
        }
      }
      await onQueryImpl(latestMessages, newMessages, abortController, shouldQuery, additionalAllowedTools, mainLoopModelParam, effort);
    } finally {
      
      
      
      if (queryGuard.end(thisGeneration)) {
        setLastQueryCompletionTime(Date.now());
        skipIdleCheckRef.current = false;
        
        
        
        resetLoadingState();
        await mrOnTurnComplete(messagesRef.current, abortController.signal.aborted);

        
        
        sendBridgeResultRef.current();

        
        
        
        
        
        
        if ("external" === 'ant' && !abortController.signal.aborted) {
          setAppState(prev => {
            if (prev.tungstenActiveSession === undefined) return prev;
            if (prev.tungstenPanelAutoHidden === true) return prev;
            return {
              ...prev,
              tungstenPanelAutoHidden: true
            };
          });
        }

        
        let budgetInfo: {
          tokens: number;
          limit: number;
          nudges: number;
        } | undefined;
        if (feature('TOKEN_BUDGET')) {
          if (getCurrentTurnTokenBudget() !== null && getCurrentTurnTokenBudget()! > 0 && !abortController.signal.aborted) {
            budgetInfo = {
              tokens: getTurnOutputTokens(),
              limit: getCurrentTurnTokenBudget()!,
              nudges: getBudgetContinuationCount()
            };
          }
          snapshotOutputTokensForTurn(null);
        }

        
        
        
        const turnDurationMs = Date.now() - loadingStartTimeRef.current - totalPausedMsRef.current;
        if ((turnDurationMs > 30000 || budgetInfo !== undefined) && !abortController.signal.aborted && !proactiveActive) {
          const hasRunningSwarmAgents = getAllInProcessTeammateTasks(store.getState().tasks).some(t => t.status === 'running');
          if (hasRunningSwarmAgents) {
            
            if (swarmStartTimeRef.current === null) {
              swarmStartTimeRef.current = loadingStartTimeRef.current;
            }
            
            if (budgetInfo) {
              swarmBudgetInfoRef.current = budgetInfo;
            }
          } else {
            setMessages(prev => [...prev, createTurnDurationMessage(turnDurationMs, budgetInfo, count(prev, isLoggableMessage))]);
          }
        }
        
        
        
        
        setAbortController(null);
      }

      
      
      
      
      
      
      
      
      
      
      
      
      
      
      if (abortController.signal.reason === 'user-cancel' && !queryGuard.isActive && inputValueRef.current === '' && getCommandQueueLength() === 0 && !store.getState().viewingAgentTaskId) {
        const msgs = messagesRef.current;
        const lastUserMsg = msgs.findLast(selectableUserMessagesFilter);
        if (lastUserMsg) {
          const idx = msgs.lastIndexOf(lastUserMsg);
          if (messagesAfterAreOnlySynthetic(msgs, idx)) {
            
            
            removeLastFromHistory();
            restoreMessageSyncRef.current(lastUserMsg);
          }
        }
      }
    }
  }, [onQueryImpl, setAppState, resetLoadingState, queryGuard, mrOnBeforeQuery, mrOnTurnComplete]);

  
  
  const initialMessageRef = useRef(false);
  useEffect(() => {
    const pending = initialMessage;
    if (!pending || isLoading || initialMessageRef.current) return;

    
    initialMessageRef.current = true;
    async function processInitialMessage(initialMsg: NonNullable<typeof pending>) {
      
      if (initialMsg.clearContext) {
        
        
        const oldPlanSlug = initialMsg.message.planContent ? getPlanSlug() : undefined;
        const {
          clearConversation
        } = await import('../commands/clear/conversation.js');
        await clearConversation({
          setMessages,
          readFileState: readFileState.current,
          discoveredSkillNames: discoveredSkillNamesRef.current,
          loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
          getAppState: () => store.getState(),
          setAppState,
          setConversationId
        });
        haikuTitleAttemptedRef.current = false;
        setHaikuTitle(undefined);
        bashTools.current.clear();
        bashToolsProcessedIdx.current = 0;

        
        if (oldPlanSlug) {
          setPlanSlug(getSessionId(), oldPlanSlug);
        }
      }

      
      const shouldStorePlanForVerification = initialMsg.message.planContent && "external" === 'ant' && isEnvTruthy(undefined);
      setAppState(prev => {
        
        let updatedToolPermissionContext = initialMsg.mode ? applyPermissionUpdates(prev.toolPermissionContext, buildPermissionUpdates(initialMsg.mode, initialMsg.allowedPrompts)) : prev.toolPermissionContext;
        
        
        if (feature('TRANSCRIPT_CLASSIFIER') && initialMsg.mode === 'auto') {
          updatedToolPermissionContext = stripDangerousPermissionsForAutoMode({
            ...updatedToolPermissionContext,
            mode: 'auto',
            prePlanMode: undefined
          });
        }
        return {
          ...prev,
          initialMessage: null,
          toolPermissionContext: updatedToolPermissionContext,
          ...(shouldStorePlanForVerification && {
            pendingPlanVerification: {
              plan: initialMsg.message.planContent!,
              verificationStarted: false,
              verificationCompleted: false
            }
          })
        };
      });

      
      if (fileHistoryEnabled()) {
        void fileHistoryMakeSnapshot((updater: (prev: FileHistoryState) => FileHistoryState) => {
          setAppState(prev => ({
            ...prev,
            fileHistory: updater(prev.fileHistory)
          }));
        }, initialMsg.message.uuid);
      }

      
      
      
      await awaitPendingHooks();

      
      
      
      const content = initialMsg.message.message.content;

      
      
      
      if (typeof content === 'string' && !initialMsg.message.planContent) {
        
        void onSubmit(content, {
          setCursorOffset: () => {},
          clearBuffer: () => {},
          resetHistory: () => {}
        });
      } else {
        
        
        
        const newAbortController = createAbortController();
        setAbortController(newAbortController);
        void onQuery([initialMsg.message], newAbortController, true,
        
        [],
        
        mainLoopModel);
      }

      
      setTimeout(ref => {
        ref.current = false;
      }, 100, initialMessageRef);
    }
    void processInitialMessage(pending);
  }, [initialMessage, isLoading, setMessages, setAppState, onQuery, mainLoopModel, tools]);
  const onSubmit = useCallback(async (input: string, helpers: PromptInputHelpers, speculationAccept?: {
    state: ActiveSpeculationState;
    speculationSessionTimeSavedMs: number;
    setAppState: SetAppState;
  }, options?: {
    fromKeybinding?: boolean;
  }) => {
    
    
    repinScroll();

    
    if (feature('PROACTIVE') || feature('KAIROS')) {
      proactiveModule?.resumeProactive();
    }

    
    
    
    if (!speculationAccept && input.trim().startsWith('/')) {
      
      
      
      const trimmedInput = expandPastedTextRefs(input, pastedContents).trim();
      const spaceIndex = trimmedInput.indexOf(' ');
      const commandName = spaceIndex === -1 ? trimmedInput.slice(1) : trimmedInput.slice(1, spaceIndex);
      const commandArgs = spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim();

      
      
      
      const matchingCommand = commands.find(cmd => isCommandEnabled(cmd) && (cmd.name === commandName || cmd.aliases?.includes(commandName) || getCommandName(cmd) === commandName));
      if (matchingCommand?.name === 'clear' && idleHintShownRef.current) {
        logEvent('tengu_idle_return_action', {
          action: 'hint_converted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          variant: idleHintShownRef.current as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          idleMinutes: Math.round((Date.now() - lastQueryCompletionTimeRef.current) / 60_000),
          messageCount: messagesRef.current.length,
          totalInputTokens: getTotalInputTokens()
        });
        idleHintShownRef.current = false;
      }
      const shouldTreatAsImmediate = queryGuard.isActive && (matchingCommand?.immediate || options?.fromKeybinding);
      if (matchingCommand && shouldTreatAsImmediate && matchingCommand.type === 'local-jsx') {
        
        
        
        if (input.trim() === inputValueRef.current.trim()) {
          setInputValue('');
          helpers.setCursorOffset(0);
          helpers.clearBuffer();
          setPastedContents({});
        }
        const pastedTextRefs = parseReferences(input).filter(r => pastedContents[r.id]?.type === 'text');
        const pastedTextCount = pastedTextRefs.length;
        const pastedTextBytes = pastedTextRefs.reduce((sum, r) => sum + (pastedContents[r.id]?.content.length ?? 0), 0);
        logEvent('tengu_paste_text', {
          pastedTextCount,
          pastedTextBytes
        });
        logEvent('tengu_immediate_command_executed', {
          commandName: matchingCommand.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          fromKeybinding: options?.fromKeybinding ?? false
        });

        
        const executeImmediateCommand = async (): Promise<void> => {
          let doneWasCalled = false;
          const onDone = (result?: string, doneOptions?: {
            display?: CommandResultDisplay;
            metaMessages?: string[];
          }): void => {
            doneWasCalled = true;
            setToolJSX({
              jsx: null,
              shouldHidePromptInput: false,
              clearLocalJSX: true
            });
            const newMessages: MessageType[] = [];
            if (result && doneOptions?.display !== 'skip') {
              addNotification({
                key: `immediate-${matchingCommand.name}`,
                text: result,
                priority: 'immediate'
              });
              
              
              
              
              
              
              
              if (!isFullscreenEnvEnabled()) {
                newMessages.push(createCommandInputMessage(formatCommandInputTags(getCommandName(matchingCommand), commandArgs)), createCommandInputMessage(`<${LOCAL_COMMAND_STDOUT_TAG}>${escapeXml(result)}</${LOCAL_COMMAND_STDOUT_TAG}>`));
              }
            }
            
            if (doneOptions?.metaMessages?.length) {
              newMessages.push(...doneOptions.metaMessages.map(content => createUserMessage({
                content,
                isMeta: true
              })));
            }
            if (newMessages.length) {
              setMessages(prev => [...prev, ...newMessages]);
            }
            
            
            
            if (stashedPrompt !== undefined) {
              setInputValue(stashedPrompt.text);
              helpers.setCursorOffset(stashedPrompt.cursorOffset);
              setPastedContents(stashedPrompt.pastedContents);
              setStashedPrompt(undefined);
            }
          };

          
          
          
          
          const context = getToolUseContext(messagesRef.current, [], createAbortController(), mainLoopModel);
          const mod = await matchingCommand.load();
          const jsx = await mod.call(onDone, context, commandArgs);

          
          
          if (jsx && !doneWasCalled) {
            
            
            setToolJSX({
              jsx,
              shouldHidePromptInput: false,
              isLocalJSXCommand: true
            });
          }
        };
        void executeImmediateCommand();
        return; 
      }
    }

    
    if (activeRemote.isRemoteMode && !input.trim()) {
      return;
    }

    
    
    
    {
      const willowMode = getFeatureValue_CACHED_MAY_BE_STALE('tengu_willow_mode', 'off');
      const idleThresholdMin = Number(process.env.CLAUDE_CODE_NEXT_IDLE_THRESHOLD_MINUTES ?? 75);
      const tokenThreshold = Number(process.env.CLAUDE_CODE_NEXT_IDLE_TOKEN_THRESHOLD ?? 100_000);
      if (willowMode !== 'off' && !getGlobalConfig().idleReturnDismissed && !skipIdleCheckRef.current && !speculationAccept && !input.trim().startsWith('/') && lastQueryCompletionTimeRef.current > 0 && getTotalInputTokens() >= tokenThreshold) {
        const idleMs = Date.now() - lastQueryCompletionTimeRef.current;
        const idleMinutes = idleMs / 60_000;
        if (idleMinutes >= idleThresholdMin && willowMode === 'dialog') {
          setIdleReturnPending({
            input,
            idleMinutes
          });
          setInputValue('');
          helpers.setCursorOffset(0);
          helpers.clearBuffer();
          return;
        }
      }
    }

    
    
    
    
    if (!options?.fromKeybinding) {
      addToHistory({
        display: speculationAccept ? input : prependModeCharacterToInput(input, inputMode),
        pastedContents: speculationAccept ? {} : pastedContents
      });
      
      
      if (inputMode === 'bash') {
        prependToShellHistoryCache(input.trim());
      }
    }

    
    
    
    
    
    
    
    
    
    
    
    const isSlashCommand = !speculationAccept && input.trim().startsWith('/');
    
    
    
    const submitsNow = !isLoading || speculationAccept || activeRemote.isRemoteMode;
    if (stashedPrompt !== undefined && !isSlashCommand && submitsNow) {
      setInputValue(stashedPrompt.text);
      helpers.setCursorOffset(stashedPrompt.cursorOffset);
      setPastedContents(stashedPrompt.pastedContents);
      setStashedPrompt(undefined);
    } else if (submitsNow) {
      if (!options?.fromKeybinding) {
        
        
        setInputValue('');
        helpers.setCursorOffset(0);
      }
      setPastedContents({});
    }
    if (submitsNow) {
      setInputMode('prompt');
      setIDESelection(undefined);
      setSubmitCount(_ => _ + 1);
      helpers.clearBuffer();
      tipPickedThisTurnRef.current = false;

      
      
      
      if (!isSlashCommand && inputMode === 'prompt' && !speculationAccept && !activeRemote.isRemoteMode) {
        setUserInputOnProcessing(input);
        
        
        
        
        resetTimingRefs();
      }

      
      
      if (feature('COMMIT_ATTRIBUTION')) {
        setAppState(prev => ({
          ...prev,
          attribution: incrementPromptCount(prev.attribution, snapshot => {
            void recordAttributionSnapshot(snapshot).catch(error => {
              logForDebugging(`Attribution: Failed to save snapshot: ${error}`);
            });
          })
        }));
      }
    }

    
    if (speculationAccept) {
      const {
        queryRequired
      } = await handleSpeculationAccept(speculationAccept.state, speculationAccept.speculationSessionTimeSavedMs, speculationAccept.setAppState, input, {
        setMessages,
        readFileState,
        cwd: getOriginalCwd()
      });
      if (queryRequired) {
        const newAbortController = createAbortController();
        setAbortController(newAbortController);
        void onQuery([], newAbortController, true, [], mainLoopModel);
      }
      return;
    }

    
    
    
    
    
    
    
    
    if (activeRemote.isRemoteMode && !(isSlashCommand && commands.find(c => {
      const name = input.trim().slice(1).split(/\s/)[0];
      return isCommandEnabled(c) && (c.name === name || c.aliases?.includes(name!) || getCommandName(c) === name);
    })?.type === 'local-jsx')) {
      
      const pastedValues = Object.values(pastedContents);
      const imageContents = pastedValues.filter(c => c.type === 'image');
      const imagePasteIds = imageContents.length > 0 ? imageContents.map(c => c.id) : undefined;
      let messageContent: string | ContentBlockParam[] = input.trim();
      let remoteContent: RemoteMessageContent = input.trim();
      if (pastedValues.length > 0) {
        const contentBlocks: ContentBlockParam[] = [];
        const remoteBlocks: Array<{
          type: string;
          [key: string]: unknown;
        }> = [];
        const trimmedInput = input.trim();
        if (trimmedInput) {
          contentBlocks.push({
            type: 'text',
            text: trimmedInput
          });
          remoteBlocks.push({
            type: 'text',
            text: trimmedInput
          });
        }
        for (const pasted of pastedValues) {
          if (pasted.type === 'image') {
            const source = {
              type: 'base64' as const,
              media_type: (pasted.mediaType ?? 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: pasted.content
            };
            contentBlocks.push({
              type: 'image',
              source
            });
            remoteBlocks.push({
              type: 'image',
              source
            });
          } else {
            contentBlocks.push({
              type: 'text',
              text: pasted.content
            });
            remoteBlocks.push({
              type: 'text',
              text: pasted.content
            });
          }
        }
        messageContent = contentBlocks;
        remoteContent = remoteBlocks;
      }

      
      
      const userMessage = createUserMessage({
        content: messageContent,
        imagePasteIds
      });
      setMessages(prev => [...prev, userMessage]);

      
      await activeRemote.sendMessage(remoteContent, {
        uuid: userMessage.uuid
      });
      return;
    }

    
    await awaitPendingHooks();
    await handlePromptSubmit({
      input,
      helpers,
      queryGuard,
      isExternalLoading,
      mode: inputMode,
      commands,
      onInputChange: setInputValue,
      setPastedContents,
      setToolJSX,
      getToolUseContext,
      messages: messagesRef.current,
      mainLoopModel,
      pastedContents,
      ideSelection,
      setUserInputOnProcessing,
      setAbortController,
      abortController,
      onQuery,
      setAppState,
      querySource: getQuerySourceForREPL(),
      onBeforeQuery,
      canUseTool,
      addNotification,
      setMessages,
      
      
      streamMode: streamModeRef.current,
      hasInterruptibleToolInProgress: hasInterruptibleToolInProgressRef.current
    });

    
    
    
    
    
    
    if ((isSlashCommand || isLoading) && stashedPrompt !== undefined) {
      setInputValue(stashedPrompt.text);
      helpers.setCursorOffset(stashedPrompt.cursorOffset);
      setPastedContents(stashedPrompt.pastedContents);
      setStashedPrompt(undefined);
    }
  }, [queryGuard,
  
  
  
  isLoading, isExternalLoading, inputMode, commands, setInputValue, setInputMode, setPastedContents, setSubmitCount, setIDESelection, setToolJSX, getToolUseContext,
  
  
  
  
  
  
  
  mainLoopModel, pastedContents, ideSelection, setUserInputOnProcessing, setAbortController, addNotification, onQuery, stashedPrompt, setStashedPrompt, setAppState, onBeforeQuery, canUseTool, remoteSession, setMessages, awaitPendingHooks, repinScroll]);

  
  const onAgentSubmit = useCallback(async (input: string, task: InProcessTeammateTaskState | LocalAgentTaskState, helpers: PromptInputHelpers) => {
    if (isLocalAgentTask(task)) {
      appendMessageToLocalAgent(task.id, createUserMessage({
        content: input
      }), setAppState);
      if (task.status === 'running') {
        queuePendingMessage(task.id, input, setAppState);
      } else {
        void resumeAgentBackground({
          agentId: task.id,
          prompt: input,
          toolUseContext: getToolUseContext(messagesRef.current, [], new AbortController(), mainLoopModel),
          canUseTool
        }).catch(err => {
          logForDebugging(`resumeAgentBackground failed: ${errorMessage(err)}`);
          addNotification({
            key: `resume-agent-failed-${task.id}`,
            jsx: <Text color="error">
                  Failed to resume agent: {errorMessage(err)}
                </Text>,
            priority: 'low'
          });
        });
      }
    } else {
      injectUserMessageToTeammate(task.id, input, setAppState);
    }
    setInputValue('');
    helpers.setCursorOffset(0);
    helpers.clearBuffer();
  }, [setAppState, setInputValue, getToolUseContext, canUseTool, mainLoopModel, addNotification]);

  
  const handleAutoRunIssue = useCallback(() => {
    const command = autoRunIssueReason ? getAutoRunCommand(autoRunIssueReason) : '/issue';
    setAutoRunIssueReason(null); 
    onSubmit(command, {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {}
    }).catch(err => {
      logForDebugging(`Auto-run ${command} failed: ${errorMessage(err)}`);
    });
  }, [onSubmit, autoRunIssueReason]);
  const handleCancelAutoRunIssue = useCallback(() => {
    setAutoRunIssueReason(null);
  }, []);

  
  const handleSurveyRequestFeedback = useCallback(() => {
    const command = "external" === 'ant' ? '/issue' : '/feedback';
    onSubmit(command, {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {}
    }).catch(err => {
      logForDebugging(`Survey feedback request failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [onSubmit]);

  
  
  
  
  
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const handleOpenRateLimitOptions = useCallback(() => {
    void onSubmitRef.current('/rate-limit-options', {
      setCursorOffset: () => {},
      clearBuffer: () => {},
      resetHistory: () => {}
    });
  }, []);
  const handleExit = useCallback(async () => {
    setIsExiting(true);
    
    
    
    if (feature('BG_SESSIONS') && isBgSession()) {
      spawnSync('tmux', ['detach-client'], {
        stdio: 'ignore'
      });
      setIsExiting(false);
      return;
    }
    const showWorktree = getCurrentWorktreeSession() !== null;
    if (showWorktree) {
      setExitFlow(<ExitFlow showWorktree onDone={() => {}} onCancel={() => {
        setExitFlow(null);
        setIsExiting(false);
      }} />);
      return;
    }
    const exitMod = await exit.load();
    const exitFlowResult = await exitMod.call(() => {});
    setExitFlow(exitFlowResult);
    
    
    
    if (exitFlowResult === null) {
      setIsExiting(false);
    }
  }, []);
  const handleShowMessageSelector = useCallback(() => {
    setIsMessageSelectorVisible(prev => !prev);
  }, []);

  
  
  
  
  
  const rewindConversationTo = useCallback((message: UserMessage) => {
    const prev = messagesRef.current;
    const messageIndex = prev.lastIndexOf(message);
    if (messageIndex === -1) return;
    logEvent('tengu_conversation_rewind', {
      preRewindMessageCount: prev.length,
      postRewindMessageCount: messageIndex,
      messagesRemoved: prev.length - messageIndex,
      rewindToMessageIndex: messageIndex
    });
    setMessages(prev.slice(0, messageIndex));
    
    setConversationId(randomUUID());
    
    
    resetMicrocompactState();
    if (feature('CONTEXT_COLLAPSE')) {
      
      
      
      
      
      
      
      ;
      (require('../services/contextCollapse/index.js') as typeof import('../services/contextCollapse/index.js')).resetContextCollapse();
      
    }

    
    setAppState(prev => ({
      ...prev,
      
      toolPermissionContext: message.permissionMode && prev.toolPermissionContext.mode !== message.permissionMode ? {
        ...prev.toolPermissionContext,
        mode: message.permissionMode
      } : prev.toolPermissionContext,
      
      promptSuggestion: {
        text: null,
        promptId: null,
        shownAt: 0,
        acceptedAt: 0,
        generationRequestId: null
      }
    }));
  }, [setMessages, setAppState]);

  
  
  
  const restoreMessageSync = useCallback((message: UserMessage) => {
    rewindConversationTo(message);
    const r = textForResubmit(message);
    if (r) {
      setInputValue(r.text);
      setInputMode(r.mode);
    }

    
    if (Array.isArray(message.message.content) && message.message.content.some(block => block.type === 'image')) {
      const imageBlocks: Array<ImageBlockParam> = message.message.content.filter(block => block.type === 'image');
      if (imageBlocks.length > 0) {
        const newPastedContents: Record<number, PastedContent> = {};
        imageBlocks.forEach((block, index) => {
          if (block.source.type === 'base64') {
            const id = message.imagePasteIds?.[index] ?? index + 1;
            newPastedContents[id] = {
              id,
              type: 'image',
              content: block.source.data,
              mediaType: block.source.media_type
            };
          }
        });
        setPastedContents(newPastedContents);
      }
    }
  }, [rewindConversationTo, setInputValue]);
  restoreMessageSyncRef.current = restoreMessageSync;

  
  
  
  const handleRestoreMessage = useCallback(async (message: UserMessage) => {
    setImmediate((restore, message) => restore(message), restoreMessageSync, message);
  }, [restoreMessageSync]);

  
  
  const findRawIndex = (uuid: string) => {
    const prefix = uuid.slice(0, 24);
    return messages.findIndex(m => m.uuid.slice(0, 24) === prefix);
  };
  const messageActionCaps: MessageActionCaps = {
    copy: text =>
    
    void setClipboard(text).then(raw => {
      if (raw) process.stdout.write(raw);
      addNotification({
        
        key: 'selection-copied',
        text: 'copied',
        color: 'success',
        priority: 'immediate',
        timeoutMs: 2000
      });
    }),
    edit: async msg => {
      
      const rawIdx = findRawIndex(msg.uuid);
      const raw = rawIdx >= 0 ? messages[rawIdx] : undefined;
      if (!raw || !selectableUserMessagesFilter(raw)) return;
      const noFileChanges = !(await fileHistoryHasAnyChanges(fileHistory, raw.uuid));
      const onlySynthetic = messagesAfterAreOnlySynthetic(messages, rawIdx);
      if (noFileChanges && onlySynthetic) {
        
        onCancel();
        
        void handleRestoreMessage(raw);
      } else {
        
        setMessageSelectorPreselect(raw);
        setIsMessageSelectorVisible(true);
      }
    }
  };
  const {
    enter: enterMessageActions,
    handlers: messageActionHandlers
  } = useMessageActions(cursor, setCursor, cursorNavRef, messageActionCaps);
  async function onInit() {
    
    
    void reverify();

    
    const memoryFiles = await getMemoryFiles();
    if (memoryFiles.length > 0) {
      const fileList = memoryFiles.map(f => `  [${f.type}] ${f.path} (${f.content.length} chars)${f.parent ? ` (included by ${f.parent})` : ''}`).join('\n');
      logForDebugging(`Loaded ${memoryFiles.length} CLAUDE.md/rules files:\n${fileList}`);
    } else {
      logForDebugging('No CLAUDE.md/rules files found');
    }
    for (const file of memoryFiles) {
      
      
      
      
      readFileState.current.set(file.path, {
        content: file.contentDiffersFromDisk ? file.rawContent ?? file.content : file.content,
        timestamp: Date.now(),
        offset: undefined,
        limit: undefined,
        isPartialView: file.contentDiffersFromDisk
      });
    }

    
  }

  
  useCostSummary(useFpsMetrics());

  
  
  
  
  useLogMessages(messages, messages.length === initialMessages?.length);

  
  
  const {
    sendBridgeResult
  } = useReplBridge(messages, setMessages, abortControllerRef, commands, mainLoopModel);
  sendBridgeResultRef.current = sendBridgeResult;
  useAfterFirstRender();

  
  
  
  
  
  
  const hasCountedQueueUseRef = useRef(false);
  useEffect(() => {
    if (queuedCommands.length < 1) {
      hasCountedQueueUseRef.current = false;
      return;
    }
    if (hasCountedQueueUseRef.current) return;
    hasCountedQueueUseRef.current = true;
    saveGlobalConfig(current => ({
      ...current,
      promptQueueUseCount: (current.promptQueueUseCount ?? 0) + 1
    }));
  }, [queuedCommands.length]);

  

  const executeQueuedInput = useCallback(async (queuedCommands: QueuedCommand[]) => {
    await handlePromptSubmit({
      helpers: {
        setCursorOffset: () => {},
        clearBuffer: () => {},
        resetHistory: () => {}
      },
      queryGuard,
      commands,
      onInputChange: () => {},
      setPastedContents: () => {},
      setToolJSX,
      getToolUseContext,
      messages,
      mainLoopModel,
      ideSelection,
      setUserInputOnProcessing,
      setAbortController,
      onQuery,
      setAppState,
      querySource: getQuerySourceForREPL(),
      onBeforeQuery,
      canUseTool,
      addNotification,
      setMessages,
      queuedCommands
    });
  }, [queryGuard, commands, setToolJSX, getToolUseContext, messages, mainLoopModel, ideSelection, setUserInputOnProcessing, canUseTool, setAbortController, onQuery, addNotification, setAppState, onBeforeQuery]);
  useQueueProcessor({
    executeQueuedInput,
    hasActiveLocalJsxUI: isShowingLocalJSXCommand,
    queryGuard
  });

  

  
  
  useEffect(() => {
    activityManager.recordUserActivity();
    updateLastInteractionTime(true);
  }, [inputValue, submitCount]);
  useEffect(() => {
    if (submitCount === 1) {
      startBackgroundHousekeeping();
    }
  }, [submitCount]);

  
  useEffect(() => {
    
    if (isLoading) return;

    
    if (submitCount === 0) return;

    
    if (lastQueryCompletionTime === 0) return;

    
    const timer = setTimeout((lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal) => {
      
      const lastUserInteraction = getLastInteractionTime();
      if (lastUserInteraction > lastQueryCompletionTime) {
        
        return;
      }

      
      const idleTimeSinceResponse = Date.now() - lastQueryCompletionTime;
      if (!isLoading && !toolJSX &&
      
      focusedInputDialogRef.current === undefined && idleTimeSinceResponse >= getGlobalConfig().messageIdleNotifThresholdMs) {
        void sendNotification({
          message: 'Claude is waiting for your input',
          notificationType: 'idle_prompt'
        }, terminal);
      }
    }, getGlobalConfig().messageIdleNotifThresholdMs, lastQueryCompletionTime, isLoading, toolJSX, focusedInputDialogRef, terminal);
    return () => clearTimeout(timer);
  }, [isLoading, toolJSX, submitCount, lastQueryCompletionTime, terminal]);

  
  
  
  useEffect(() => {
    if (lastQueryCompletionTime === 0) return;
    if (isLoading) return;
    const willowMode: string = getFeatureValue_CACHED_MAY_BE_STALE('tengu_willow_mode', 'off');
    if (willowMode !== 'hint' && willowMode !== 'hint_v2') return;
    if (getGlobalConfig().idleReturnDismissed) return;
    const tokenThreshold = Number(process.env.CLAUDE_CODE_NEXT_IDLE_TOKEN_THRESHOLD ?? 100_000);
    if (getTotalInputTokens() < tokenThreshold) return;
    const idleThresholdMs = Number(process.env.CLAUDE_CODE_NEXT_IDLE_THRESHOLD_MINUTES ?? 75) * 60_000;
    const elapsed = Date.now() - lastQueryCompletionTime;
    const remaining = idleThresholdMs - elapsed;
    const timer = setTimeout((lqct, addNotif, msgsRef, mode, hintRef) => {
      if (msgsRef.current.length === 0) return;
      const totalTokens = getTotalInputTokens();
      const formattedTokens = formatTokens(totalTokens);
      const idleMinutes = (Date.now() - lqct) / 60_000;
      addNotif({
        key: 'idle-return-hint',
        jsx: mode === 'hint_v2' ? <>
                <Text dimColor>new task? </Text>
                <Text color="suggestion">/clear</Text>
                <Text dimColor> to save </Text>
                <Text color="suggestion">{formattedTokens} tokens</Text>
              </> : <Text color="warning">
                new task? /clear to save {formattedTokens} tokens
              </Text>,
        priority: 'medium',
        
        
        
        timeoutMs: 0x7fffffff
      });
      hintRef.current = mode;
      logEvent('tengu_idle_return_action', {
        action: 'hint_shown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        variant: mode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        idleMinutes: Math.round(idleMinutes),
        messageCount: msgsRef.current.length,
        totalInputTokens: totalTokens
      });
    }, Math.max(0, remaining), lastQueryCompletionTime, addNotification, messagesRef, willowMode, idleHintShownRef);
    return () => {
      clearTimeout(timer);
      removeNotification('idle-return-hint');
      idleHintShownRef.current = false;
    };
  }, [lastQueryCompletionTime, isLoading, addNotification, removeNotification]);

  
  
  const handleIncomingPrompt = useCallback((content: string, options?: {
    isMeta?: boolean;
  }): boolean => {
    if (queryGuard.isActive) return false;

    
    
    
    
    
    if (getCommandQueue().some(cmd => cmd.mode === 'prompt' || cmd.mode === 'bash')) {
      return false;
    }
    const newAbortController = createAbortController();
    setAbortController(newAbortController);

    
    const userMessage = createUserMessage({
      content,
      isMeta: options?.isMeta ? true : undefined
    });
    void onQuery([userMessage], newAbortController, true, [], mainLoopModel);
    return true;
  }, [onQuery, mainLoopModel, store]);

  
  const voice = feature('VOICE_MODE') ?
  
  useVoiceIntegration({
    setInputValueRaw,
    inputValueRef,
    insertTextRef
  }) : {
    stripTrailing: () => 0,
    handleKeyEvent: () => {},
    resetAnchor: () => {},
    interimRange: null
  };
  useInboxPoller({
    enabled: isAgentSwarmsEnabled(),
    isLoading,
    focusedInputDialog,
    onSubmitMessage: handleIncomingPrompt
  });
  useMailboxBridge({
    isLoading,
    onSubmitMessage: handleIncomingPrompt
  });

  
  if (feature('AGENT_TRIGGERS')) {
    
    
    
    
    
    
    const assistantMode = store.getState().kairosEnabled;
    
    useScheduledTasks!({
      isLoading,
      assistantMode,
      setMessages
    });
  }

  
  
  

  if ("external" === 'ant') {
    
    
    
    useTaskListWatcher({
      taskListId,
      isLoading,
      onSubmitTask: handleIncomingPrompt
    });

    
    
    
    useProactive?.({
      
      
      
      isLoading: isLoading || initialMessage !== null,
      queuedCommandsLength: queuedCommands.length,
      hasActiveLocalJsxUI: isShowingLocalJSXCommand,
      isInPlanMode: toolPermissionContext.mode === 'plan',
      onSubmitTick: (prompt: string) => handleIncomingPrompt(prompt, {
        isMeta: true
      }),
      onQueueTick: (prompt: string) => enqueue({
        mode: 'prompt',
        value: prompt,
        isMeta: true
      })
    });
  }

  
  
  useEffect(() => {
    if (queuedCommands.some(cmd => cmd.priority === 'now')) {
      abortControllerRef.current?.abort('interrupt');
    }
  }, [queuedCommands]);

  
  useEffect(() => {
    void onInit();

    
    return () => {
      void diagnosticTracker.shutdown();
    };
    
    
  }, []);

  
  const {
    internal_eventEmitter
  } = useStdin();
  const [remountKey, setRemountKey] = useState(0);
  useEffect(() => {
    const handleSuspend = () => {
      
      process.stdout.write(`\nClaude Code Next has been suspended. Run \`fg\` to bring Claude Code Next back.\nNote: ctrl + z now suspends Claude Code Next, ctrl + _ undoes input.\n`);
    };
    const handleResume = () => {
      
      
      setRemountKey(prev => prev + 1);
    };
    internal_eventEmitter?.on('suspend', handleSuspend);
    internal_eventEmitter?.on('resume', handleResume);
    return () => {
      internal_eventEmitter?.off('suspend', handleSuspend);
      internal_eventEmitter?.off('resume', handleResume);
    };
  }, [internal_eventEmitter]);

  
  const stopHookSpinnerSuffix = useMemo(() => {
    if (!isLoading) return null;

    
    const progressMsgs = messages.filter((m): m is ProgressMessage<HookProgress> => m.type === 'progress' && m.data.type === 'hook_progress' && (m.data.hookEvent === 'Stop' || m.data.hookEvent === 'SubagentStop'));
    if (progressMsgs.length === 0) return null;

    
    const currentToolUseID = progressMsgs.at(-1)?.toolUseID;
    if (!currentToolUseID) return null;

    
    const hasSummaryForCurrentExecution = messages.some(m => m.type === 'system' && m.subtype === 'stop_hook_summary' && m.toolUseID === currentToolUseID);
    if (hasSummaryForCurrentExecution) return null;
    const currentHooks = progressMsgs.filter(p => p.toolUseID === currentToolUseID);
    const total = currentHooks.length;

    
    const completedCount = count(messages, m => {
      if (m.type !== 'attachment') return false;
      const attachment = m.attachment;
      return 'hookEvent' in attachment && (attachment.hookEvent === 'Stop' || attachment.hookEvent === 'SubagentStop') && 'toolUseID' in attachment && attachment.toolUseID === currentToolUseID;
    });

    
    const customMessage = currentHooks.find(p => p.data.statusMessage)?.data.statusMessage;
    if (customMessage) {
      
      return total === 1 ? `${customMessage}…` : `${customMessage}… ${completedCount}/${total}`;
    }

    
    const hookType = currentHooks[0]?.data.hookEvent === 'SubagentStop' ? 'subagent stop' : 'stop';
    if ("external" === 'ant') {
      const cmd = currentHooks[completedCount]?.data.command;
      const label = cmd ? ` '${truncateToWidth(cmd, 40)}'` : '';
      return total === 1 ? `running ${hookType} hook${label}` : `running ${hookType} hook${label}\u2026 ${completedCount}/${total}`;
    }
    return total === 1 ? `running ${hookType} hook` : `running stop hooks… ${completedCount}/${total}`;
  }, [messages, isLoading]);

  
  const handleEnterTranscript = useCallback(() => {
    setFrozenTranscriptState({
      messagesLength: messages.length,
      streamingToolUsesLength: streamingToolUses.length
    });
  }, [messages.length, streamingToolUses.length]);

  
  const handleExitTranscript = useCallback(() => {
    setFrozenTranscriptState(null);
  }, []);

  
  const virtualScrollActive = isFullscreenEnvEnabled() && !disableVirtualScroll;

  
  
  
  
  const jumpRef = useRef<JumpHandle | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCount, setSearchCount] = useState(0);
  const [searchCurrent, setSearchCurrent] = useState(0);
  const onSearchMatchesChange = useCallback((count: number, current: number) => {
    setSearchCount(count);
    setSearchCurrent(current);
  }, []);
  useInput((input, key, event) => {
    if (key.ctrl || key.meta) return;
    
    
    
    if (input === '/') {
      
      
      
      jumpRef.current?.setAnchor();
      setSearchOpen(true);
      event.stopImmediatePropagation();
      return;
    }
    
    
    
    const c = input[0];
    if ((c === 'n' || c === 'N') && input === c.repeat(input.length) && searchCount > 0) {
      const fn = c === 'n' ? jumpRef.current?.nextMatch : jumpRef.current?.prevMatch;
      if (fn) for (let i = 0; i < input.length; i++) fn();
      event.stopImmediatePropagation();
    }
  },
  
  
  {
    isActive: screen === 'transcript' && virtualScrollActive && !searchOpen && !dumpMode
  });
  const {
    setQuery: setHighlight,
    scanElement,
    setPositions
  } = useSearchHighlight();

  
  
  
  
  
  const transcriptCols = useTerminalSize().columns;
  const prevColsRef = React.useRef(transcriptCols);
  React.useEffect(() => {
    if (prevColsRef.current !== transcriptCols) {
      prevColsRef.current = transcriptCols;
      if (searchQuery || searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchCount(0);
        setSearchCurrent(0);
        jumpRef.current?.disarmSearch();
        setHighlight('');
      }
    }
  }, [transcriptCols, searchQuery, searchOpen, setHighlight]);

  
  
  useInput((input, key, event) => {
    if (key.ctrl || key.meta) return;
    if (input === 'q') {
      
      handleExitTranscript();
      event.stopImmediatePropagation();
      return;
    }
    if (input === '[' && !dumpMode) {
      
      
      
      
      setDumpMode(true);
      setShowAllInTranscript(true);
      event.stopImmediatePropagation();
    } else if (input === 'v') {
      
      
      
      
      event.stopImmediatePropagation();
      
      
      
      
      if (editorRenderingRef.current) return;
      editorRenderingRef.current = true;
      
      
      
      const gen = editorGenRef.current;
      const setStatus = (s: string): void => {
        if (gen !== editorGenRef.current) return;
        clearTimeout(editorTimerRef.current);
        setEditorStatus(s);
      };
      setStatus(`rendering ${deferredMessages.length} messages…`);
      void (async () => {
        try {
          
          
          
          
          
          const w = Math.max(80, (process.stdout.columns ?? 80) - 6);
          const raw = await renderMessagesToPlainText(deferredMessages, tools, w);
          const text = raw.replace(/[ \t]+$/gm, '');
          const path = join(tmpdir(), `cc-transcript-${Date.now()}.txt`);
          await writeFile(path, text);
          const opened = openFileInExternalEditor(path);
          setStatus(opened ? `opening ${path}` : `wrote ${path} · no $VISUAL/$EDITOR set`);
        } catch (e) {
          setStatus(`render failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        editorRenderingRef.current = false;
        if (gen !== editorGenRef.current) return;
        editorTimerRef.current = setTimeout(s => s(''), 4000, setEditorStatus);
      })();
    }
  },
  
  
  
  {
    isActive: screen === 'transcript' && virtualScrollActive && !searchOpen
  });

  
  
  
  
  const inTranscript = screen === 'transcript' && virtualScrollActive;
  useEffect(() => {
    if (!inTranscript) {
      setSearchQuery('');
      setSearchCount(0);
      setSearchCurrent(0);
      setSearchOpen(false);
      editorGenRef.current++;
      clearTimeout(editorTimerRef.current);
      setDumpMode(false);
      setEditorStatus('');
    }
  }, [inTranscript]);
  useEffect(() => {
    setHighlight(inTranscript ? searchQuery : '');
    
    
    
    if (!inTranscript) setPositions(null);
  }, [inTranscript, searchQuery, setHighlight, setPositions]);
  const globalKeybindingProps = {
    screen,
    setScreen,
    showAllInTranscript,
    setShowAllInTranscript,
    messageCount: messages.length,
    onEnterTranscript: handleEnterTranscript,
    onExitTranscript: handleExitTranscript,
    virtualScrollActive,
    
    
    
    
    
    
    searchBarOpen: searchOpen
  };

  
  const transcriptMessages = frozenTranscriptState ? deferredMessages.slice(0, frozenTranscriptState.messagesLength) : deferredMessages;
  const transcriptStreamingToolUses = frozenTranscriptState ? streamingToolUses.slice(0, frozenTranscriptState.streamingToolUsesLength) : streamingToolUses;

  
  
  
  useBackgroundTaskNavigation({
    onOpenBackgroundTasks: isShowingLocalJSXCommand ? undefined : () => setShowBashesDialog(true)
  });
  
  useTeammateViewAutoExit();
  if (screen === 'transcript') {
    
    
    
    
    
    
    
    
    const transcriptScrollRef = isFullscreenEnvEnabled() && !disableVirtualScroll && !dumpMode ? scrollRef : undefined;
    const transcriptMessagesElement = <Messages messages={transcriptMessages} tools={tools} commands={commands} verbose={true} toolJSX={null} toolUseConfirmQueue={[]} inProgressToolUseIDs={inProgressToolUseIDs} isMessageSelectorVisible={false} conversationId={conversationId} screen={screen} agentDefinitions={agentDefinitions} streamingToolUses={transcriptStreamingToolUses} showAllInTranscript={showAllInTranscript} onOpenRateLimitOptions={handleOpenRateLimitOptions} isLoading={isLoading} hidePastThinking={true} streamingThinking={streamingThinking} scrollRef={transcriptScrollRef} jumpRef={jumpRef} onSearchMatchesChange={onSearchMatchesChange} scanElement={scanElement} setPositions={setPositions} disableRenderCap={dumpMode} />;
    const transcriptToolJSX = toolJSX && <Box flexDirection="column" width="100%">
        {toolJSX.jsx}
      </Box>;
    const transcriptReturn = <KeybindingSetup>
        <AnimatedTerminalTitle isAnimating={titleIsAnimating} title={terminalTitle} disabled={titleDisabled} noPrefix={showStatusInTerminalTab} />
        <GlobalKeybindingHandlers {...globalKeybindingProps} />
        {feature('VOICE_MODE') ? <VoiceKeybindingHandler voiceHandleKeyEvent={voice.handleKeyEvent} stripTrailing={voice.stripTrailing} resetAnchor={voice.resetAnchor} isActive={!toolJSX?.isLocalJSXCommand} /> : null}
        <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!toolJSX?.isLocalJSXCommand} />
        {transcriptScrollRef ?
      
      
      
      
      <ScrollKeybindingHandler scrollRef={scrollRef}
      
      
      isActive={focusedInputDialog !== 'ultraplan-choice'}
      
      
      isModal={!searchOpen}
      
      
      
      
      onScroll={() => jumpRef.current?.disarmSearch()} /> : null}
        <CancelRequestHandler {...cancelRequestProps} />
        {transcriptScrollRef ? <FullscreenLayout scrollRef={scrollRef} scrollable={<>
                {transcriptMessagesElement}
                {transcriptToolJSX}
                <SandboxViolationExpandedView />
              </>} bottom={searchOpen ? <TranscriptSearchBar jumpRef={jumpRef}
      
      
      
      
      initialQuery="" count={searchCount} current={searchCurrent} onClose={q => {
        
        
        setSearchQuery(searchCount > 0 ? q : '');
        setSearchOpen(false);
        
        
        
        
        
        if (!q) {
          setSearchCount(0);
          setSearchCurrent(0);
          jumpRef.current?.setSearchQuery('');
        }
      }} onCancel={() => {
        
        
        
        
        
        
        
        
        setSearchOpen(false);
        jumpRef.current?.setSearchQuery('');
        jumpRef.current?.setSearchQuery(searchQuery);
        setHighlight(searchQuery);
      }} setHighlight={setHighlight} /> : <TranscriptModeFooter showAllInTranscript={showAllInTranscript} virtualScroll={true} status={editorStatus || undefined} searchBadge={searchQuery && searchCount > 0 ? {
        current: searchCurrent,
        count: searchCount
      } : undefined} />} /> : <>
            {transcriptMessagesElement}
            {transcriptToolJSX}
            <SandboxViolationExpandedView />
            <TranscriptModeFooter showAllInTranscript={showAllInTranscript} virtualScroll={false} suppressShowAll={dumpMode} status={editorStatus || undefined} />
          </>}
      </KeybindingSetup>;
    
    
    
    
    
    
    
    
    if (transcriptScrollRef) {
      return <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>
          {transcriptReturn}
        </AlternateScreen>;
    }
    return transcriptReturn;
  }

  
  
  
  
  const viewedTask = viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
  const viewedTeammateTask = viewedTask && isInProcessTeammateTask(viewedTask) ? viewedTask : undefined;
  const viewedAgentTask = viewedTeammateTask ?? (viewedTask && isLocalAgentTask(viewedTask) ? viewedTask : undefined);

  
  
  
  
  
  
  const usesSyncMessages = showStreamingText || !isLoading;
  
  
  const displayedMessages = viewedAgentTask ? viewedAgentTask.messages ?? [] : usesSyncMessages ? messages : deferredMessages;
  
  
  
  
  
  
  
  
  const placeholderText = userInputOnProcessing && !viewedAgentTask && displayedMessages.length <= userInputBaselineRef.current ? userInputOnProcessing : undefined;
  const toolPermissionOverlay = focusedInputDialog === 'tool-permission' ? <PermissionRequest key={toolUseConfirmQueue[0]?.toolUseID} onDone={() => setToolUseConfirmQueue(([_, ...tail]) => tail)} onReject={handleQueuedCommandOnCancel} toolUseConfirm={toolUseConfirmQueue[0]!} toolUseContext={getToolUseContext(messages, messages, abortController ?? createAbortController(), mainLoopModel)} verbose={verbose} workerBadge={toolUseConfirmQueue[0]?.workerBadge} setStickyFooter={isFullscreenEnvEnabled() ? setPermissionStickyFooter : undefined} /> : null;

  
  
  
  const companionNarrow = transcriptCols < MIN_COLS_FOR_FULL_SPRITE;
  
  
  
  
  
  
  const companionVisible = !toolJSX?.shouldHidePromptInput && !focusedInputDialog && !showBashesDialog;

  
  
  
  
  
  
  
  const toolJsxCentered = isFullscreenEnvEnabled() && toolJSX?.isLocalJSXCommand === true;
  const centeredModal: React.ReactNode = toolJsxCentered ? toolJSX!.jsx : null;

  
  
  
  
  
  const mainReturn = <KeybindingSetup>
      <AnimatedTerminalTitle isAnimating={titleIsAnimating} title={terminalTitle} disabled={titleDisabled} noPrefix={showStatusInTerminalTab} />
      <GlobalKeybindingHandlers {...globalKeybindingProps} />
      {feature('VOICE_MODE') ? <VoiceKeybindingHandler voiceHandleKeyEvent={voice.handleKeyEvent} stripTrailing={voice.stripTrailing} resetAnchor={voice.resetAnchor} isActive={!toolJSX?.isLocalJSXCommand} /> : null}
      <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!toolJSX?.isLocalJSXCommand} />
      {

}
      <ScrollKeybindingHandler scrollRef={scrollRef} isActive={isFullscreenEnvEnabled() && (centeredModal != null || !focusedInputDialog || focusedInputDialog === 'tool-permission')} onScroll={centeredModal || toolPermissionOverlay || viewedAgentTask ? undefined : composedOnScroll} />
      {feature('MESSAGE_ACTIONS') && isFullscreenEnvEnabled() && !disableMessageActions ? <MessageActionsKeybindings handlers={messageActionHandlers} isActive={cursor !== null} /> : null}
      <CancelRequestHandler {...cancelRequestProps} />
      <MCPConnectionManager key={remountKey} dynamicMcpConfig={dynamicMcpConfig} isStrictMcpConfig={strictMcpConfig}>
        <FullscreenLayout scrollRef={scrollRef} overlay={toolPermissionOverlay} bottomFloat={feature('BUDDY') && companionVisible && !companionNarrow ? <CompanionFloatingBubble /> : undefined} modal={centeredModal} modalScrollRef={modalScrollRef} dividerYRef={dividerYRef} hidePill={!!viewedAgentTask} hideSticky={!!viewedTeammateTask} newMessageCount={unseenDivider?.count ?? 0} onPillClick={() => {
        setCursor(null);
        jumpToNew(scrollRef.current);
      }} scrollable={<>
              <TeammateViewHeader />
              <Messages messages={displayedMessages} tools={tools} commands={commands} verbose={verbose} toolJSX={toolJSX} toolUseConfirmQueue={toolUseConfirmQueue} inProgressToolUseIDs={viewedTeammateTask ? viewedTeammateTask.inProgressToolUseIDs ?? new Set() : inProgressToolUseIDs} isMessageSelectorVisible={isMessageSelectorVisible} conversationId={conversationId} screen={screen} streamingToolUses={streamingToolUses} showAllInTranscript={showAllInTranscript} agentDefinitions={agentDefinitions} onOpenRateLimitOptions={handleOpenRateLimitOptions} isLoading={isLoading} streamingText={isLoading && !viewedAgentTask ? visibleStreamingText : null} isBriefOnly={viewedAgentTask ? false : isBriefOnly} unseenDivider={viewedAgentTask ? undefined : unseenDivider} scrollRef={isFullscreenEnvEnabled() ? scrollRef : undefined} trackStickyPrompt={isFullscreenEnvEnabled() ? true : undefined} cursor={cursor} setCursor={setCursor} cursorNavRef={cursorNavRef} />
              <AwsAuthStatusBox />
              {

}
              {!disabled && placeholderText && !centeredModal && <UserTextMessage param={{
          text: placeholderText,
          type: 'text'
        }} addMargin={true} verbose={verbose} />}
              {toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) && !toolJsxCentered && <Box flexDirection="column" width="100%">
                    {toolJSX.jsx}
                  </Box>}
              {"external" === 'ant' && <TungstenLiveMonitor />}
              {feature('WEB_BROWSER_TOOL') ? WebBrowserPanelModule && <WebBrowserPanelModule.WebBrowserPanel /> : null}
              <Box flexGrow={1} />
              {showSpinner && <SpinnerWithVerb mode={streamMode} spinnerTip={spinnerTip} responseLengthRef={responseLengthRef} apiMetricsRef={apiMetricsRef} overrideMessage={spinnerMessage} spinnerSuffix={stopHookSpinnerSuffix} verbose={verbose} loadingStartTimeRef={loadingStartTimeRef} totalPausedMsRef={totalPausedMsRef} pauseStartTimeRef={pauseStartTimeRef} overrideColor={spinnerColor} overrideShimmerColor={spinnerShimmerColor} hasActiveTools={inProgressToolUseIDs.size > 0} leaderIsIdle={!isLoading} />}
              {!showSpinner && !isLoading && !userInputOnProcessing && !hasRunningTeammates && isBriefOnly && !viewedAgentTask && <BriefIdleStatus />}
              {isFullscreenEnvEnabled() && <PromptInputQueuedCommands />}
            </>} bottom={<Box flexDirection={feature('BUDDY') && companionNarrow ? 'column' : 'row'} width="100%" alignItems={feature('BUDDY') && companionNarrow ? undefined : 'flex-end'}>
              {feature('BUDDY') && companionNarrow && isFullscreenEnvEnabled() && companionVisible ? <CompanionSprite /> : null}
              <Box flexDirection="column" flexGrow={1}>
                {permissionStickyFooter}
                {

}
                {toolJSX?.isLocalJSXCommand && toolJSX.isImmediate && !toolJsxCentered && <Box flexDirection="column" width="100%">
                      {toolJSX.jsx}
                    </Box>}
                {!showSpinner && !toolJSX?.isLocalJSXCommand && showExpandedTodos && tasksV2 && tasksV2.length > 0 && <Box width="100%" flexDirection="column">
                      <TaskListV2 tasks={tasksV2} isStandalone={true} />
                    </Box>}
                {focusedInputDialog === 'sandbox-permission' && <SandboxPermissionRequest key={sandboxPermissionRequestQueue[0]!.hostPattern.host} hostPattern={sandboxPermissionRequestQueue[0]!.hostPattern} onUserResponse={(response: {
            allow: boolean;
            persistToSettings: boolean;
          }) => {
            const {
              allow,
              persistToSettings
            } = response;
            const currentRequest = sandboxPermissionRequestQueue[0];
            if (!currentRequest) return;
            const approvedHost = currentRequest.hostPattern.host;
            if (persistToSettings) {
              const update = {
                type: 'addRules' as const,
                rules: [{
                  toolName: WEB_FETCH_TOOL_NAME,
                  ruleContent: `domain:${approvedHost}`
                }],
                behavior: (allow ? 'allow' : 'deny') as 'allow' | 'deny',
                destination: 'localSettings' as const
              };
              setAppState(prev => ({
                ...prev,
                toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, update)
              }));
              persistPermissionUpdate(update);

              
              
              SandboxManager.refreshConfig();
            }

            
            
            setSandboxPermissionRequestQueue(queue => {
              queue.filter(item => item.hostPattern.host === approvedHost).forEach(item => item.resolvePromise(allow));
              return queue.filter(item => item.hostPattern.host !== approvedHost);
            });

            
            
            const cleanups = sandboxBridgeCleanupRef.current.get(approvedHost);
            if (cleanups) {
              for (const fn of cleanups) {
                fn();
              }
              sandboxBridgeCleanupRef.current.delete(approvedHost);
            }
          }} />}
                {focusedInputDialog === 'prompt' && <PromptDialog key={promptQueue[0]!.request.prompt} title={promptQueue[0]!.title} toolInputSummary={promptQueue[0]!.toolInputSummary} request={promptQueue[0]!.request} onRespond={selectedKey => {
            const item = promptQueue[0];
            if (!item) return;
            item.resolve({
              prompt_response: item.request.prompt,
              selected: selectedKey
            });
            setPromptQueue(([, ...tail]) => tail);
          }} onAbort={() => {
            const item = promptQueue[0];
            if (!item) return;
            item.reject(new Error('Prompt cancelled by user'));
            setPromptQueue(([, ...tail]) => tail);
          }} />}
                {}
                {pendingWorkerRequest && <WorkerPendingPermission toolName={pendingWorkerRequest.toolName} description={pendingWorkerRequest.description} />}
                {}
                {pendingSandboxRequest && <WorkerPendingPermission toolName="Network Access" description={`Waiting for leader to approve network access to ${pendingSandboxRequest.host}`} />}
                {}
                {focusedInputDialog === 'worker-sandbox-permission' && <SandboxPermissionRequest key={workerSandboxPermissions.queue[0]!.requestId} hostPattern={{
            host: workerSandboxPermissions.queue[0]!.host,
            port: undefined
          } as NetworkHostPattern} onUserResponse={(response: {
            allow: boolean;
            persistToSettings: boolean;
          }) => {
            const {
              allow,
              persistToSettings
            } = response;
            const currentRequest = workerSandboxPermissions.queue[0];
            if (!currentRequest) return;
            const approvedHost = currentRequest.host;

            
            void sendSandboxPermissionResponseViaMailbox(currentRequest.workerName, currentRequest.requestId, approvedHost, allow, teamContext?.teamName);
            if (persistToSettings && allow) {
              const update = {
                type: 'addRules' as const,
                rules: [{
                  toolName: WEB_FETCH_TOOL_NAME,
                  ruleContent: `domain:${approvedHost}`
                }],
                behavior: 'allow' as const,
                destination: 'localSettings' as const
              };
              setAppState(prev => ({
                ...prev,
                toolPermissionContext: applyPermissionUpdate(prev.toolPermissionContext, update)
              }));
              persistPermissionUpdate(update);
              SandboxManager.refreshConfig();
            }

            
            setAppState(prev => ({
              ...prev,
              workerSandboxPermissions: {
                ...prev.workerSandboxPermissions,
                queue: prev.workerSandboxPermissions.queue.slice(1)
              }
            }));
          }} />}
                {focusedInputDialog === 'elicitation' && <ElicitationDialog key={elicitation.queue[0]!.serverName + ':' + String(elicitation.queue[0]!.requestId)} event={elicitation.queue[0]!} onResponse={(action, content) => {
            const currentRequest = elicitation.queue[0];
            if (!currentRequest) return;
            
            currentRequest.respond({
              action,
              content
            });
            
            const isUrlAccept = currentRequest.params.mode === 'url' && action === 'accept';
            if (!isUrlAccept) {
              setAppState(prev => ({
                ...prev,
                elicitation: {
                  queue: prev.elicitation.queue.slice(1)
                }
              }));
            }
          }} onWaitingDismiss={action => {
            const currentRequest = elicitation.queue[0];
            
            setAppState(prev => ({
              ...prev,
              elicitation: {
                queue: prev.elicitation.queue.slice(1)
              }
            }));
            currentRequest?.onWaitingDismiss?.(action);
          }} />}
                {focusedInputDialog === 'cost' && <CostThresholdDialog onDone={() => {
            setShowCostDialog(false);
            setHaveShownCostDialog(true);
            saveGlobalConfig(current => ({
              ...current,
              hasAcknowledgedCostThreshold: true
            }));
            logEvent('tengu_cost_threshold_acknowledged', {});
          }} />}
                {focusedInputDialog === 'idle-return' && idleReturnPending && <IdleReturnDialog idleMinutes={idleReturnPending.idleMinutes} totalInputTokens={getTotalInputTokens()} onDone={async action => {
            const pending = idleReturnPending;
            setIdleReturnPending(null);
            logEvent('tengu_idle_return_action', {
              action: action as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              idleMinutes: Math.round(pending.idleMinutes),
              messageCount: messagesRef.current.length,
              totalInputTokens: getTotalInputTokens()
            });
            if (action === 'dismiss') {
              setInputValue(pending.input);
              return;
            }
            if (action === 'never') {
              saveGlobalConfig(current => {
                if (current.idleReturnDismissed) return current;
                return {
                  ...current,
                  idleReturnDismissed: true
                };
              });
            }
            if (action === 'clear') {
              const {
                clearConversation
              } = await import('../commands/clear/conversation.js');
              await clearConversation({
                setMessages,
                readFileState: readFileState.current,
                discoveredSkillNames: discoveredSkillNamesRef.current,
                loadedNestedMemoryPaths: loadedNestedMemoryPathsRef.current,
                getAppState: () => store.getState(),
                setAppState,
                setConversationId
              });
              haikuTitleAttemptedRef.current = false;
              setHaikuTitle(undefined);
              bashTools.current.clear();
              bashToolsProcessedIdx.current = 0;
            }
            skipIdleCheckRef.current = true;
            void onSubmitRef.current(pending.input, {
              setCursorOffset: () => {},
              clearBuffer: () => {},
              resetHistory: () => {}
            });
          }} />}
                {focusedInputDialog === 'ide-onboarding' && <IdeOnboardingDialog onDone={() => setShowIdeOnboarding(false)} installationStatus={ideInstallationStatus} />}
                {"external" === 'ant' && focusedInputDialog === 'model-switch' && AntModelSwitchCallout && <AntModelSwitchCallout onDone={(selection: string, modelAlias?: string) => {
            setShowModelSwitchCallout(false);
            if (selection === 'switch' && modelAlias) {
              setAppState(prev => ({
                ...prev,
                mainLoopModel: modelAlias,
                mainLoopModelForSession: null
              }));
            }
          }} />}
                {"external" === 'ant' && focusedInputDialog === 'undercover-callout' && UndercoverAutoCallout && <UndercoverAutoCallout onDone={() => setShowUndercoverCallout(false)} />}
                {focusedInputDialog === 'effort-callout' && <EffortCallout model={mainLoopModel} onDone={selection => {
            setShowEffortCallout(false);
            if (selection !== 'dismiss') {
              setAppState(prev => ({
                ...prev,
                effortValue: selection
              }));
            }
          }} />}
                {focusedInputDialog === 'remote-callout' && <RemoteCallout onDone={selection => {
            setAppState(prev => {
              if (!prev.showRemoteCallout) return prev;
              return {
                ...prev,
                showRemoteCallout: false,
                ...(selection === 'enable' && {
                  replBridgeEnabled: true,
                  replBridgeExplicit: true,
                  replBridgeOutboundOnly: false
                })
              };
            });
          }} />}

                {exitFlow}

                {focusedInputDialog === 'plugin-hint' && hintRecommendation && <PluginHintMenu pluginName={hintRecommendation.pluginName} pluginDescription={hintRecommendation.pluginDescription} marketplaceName={hintRecommendation.marketplaceName} sourceCommand={hintRecommendation.sourceCommand} onResponse={handleHintResponse} />}

                {focusedInputDialog === 'lsp-recommendation' && lspRecommendation && <LspRecommendationMenu pluginName={lspRecommendation.pluginName} pluginDescription={lspRecommendation.pluginDescription} fileExtension={lspRecommendation.fileExtension} onResponse={handleLspResponse} />}

                {focusedInputDialog === 'desktop-upsell' && <DesktopUpsellStartup onDone={() => setShowDesktopUpsellStartup(false)} />}

                {feature('ULTRAPLAN') ? focusedInputDialog === 'ultraplan-choice' && ultraplanPendingChoice && <UltraplanChoiceDialog plan={ultraplanPendingChoice.plan} sessionId={ultraplanPendingChoice.sessionId} taskId={ultraplanPendingChoice.taskId} setMessages={setMessages} readFileState={readFileState.current} getAppState={() => store.getState()} setConversationId={setConversationId} /> : null}

                {feature('ULTRAPLAN') ? focusedInputDialog === 'ultraplan-launch' && ultraplanLaunchPending && <UltraplanLaunchDialog onChoice={(choice, opts) => {
            const blurb = ultraplanLaunchPending.blurb;
            setAppState(prev => prev.ultraplanLaunchPending ? {
              ...prev,
              ultraplanLaunchPending: undefined
            } : prev);
            if (choice === 'cancel') return;
            
            
            
            setMessages(prev => [...prev, createCommandInputMessage(formatCommandInputTags('ultraplan', blurb))]);
            const appendStdout = (msg: string) => setMessages(prev => [...prev, createCommandInputMessage(`<${LOCAL_COMMAND_STDOUT_TAG}>${escapeXml(msg)}</${LOCAL_COMMAND_STDOUT_TAG}>`)]);
            
            
            
            const appendWhenIdle = (msg: string) => {
              if (!queryGuard.isActive) {
                appendStdout(msg);
                return;
              }
              const unsub = queryGuard.subscribe(() => {
                if (queryGuard.isActive) return;
                unsub();
                
                
                
                if (!store.getState().ultraplanSessionUrl) return;
                appendStdout(msg);
              });
            };
            void launchUltraplan({
              blurb,
              getAppState: () => store.getState(),
              setAppState,
              signal: createAbortController().signal,
              disconnectedBridge: opts?.disconnectedBridge,
              onSessionReady: appendWhenIdle
            }).then(appendStdout).catch(logError);
          }} /> : null}

                {mrRender()}

                {!toolJSX?.shouldHidePromptInput && !focusedInputDialog && !isExiting && !disabled && !cursor && <>
                      {autoRunIssueReason && <AutoRunIssueNotification onRun={handleAutoRunIssue} onCancel={handleCancelAutoRunIssue} reason={getAutoRunIssueReasonText(autoRunIssueReason)} />}
                      {postCompactSurvey.state !== 'closed' ? <FeedbackSurvey state={postCompactSurvey.state} lastResponse={postCompactSurvey.lastResponse} handleSelect={postCompactSurvey.handleSelect} inputValue={inputValue} setInputValue={setInputValue} onRequestFeedback={handleSurveyRequestFeedback} /> : memorySurvey.state !== 'closed' ? <FeedbackSurvey state={memorySurvey.state} lastResponse={memorySurvey.lastResponse} handleSelect={memorySurvey.handleSelect} handleTranscriptSelect={memorySurvey.handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} onRequestFeedback={handleSurveyRequestFeedback} message="How well did Claude use its memory? (optional)" /> : <FeedbackSurvey state={feedbackSurvey.state} lastResponse={feedbackSurvey.lastResponse} handleSelect={feedbackSurvey.handleSelect} handleTranscriptSelect={feedbackSurvey.handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} onRequestFeedback={didAutoRunIssueRef.current ? undefined : handleSurveyRequestFeedback} />}
                      {}
                      {frustrationDetection.state !== 'closed' && <FeedbackSurvey state={frustrationDetection.state} lastResponse={null} handleSelect={() => {}} handleTranscriptSelect={frustrationDetection.handleTranscriptSelect} inputValue={inputValue} setInputValue={setInputValue} />}
                      {}
                      {"external" === 'ant' && skillImprovementSurvey.suggestion && <SkillImprovementSurvey isOpen={skillImprovementSurvey.isOpen} skillName={skillImprovementSurvey.suggestion.skillName} updates={skillImprovementSurvey.suggestion.updates} handleSelect={skillImprovementSurvey.handleSelect} inputValue={inputValue} setInputValue={setInputValue} />}
                      {showIssueFlagBanner && <IssueFlagBanner />}
                      {}
                      <PromptInput debug={debug} ideSelection={ideSelection} hasSuppressedDialogs={!!hasSuppressedDialogs} isLocalJSXCommandActive={isShowingLocalJSXCommand} getToolUseContext={getToolUseContext} toolPermissionContext={toolPermissionContext} setToolPermissionContext={setToolPermissionContext} apiKeyStatus={apiKeyStatus} commands={commands} agents={agentDefinitions.activeAgents} isLoading={isLoading} onExit={handleExit} verbose={verbose} messages={messages} onAutoUpdaterResult={setAutoUpdaterResult} autoUpdaterResult={autoUpdaterResult} input={inputValue} onInputChange={setInputValue} mode={inputMode} onModeChange={setInputMode} stashedPrompt={stashedPrompt} setStashedPrompt={setStashedPrompt} submitCount={submitCount} onShowMessageSelector={handleShowMessageSelector} onMessageActionsEnter={
            
            feature('MESSAGE_ACTIONS') && isFullscreenEnvEnabled() && !disableMessageActions ? enterMessageActions : undefined} mcpClients={mcpClients} pastedContents={pastedContents} setPastedContents={setPastedContents} vimMode={vimMode} setVimMode={setVimMode} showBashesDialog={showBashesDialog} setShowBashesDialog={setShowBashesDialog} onSubmit={onSubmit} onAgentSubmit={onAgentSubmit} isSearchingHistory={isSearchingHistory} setIsSearchingHistory={setIsSearchingHistory} helpOpen={isHelpOpen} setHelpOpen={setIsHelpOpen} insertTextRef={feature('VOICE_MODE') ? insertTextRef : undefined} voiceInterimRange={voice.interimRange} />
                      <SessionBackgroundHint onBackgroundSession={handleBackgroundSession} isLoading={isLoading} />
                    </>}
                {cursor &&
          
          <MessageActionsBar cursor={cursor} />}
                {focusedInputDialog === 'message-selector' && <MessageSelector messages={messages} preselectedMessage={messageSelectorPreselect} onPreRestore={onCancel} onRestoreCode={async (message: UserMessage) => {
            await fileHistoryRewind((updater: (prev: FileHistoryState) => FileHistoryState) => {
              setAppState(prev => ({
                ...prev,
                fileHistory: updater(prev.fileHistory)
              }));
            }, message.uuid);
          }} onSummarize={async (message: UserMessage, feedback?: string, direction: PartialCompactDirection = 'from') => {
            
            
            const compactMessages = getMessagesAfterCompactBoundary(messages);
            const messageIndex = compactMessages.indexOf(message);
            if (messageIndex === -1) {
              
              
              
              
              setMessages(prev => [...prev, createSystemMessage('That message is no longer in the active context (snipped or pre-compact). Choose a more recent message.', 'warning')]);
              return;
            }
            const newAbortController = createAbortController();
            const context = getToolUseContext(compactMessages, [], newAbortController, mainLoopModel);
            const appState = context.getAppState();
            const defaultSysPrompt = await getSystemPrompt(context.options.tools, context.options.mainLoopModel, Array.from(appState.toolPermissionContext.additionalWorkingDirectories.keys()), context.options.mcpClients);
            const systemPrompt = buildEffectiveSystemPrompt({
              mainThreadAgentDefinition: undefined,
              toolUseContext: context,
              customSystemPrompt: context.options.customSystemPrompt,
              defaultSystemPrompt: defaultSysPrompt,
              appendSystemPrompt: context.options.appendSystemPrompt
            });
            const [userContext, systemContext] = await Promise.all([getUserContext(), getSystemContext()]);
            const result = await partialCompactConversation(compactMessages, messageIndex, context, {
              systemPrompt,
              userContext,
              systemContext,
              toolUseContext: context,
              forkContextMessages: compactMessages
            }, feedback, direction);
            const kept = result.messagesToKeep ?? [];
            const ordered = direction === 'up_to' ? [...result.summaryMessages, ...kept] : [...kept, ...result.summaryMessages];
            const postCompact = [result.boundaryMarker, ...ordered, ...result.attachments, ...result.hookResults];
            
            
            
            
            
            if (isFullscreenEnvEnabled() && direction === 'from') {
              setMessages(old => {
                const rawIdx = old.findIndex(m => m.uuid === message.uuid);
                return [...old.slice(0, rawIdx === -1 ? 0 : rawIdx), ...postCompact];
              });
            } else {
              setMessages(postCompact);
            }
            
            
            if (feature('PROACTIVE') || feature('KAIROS')) {
              proactiveModule?.setContextBlocked(false);
            }
            setConversationId(randomUUID());
            runPostCompactCleanup(context.options.querySource);
            if (direction === 'from') {
              const r = textForResubmit(message);
              if (r) {
                setInputValue(r.text);
                setInputMode(r.mode);
              }
            }

            
            const historyShortcut = getShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o');
            addNotification({
              key: 'summarize-ctrl-o-hint',
              text: `Conversation summarized (${historyShortcut} for history)`,
              priority: 'medium',
              timeoutMs: 8000
            });
          }} onRestoreMessage={handleRestoreMessage} onClose={() => {
            setIsMessageSelectorVisible(false);
            setMessageSelectorPreselect(undefined);
          }} />}
                {"external" === 'ant' && <DevBar />}
              </Box>
              {feature('BUDDY') && !(companionNarrow && isFullscreenEnvEnabled()) && companionVisible ? <CompanionSprite /> : null}
            </Box>} />
      </MCPConnectionManager>
    </KeybindingSetup>;
  if (isFullscreenEnvEnabled()) {
    return <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>
        {mainReturn}
      </AlternateScreen>;
  }
  return mainReturn;
}
