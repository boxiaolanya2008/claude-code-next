import type { Notification } from 'src/context/notifications.js'
import type { TodoList } from 'src/utils/todo/types.js'
import type { BridgePermissionCallbacks } from '../bridge/bridgePermissionCallbacks.js'
import type { Command } from '../commands.js'
import type { ChannelPermissionCallbacks } from '../services/mcp/channelPermissions.js'
import type { ElicitationRequestEvent } from '../services/mcp/elicitationHandler.js'
import type {
  MCPServerConnection,
  ServerResource,
} from '../services/mcp/types.js'
import { shouldEnablePromptSuggestion } from '../services/PromptSuggestion/promptSuggestion.js'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolPermissionContext,
} from '../Tool.js'
import type { TaskState } from '../tasks/types.js'
import type { AgentColorName } from '../tools/AgentTool/agentColorManager.js'
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js'
import type { AllowedPrompt } from '../tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import type { AgentId } from '../types/ids.js'
import type { Message, UserMessage } from '../types/message.js'
import type { LoadedPlugin, PluginError } from '../types/plugin.js'
import type { DeepImmutable } from '../types/utils.js'
import {
  type AttributionState,
  createEmptyAttributionState,
} from '../utils/commitAttribution.js'
import type { EffortValue } from '../utils/effort.js'
import type { FileHistoryState } from '../utils/fileHistory.js'
import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import type { SessionHooksState } from '../utils/hooks/sessionHooks.js'
import type { ModelSetting } from '../utils/model/model.js'
import type { DenialTrackingState } from '../utils/permissions/denialTracking.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'
import { shouldEnableThinkingByDefault } from '../utils/thinking.js'
import type { Store } from './store.js'

export type CompletionBoundary =
  | { type: 'complete'; completedAt: number; outputTokens: number }
  | { type: 'bash'; command: string; completedAt: number }
  | { type: 'edit'; toolName: string; filePath: string; completedAt: number }
  | {
      type: 'denied_tool'
      toolName: string
      detail: string
      completedAt: number
    }

export type SpeculationResult = {
  messages: Message[]
  boundary: CompletionBoundary | null
  timeSavedMs: number
}

export type SpeculationState =
  | { status: 'idle' }
  | {
      status: 'active'
      id: string
      abort: () => void
      startTime: number
      messagesRef: { current: Message[] } // Mutable ref - avoids array spreading per message
      writtenPathsRef: { current: Set<string> } // Mutable ref - relative paths written to overlay
      boundary: CompletionBoundary | null
      suggestionLength: number
      toolUseCount: number
      isPipelined: boolean
      contextRef: { current: REPLHookContext }
      pipelinedSuggestion?: {
        text: string
        promptId: 'user_intent' | 'stated_intent'
        generationRequestId: string | null
      } | null
    }

export const IDLE_SPECULATION_STATE: SpeculationState = { status: 'idle' }

export type FooterItem =
  | 'tasks'
  | 'tmux'
  | 'bagel'
  | 'teams'
  | 'bridge'
  | 'companion'

export type AppState = DeepImmutable<{
  settings: SettingsJson
  verbose: boolean
  mainLoopModel: ModelSetting
  mainLoopModelForSession: ModelSetting
  statusLineText: string | undefined
  expandedView: 'none' | 'tasks' | 'teammates'
  isBriefOnly: boolean
  
  showTeammateMessagePreview?: boolean
  selectedIPAgentIndex: number
  
  
  
  coordinatorTaskIndex: number
  viewSelectionMode: 'none' | 'selecting-agent' | 'viewing-agent'
  
  
  
  footerSelection: FooterItem | null
  toolPermissionContext: ToolPermissionContext
  spinnerTip?: string
  
  agent: string | undefined
  
  
  
  kairosEnabled: boolean
  
  remoteSessionUrl: string | undefined
  
  
  
  remoteConnectionStatus:
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected'
  
  // workflows) running inside the REMOTE daemon child. Event-sourced from
  
  
  
  remoteBackgroundTaskCount: number
  
  replBridgeEnabled: boolean
  
  replBridgeExplicit: boolean
  
  replBridgeOutboundOnly: boolean
  
  replBridgeConnected: boolean
  
  replBridgeSessionActive: boolean
  
  replBridgeReconnecting: boolean
  
  replBridgeConnectUrl: string | undefined
  
  replBridgeSessionUrl: string | undefined
  
  replBridgeEnvironmentId: string | undefined
  replBridgeSessionId: string | undefined
  
  replBridgeError: string | undefined
  
  replBridgeInitialName: string | undefined
  
  showRemoteCallout: boolean
}> & {
  // Unified task state - excluded from DeepImmutable because TaskState contains function types
  tasks: { [taskId: string]: TaskState }
  // Name → AgentId registry populated by Agent tool when `name` is provided.
  
  agentNameRegistry: Map<string, AgentId>
  
  foregroundedTaskId?: string
  
  viewingAgentTaskId?: string
  
  companionReaction?: string
  
  companionPetAt?: number
  
  mcp: {
    clients: MCPServerConnection[]
    tools: Tool[]
    commands: Command[]
    resources: Record<string, ServerResource[]>
    

    pluginReconnectKey: number
  }
  plugins: {
    enabled: LoadedPlugin[]
    disabled: LoadedPlugin[]
    commands: Command[]
    

    errors: PluginError[]
    
    installationStatus: {
      marketplaces: Array<{
        name: string
        status: 'pending' | 'installing' | 'installed' | 'failed'
        error?: string
      }>
      plugins: Array<{
        id: string
        name: string
        status: 'pending' | 'installing' | 'installed' | 'failed'
        error?: string
      }>
    }
    /**
     * Set to true when plugin state on disk has changed (background reconcile,
     * /plugin menu install, external settings edit) and active components are
     * stale. In interactive mode, user runs /reload-plugins to consume. In
     * headless mode, refreshPluginState() auto-consumes via refreshActivePlugins().
     */
    needsRefresh: boolean
  }
  agentDefinitions: AgentDefinitionsResult
  fileHistory: FileHistoryState
  attribution: AttributionState
  todos: { [agentId: string]: TodoList }
  remoteAgentTaskSuggestions: { summary: string; task: string }[]
  notifications: {
    current: Notification | null
    queue: Notification[]
  }
  elicitation: {
    queue: ElicitationRequestEvent[]
  }
  thinkingEnabled: boolean | undefined
  promptSuggestionEnabled: boolean
  sessionHooks: SessionHooksState
  tungstenActiveSession?: {
    sessionName: string
    socketName: string
    target: string 
  }
  tungstenLastCapturedTime?: number 
  tungstenLastCommand?: {
    command: string 
    timestamp: number 
  }
  // Sticky tmux panel visibility — mirrors globalConfig.tungstenPanelVisible for reactivity.
  tungstenPanelVisible?: boolean
  
  
  
  tungstenPanelAutoHidden?: boolean
  
  bagelActive?: boolean
  
  bagelUrl?: string
  
  bagelPanelVisible?: boolean
  
  
  
  
  
  computerUseMcpState?: {
    // Session-scoped app allowlist. NOT persisted across resume.
    allowedApps?: readonly {
      bundleId: string
      displayName: string
      grantedAt: number
    }[]
    
    grantFlags?: {
      clipboardRead: boolean
      clipboardWrite: boolean
      systemKeyCombos: boolean
    }
    // Dims-only (NOT the blob) for scaleCoord after compaction. The full
    
    lastScreenshotDims?: {
      width: number
      height: number
      displayWidth: number
      displayHeight: number
      displayId?: number
      originX?: number
      originY?: number
    }
    // Accumulated by onAppsHidden, cleared + unhidden at turn end.
    hiddenDuringTurn?: ReadonlySet<string>
    
    
    
    selectedDisplayId?: number
    
    
    
    
    
    displayPinnedByModel?: boolean
    
    
    
    displayResolvedForApps?: string
  }
  // REPL tool VM context - persists across REPL calls for state sharing
  replContext?: {
    vmContext: import('vm').Context
    registeredTools: Map<
      string,
      {
        name: string
        description: string
        schema: Record<string, unknown>
        handler: (args: Record<string, unknown>) => Promise<unknown>
      }
    >
    console: {
      log: (...args: unknown[]) => void
      error: (...args: unknown[]) => void
      warn: (...args: unknown[]) => void
      info: (...args: unknown[]) => void
      debug: (...args: unknown[]) => void
      getStdout: () => string
      getStderr: () => string
      clear: () => void
    }
  }
  teamContext?: {
    teamName: string
    teamFilePath: string
    leadAgentId: string
    
    
    selfAgentId?: string 
    selfAgentName?: string 
    isLeader?: boolean 
    selfAgentColor?: string 
    teammates: {
      [teammateId: string]: {
        name: string
        agentType?: string
        color?: string
        tmuxSessionName: string
        tmuxPaneId: string
        cwd: string
        worktreePath?: string
        spawnedAt: number
      }
    }
  }
  // Standalone agent context for non-swarm sessions with custom name/color
  standaloneAgentContext?: {
    name: string
    color?: AgentColorName
  }
  inbox: {
    messages: Array<{
      id: string
      from: string
      text: string
      timestamp: string
      status: 'pending' | 'processing' | 'processed'
      color?: string
      summary?: string
    }>
  }
  // Worker sandbox permission requests (leader side) - for network access approval
  workerSandboxPermissions: {
    queue: Array<{
      requestId: string
      workerId: string
      workerName: string
      workerColor?: string
      host: string
      createdAt: number
    }>
    selectedIndex: number
  }
  // Pending permission request on worker side (shown while waiting for leader approval)
  pendingWorkerRequest: {
    toolName: string
    toolUseId: string
    description: string
  } | null
  
  pendingSandboxRequest: {
    requestId: string
    host: string
  } | null
  promptSuggestion: {
    text: string | null
    promptId: 'user_intent' | 'stated_intent' | null
    shownAt: number
    acceptedAt: number
    generationRequestId: string | null
  }
  speculation: SpeculationState
  speculationSessionTimeSavedMs: number
  skillImprovement: {
    suggestion: {
      skillName: string
      updates: { section: string; change: string; reason: string }[]
    } | null
  }
  // Auth version - incremented on login/logout to trigger re-fetching of auth-dependent data
  authVersion: number
  
  
  initialMessage: {
    message: UserMessage
    clearContext?: boolean
    mode?: PermissionMode
    
    allowedPrompts?: AllowedPrompt[]
  } | null
  
  
  pendingPlanVerification?: {
    plan: string
    verificationStarted: boolean
    verificationCompleted: boolean
  }
  // Denial tracking for classifier modes (YOLO, headless, etc.) - falls back to prompting when limits exceeded
  denialTracking?: DenialTrackingState
  
  activeOverlays: ReadonlySet<string>
  
  fastMode?: boolean
  
  advisorModel?: string
  
  effortValue?: EffortValue
  
  
  
  
  ultraplanLaunching?: boolean
  
  // truthy disables the keyword trigger + rainbow. Cleared when the poll
  
  ultraplanSessionUrl?: string
  
  
  ultraplanPendingChoice?: { plan: string; sessionId: string; taskId: string }
  // Pre-launch permission dialog. Set by /ultraplan (slash or keyword);
  // cleared by UltraplanLaunchDialog on choice.
  ultraplanLaunchPending?: { blurb: string }
  // Remote-harness side: set via set_permission_mode control_request,
  // pushed to CCR external_metadata.is_ultraplan_mode by onChangeAppState.
  isUltraplanMode?: boolean
  
  replBridgePermissionCallbacks?: BridgePermissionCallbacks
  
  
  // interactiveHandler.ts. Constructed once in useManageMCPConnections.
  channelPermissionCallbacks?: ChannelPermissionCallbacks
}

export type AppStateStore = Store<AppState>

export function getDefaultAppState(): AppState {
  // Determine initial permission mode for teammates spawned with plan_mode_required
  
  
  const teammateUtils =
    require('../utils/teammate.js') as typeof import('../utils/teammate.js')
  
  const initialMode: PermissionMode =
    teammateUtils.isTeammate() && teammateUtils.isPlanModeRequired()
      ? 'plan'
      : 'default'

  return {
    settings: getInitialSettings(),
    tasks: {},
    agentNameRegistry: new Map(),
    verbose: false,
    mainLoopModel: null, // alias, full name (as with --model or env var), or null (default)
    mainLoopModelForSession: null,
    statusLineText: undefined,
    expandedView: 'none',
    isBriefOnly: false,
    showTeammateMessagePreview: false,
    selectedIPAgentIndex: -1,
    coordinatorTaskIndex: -1,
    viewSelectionMode: 'none',
    footerSelection: null,
    kairosEnabled: false,
    remoteSessionUrl: undefined,
    remoteConnectionStatus: 'connecting',
    remoteBackgroundTaskCount: 0,
    replBridgeEnabled: false,
    replBridgeExplicit: false,
    replBridgeOutboundOnly: false,
    replBridgeConnected: false,
    replBridgeSessionActive: false,
    replBridgeReconnecting: false,
    replBridgeConnectUrl: undefined,
    replBridgeSessionUrl: undefined,
    replBridgeEnvironmentId: undefined,
    replBridgeSessionId: undefined,
    replBridgeError: undefined,
    replBridgeInitialName: undefined,
    showRemoteCallout: false,
    toolPermissionContext: {
      ...getEmptyToolPermissionContext(),
      mode: initialMode,
    },
    agent: undefined,
    agentDefinitions: { activeAgents: [], allAgents: [] },
    fileHistory: {
      snapshots: [],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    },
    attribution: createEmptyAttributionState(),
    mcp: {
      clients: [],
      tools: [],
      commands: [],
      resources: {},
      pluginReconnectKey: 0,
    },
    plugins: {
      enabled: [],
      disabled: [],
      commands: [],
      errors: [],
      installationStatus: {
        marketplaces: [],
        plugins: [],
      },
      needsRefresh: false,
    },
    todos: {},
    remoteAgentTaskSuggestions: [],
    notifications: {
      current: null,
      queue: [],
    },
    elicitation: {
      queue: [],
    },
    thinkingEnabled: shouldEnableThinkingByDefault(),
    promptSuggestionEnabled: shouldEnablePromptSuggestion(),
    sessionHooks: new Map(),
    inbox: {
      messages: [],
    },
    workerSandboxPermissions: {
      queue: [],
      selectedIndex: 0,
    },
    pendingWorkerRequest: null,
    pendingSandboxRequest: null,
    promptSuggestion: {
      text: null,
      promptId: null,
      shownAt: 0,
      acceptedAt: 0,
      generationRequestId: null,
    },
    speculation: IDLE_SPECULATION_STATE,
    speculationSessionTimeSavedMs: 0,
    skillImprovement: {
      suggestion: null,
    },
    authVersion: 0,
    initialMessage: null,
    effortValue: undefined,
    activeOverlays: new Set<string>(),
    fastMode: false,
  }
}
