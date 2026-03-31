import { feature } from 'bun:bundle';
import chalk from 'chalk';
import * as path from 'path';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { useCommandQueue } from 'src/hooks/useCommandQueue.js';
import { type IDEAtMentioned, useIdeAtMentioned } from 'src/hooks/useIdeAtMentioned.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { type AppState, useAppState, useAppStateStore, useSetAppState } from 'src/state/AppState.js';
import type { FooterItem } from 'src/state/AppStateStore.js';
import { getCwd } from 'src/utils/cwd.js';
import { isQueuedCommandEditable, popAllEditable } from 'src/utils/messageQueueManager.js';
import stripAnsi from 'strip-ansi';
import { companionReservedColumns } from '../../buddy/CompanionSprite.js';
import { findBuddyTriggerPositions, useBuddyNotification } from '../../buddy/useBuddyNotification.js';
import { FastModePicker } from '../../commands/fast/fast.js';
import { isUltrareviewEnabled } from '../../commands/review/ultrareviewEnabled.js';
import { getNativeCSIuTerminalDisplayName } from '../../commands/terminalSetup/terminalSetup.js';
import { type Command, hasCommand } from '../../commands.js';
import { useIsModalOverlayActive } from '../../context/overlayContext.js';
import { useSetPromptOverlayDialog } from '../../context/promptOverlayContext.js';
import { formatImageRef, formatPastedTextRef, getPastedTextRefNumLines, parseReferences } from '../../history.js';
import type { VerificationStatus } from '../../hooks/useApiKeyVerification.js';
import { type HistoryMode, useArrowKeyHistory } from '../../hooks/useArrowKeyHistory.js';
import { useDoublePress } from '../../hooks/useDoublePress.js';
import { useHistorySearch } from '../../hooks/useHistorySearch.js';
import type { IDESelection } from '../../hooks/useIdeSelection.js';
import { useInputBuffer } from '../../hooks/useInputBuffer.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { usePromptSuggestion } from '../../hooks/usePromptSuggestion.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { useTypeahead } from '../../hooks/useTypeahead.js';
import type { BorderTextOptions } from '../../ink/render-border.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, type ClickEvent, type Key, Text, useInput } from '../../ink.js';
import { useOptionalKeybindingContext } from '../../keybindings/KeybindingContext.js';
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js';
import { useKeybinding, useKeybindings } from '../../keybindings/useKeybinding.js';
import type { MCPServerConnection } from '../../services/mcp/types.js';
import { abortPromptSuggestion, logSuggestionSuppressed } from '../../services/PromptSuggestion/promptSuggestion.js';
import { type ActiveSpeculationState, abortSpeculation } from '../../services/PromptSuggestion/speculation.js';
import { getActiveAgentForInput, getViewedTeammateTask } from '../../state/selectors.js';
import { enterTeammateView, exitTeammateView, stopOrDismissAgent } from '../../state/teammateViewHelpers.js';
import type { ToolPermissionContext } from '../../Tool.js';
import { getRunningTeammatesSorted } from '../../tasks/InProcessTeammateTask/InProcessTeammateTask.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { isPanelAgentTask, type LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js';
import { isBackgroundTask } from '../../tasks/types.js';
import { AGENT_COLOR_TO_THEME_COLOR, AGENT_COLORS, type AgentColorName } from '../../tools/AgentTool/agentColorManager.js';
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js';
import type { Message } from '../../types/message.js';
import type { PermissionMode } from '../../types/permissions.js';
import type { BaseTextInputProps, PromptInputMode, VimMode } from '../../types/textInputTypes.js';
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js';
import { count } from '../../utils/array.js';
import type { AutoUpdaterResult } from '../../utils/autoUpdater.js';
import { Cursor } from '../../utils/Cursor.js';
import { getGlobalConfig, type PastedContent, saveGlobalConfig } from '../../utils/config.js';
import { logForDebugging } from '../../utils/debug.js';
import { parseDirectMemberMessage, sendDirectMemberMessage } from '../../utils/directMemberMessage.js';
import type { EffortLevel } from '../../utils/effort.js';
import { env } from '../../utils/env.js';
import { errorMessage } from '../../utils/errors.js';
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js';
import { getFastModeUnavailableReason, isFastModeAvailable, isFastModeCooldown, isFastModeEnabled, isFastModeSupportedByModel } from '../../utils/fastMode.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import type { PromptInputHelpers } from '../../utils/handlePromptSubmit.js';
import { getImageFromClipboard, PASTE_THRESHOLD } from '../../utils/imagePaste.js';
import type { ImageDimensions } from '../../utils/imageResizer.js';
import { cacheImagePath, storeImage } from '../../utils/imageStore.js';
import { isMacosOptionChar, MACOS_OPTION_SPECIAL_CHARS } from '../../utils/keyboardShortcuts.js';
import { logError } from '../../utils/log.js';
import { isOpus1mMergeEnabled, modelDisplayString } from '../../utils/model/model.js';
import { setAutoModeActive } from '../../utils/permissions/autoModeState.js';
import { cyclePermissionMode, getNextPermissionMode } from '../../utils/permissions/getNextPermissionMode.js';
import { transitionPermissionMode } from '../../utils/permissions/permissionSetup.js';
import { getPlatform } from '../../utils/platform.js';
import type { ProcessUserInputContext } from '../../utils/processUserInput/processUserInput.js';
import { editPromptInEditor } from '../../utils/promptEditor.js';
import { hasAutoModeOptIn } from '../../utils/settings/settings.js';
import { findBtwTriggerPositions } from '../../utils/sideQuestion.js';
import { findSlashCommandPositions } from '../../utils/suggestions/commandSuggestions.js';
import { findSlackChannelPositions, getKnownChannelsVersion, hasSlackMcpServer, subscribeKnownChannels } from '../../utils/suggestions/slackChannelSuggestions.js';
import { isInProcessEnabled } from '../../utils/swarm/backends/registry.js';
import { syncTeammateMode } from '../../utils/swarm/teamHelpers.js';
import type { TeamSummary } from '../../utils/teamDiscovery.js';
import { getTeammateColor } from '../../utils/teammate.js';
import { isInProcessTeammate } from '../../utils/teammateContext.js';
import { writeToMailbox } from '../../utils/teammateMailbox.js';
import type { TextHighlight } from '../../utils/textHighlighting.js';
import type { Theme } from '../../utils/theme.js';
import { findThinkingTriggerPositions, getRainbowColor, isUltrathinkEnabled } from '../../utils/thinking.js';
import { findTokenBudgetPositions } from '../../utils/tokenBudget.js';
import { findUltraplanTriggerPositions, findUltrareviewTriggerPositions } from '../../utils/ultraplan/keyword.js';
import { AutoModeOptInDialog } from '../AutoModeOptInDialog.js';
import { BridgeDialog } from '../BridgeDialog.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';
import { getVisibleAgentTasks, useCoordinatorTaskCount } from '../CoordinatorAgentStatus.js';
import { getEffortNotificationText } from '../EffortIndicator.js';
import { getFastIconString } from '../FastIcon.js';
import { GlobalSearchDialog } from '../GlobalSearchDialog.js';
import { HistorySearchDialog } from '../HistorySearchDialog.js';
import { ModelPicker } from '../ModelPicker.js';
import { QuickOpenDialog } from '../QuickOpenDialog.js';
import TextInput from '../TextInput.js';
import { ThinkingToggle } from '../ThinkingToggle.js';
import { BackgroundTasksDialog } from '../tasks/BackgroundTasksDialog.js';
import { shouldHideTasksFooter } from '../tasks/taskStatusUtils.js';
import { TeamsDialog } from '../teams/TeamsDialog.js';
import VimTextInput from '../VimTextInput.js';
import { getModeFromInput, getValueFromInput } from './inputModes.js';
import { FOOTER_TEMPORARY_STATUS_TIMEOUT, Notifications } from './Notifications.js';
import PromptInputFooter from './PromptInputFooter.js';
import type { SuggestionItem } from './PromptInputFooterSuggestions.js';
import { PromptInputModeIndicator } from './PromptInputModeIndicator.js';
import { PromptInputQueuedCommands } from './PromptInputQueuedCommands.js';
import { PromptInputStashNotice } from './PromptInputStashNotice.js';
import { useMaybeTruncateInput } from './useMaybeTruncateInput.js';
import { usePromptInputPlaceholder } from './usePromptInputPlaceholder.js';
import { useShowFastIconHint } from './useShowFastIconHint.js';
import { useSwarmBanner } from './useSwarmBanner.js';
import { isNonSpacePrintable, isVimModeEnabled } from './utils.js';
type Props = {
  debug: boolean;
  ideSelection: IDESelection | undefined;
  toolPermissionContext: ToolPermissionContext;
  setToolPermissionContext: (ctx: ToolPermissionContext) => void;
  apiKeyStatus: VerificationStatus;
  commands: Command[];
  agents: AgentDefinition[];
  isLoading: boolean;
  verbose: boolean;
  messages: Message[];
  onAutoUpdaterResult: (result: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  input: string;
  onInputChange: (value: string) => void;
  mode: PromptInputMode;
  onModeChange: (mode: PromptInputMode) => void;
  stashedPrompt: {
    text: string;
    cursorOffset: number;
    pastedContents: Record<number, PastedContent>;
  } | undefined;
  setStashedPrompt: (value: {
    text: string;
    cursorOffset: number;
    pastedContents: Record<number, PastedContent>;
  } | undefined) => void;
  submitCount: number;
  onShowMessageSelector: () => void;
  
  onMessageActionsEnter?: () => void;
  mcpClients: MCPServerConnection[];
  pastedContents: Record<number, PastedContent>;
  setPastedContents: React.Dispatch<React.SetStateAction<Record<number, PastedContent>>>;
  vimMode: VimMode;
  setVimMode: (mode: VimMode) => void;
  showBashesDialog: string | boolean;
  setShowBashesDialog: (show: string | boolean) => void;
  onExit: () => void;
  getToolUseContext: (messages: Message[], newMessages: Message[], abortController: AbortController, mainLoopModel: string) => ProcessUserInputContext;
  onSubmit: (input: string, helpers: PromptInputHelpers, speculationAccept?: {
    state: ActiveSpeculationState;
    speculationSessionTimeSavedMs: number;
    setAppState: (f: (prev: AppState) => AppState) => void;
  }, options?: {
    fromKeybinding?: boolean;
  }) => Promise<void>;
  onAgentSubmit?: (input: string, task: InProcessTeammateTaskState | LocalAgentTaskState, helpers: PromptInputHelpers) => Promise<void>;
  isSearchingHistory: boolean;
  setIsSearchingHistory: (isSearching: boolean) => void;
  onDismissSideQuestion?: () => void;
  isSideQuestionVisible?: boolean;
  helpOpen: boolean;
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>;
  hasSuppressedDialogs?: boolean;
  isLocalJSXCommandActive?: boolean;
  insertTextRef?: React.MutableRefObject<{
    insert: (text: string) => void;
    setInputWithCursor: (value: string, cursor: number) => void;
    cursorOffset: number;
  } | null>;
  voiceInterimRange?: {
    start: number;
    end: number;
  } | null;
};

const PROMPT_FOOTER_LINES = 5;
const MIN_INPUT_VIEWPORT_LINES = 3;
function PromptInput({
  debug,
  ideSelection,
  toolPermissionContext,
  setToolPermissionContext,
  apiKeyStatus,
  commands,
  agents,
  isLoading,
  verbose,
  messages,
  onAutoUpdaterResult,
  autoUpdaterResult,
  input,
  onInputChange,
  mode,
  onModeChange,
  stashedPrompt,
  setStashedPrompt,
  submitCount,
  onShowMessageSelector,
  onMessageActionsEnter,
  mcpClients,
  pastedContents,
  setPastedContents,
  vimMode,
  setVimMode,
  showBashesDialog,
  setShowBashesDialog,
  onExit,
  getToolUseContext,
  onSubmit: onSubmitProp,
  onAgentSubmit,
  isSearchingHistory,
  setIsSearchingHistory,
  onDismissSideQuestion,
  isSideQuestionVisible,
  helpOpen,
  setHelpOpen,
  hasSuppressedDialogs,
  isLocalJSXCommandActive = false,
  insertTextRef,
  voiceInterimRange
}: Props): React.ReactNode {
  const mainLoopModel = useMainLoopModel();
  
  
  
  
  
  const isModalOverlayActive = useIsModalOverlayActive() || isLocalJSXCommandActive;
  const [isAutoUpdating, setIsAutoUpdating] = useState(false);
  const [exitMessage, setExitMessage] = useState<{
    show: boolean;
    key?: string;
  }>({
    show: false
  });
  const [cursorOffset, setCursorOffset] = useState<number>(input.length);
  
  
  const lastInternalInputRef = React.useRef(input);
  if (input !== lastInternalInputRef.current) {
    
    setCursorOffset(input.length);
    lastInternalInputRef.current = input;
  }
  
  const trackAndSetInput = React.useCallback((value: string) => {
    lastInternalInputRef.current = value;
    onInputChange(value);
  }, [onInputChange]);
  
  
  if (insertTextRef) {
    insertTextRef.current = {
      cursorOffset,
      insert: (text: string) => {
        const needsSpace = cursorOffset === input.length && input.length > 0 && !/\s$/.test(input);
        const insertText = needsSpace ? ' ' + text : text;
        const newValue = input.slice(0, cursorOffset) + insertText + input.slice(cursorOffset);
        lastInternalInputRef.current = newValue;
        onInputChange(newValue);
        setCursorOffset(cursorOffset + insertText.length);
      },
      setInputWithCursor: (value: string, cursor: number) => {
        lastInternalInputRef.current = value;
        onInputChange(value);
        setCursorOffset(cursor);
      }
    };
  }
  const store = useAppStateStore();
  const setAppState = useSetAppState();
  const tasks = useAppState(s => s.tasks);
  const replBridgeConnected = useAppState(s => s.replBridgeConnected);
  const replBridgeExplicit = useAppState(s => s.replBridgeExplicit);
  const replBridgeReconnecting = useAppState(s => s.replBridgeReconnecting);
  
  
  
  const bridgeFooterVisible = replBridgeConnected && (replBridgeExplicit || replBridgeReconnecting);
  
  const hasTungstenSession = useAppState(s => "external" === 'ant' && s.tungstenActiveSession !== undefined);
  const tmuxFooterVisible = "external" === 'ant' && hasTungstenSession;
  
  const bagelFooterVisible = useAppState(s => false);
  const teamContext = useAppState(s => s.teamContext);
  const queuedCommands = useCommandQueue();
  const promptSuggestionState = useAppState(s => s.promptSuggestion);
  const speculation = useAppState(s => s.speculation);
  const speculationSessionTimeSavedMs = useAppState(s => s.speculationSessionTimeSavedMs);
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);
  const viewSelectionMode = useAppState(s => s.viewSelectionMode);
  const showSpinnerTree = useAppState(s => s.expandedView) === 'teammates';
  const {
    companion: _companion,
    companionMuted
  } = feature('BUDDY') ? getGlobalConfig() : {
    companion: undefined,
    companionMuted: undefined
  };
  const companionFooterVisible = !!_companion && !companionMuted;
  
  
  
  
  
  const briefOwnsGap = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  
  useAppState(s => s.isBriefOnly) && !viewingAgentTaskId : false;
  const mainLoopModel_ = useAppState(s => s.mainLoopModel);
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession);
  const thinkingEnabled = useAppState(s => s.thinkingEnabled);
  const isFastMode = useAppState(s => isFastModeEnabled() ? s.fastMode : false);
  const effortValue = useAppState(s => s.effortValue);
  const viewedTeammate = getViewedTeammateTask(store.getState());
  const viewingAgentName = viewedTeammate?.identity.agentName;
  
  
  
  const viewingAgentColor = viewedTeammate?.identity.color && AGENT_COLORS.includes(viewedTeammate.identity.color as AgentColorName) ? viewedTeammate.identity.color as AgentColorName : undefined;
  
  const inProcessTeammates = useMemo(() => getRunningTeammatesSorted(tasks), [tasks]);

  
  const isTeammateMode = inProcessTeammates.length > 0 || viewedTeammate !== undefined;

  
  const effectiveToolPermissionContext = useMemo((): ToolPermissionContext => {
    if (viewedTeammate) {
      return {
        ...toolPermissionContext,
        mode: viewedTeammate.permissionMode
      };
    }
    return toolPermissionContext;
  }, [viewedTeammate, toolPermissionContext]);
  const {
    historyQuery,
    setHistoryQuery,
    historyMatch,
    historyFailedMatch
  } = useHistorySearch(entry => {
    setPastedContents(entry.pastedContents);
    void onSubmit(entry.display);
  }, input, trackAndSetInput, setCursorOffset, cursorOffset, onModeChange, mode, isSearchingHistory, setIsSearchingHistory, setPastedContents, pastedContents);
  
  
  
  
  
  const nextPasteIdRef = useRef(-1);
  if (nextPasteIdRef.current === -1) {
    nextPasteIdRef.current = getInitialPasteId(messages);
  }
  
  
  
  const pendingSpaceAfterPillRef = useRef(false);
  const [showTeamsDialog, setShowTeamsDialog] = useState(false);
  const [showBridgeDialog, setShowBridgeDialog] = useState(false);
  const [teammateFooterIndex, setTeammateFooterIndex] = useState(0);
  
  
  
  const coordinatorTaskIndex = useAppState(s => s.coordinatorTaskIndex);
  const setCoordinatorTaskIndex = useCallback((v: number | ((prev: number) => number)) => setAppState(prev => {
    const next = typeof v === 'function' ? v(prev.coordinatorTaskIndex) : v;
    if (next === prev.coordinatorTaskIndex) return prev;
    return {
      ...prev,
      coordinatorTaskIndex: next
    };
  }), [setAppState]);
  const coordinatorTaskCount = useCoordinatorTaskCount();
  
  
  
  
  const hasBgTaskPill = useMemo(() => Object.values(tasks).some(t => isBackgroundTask(t) && !("external" === 'ant' && isPanelAgentTask(t))), [tasks]);
  const minCoordinatorIndex = hasBgTaskPill ? -1 : 0;
  
  useEffect(() => {
    if (coordinatorTaskIndex >= coordinatorTaskCount) {
      setCoordinatorTaskIndex(Math.max(minCoordinatorIndex, coordinatorTaskCount - 1));
    } else if (coordinatorTaskIndex < minCoordinatorIndex) {
      setCoordinatorTaskIndex(minCoordinatorIndex);
    }
  }, [coordinatorTaskCount, coordinatorTaskIndex, minCoordinatorIndex]);
  const [isPasting, setIsPasting] = useState(false);
  const [isExternalEditorActive, setIsExternalEditorActive] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);
  const [showFastModePicker, setShowFastModePicker] = useState(false);
  const [showThinkingToggle, setShowThinkingToggle] = useState(false);
  const [showAutoModeOptIn, setShowAutoModeOptIn] = useState(false);
  const [previousModeBeforeAuto, setPreviousModeBeforeAuto] = useState<PermissionMode | null>(null);
  const autoModeOptInTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  
  const isCursorOnFirstLine = useMemo(() => {
    const firstNewlineIndex = input.indexOf('\n');
    if (firstNewlineIndex === -1) {
      return true; 
    }
    return cursorOffset <= firstNewlineIndex;
  }, [input, cursorOffset]);
  const isCursorOnLastLine = useMemo(() => {
    const lastNewlineIndex = input.lastIndexOf('\n');
    if (lastNewlineIndex === -1) {
      return true; 
    }
    return cursorOffset > lastNewlineIndex;
  }, [input, cursorOffset]);

  
  
  const cachedTeams: TeamSummary[] = useMemo(() => {
    if (!isAgentSwarmsEnabled()) return [];
    
    if (isInProcessEnabled()) return [];
    if (!teamContext) {
      return [];
    }
    const teammateCount = count(Object.values(teamContext.teammates), t => t.name !== 'team-lead');
    return [{
      name: teamContext.teamName,
      memberCount: teammateCount,
      runningCount: 0,
      idleCount: 0
    }];
  }, [teamContext]);

  
  
  
  
  const runningTaskCount = useMemo(() => count(Object.values(tasks), t => t.status === 'running'), [tasks]);
  
  
  
  const tasksFooterVisible = (runningTaskCount > 0 || "external" === 'ant' && coordinatorTaskCount > 0) && !shouldHideTasksFooter(tasks, showSpinnerTree);
  const teamsFooterVisible = cachedTeams.length > 0;
  const footerItems = useMemo(() => [tasksFooterVisible && 'tasks', tmuxFooterVisible && 'tmux', bagelFooterVisible && 'bagel', teamsFooterVisible && 'teams', bridgeFooterVisible && 'bridge', companionFooterVisible && 'companion'].filter(Boolean) as FooterItem[], [tasksFooterVisible, tmuxFooterVisible, bagelFooterVisible, teamsFooterVisible, bridgeFooterVisible, companionFooterVisible]);

  
  
  
  
  const rawFooterSelection = useAppState(s => s.footerSelection);
  const footerItemSelected = rawFooterSelection && footerItems.includes(rawFooterSelection) ? rawFooterSelection : null;
  useEffect(() => {
    if (rawFooterSelection && !footerItemSelected) {
      setAppState(prev => prev.footerSelection === null ? prev : {
        ...prev,
        footerSelection: null
      });
    }
  }, [rawFooterSelection, footerItemSelected, setAppState]);
  const tasksSelected = footerItemSelected === 'tasks';
  const tmuxSelected = footerItemSelected === 'tmux';
  const bagelSelected = footerItemSelected === 'bagel';
  const teamsSelected = footerItemSelected === 'teams';
  const bridgeSelected = footerItemSelected === 'bridge';
  function selectFooterItem(item: FooterItem | null): void {
    setAppState(prev => prev.footerSelection === item ? prev : {
      ...prev,
      footerSelection: item
    });
    if (item === 'tasks') {
      setTeammateFooterIndex(0);
      setCoordinatorTaskIndex(minCoordinatorIndex);
    }
  }

  
  
  function navigateFooter(delta: 1 | -1, exitAtStart = false): boolean {
    const idx = footerItemSelected ? footerItems.indexOf(footerItemSelected) : -1;
    const next = footerItems[idx + delta];
    if (next) {
      selectFooterItem(next);
      return true;
    }
    if (delta < 0 && exitAtStart) {
      selectFooterItem(null);
      return true;
    }
    return false;
  }

  
  const {
    suggestion: promptSuggestion,
    markAccepted,
    logOutcomeAtSubmission,
    markShown
  } = usePromptSuggestion({
    inputValue: input,
    isAssistantResponding: isLoading
  });
  const displayedValue = useMemo(() => isSearchingHistory && historyMatch ? getValueFromInput(typeof historyMatch === 'string' ? historyMatch : historyMatch.display) : input, [isSearchingHistory, historyMatch, input]);
  const thinkTriggers = useMemo(() => findThinkingTriggerPositions(displayedValue), [displayedValue]);
  const ultraplanSessionUrl = useAppState(s => s.ultraplanSessionUrl);
  const ultraplanLaunching = useAppState(s => s.ultraplanLaunching);
  const ultraplanTriggers = useMemo(() => feature('ULTRAPLAN') && !ultraplanSessionUrl && !ultraplanLaunching ? findUltraplanTriggerPositions(displayedValue) : [], [displayedValue, ultraplanSessionUrl, ultraplanLaunching]);
  const ultrareviewTriggers = useMemo(() => isUltrareviewEnabled() ? findUltrareviewTriggerPositions(displayedValue) : [], [displayedValue]);
  const btwTriggers = useMemo(() => findBtwTriggerPositions(displayedValue), [displayedValue]);
  const buddyTriggers = useMemo(() => findBuddyTriggerPositions(displayedValue), [displayedValue]);
  const slashCommandTriggers = useMemo(() => {
    const positions = findSlashCommandPositions(displayedValue);
    
    return positions.filter(pos => {
      const commandName = displayedValue.slice(pos.start + 1, pos.end); 
      return hasCommand(commandName, commands);
    });
  }, [displayedValue, commands]);
  const tokenBudgetTriggers = useMemo(() => feature('TOKEN_BUDGET') ? findTokenBudgetPositions(displayedValue) : [], [displayedValue]);
  const knownChannelsVersion = useSyncExternalStore(subscribeKnownChannels, getKnownChannelsVersion);
  const slackChannelTriggers = useMemo(() => hasSlackMcpServer(store.getState().mcp.clients) ? findSlackChannelPositions(displayedValue) : [],
  
  [displayedValue, knownChannelsVersion]);

  
  const memberMentionHighlights = useMemo((): Array<{
    start: number;
    end: number;
    themeColor: keyof Theme;
  }> => {
    if (!isAgentSwarmsEnabled()) return [];
    if (!teamContext?.teammates) return [];
    const highlights: Array<{
      start: number;
      end: number;
      themeColor: keyof Theme;
    }> = [];
    const members = teamContext.teammates;
    if (!members) return highlights;

    
    const regex = /(^|\s)@([\w-]+)/g;
    const memberValues = Object.values(members);
    let match;
    while ((match = regex.exec(displayedValue)) !== null) {
      const leadingSpace = match[1] ?? '';
      const nameStart = match.index + leadingSpace.length;
      const fullMatch = match[0].trimStart();
      const name = match[2];

      
      const member = memberValues.find(t => t.name === name);
      if (member?.color) {
        const themeColor = AGENT_COLOR_TO_THEME_COLOR[member.color as AgentColorName];
        if (themeColor) {
          highlights.push({
            start: nameStart,
            end: nameStart + fullMatch.length,
            themeColor
          });
        }
      }
    }
    return highlights;
  }, [displayedValue, teamContext]);
  const imageRefPositions = useMemo(() => parseReferences(displayedValue).filter(r => r.match.startsWith('[Image')).map(r => ({
    start: r.index,
    end: r.index + r.match.length
  })), [displayedValue]);

  
  
  
  const cursorAtImageChip = imageRefPositions.some(r => r.start === cursorOffset);

  
  
  
  useEffect(() => {
    const inside = imageRefPositions.find(r => cursorOffset > r.start && cursorOffset < r.end);
    if (inside) {
      const mid = (inside.start + inside.end) / 2;
      setCursorOffset(cursorOffset < mid ? inside.start : inside.end);
    }
  }, [cursorOffset, imageRefPositions, setCursorOffset]);
  const combinedHighlights = useMemo((): TextHighlight[] => {
    const highlights: TextHighlight[] = [];

    
    
    for (const ref of imageRefPositions) {
      if (cursorOffset === ref.start) {
        highlights.push({
          start: ref.start,
          end: ref.end,
          color: undefined,
          inverse: true,
          priority: 8
        });
      }
    }
    if (isSearchingHistory && historyMatch && !historyFailedMatch) {
      highlights.push({
        start: cursorOffset,
        end: cursorOffset + historyQuery.length,
        color: 'warning',
        priority: 20
      });
    }

    
    for (const trigger of btwTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'warning',
        priority: 15
      });
    }

    
    for (const trigger of slashCommandTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'suggestion',
        priority: 5
      });
    }

    
    for (const trigger of tokenBudgetTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'suggestion',
        priority: 5
      });
    }
    for (const trigger of slackChannelTriggers) {
      highlights.push({
        start: trigger.start,
        end: trigger.end,
        color: 'suggestion',
        priority: 5
      });
    }

    
    for (const mention of memberMentionHighlights) {
      highlights.push({
        start: mention.start,
        end: mention.end,
        color: mention.themeColor,
        priority: 5
      });
    }

    
    if (voiceInterimRange) {
      highlights.push({
        start: voiceInterimRange.start,
        end: voiceInterimRange.end,
        color: undefined,
        dimColor: true,
        priority: 1
      });
    }

    
    if (isUltrathinkEnabled()) {
      for (const trigger of thinkTriggers) {
        for (let i = trigger.start; i < trigger.end; i++) {
          highlights.push({
            start: i,
            end: i + 1,
            color: getRainbowColor(i - trigger.start),
            shimmerColor: getRainbowColor(i - trigger.start, true),
            priority: 10
          });
        }
      }
    }

    
    if (feature('ULTRAPLAN')) {
      for (const trigger of ultraplanTriggers) {
        for (let i = trigger.start; i < trigger.end; i++) {
          highlights.push({
            start: i,
            end: i + 1,
            color: getRainbowColor(i - trigger.start),
            shimmerColor: getRainbowColor(i - trigger.start, true),
            priority: 10
          });
        }
      }
    }

    
    for (const trigger of ultrareviewTriggers) {
      for (let i = trigger.start; i < trigger.end; i++) {
        highlights.push({
          start: i,
          end: i + 1,
          color: getRainbowColor(i - trigger.start),
          shimmerColor: getRainbowColor(i - trigger.start, true),
          priority: 10
        });
      }
    }

    
    for (const trigger of buddyTriggers) {
      for (let i = trigger.start; i < trigger.end; i++) {
        highlights.push({
          start: i,
          end: i + 1,
          color: getRainbowColor(i - trigger.start),
          shimmerColor: getRainbowColor(i - trigger.start, true),
          priority: 10
        });
      }
    }
    return highlights;
  }, [isSearchingHistory, historyQuery, historyMatch, historyFailedMatch, cursorOffset, btwTriggers, imageRefPositions, memberMentionHighlights, slashCommandTriggers, tokenBudgetTriggers, slackChannelTriggers, displayedValue, voiceInterimRange, thinkTriggers, ultraplanTriggers, ultrareviewTriggers, buddyTriggers]);
  const {
    addNotification,
    removeNotification
  } = useNotifications();

  
  useEffect(() => {
    if (thinkTriggers.length && isUltrathinkEnabled()) {
      addNotification({
        key: 'ultrathink-active',
        text: 'Effort set to high for this turn',
        priority: 'immediate',
        timeoutMs: 5000
      });
    } else {
      removeNotification('ultrathink-active');
    }
  }, [addNotification, removeNotification, thinkTriggers.length]);
  useEffect(() => {
    if (feature('ULTRAPLAN') && ultraplanTriggers.length) {
      addNotification({
        key: 'ultraplan-active',
        text: 'This prompt will launch an ultraplan session in Claude Code Next on the web',
        priority: 'immediate',
        timeoutMs: 5000
      });
    } else {
      removeNotification('ultraplan-active');
    }
  }, [addNotification, removeNotification, ultraplanTriggers.length]);
  useEffect(() => {
    if (isUltrareviewEnabled() && ultrareviewTriggers.length) {
      addNotification({
        key: 'ultrareview-active',
        text: 'Run /ultrareview after Claude finishes to review these changes in the cloud',
        priority: 'immediate',
        timeoutMs: 5000
      });
    }
  }, [addNotification, ultrareviewTriggers.length]);

  
  const prevInputLengthRef = useRef(input.length);
  const peakInputLengthRef = useRef(input.length);

  
  const dismissStashHint = useCallback(() => {
    removeNotification('stash-hint');
  }, [removeNotification]);

  
  useEffect(() => {
    const prevLength = prevInputLengthRef.current;
    const peakLength = peakInputLengthRef.current;
    const currentLength = input.length;
    prevInputLengthRef.current = currentLength;

    
    if (currentLength > peakLength) {
      peakInputLengthRef.current = currentLength;
      return;
    }

    
    if (currentLength === 0) {
      peakInputLengthRef.current = 0;
      return;
    }

    
    
    const clearedSubstantialInput = peakLength >= 20 && currentLength <= 5;
    const wasRapidClear = prevLength >= 20 && currentLength <= 5;
    if (clearedSubstantialInput && !wasRapidClear) {
      const config = getGlobalConfig();
      if (!config.hasUsedStash) {
        addNotification({
          key: 'stash-hint',
          jsx: <Text dimColor>
              Tip:{' '}
              <ConfigurableShortcutHint action="chat:stash" context="Chat" fallback="ctrl+s" description="stash" />
            </Text>,
          priority: 'immediate',
          timeoutMs: FOOTER_TEMPORARY_STATUS_TIMEOUT
        });
      }
      peakInputLengthRef.current = currentLength;
    }
  }, [input.length, addNotification]);

  
  const {
    pushToBuffer,
    undo,
    canUndo,
    clearBuffer
  } = useInputBuffer({
    maxBufferSize: 50,
    debounceMs: 1000
  });
  useMaybeTruncateInput({
    input,
    pastedContents,
    onInputChange: trackAndSetInput,
    setCursorOffset,
    setPastedContents
  });
  const defaultPlaceholder = usePromptInputPlaceholder({
    input,
    submitCount,
    viewingAgentName
  });
  const onChange = useCallback((value: string) => {
    if (value === '?') {
      logEvent('tengu_help_toggled', {});
      setHelpOpen(v => !v);
      return;
    }
    setHelpOpen(false);

    
    dismissStashHint();

    
    abortPromptSuggestion();
    abortSpeculation(setAppState);

    
    const isSingleCharInsertion = value.length === input.length + 1;
    const insertedAtStart = cursorOffset === 0;
    const mode = getModeFromInput(value);
    if (insertedAtStart && mode !== 'prompt') {
      if (isSingleCharInsertion) {
        onModeChange(mode);
        return;
      }
      
      if (input.length === 0) {
        onModeChange(mode);
        const valueWithoutMode = getValueFromInput(value).replaceAll('\t', '    ');
        pushToBuffer(input, cursorOffset, pastedContents);
        trackAndSetInput(valueWithoutMode);
        setCursorOffset(valueWithoutMode.length);
        return;
      }
    }
    const processedValue = value.replaceAll('\t', '    ');

    
    if (input !== processedValue) {
      pushToBuffer(input, cursorOffset, pastedContents);
    }

    
    setAppState(prev => prev.footerSelection === null ? prev : {
      ...prev,
      footerSelection: null
    });
    trackAndSetInput(processedValue);
  }, [trackAndSetInput, onModeChange, input, cursorOffset, pushToBuffer, pastedContents, dismissStashHint, setAppState]);
  const {
    resetHistory,
    onHistoryUp,
    onHistoryDown,
    dismissSearchHint,
    historyIndex
  } = useArrowKeyHistory((value: string, historyMode: HistoryMode, pastedContents: Record<number, PastedContent>) => {
    onChange(value);
    onModeChange(historyMode);
    setPastedContents(pastedContents);
  }, input, pastedContents, setCursorOffset, mode);

  
  useEffect(() => {
    if (isSearchingHistory) {
      dismissSearchHint();
    }
  }, [isSearchingHistory, dismissSearchHint]);

  
  
  
  function handleHistoryUp() {
    if (suggestions.length > 1) {
      return;
    }

    
    
    
    if (!isCursorOnFirstLine) {
      return;
    }

    
    const hasEditableCommand = queuedCommands.some(isQueuedCommandEditable);
    if (hasEditableCommand) {
      void popAllCommandsFromQueue();
      return;
    }
    onHistoryUp();
  }
  function handleHistoryDown() {
    if (suggestions.length > 1) {
      return;
    }

    
    
    
    if (!isCursorOnLastLine) {
      return;
    }

    
    if (onHistoryDown() && footerItems.length > 0) {
      const first = footerItems[0]!;
      selectFooterItem(first);
      if (first === 'tasks' && !getGlobalConfig().hasSeenTasksHint) {
        saveGlobalConfig(c => c.hasSeenTasksHint ? c : {
          ...c,
          hasSeenTasksHint: true
        });
      }
    }
  }

  
  const [suggestionsState, setSuggestionsStateRaw] = useState<{
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  }>({
    suggestions: [],
    selectedSuggestion: -1,
    commandArgumentHint: undefined
  });

  
  const setSuggestionsState = useCallback((updater: typeof suggestionsState | ((prev: typeof suggestionsState) => typeof suggestionsState)) => {
    setSuggestionsStateRaw(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);
  const onSubmit = useCallback(async (inputParam: string, isSubmittingSlashCommand = false) => {
    inputParam = inputParam.trimEnd();

    
    
    
    
    
    const state = store.getState();
    if (state.footerSelection && footerItems.includes(state.footerSelection)) {
      return;
    }

    
    
    
    if (state.viewSelectionMode === 'selecting-agent') {
      return;
    }

    
    const hasImages = Object.values(pastedContents).some(c => c.type === 'image');

    
    
    
    
    const suggestionText = promptSuggestionState.text;
    const inputMatchesSuggestion = inputParam.trim() === '' || inputParam === suggestionText;
    if (inputMatchesSuggestion && suggestionText && !hasImages && !state.viewingAgentTaskId) {
      
      if (speculation.status === 'active') {
        markAccepted();
        
        logOutcomeAtSubmission(suggestionText, {
          skipReset: true
        });
        void onSubmitProp(suggestionText, {
          setCursorOffset,
          clearBuffer,
          resetHistory
        }, {
          state: speculation,
          speculationSessionTimeSavedMs: speculationSessionTimeSavedMs,
          setAppState
        });
        return; 
      }

      
      if (promptSuggestionState.shownAt > 0) {
        markAccepted();
        inputParam = suggestionText;
      }
    }

    
    if (isAgentSwarmsEnabled()) {
      const directMessage = parseDirectMemberMessage(inputParam);
      if (directMessage) {
        const result = await sendDirectMemberMessage(directMessage.recipientName, directMessage.message, teamContext, writeToMailbox);
        if (result.success) {
          addNotification({
            key: 'direct-message-sent',
            text: `Sent to @${result.recipientName}`,
            priority: 'immediate',
            timeoutMs: 3000
          });
          trackAndSetInput('');
          setCursorOffset(0);
          clearBuffer();
          resetHistory();
          return;
        } else if (result.error === 'no_team_context') {
          
        } else {
          
          
        }
      }
    }

    
    if (inputParam.trim() === '' && !hasImages) {
      return;
    }

    
    
    const hasDirectorySuggestions = suggestionsState.suggestions.length > 0 && suggestionsState.suggestions.every(s => s.description === 'directory');
    if (suggestionsState.suggestions.length > 0 && !isSubmittingSlashCommand && !hasDirectorySuggestions) {
      logForDebugging(`[onSubmit] early return: suggestions showing (count=${suggestionsState.suggestions.length})`);
      return; 
    }

    
    if (promptSuggestionState.text && promptSuggestionState.shownAt > 0) {
      logOutcomeAtSubmission(inputParam);
    }

    
    removeNotification('stash-hint');

    
    const activeAgent = getActiveAgentForInput(store.getState());
    if (activeAgent.type !== 'leader' && onAgentSubmit) {
      logEvent('tengu_transcript_input_to_teammate', {});
      await onAgentSubmit(inputParam, activeAgent.task, {
        setCursorOffset,
        clearBuffer,
        resetHistory
      });
      return;
    }

    
    await onSubmitProp(inputParam, {
      setCursorOffset,
      clearBuffer,
      resetHistory
    });
  }, [promptSuggestionState, speculation, speculationSessionTimeSavedMs, teamContext, store, footerItems, suggestionsState.suggestions, onSubmitProp, onAgentSubmit, clearBuffer, resetHistory, logOutcomeAtSubmission, setAppState, markAccepted, pastedContents, removeNotification]);
  const {
    suggestions,
    selectedSuggestion,
    commandArgumentHint,
    inlineGhostText,
    maxColumnWidth
  } = useTypeahead({
    commands,
    onInputChange: trackAndSetInput,
    onSubmit,
    setCursorOffset,
    input,
    cursorOffset,
    mode,
    agents,
    setSuggestionsState,
    suggestionsState,
    suppressSuggestions: isSearchingHistory || historyIndex > 0,
    markAccepted,
    onModeChange
  });

  
  
  const showPromptSuggestion = mode === 'prompt' && suggestions.length === 0 && promptSuggestion && !viewingAgentTaskId;
  if (showPromptSuggestion) {
    markShown();
  }

  
  
  
  if (promptSuggestionState.text && !promptSuggestion && promptSuggestionState.shownAt === 0 && !viewingAgentTaskId) {
    logSuggestionSuppressed('timing', promptSuggestionState.text);
    setAppState(prev => ({
      ...prev,
      promptSuggestion: {
        text: null,
        promptId: null,
        shownAt: 0,
        acceptedAt: 0,
        generationRequestId: null
      }
    }));
  }
  function onImagePaste(image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, sourcePath?: string) {
    logEvent('tengu_paste_image', {});
    onModeChange('prompt');
    const pasteId = nextPasteIdRef.current++;
    const newContent: PastedContent = {
      id: pasteId,
      type: 'image',
      content: image,
      mediaType: mediaType || 'image/png',
      
      filename: filename || 'Pasted image',
      dimensions,
      sourcePath
    };

    
    cacheImagePath(newContent);

    
    void storeImage(newContent);

    
    setPastedContents(prev => ({
      ...prev,
      [pasteId]: newContent
    }));
    
    
    
    const prefix = pendingSpaceAfterPillRef.current ? ' ' : '';
    insertTextAtCursor(prefix + formatImageRef(pasteId));
    pendingSpaceAfterPillRef.current = true;
  }

  
  
  
  
  useEffect(() => {
    const referencedIds = new Set(parseReferences(input).map(r => r.id));
    setPastedContents(prev => {
      const orphaned = Object.values(prev).filter(c => c.type === 'image' && !referencedIds.has(c.id));
      if (orphaned.length === 0) return prev;
      const next = {
        ...prev
      };
      for (const img of orphaned) delete next[img.id];
      return next;
    });
  }, [input, setPastedContents]);
  function onTextPaste(rawText: string) {
    pendingSpaceAfterPillRef.current = false;
    
    let text = stripAnsi(rawText).replace(/\r/g, '\n').replaceAll('\t', '    ');

    
    if (input.length === 0) {
      const pastedMode = getModeFromInput(text);
      if (pastedMode !== 'prompt') {
        onModeChange(pastedMode);
        text = getValueFromInput(text);
      }
    }
    const numLines = getPastedTextRefNumLines(text);
    
    
    
    
    
    const maxLines = Math.min(rows - 10, 2);

    
    
    if (text.length > PASTE_THRESHOLD || numLines > maxLines) {
      const pasteId = nextPasteIdRef.current++;
      const newContent: PastedContent = {
        id: pasteId,
        type: 'text',
        content: text
      };
      setPastedContents(prev => ({
        ...prev,
        [pasteId]: newContent
      }));
      insertTextAtCursor(formatPastedTextRef(pasteId, numLines));
    } else {
      
      insertTextAtCursor(text);
    }
  }
  const lazySpaceInputFilter = useCallback((input: string, key: Key): string => {
    if (!pendingSpaceAfterPillRef.current) return input;
    pendingSpaceAfterPillRef.current = false;
    if (isNonSpacePrintable(input, key)) return ' ' + input;
    return input;
  }, []);
  function insertTextAtCursor(text: string) {
    
    pushToBuffer(input, cursorOffset, pastedContents);
    const newInput = input.slice(0, cursorOffset) + text + input.slice(cursorOffset);
    trackAndSetInput(newInput);
    setCursorOffset(cursorOffset + text.length);
  }
  const doublePressEscFromEmpty = useDoublePress(() => {}, () => onShowMessageSelector());

  
  const popAllCommandsFromQueue = useCallback((): boolean => {
    const result = popAllEditable(input, cursorOffset);
    if (!result) {
      return false;
    }
    trackAndSetInput(result.text);
    onModeChange('prompt'); 
    setCursorOffset(result.cursorOffset);

    
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
    return true;
  }, [trackAndSetInput, onModeChange, input, cursorOffset, setPastedContents]);

  
  
  const onIdeAtMentioned = function (atMentioned: IDEAtMentioned) {
    logEvent('tengu_ext_at_mentioned', {});
    let atMentionedText: string;
    const relativePath = path.relative(getCwd(), atMentioned.filePath);
    if (atMentioned.lineStart && atMentioned.lineEnd) {
      atMentionedText = atMentioned.lineStart === atMentioned.lineEnd ? `@${relativePath}#L${atMentioned.lineStart} ` : `@${relativePath}#L${atMentioned.lineStart}-${atMentioned.lineEnd} `;
    } else {
      atMentionedText = `@${relativePath} `;
    }
    const cursorChar = input[cursorOffset - 1] ?? ' ';
    if (!/\s/.test(cursorChar)) {
      atMentionedText = ` ${atMentionedText}`;
    }
    insertTextAtCursor(atMentionedText);
  };
  useIdeAtMentioned(mcpClients, onIdeAtMentioned);

  
  const handleUndo = useCallback(() => {
    if (canUndo) {
      const previousState = undo();
      if (previousState) {
        trackAndSetInput(previousState.text);
        setCursorOffset(previousState.cursorOffset);
        setPastedContents(previousState.pastedContents);
      }
    }
  }, [canUndo, undo, trackAndSetInput, setPastedContents]);

  
  const handleNewline = useCallback(() => {
    pushToBuffer(input, cursorOffset, pastedContents);
    const newInput = input.slice(0, cursorOffset) + '\n' + input.slice(cursorOffset);
    trackAndSetInput(newInput);
    setCursorOffset(cursorOffset + 1);
  }, [input, cursorOffset, trackAndSetInput, setCursorOffset, pushToBuffer, pastedContents]);

  
  const handleExternalEditor = useCallback(async () => {
    logEvent('tengu_external_editor_used', {});
    setIsExternalEditorActive(true);
    try {
      
      const result = await editPromptInEditor(input, pastedContents);
      if (result.error) {
        addNotification({
          key: 'external-editor-error',
          text: result.error,
          color: 'warning',
          priority: 'high'
        });
      }
      if (result.content !== null && result.content !== input) {
        
        pushToBuffer(input, cursorOffset, pastedContents);
        trackAndSetInput(result.content);
        setCursorOffset(result.content.length);
      }
    } catch (err) {
      if (err instanceof Error) {
        logError(err);
      }
      addNotification({
        key: 'external-editor-error',
        text: `External editor failed: ${errorMessage(err)}`,
        color: 'warning',
        priority: 'high'
      });
    } finally {
      setIsExternalEditorActive(false);
    }
  }, [input, cursorOffset, pastedContents, pushToBuffer, trackAndSetInput, addNotification]);

  
  const handleStash = useCallback(() => {
    if (input.trim() === '' && stashedPrompt !== undefined) {
      
      trackAndSetInput(stashedPrompt.text);
      setCursorOffset(stashedPrompt.cursorOffset);
      setPastedContents(stashedPrompt.pastedContents);
      setStashedPrompt(undefined);
    } else if (input.trim() !== '') {
      
      setStashedPrompt({
        text: input,
        cursorOffset,
        pastedContents
      });
      trackAndSetInput('');
      setCursorOffset(0);
      setPastedContents({});
      
      saveGlobalConfig(c => {
        if (c.hasUsedStash) return c;
        return {
          ...c,
          hasUsedStash: true
        };
      });
    }
  }, [input, cursorOffset, stashedPrompt, trackAndSetInput, setStashedPrompt, pastedContents, setPastedContents]);

  
  const handleModelPicker = useCallback(() => {
    setShowModelPicker(prev => !prev);
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [helpOpen]);

  
  const handleFastModePicker = useCallback(() => {
    setShowFastModePicker(prev => !prev);
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [helpOpen]);

  
  const handleThinkingToggle = useCallback(() => {
    setShowThinkingToggle(prev => !prev);
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [helpOpen]);

  
  const handleCycleMode = useCallback(() => {
    
    if (isAgentSwarmsEnabled() && viewedTeammate && viewingAgentTaskId) {
      const teammateContext: ToolPermissionContext = {
        ...toolPermissionContext,
        mode: viewedTeammate.permissionMode
      };
      
      const nextMode = getNextPermissionMode(teammateContext, undefined);
      logEvent('tengu_mode_cycle', {
        to: nextMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const teammateTaskId = viewingAgentTaskId;
      setAppState(prev => {
        const task = prev.tasks[teammateTaskId];
        if (!task || task.type !== 'in_process_teammate') {
          return prev;
        }
        if (task.permissionMode === nextMode) {
          return prev;
        }
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [teammateTaskId]: {
              ...task,
              permissionMode: nextMode
            }
          }
        };
      });
      if (helpOpen) {
        setHelpOpen(false);
      }
      return;
    }

    
    logForDebugging(`[auto-mode] handleCycleMode: currentMode=${toolPermissionContext.mode} isAutoModeAvailable=${toolPermissionContext.isAutoModeAvailable} showAutoModeOptIn=${showAutoModeOptIn} timeoutPending=${!!autoModeOptInTimeoutRef.current}`);
    const nextMode = getNextPermissionMode(toolPermissionContext, teamContext);

    
    
    
    
    
    let isEnteringAutoModeFirstTime = false;
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      isEnteringAutoModeFirstTime = nextMode === 'auto' && toolPermissionContext.mode !== 'auto' && !hasAutoModeOptIn() && !viewingAgentTaskId; 
    }
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (isEnteringAutoModeFirstTime) {
        
        setPreviousModeBeforeAuto(toolPermissionContext.mode);

        
        
        setAppState(prev => ({
          ...prev,
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            mode: 'auto'
          }
        }));
        setToolPermissionContext({
          ...toolPermissionContext,
          mode: 'auto'
        });

        
        if (autoModeOptInTimeoutRef.current) {
          clearTimeout(autoModeOptInTimeoutRef.current);
        }
        autoModeOptInTimeoutRef.current = setTimeout((setShowAutoModeOptIn, autoModeOptInTimeoutRef) => {
          setShowAutoModeOptIn(true);
          autoModeOptInTimeoutRef.current = null;
        }, 400, setShowAutoModeOptIn, autoModeOptInTimeoutRef);
        if (helpOpen) {
          setHelpOpen(false);
        }
        return;
      }
    }

    
    
    
    
    
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (showAutoModeOptIn || autoModeOptInTimeoutRef.current) {
        if (showAutoModeOptIn) {
          logEvent('tengu_auto_mode_opt_in_dialog_decline', {});
        }
        setShowAutoModeOptIn(false);
        if (autoModeOptInTimeoutRef.current) {
          clearTimeout(autoModeOptInTimeoutRef.current);
          autoModeOptInTimeoutRef.current = null;
        }
        setPreviousModeBeforeAuto(null);
        
      }
    }

    
    
    
    const {
      context: preparedContext
    } = cyclePermissionMode(toolPermissionContext, teamContext);
    logEvent('tengu_mode_cycle', {
      to: nextMode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });

    
    if (nextMode === 'plan') {
      saveGlobalConfig(current => ({
        ...current,
        lastPlanModeUse: Date.now()
      }));
    }

    
    
    
    
    setAppState(prev => ({
      ...prev,
      toolPermissionContext: {
        ...preparedContext,
        mode: nextMode
      }
    }));
    setToolPermissionContext({
      ...preparedContext,
      mode: nextMode
    });

    
    syncTeammateMode(nextMode, teamContext?.teamName);

    
    if (helpOpen) {
      setHelpOpen(false);
    }
  }, [toolPermissionContext, teamContext, viewingAgentTaskId, viewedTeammate, setAppState, setToolPermissionContext, helpOpen, showAutoModeOptIn]);

  
  const handleAutoModeOptInAccept = useCallback(() => {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      setShowAutoModeOptIn(false);
      setPreviousModeBeforeAuto(null);

      
      
      
      const strippedContext = transitionPermissionMode(previousModeBeforeAuto ?? toolPermissionContext.mode, 'auto', toolPermissionContext);
      setAppState(prev => ({
        ...prev,
        toolPermissionContext: {
          ...strippedContext,
          mode: 'auto'
        }
      }));
      setToolPermissionContext({
        ...strippedContext,
        mode: 'auto'
      });

      
      if (helpOpen) {
        setHelpOpen(false);
      }
    }
  }, [helpOpen, setHelpOpen, previousModeBeforeAuto, toolPermissionContext, setAppState, setToolPermissionContext]);

  
  const handleAutoModeOptInDecline = useCallback(() => {
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      logForDebugging(`[auto-mode] handleAutoModeOptInDecline: reverting to ${previousModeBeforeAuto}, setting isAutoModeAvailable=false`);
      setShowAutoModeOptIn(false);
      if (autoModeOptInTimeoutRef.current) {
        clearTimeout(autoModeOptInTimeoutRef.current);
        autoModeOptInTimeoutRef.current = null;
      }

      
      
      if (previousModeBeforeAuto) {
        setAutoModeActive(false);
        setAppState(prev => ({
          ...prev,
          toolPermissionContext: {
            ...prev.toolPermissionContext,
            mode: previousModeBeforeAuto,
            isAutoModeAvailable: false
          }
        }));
        setToolPermissionContext({
          ...toolPermissionContext,
          mode: previousModeBeforeAuto,
          isAutoModeAvailable: false
        });
        setPreviousModeBeforeAuto(null);
      }
    }
  }, [previousModeBeforeAuto, toolPermissionContext, setAppState, setToolPermissionContext]);

  
  const handleImagePaste = useCallback(() => {
    void getImageFromClipboard().then(imageData => {
      if (imageData) {
        onImagePaste(imageData.base64, imageData.mediaType);
      } else {
        const shortcutDisplay = getShortcutDisplay('chat:imagePaste', 'Chat', 'ctrl+v');
        const message = env.isSSH() ? "No image found in clipboard. You're SSH'd; try scp?" : `No image found in clipboard. Use ${shortcutDisplay} to paste images.`;
        addNotification({
          key: 'no-image-in-clipboard',
          text: message,
          priority: 'immediate',
          timeoutMs: 1000
        });
      }
    });
  }, [addNotification, onImagePaste]);

  
  
  
  
  
  
  const keybindingContext = useOptionalKeybindingContext();
  useEffect(() => {
    if (!keybindingContext || isModalOverlayActive) return;
    return keybindingContext.registerHandler({
      action: 'chat:submit',
      context: 'Chat',
      handler: () => {
        void onSubmit(input);
      }
    });
  }, [keybindingContext, isModalOverlayActive, onSubmit, input]);

  
  
  
  
  
  const chatHandlers = useMemo(() => ({
    'chat:undo': handleUndo,
    'chat:newline': handleNewline,
    'chat:externalEditor': handleExternalEditor,
    'chat:stash': handleStash,
    'chat:modelPicker': handleModelPicker,
    'chat:thinkingToggle': handleThinkingToggle,
    'chat:cycleMode': handleCycleMode,
    'chat:imagePaste': handleImagePaste
  }), [handleUndo, handleNewline, handleExternalEditor, handleStash, handleModelPicker, handleThinkingToggle, handleCycleMode, handleImagePaste]);
  useKeybindings(chatHandlers, {
    context: 'Chat',
    isActive: !isModalOverlayActive
  });

  
  
  useKeybinding('chat:messageActions', () => onMessageActionsEnter?.(), {
    context: 'Chat',
    isActive: !isModalOverlayActive && !isSearchingHistory
  });

  
  useKeybinding('chat:fastMode', handleFastModePicker, {
    context: 'Chat',
    isActive: !isModalOverlayActive && isFastModeEnabled() && isFastModeAvailable()
  });

  
  
  
  useKeybinding('help:dismiss', () => {
    setHelpOpen(false);
  }, {
    context: 'Help',
    isActive: helpOpen
  });

  
  
  
  const quickSearchActive = feature('QUICK_SEARCH') ? !isModalOverlayActive : false;
  useKeybinding('app:quickOpen', () => {
    if (feature('QUICK_SEARCH')) {
      setShowQuickOpen(true);
      setHelpOpen(false);
    }
  }, {
    context: 'Global',
    isActive: quickSearchActive
  });
  useKeybinding('app:globalSearch', () => {
    if (feature('QUICK_SEARCH')) {
      setShowGlobalSearch(true);
      setHelpOpen(false);
    }
  }, {
    context: 'Global',
    isActive: quickSearchActive
  });
  useKeybinding('history:search', () => {
    if (feature('HISTORY_PICKER')) {
      setShowHistoryPicker(true);
      setHelpOpen(false);
    }
  }, {
    context: 'Global',
    isActive: feature('HISTORY_PICKER') ? !isModalOverlayActive : false
  });

  
  
  useKeybinding('app:interrupt', () => {
    abortSpeculation(setAppState);
  }, {
    context: 'Global',
    isActive: !isLoading && speculation.status === 'active'
  });

  
  
  
  useKeybindings({
    'footer:up': () => {
      
      if (tasksSelected && "external" === 'ant' && coordinatorTaskCount > 0 && coordinatorTaskIndex > minCoordinatorIndex) {
        setCoordinatorTaskIndex(prev => prev - 1);
        return;
      }
      navigateFooter(-1, true);
    },
    'footer:down': () => {
      
      if (tasksSelected && "external" === 'ant' && coordinatorTaskCount > 0) {
        if (coordinatorTaskIndex < coordinatorTaskCount - 1) {
          setCoordinatorTaskIndex(prev => prev + 1);
        }
        return;
      }
      if (tasksSelected && !isTeammateMode) {
        setShowBashesDialog(true);
        selectFooterItem(null);
        return;
      }
      navigateFooter(1);
    },
    'footer:next': () => {
      
      if (tasksSelected && isTeammateMode) {
        const totalAgents = 1 + inProcessTeammates.length;
        setTeammateFooterIndex(prev => (prev + 1) % totalAgents);
        return;
      }
      navigateFooter(1);
    },
    'footer:previous': () => {
      if (tasksSelected && isTeammateMode) {
        const totalAgents = 1 + inProcessTeammates.length;
        setTeammateFooterIndex(prev => (prev - 1 + totalAgents) % totalAgents);
        return;
      }
      navigateFooter(-1);
    },
    'footer:openSelected': () => {
      if (viewSelectionMode === 'selecting-agent') {
        return;
      }
      switch (footerItemSelected) {
        case 'companion':
          if (feature('BUDDY')) {
            selectFooterItem(null);
            void onSubmit('/buddy');
          }
          break;
        case 'tasks':
          if (isTeammateMode) {
            
            if (teammateFooterIndex === 0) {
              exitTeammateView(setAppState);
            } else {
              const teammate = inProcessTeammates[teammateFooterIndex - 1];
              if (teammate) enterTeammateView(teammate.id, setAppState);
            }
          } else if (coordinatorTaskIndex === 0 && coordinatorTaskCount > 0) {
            exitTeammateView(setAppState);
          } else {
            const selectedTaskId = getVisibleAgentTasks(tasks)[coordinatorTaskIndex - 1]?.id;
            if (selectedTaskId) {
              enterTeammateView(selectedTaskId, setAppState);
            } else {
              setShowBashesDialog(true);
              selectFooterItem(null);
            }
          }
          break;
        case 'tmux':
          if ("external" === 'ant') {
            setAppState(prev => prev.tungstenPanelAutoHidden ? {
              ...prev,
              tungstenPanelAutoHidden: false
            } : {
              ...prev,
              tungstenPanelVisible: !(prev.tungstenPanelVisible ?? true)
            });
          }
          break;
        case 'bagel':
          break;
        case 'teams':
          setShowTeamsDialog(true);
          selectFooterItem(null);
          break;
        case 'bridge':
          setShowBridgeDialog(true);
          selectFooterItem(null);
          break;
      }
    },
    'footer:clearSelection': () => {
      selectFooterItem(null);
    },
    'footer:close': () => {
      if (tasksSelected && coordinatorTaskIndex >= 1) {
        const task = getVisibleAgentTasks(tasks)[coordinatorTaskIndex - 1];
        if (!task) return false;
        
        
        if (viewSelectionMode === 'viewing-agent' && task.id === viewingAgentTaskId) {
          onChange(input.slice(0, cursorOffset) + 'x' + input.slice(cursorOffset));
          setCursorOffset(cursorOffset + 1);
          return;
        }
        stopOrDismissAgent(task.id, setAppState);
        if (task.status !== 'running') {
          setCoordinatorTaskIndex(i => Math.max(minCoordinatorIndex, i - 1));
        }
        return;
      }
      
      return false;
    }
  }, {
    context: 'Footer',
    isActive: !!footerItemSelected && !isModalOverlayActive
  });
  useInput((char, key) => {
    
    
    
    if (showTeamsDialog || showQuickOpen || showGlobalSearch || showHistoryPicker) {
      return;
    }

    
    if (getPlatform() === 'macos' && isMacosOptionChar(char)) {
      const shortcut = MACOS_OPTION_SPECIAL_CHARS[char];
      const terminalName = getNativeCSIuTerminalDisplayName();
      const jsx = terminalName ? <Text dimColor>
          To enable {shortcut}, set <Text bold>Option as Meta</Text> in{' '}
          {terminalName} preferences (⌘,)
        </Text> : <Text dimColor>To enable {shortcut}, run /terminal-setup</Text>;
      addNotification({
        key: 'option-meta-hint',
        jsx,
        priority: 'immediate',
        timeoutMs: 5000
      });
      
    }

    

    

    
    
    
    
    if (footerItemSelected && char && !key.ctrl && !key.meta && !key.escape && !key.return) {
      onChange(input.slice(0, cursorOffset) + char + input.slice(cursorOffset));
      setCursorOffset(cursorOffset + char.length);
      return;
    }

    
    if (cursorOffset === 0 && (key.escape || key.backspace || key.delete || key.ctrl && char === 'u')) {
      onModeChange('prompt');
      setHelpOpen(false);
    }

    
    if (helpOpen && input === '' && (key.backspace || key.delete)) {
      setHelpOpen(false);
    }

    
    
    
    
    

    
    if (key.escape) {
      
      if (speculation.status === 'active') {
        abortSpeculation(setAppState);
        return;
      }

      
      if (isSideQuestionVisible && onDismissSideQuestion) {
        onDismissSideQuestion();
        return;
      }

      
      if (helpOpen) {
        setHelpOpen(false);
        return;
      }

      
      
      
      if (footerItemSelected) {
        return;
      }

      
      const hasEditableCommand = queuedCommands.some(isQueuedCommandEditable);
      if (hasEditableCommand) {
        void popAllCommandsFromQueue();
        return;
      }
      if (messages.length > 0 && !input && !isLoading) {
        doublePressEscFromEmpty();
      }
    }
    if (key.return && helpOpen) {
      setHelpOpen(false);
    }
  });
  const swarmBanner = useSwarmBanner();
  const fastModeCooldown = isFastModeEnabled() ? isFastModeCooldown() : false;
  const showFastIcon = isFastModeEnabled() ? isFastMode && (isFastModeAvailable() || fastModeCooldown) : false;
  const showFastIconHint = useShowFastIconHint(showFastIcon ?? false);

  
  
  
  const effortNotificationText = briefOwnsGap ? undefined : getEffortNotificationText(effortValue, mainLoopModel);
  useEffect(() => {
    if (!effortNotificationText) {
      removeNotification('effort-level');
      return;
    }
    addNotification({
      key: 'effort-level',
      text: effortNotificationText,
      priority: 'high',
      timeoutMs: 12_000
    });
  }, [effortNotificationText, addNotification, removeNotification]);
  useBuddyNotification();
  const companionSpeaking = feature('BUDDY') ?
  
  useAppState(s => s.companionReaction !== undefined) : false;
  const {
    columns,
    rows
  } = useTerminalSize();
  const textInputColumns = columns - 3 - companionReservedColumns(columns, companionSpeaking);

  
  
  
  
  
  
  const maxVisibleLines = isFullscreenEnvEnabled() ? Math.max(MIN_INPUT_VIEWPORT_LINES, Math.floor(rows / 2) - PROMPT_FOOTER_LINES) : undefined;
  const handleInputClick = useCallback((e: ClickEvent) => {
    
    
    
    if (!input || isSearchingHistory) return;
    const c = Cursor.fromText(input, textInputColumns, cursorOffset);
    const viewportStart = c.getViewportStartLine(maxVisibleLines);
    const offset = c.measuredText.getOffsetFromPosition({
      line: e.localRow + viewportStart,
      column: e.localCol
    });
    setCursorOffset(offset);
  }, [input, textInputColumns, isSearchingHistory, cursorOffset, maxVisibleLines]);
  const handleOpenTasksDialog = useCallback((taskId?: string) => setShowBashesDialog(taskId ?? true), [setShowBashesDialog]);
  const placeholder = showPromptSuggestion && promptSuggestion ? promptSuggestion : defaultPlaceholder;

  
  const isInputWrapped = useMemo(() => input.includes('\n'), [input]);

  
  
  
  const handleModelSelect = useCallback((model: string | null, _effort: EffortLevel | undefined) => {
    let wasFastModeDisabled = false;
    setAppState(prev => {
      wasFastModeDisabled = isFastModeEnabled() && !isFastModeSupportedByModel(model) && !!prev.fastMode;
      return {
        ...prev,
        mainLoopModel: model,
        mainLoopModelForSession: null,
        
        ...(wasFastModeDisabled && {
          fastMode: false
        })
      };
    });
    setShowModelPicker(false);
    const effectiveFastMode = (isFastMode ?? false) && !wasFastModeDisabled;
    let message = `Model set to ${modelDisplayString(model)}`;
    if (isBilledAsExtraUsage(model, effectiveFastMode, isOpus1mMergeEnabled())) {
      message += ' · Billed as extra usage';
    }
    if (wasFastModeDisabled) {
      message += ' · Fast mode OFF';
    }
    addNotification({
      key: 'model-switched',
      jsx: <Text>{message}</Text>,
      priority: 'immediate',
      timeoutMs: 3000
    });
    logEvent('tengu_model_picker_hotkey', {
      model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
  }, [setAppState, addNotification, isFastMode]);
  const handleModelCancel = useCallback(() => {
    setShowModelPicker(false);
  }, []);

  
  
  const modelPickerElement = useMemo(() => {
    if (!showModelPicker) return null;
    return <Box flexDirection="column" marginTop={1}>
        <ModelPicker initial={mainLoopModel_} sessionModel={mainLoopModelForSession} onSelect={handleModelSelect} onCancel={handleModelCancel} isStandaloneCommand showFastModeNotice={isFastModeEnabled() && isFastMode && isFastModeSupportedByModel(mainLoopModel_) && isFastModeAvailable()} />
      </Box>;
  }, [showModelPicker, mainLoopModel_, mainLoopModelForSession, handleModelSelect, handleModelCancel]);
  const handleFastModeSelect = useCallback((result?: string) => {
    setShowFastModePicker(false);
    if (result) {
      addNotification({
        key: 'fast-mode-toggled',
        jsx: <Text>{result}</Text>,
        priority: 'immediate',
        timeoutMs: 3000
      });
    }
  }, [addNotification]);

  
  const fastModePickerElement = useMemo(() => {
    if (!showFastModePicker) return null;
    return <Box flexDirection="column" marginTop={1}>
        <FastModePicker onDone={handleFastModeSelect} unavailableReason={getFastModeUnavailableReason()} />
      </Box>;
  }, [showFastModePicker, handleFastModeSelect]);

  
  const handleThinkingSelect = useCallback((enabled: boolean) => {
    setAppState(prev => ({
      ...prev,
      thinkingEnabled: enabled
    }));
    setShowThinkingToggle(false);
    logEvent('tengu_thinking_toggled_hotkey', {
      enabled
    });
    addNotification({
      key: 'thinking-toggled-hotkey',
      jsx: <Text color={enabled ? 'suggestion' : undefined} dimColor={!enabled}>
            Thinking {enabled ? 'on' : 'off'}
          </Text>,
      priority: 'immediate',
      timeoutMs: 3000
    });
  }, [setAppState, addNotification]);
  const handleThinkingCancel = useCallback(() => {
    setShowThinkingToggle(false);
  }, []);

  
  const thinkingToggleElement = useMemo(() => {
    if (!showThinkingToggle) return null;
    return <Box flexDirection="column" marginTop={1}>
        <ThinkingToggle currentValue={thinkingEnabled ?? true} onSelect={handleThinkingSelect} onCancel={handleThinkingCancel} isMidConversation={messages.some(m => m.type === 'assistant')} />
      </Box>;
  }, [showThinkingToggle, thinkingEnabled, handleThinkingSelect, handleThinkingCancel, messages.length]);

  
  
  
  
  const autoModeOptInDialog = useMemo(() => feature('TRANSCRIPT_CLASSIFIER') && showAutoModeOptIn ? <AutoModeOptInDialog onAccept={handleAutoModeOptInAccept} onDecline={handleAutoModeOptInDecline} /> : null, [showAutoModeOptIn, handleAutoModeOptInAccept, handleAutoModeOptInDecline]);
  useSetPromptOverlayDialog(isFullscreenEnvEnabled() ? autoModeOptInDialog : null);
  if (showBashesDialog) {
    return <BackgroundTasksDialog onDone={() => setShowBashesDialog(false)} toolUseContext={getToolUseContext(messages, [], new AbortController(), mainLoopModel)} initialDetailTaskId={typeof showBashesDialog === 'string' ? showBashesDialog : undefined} />;
  }
  if (isAgentSwarmsEnabled() && showTeamsDialog) {
    return <TeamsDialog initialTeams={cachedTeams} onDone={() => {
      setShowTeamsDialog(false);
    }} />;
  }
  if (feature('QUICK_SEARCH')) {
    const insertWithSpacing = (text: string) => {
      const cursorChar = input[cursorOffset - 1] ?? ' ';
      insertTextAtCursor(/\s/.test(cursorChar) ? text : ` ${text}`);
    };
    if (showQuickOpen) {
      return <QuickOpenDialog onDone={() => setShowQuickOpen(false)} onInsert={insertWithSpacing} />;
    }
    if (showGlobalSearch) {
      return <GlobalSearchDialog onDone={() => setShowGlobalSearch(false)} onInsert={insertWithSpacing} />;
    }
  }
  if (feature('HISTORY_PICKER') && showHistoryPicker) {
    return <HistorySearchDialog initialQuery={input} onSelect={entry => {
      const entryMode = getModeFromInput(entry.display);
      const value = getValueFromInput(entry.display);
      onModeChange(entryMode);
      trackAndSetInput(value);
      setPastedContents(entry.pastedContents);
      setCursorOffset(value.length);
      setShowHistoryPicker(false);
    }} onCancel={() => setShowHistoryPicker(false)} />;
  }

  
  if (modelPickerElement) {
    return modelPickerElement;
  }
  if (fastModePickerElement) {
    return fastModePickerElement;
  }
  if (thinkingToggleElement) {
    return thinkingToggleElement;
  }
  if (showBridgeDialog) {
    return <BridgeDialog onDone={() => {
      setShowBridgeDialog(false);
      selectFooterItem(null);
    }} />;
  }
  const baseProps: BaseTextInputProps = {
    multiline: true,
    onSubmit,
    onChange,
    value: historyMatch ? getValueFromInput(typeof historyMatch === 'string' ? historyMatch : historyMatch.display) : input,
    
    
    
    
    onHistoryUp: handleHistoryUp,
    onHistoryDown: handleHistoryDown,
    onHistoryReset: resetHistory,
    placeholder,
    onExit,
    onExitMessage: (show, key) => setExitMessage({
      show,
      key
    }),
    onImagePaste,
    columns: textInputColumns,
    maxVisibleLines,
    disableCursorMovementForUpDownKeys: suggestions.length > 0 || !!footerItemSelected,
    disableEscapeDoublePress: suggestions.length > 0,
    cursorOffset,
    onChangeCursorOffset: setCursorOffset,
    onPaste: onTextPaste,
    onIsPastingChange: setIsPasting,
    focus: !isSearchingHistory && !isModalOverlayActive && !footerItemSelected,
    showCursor: !footerItemSelected && !isSearchingHistory && !cursorAtImageChip,
    argumentHint: commandArgumentHint,
    onUndo: canUndo ? () => {
      const previousState = undo();
      if (previousState) {
        trackAndSetInput(previousState.text);
        setCursorOffset(previousState.cursorOffset);
        setPastedContents(previousState.pastedContents);
      }
    } : undefined,
    highlights: combinedHighlights,
    inlineGhostText,
    inputFilter: lazySpaceInputFilter
  };
  const getBorderColor = (): keyof Theme => {
    const modeColors: Record<string, keyof Theme> = {
      bash: 'bashBorder'
    };

    
    if (modeColors[mode]) {
      return modeColors[mode];
    }

    
    if (isInProcessTeammate()) {
      return 'promptBorder';
    }

    
    const teammateColorName = getTeammateColor();
    if (teammateColorName && AGENT_COLORS.includes(teammateColorName as AgentColorName)) {
      return AGENT_COLOR_TO_THEME_COLOR[teammateColorName as AgentColorName];
    }
    return 'promptBorder';
  };
  if (isExternalEditorActive) {
    return <Box flexDirection="row" alignItems="center" justifyContent="center" borderColor={getBorderColor()} borderStyle="round" borderLeft={false} borderRight={false} borderBottom width="100%">
        <Text dimColor italic>
          Save and close editor to continue...
        </Text>
      </Box>;
  }
  const textInputElement = isVimModeEnabled() ? <VimTextInput {...baseProps} initialMode={vimMode} onModeChange={setVimMode} /> : <TextInput {...baseProps} />;
  return <Box flexDirection="column" marginTop={briefOwnsGap ? 0 : 1}>
      {!isFullscreenEnvEnabled() && <PromptInputQueuedCommands />}
      {hasSuppressedDialogs && <Box marginTop={1} marginLeft={2}>
          <Text dimColor>Waiting for permission…</Text>
        </Box>}
      <PromptInputStashNotice hasStash={stashedPrompt !== undefined} />
      {swarmBanner ? <>
          <Text color={swarmBanner.bgColor}>
            {swarmBanner.text ? <>
                {'─'.repeat(Math.max(0, columns - stringWidth(swarmBanner.text) - 4))}
                <Text backgroundColor={swarmBanner.bgColor} color="inverseText">
                  {' '}
                  {swarmBanner.text}{' '}
                </Text>
                {'──'}
              </> : '─'.repeat(columns)}
          </Text>
          <Box flexDirection="row" width="100%">
            <PromptInputModeIndicator mode={mode} isLoading={isLoading} viewingAgentName={viewingAgentName} viewingAgentColor={viewingAgentColor} />
            <Box flexGrow={1} flexShrink={1} onClick={handleInputClick}>
              {textInputElement}
            </Box>
          </Box>
          <Text color={swarmBanner.bgColor}>{'─'.repeat(columns)}</Text>
        </> : <Box flexDirection="row" alignItems="flex-start" justifyContent="flex-start" borderColor={getBorderColor()} borderStyle="round" borderLeft={false} borderRight={false} borderBottom width="100%" borderText={buildBorderText(showFastIcon ?? false, showFastIconHint, fastModeCooldown)}>
          <PromptInputModeIndicator mode={mode} isLoading={isLoading} viewingAgentName={viewingAgentName} viewingAgentColor={viewingAgentColor} />
          <Box flexGrow={1} flexShrink={1} onClick={handleInputClick}>
            {textInputElement}
          </Box>
        </Box>}
      <PromptInputFooter apiKeyStatus={apiKeyStatus} debug={debug} exitMessage={exitMessage} vimMode={isVimModeEnabled() ? vimMode : undefined} mode={mode} autoUpdaterResult={autoUpdaterResult} isAutoUpdating={isAutoUpdating} verbose={verbose} onAutoUpdaterResult={onAutoUpdaterResult} onChangeIsUpdating={setIsAutoUpdating} suggestions={suggestions} selectedSuggestion={selectedSuggestion} maxColumnWidth={maxColumnWidth} toolPermissionContext={effectiveToolPermissionContext} helpOpen={helpOpen} suppressHint={input.length > 0} isLoading={isLoading} tasksSelected={tasksSelected} teamsSelected={teamsSelected} bridgeSelected={bridgeSelected} tmuxSelected={tmuxSelected} teammateFooterIndex={teammateFooterIndex} ideSelection={ideSelection} mcpClients={mcpClients} isPasting={isPasting} isInputWrapped={isInputWrapped} messages={messages} isSearching={isSearchingHistory} historyQuery={historyQuery} setHistoryQuery={setHistoryQuery} historyFailedMatch={historyFailedMatch} onOpenTasksDialog={isFullscreenEnvEnabled() ? handleOpenTasksDialog : undefined} />
      {isFullscreenEnvEnabled() ? null : autoModeOptInDialog}
      {isFullscreenEnvEnabled() ?
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    <Box position="absolute" marginTop={briefOwnsGap ? -2 : -1} height={suggestions.length === 0 && !showAutoModeOptIn ? 1 : 0} width="100%" paddingLeft={2} paddingRight={1} flexDirection="column" justifyContent="flex-end" overflow="hidden">
          <Notifications apiKeyStatus={apiKeyStatus} autoUpdaterResult={autoUpdaterResult} debug={debug} isAutoUpdating={isAutoUpdating} verbose={verbose} messages={messages} onAutoUpdaterResult={onAutoUpdaterResult} onChangeIsUpdating={setIsAutoUpdating} ideSelection={ideSelection} mcpClients={mcpClients} isInputWrapped={isInputWrapped} />
        </Box> : null}
    </Box>;
}

function getInitialPasteId(messages: Message[]): number {
  let maxId = 0;
  for (const message of messages) {
    if (message.type === 'user') {
      
      if (message.imagePasteIds) {
        for (const id of message.imagePasteIds) {
          if (id > maxId) maxId = id;
        }
      }
      
      if (Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type === 'text') {
            const refs = parseReferences(block.text);
            for (const ref of refs) {
              if (ref.id > maxId) maxId = ref.id;
            }
          }
        }
      }
    }
  }
  return maxId + 1;
}
function buildBorderText(showFastIcon: boolean, showFastIconHint: boolean, fastModeCooldown: boolean): BorderTextOptions | undefined {
  if (!showFastIcon) return undefined;
  const fastSeg = showFastIconHint ? `${getFastIconString(true, fastModeCooldown)} ${chalk.dim('/fast')}` : getFastIconString(true, fastModeCooldown);
  return {
    content: ` ${fastSeg} `,
    position: 'top',
    align: 'end',
    offset: 0
  };
}
export default React.memo(PromptInput);
