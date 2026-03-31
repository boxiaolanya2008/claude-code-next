import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Attributes, Meter, MetricOptions } from '@opentelemetry/api'
import type { logs } from '@opentelemetry/api-logs'
import type { LoggerProvider } from '@opentelemetry/sdk-logs'
import type { MeterProvider } from '@opentelemetry/sdk-metrics'
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { realpathSync } from 'fs'
import sumBy from 'lodash-es/sumBy.js'
import { cwd } from 'process'
import type { HookEvent, ModelUsage } from 'src/entrypoints/agentSdkTypes.js'
import type { AgentColorName } from 'src/tools/AgentTool/agentColorManager.js'
import type { HookCallbackMatcher } from 'src/types/hooks.js'

import { randomUUID } from 'src/utils/crypto.js'
import type { ModelSetting } from 'src/utils/model/model.js'
import type { ModelStrings } from 'src/utils/model/modelStrings.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { resetSettingsCache } from 'src/utils/settings/settingsCache.js'
import type { PluginHookMatcher } from 'src/utils/settings/types.js'
import { createSignal } from 'src/utils/signal.js'

type RegisteredHookMatcher = HookCallbackMatcher | PluginHookMatcher

import type { SessionId } from 'src/types/ids.js'

export type ChannelEntry =
  | { kind: 'plugin'; name: string; marketplace: string; dev?: boolean }
  | { kind: 'server'; name: string; dev?: boolean }

export type AttributedCounter = {
  add(value: number, additionalAttributes?: Attributes): void
}

type State = {
  originalCwd: string
  
  
  
  projectRoot: string
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  turnHookDurationMs: number
  turnToolDurationMs: number
  turnClassifierDurationMs: number
  turnToolCount: number
  turnHookCount: number
  turnClassifierCount: number
  startTime: number
  lastInteractionTime: number
  totalLinesAdded: number
  totalLinesRemoved: number
  hasUnknownModelCost: boolean
  cwd: string
  modelUsage: { [modelName: string]: ModelUsage }
  mainLoopModelOverride: ModelSetting | undefined
  initialMainLoopModel: ModelSetting
  modelStrings: ModelStrings | null
  isInteractive: boolean
  kairosActive: boolean
  
  
  
  
  strictToolResultPairing: boolean
  sdkAgentProgressSummariesEnabled: boolean
  userMsgOptIn: boolean
  clientType: string
  sessionSource: string | undefined
  questionPreviewFormat: 'markdown' | 'html' | undefined
  flagSettingsPath: string | undefined
  flagSettingsInline: Record<string, unknown> | null
  allowedSettingSources: SettingSource[]
  sessionIngressToken: string | null | undefined
  oauthTokenFromFd: string | null | undefined
  apiKeyFromFd: string | null | undefined
  
  meter: Meter | null
  sessionCounter: AttributedCounter | null
  locCounter: AttributedCounter | null
  prCounter: AttributedCounter | null
  commitCounter: AttributedCounter | null
  costCounter: AttributedCounter | null
  tokenCounter: AttributedCounter | null
  codeEditToolDecisionCounter: AttributedCounter | null
  activeTimeCounter: AttributedCounter | null
  statsStore: { observe(name: string, value: number): void } | null
  sessionId: SessionId
  
  parentSessionId: SessionId | undefined
  
  loggerProvider: LoggerProvider | null
  eventLogger: ReturnType<typeof logs.getLogger> | null
  
  meterProvider: MeterProvider | null
  
  tracerProvider: BasicTracerProvider | null
  
  agentColorMap: Map<string, AgentColorName>
  agentColorIndex: number
  
  lastAPIRequest: Omit<BetaMessageStreamParams, 'messages'> | null
  
  
  
  lastAPIRequestMessages: BetaMessageStreamParams['messages'] | null
  
  lastClassifierRequests: unknown[] | null
  
  
  cachedClaudeMdContent: string | null
  
  inMemoryErrorLog: Array<{ error: string; timestamp: string }>
  
  inlinePlugins: Array<string>
  
  chromeFlagOverride: boolean | undefined
  
  useCoworkPlugins: boolean
  
  sessionBypassPermissionsMode: boolean
  
  
  
  scheduledTasksEnabled: boolean
  
  
  
  
  
  sessionCronTasks: SessionCronTask[]
  
  
  
  
  
  sessionCreatedTeams: Set<string>
  
  
  
  sessionTrustAccepted: boolean
  
  sessionPersistenceDisabled: boolean
  
  hasExitedPlanMode: boolean
  
  needsPlanModeExitAttachment: boolean
  
  needsAutoModeExitAttachment: boolean
  
  lspRecommendationShownThisSession: boolean
  
  initJsonSchema: Record<string, unknown> | null
  
  registeredHooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>> | null
  
  planSlugCache: Map<string, string>
  
  teleportedSessionInfo: {
    isTeleported: boolean
    hasLoggedFirstMessage: boolean
    sessionId: string | null
  } | null
  
  
  invokedSkills: Map<
    string,
    {
      skillName: string
      skillPath: string
      content: string
      invokedAt: number
      agentId: string | null
    }
  >
  
  slowOperations: Array<{
    operation: string
    durationMs: number
    timestamp: number
  }>
  
  sdkBetas: string[] | undefined
  
  mainThreadAgentType: string | undefined
  
  isRemoteMode: boolean
  
  directConnectServerUrl: string | undefined
  
  systemPromptSectionCache: Map<string, string | null>
  
  lastEmittedDate: string | null
  
  additionalDirectoriesForClaudeMd: string[]
  
  
  
  
  
  allowedChannels: ChannelEntry[]
  
  
  
  hasDevChannels: boolean
  
  sessionProjectDir: string | null
  
  promptCache1hAllowlist: string[] | null
  
  
  
  promptCache1hEligible: boolean | null
  
  
  
  afkModeHeaderLatched: boolean | null
  
  
  
  fastModeHeaderLatched: boolean | null
  
  
  
  cacheEditingHeaderLatched: boolean | null
  
  
  
  
  thinkingClearLatched: boolean | null
  
  promptId: string | null
  
  
  
  lastMainRequestId: string | undefined
  
  
  
  lastApiCompletionTimestamp: number | null
  
  
  
  pendingPostCompaction: boolean
}

function getInitialState(): State {
  
  
  let resolvedCwd = ''
  if (
    typeof process !== 'undefined' &&
    typeof process.cwd === 'function' &&
    typeof realpathSync === 'function'
  ) {
    const rawCwd = cwd()
    try {
      resolvedCwd = realpathSync(rawCwd).normalize('NFC')
    } catch {
      
      resolvedCwd = rawCwd.normalize('NFC')
    }
  }
  const state: State = {
    originalCwd: resolvedCwd,
    projectRoot: resolvedCwd,
    totalCostUSD: 0,
    totalAPIDuration: 0,
    totalAPIDurationWithoutRetries: 0,
    totalToolDuration: 0,
    turnHookDurationMs: 0,
    turnToolDurationMs: 0,
    turnClassifierDurationMs: 0,
    turnToolCount: 0,
    turnHookCount: 0,
    turnClassifierCount: 0,
    startTime: Date.now(),
    lastInteractionTime: Date.now(),
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    hasUnknownModelCost: false,
    cwd: resolvedCwd,
    modelUsage: {},
    mainLoopModelOverride: undefined,
    initialMainLoopModel: null,
    modelStrings: null,
    isInteractive: false,
    kairosActive: false,
    strictToolResultPairing: false,
    sdkAgentProgressSummariesEnabled: false,
    userMsgOptIn: false,
    clientType: 'cli',
    sessionSource: undefined,
    questionPreviewFormat: undefined,
    sessionIngressToken: undefined,
    oauthTokenFromFd: undefined,
    apiKeyFromFd: undefined,
    flagSettingsPath: undefined,
    flagSettingsInline: null,
    allowedSettingSources: [
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ],
    
    meter: null,
    sessionCounter: null,
    locCounter: null,
    prCounter: null,
    commitCounter: null,
    costCounter: null,
    tokenCounter: null,
    codeEditToolDecisionCounter: null,
    activeTimeCounter: null,
    statsStore: null,
    sessionId: randomUUID() as SessionId,
    parentSessionId: undefined,
    
    loggerProvider: null,
    eventLogger: null,
    
    meterProvider: null,
    tracerProvider: null,
    
    agentColorMap: new Map(),
    agentColorIndex: 0,
    
    lastAPIRequest: null,
    lastAPIRequestMessages: null,
    
    lastClassifierRequests: null,
    cachedClaudeMdContent: null,
    
    inMemoryErrorLog: [],
    
    inlinePlugins: [],
    
    chromeFlagOverride: undefined,
    
    useCoworkPlugins: false,
    
    sessionBypassPermissionsMode: false,
    
    scheduledTasksEnabled: false,
    sessionCronTasks: [],
    sessionCreatedTeams: new Set(),
    
    sessionTrustAccepted: false,
    
    sessionPersistenceDisabled: false,
    
    hasExitedPlanMode: false,
    
    needsPlanModeExitAttachment: false,
    
    needsAutoModeExitAttachment: false,
    
    lspRecommendationShownThisSession: false,
    
    initJsonSchema: null,
    registeredHooks: null,
    
    planSlugCache: new Map(),
    
    teleportedSessionInfo: null,
    
    invokedSkills: new Map(),
    
    slowOperations: [],
    
    sdkBetas: undefined,
    
    mainThreadAgentType: undefined,
    
    isRemoteMode: false,
    ...(process.env.USER_TYPE === 'ant'
      ? {
          replBridgeActive: false,
        }
      : {}),
    
    directConnectServerUrl: undefined,
    
    systemPromptSectionCache: new Map(),
    
    lastEmittedDate: null,
    
    additionalDirectoriesForClaudeMd: [],
    
    allowedChannels: [],
    hasDevChannels: false,
    
    sessionProjectDir: null,
    
    promptCache1hAllowlist: null,
    
    promptCache1hEligible: null,
    
    afkModeHeaderLatched: null,
    fastModeHeaderLatched: null,
    cacheEditingHeaderLatched: null,
    thinkingClearLatched: null,
    
    promptId: null,
    lastMainRequestId: undefined,
    lastApiCompletionTimestamp: null,
    pendingPostCompaction: false,
  }

  return state
}

const STATE: State = getInitialState()

export function getSessionId(): SessionId {
  return STATE.sessionId
}

export function regenerateSessionId(
  options: { setCurrentAsParent?: boolean } = {},
): SessionId {
  if (options.setCurrentAsParent) {
    STATE.parentSessionId = STATE.sessionId
  }
  
  
  
  STATE.planSlugCache.delete(STATE.sessionId)
  
  
  STATE.sessionId = randomUUID() as SessionId
  STATE.sessionProjectDir = null
  return STATE.sessionId
}

export function getParentSessionId(): SessionId | undefined {
  return STATE.parentSessionId
}

export function switchSession(
  sessionId: SessionId,
  projectDir: string | null = null,
): void {
  
  
  
  STATE.planSlugCache.delete(STATE.sessionId)
  STATE.sessionId = sessionId
  STATE.sessionProjectDir = projectDir
  sessionSwitched.emit(sessionId)
}

const sessionSwitched = createSignal<[id: SessionId]>()

export const onSessionSwitch = sessionSwitched.subscribe

export function getSessionProjectDir(): string | null {
  return STATE.sessionProjectDir
}

export function getOriginalCwd(): string {
  return STATE.originalCwd
}

export function getProjectRoot(): string {
  return STATE.projectRoot
}

export function setOriginalCwd(cwd: string): void {
  STATE.originalCwd = cwd.normalize('NFC')
}

export function setProjectRoot(cwd: string): void {
  STATE.projectRoot = cwd.normalize('NFC')
}

export function getCwdState(): string {
  return STATE.cwd
}

export function setCwdState(cwd: string): void {
  STATE.cwd = cwd.normalize('NFC')
}

export function getDirectConnectServerUrl(): string | undefined {
  return STATE.directConnectServerUrl
}

export function setDirectConnectServerUrl(url: string): void {
  STATE.directConnectServerUrl = url
}

export function addToTotalDurationState(
  duration: number,
  durationWithoutRetries: number,
): void {
  STATE.totalAPIDuration += duration
  STATE.totalAPIDurationWithoutRetries += durationWithoutRetries
}

export function resetTotalDurationStateAndCost_FOR_TESTS_ONLY(): void {
  STATE.totalAPIDuration = 0
  STATE.totalAPIDurationWithoutRetries = 0
  STATE.totalCostUSD = 0
}

export function addToTotalCostState(
  cost: number,
  modelUsage: ModelUsage,
  model: string,
): void {
  STATE.modelUsage[model] = modelUsage
  STATE.totalCostUSD += cost
}

export function getTotalCostUSD(): number {
  return STATE.totalCostUSD
}

export function getTotalAPIDuration(): number {
  return STATE.totalAPIDuration
}

export function getTotalDuration(): number {
  return Date.now() - STATE.startTime
}

export function getTotalAPIDurationWithoutRetries(): number {
  return STATE.totalAPIDurationWithoutRetries
}

export function getTotalToolDuration(): number {
  return STATE.totalToolDuration
}

export function addToToolDuration(duration: number): void {
  STATE.totalToolDuration += duration
  STATE.turnToolDurationMs += duration
  STATE.turnToolCount++
}

export function getTurnHookDurationMs(): number {
  return STATE.turnHookDurationMs
}

export function addToTurnHookDuration(duration: number): void {
  STATE.turnHookDurationMs += duration
  STATE.turnHookCount++
}

export function resetTurnHookDuration(): void {
  STATE.turnHookDurationMs = 0
  STATE.turnHookCount = 0
}

export function getTurnHookCount(): number {
  return STATE.turnHookCount
}

export function getTurnToolDurationMs(): number {
  return STATE.turnToolDurationMs
}

export function resetTurnToolDuration(): void {
  STATE.turnToolDurationMs = 0
  STATE.turnToolCount = 0
}

export function getTurnToolCount(): number {
  return STATE.turnToolCount
}

export function getTurnClassifierDurationMs(): number {
  return STATE.turnClassifierDurationMs
}

export function addToTurnClassifierDuration(duration: number): void {
  STATE.turnClassifierDurationMs += duration
  STATE.turnClassifierCount++
}

export function resetTurnClassifierDuration(): void {
  STATE.turnClassifierDurationMs = 0
  STATE.turnClassifierCount = 0
}

export function getTurnClassifierCount(): number {
  return STATE.turnClassifierCount
}

export function getStatsStore(): {
  observe(name: string, value: number): void
} | null {
  return STATE.statsStore
}

export function setStatsStore(
  store: { observe(name: string, value: number): void } | null,
): void {
  STATE.statsStore = store
}

let interactionTimeDirty = false

export function updateLastInteractionTime(immediate?: boolean): void {
  if (immediate) {
    flushInteractionTime_inner()
  } else {
    interactionTimeDirty = true
  }
}

export function flushInteractionTime(): void {
  if (interactionTimeDirty) {
    flushInteractionTime_inner()
  }
}

function flushInteractionTime_inner(): void {
  STATE.lastInteractionTime = Date.now()
  interactionTimeDirty = false
}

export function addToTotalLinesChanged(added: number, removed: number): void {
  STATE.totalLinesAdded += added
  STATE.totalLinesRemoved += removed
}

export function getTotalLinesAdded(): number {
  return STATE.totalLinesAdded
}

export function getTotalLinesRemoved(): number {
  return STATE.totalLinesRemoved
}

export function getTotalInputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'inputTokens')
}

export function getTotalOutputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'outputTokens')
}

export function getTotalCacheReadInputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'cacheReadInputTokens')
}

export function getTotalCacheCreationInputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'cacheCreationInputTokens')
}

export function getTotalWebSearchRequests(): number {
  return sumBy(Object.values(STATE.modelUsage), 'webSearchRequests')
}

let outputTokensAtTurnStart = 0
let currentTurnTokenBudget: number | null = null
export function getTurnOutputTokens(): number {
  return getTotalOutputTokens() - outputTokensAtTurnStart
}
export function getCurrentTurnTokenBudget(): number | null {
  return currentTurnTokenBudget
}
let budgetContinuationCount = 0
export function snapshotOutputTokensForTurn(budget: number | null): void {
  outputTokensAtTurnStart = getTotalOutputTokens()
  currentTurnTokenBudget = budget
  budgetContinuationCount = 0
}
export function getBudgetContinuationCount(): number {
  return budgetContinuationCount
}
export function incrementBudgetContinuationCount(): void {
  budgetContinuationCount++
}

export function setHasUnknownModelCost(): void {
  STATE.hasUnknownModelCost = true
}

export function hasUnknownModelCost(): boolean {
  return STATE.hasUnknownModelCost
}

export function getLastMainRequestId(): string | undefined {
  return STATE.lastMainRequestId
}

export function setLastMainRequestId(requestId: string): void {
  STATE.lastMainRequestId = requestId
}

export function getLastApiCompletionTimestamp(): number | null {
  return STATE.lastApiCompletionTimestamp
}

export function setLastApiCompletionTimestamp(timestamp: number): void {
  STATE.lastApiCompletionTimestamp = timestamp
}

export function markPostCompaction(): void {
  STATE.pendingPostCompaction = true
}

export function consumePostCompaction(): boolean {
  const was = STATE.pendingPostCompaction
  STATE.pendingPostCompaction = false
  return was
}

export function getLastInteractionTime(): number {
  return STATE.lastInteractionTime
}

let scrollDraining = false
let scrollDrainTimer: ReturnType<typeof setTimeout> | undefined
const SCROLL_DRAIN_IDLE_MS = 150

export function markScrollActivity(): void {
  scrollDraining = true
  if (scrollDrainTimer) clearTimeout(scrollDrainTimer)
  scrollDrainTimer = setTimeout(() => {
    scrollDraining = false
    scrollDrainTimer = undefined
  }, SCROLL_DRAIN_IDLE_MS)
  scrollDrainTimer.unref?.()
}

export function getIsScrollDraining(): boolean {
  return scrollDraining
}

export async function waitForScrollIdle(): Promise<void> {
  while (scrollDraining) {
    
    
    await new Promise(r => setTimeout(r, SCROLL_DRAIN_IDLE_MS).unref?.())
  }
}

export function getModelUsage(): { [modelName: string]: ModelUsage } {
  return STATE.modelUsage
}

export function getUsageForModel(model: string): ModelUsage | undefined {
  return STATE.modelUsage[model]
}

export function getMainLoopModelOverride(): ModelSetting | undefined {
  return STATE.mainLoopModelOverride
}

export function getInitialMainLoopModel(): ModelSetting {
  return STATE.initialMainLoopModel
}

export function setMainLoopModelOverride(
  model: ModelSetting | undefined,
): void {
  STATE.mainLoopModelOverride = model
}

export function setInitialMainLoopModel(model: ModelSetting): void {
  STATE.initialMainLoopModel = model
}

export function getSdkBetas(): string[] | undefined {
  return STATE.sdkBetas
}

export function setSdkBetas(betas: string[] | undefined): void {
  STATE.sdkBetas = betas
}

export function resetCostState(): void {
  STATE.totalCostUSD = 0
  STATE.totalAPIDuration = 0
  STATE.totalAPIDurationWithoutRetries = 0
  STATE.totalToolDuration = 0
  STATE.startTime = Date.now()
  STATE.totalLinesAdded = 0
  STATE.totalLinesRemoved = 0
  STATE.hasUnknownModelCost = false
  STATE.modelUsage = {}
  STATE.promptId = null
}

export function setCostStateForRestore({
  totalCostUSD,
  totalAPIDuration,
  totalAPIDurationWithoutRetries,
  totalToolDuration,
  totalLinesAdded,
  totalLinesRemoved,
  lastDuration,
  modelUsage,
}: {
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  lastDuration: number | undefined
  modelUsage: { [modelName: string]: ModelUsage } | undefined
}): void {
  STATE.totalCostUSD = totalCostUSD
  STATE.totalAPIDuration = totalAPIDuration
  STATE.totalAPIDurationWithoutRetries = totalAPIDurationWithoutRetries
  STATE.totalToolDuration = totalToolDuration
  STATE.totalLinesAdded = totalLinesAdded
  STATE.totalLinesRemoved = totalLinesRemoved

  
  if (modelUsage) {
    STATE.modelUsage = modelUsage
  }

  
  if (lastDuration) {
    STATE.startTime = Date.now() - lastDuration
  }
}

export function resetStateForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetStateForTests can only be called in tests')
  }
  Object.entries(getInitialState()).forEach(([key, value]) => {
    STATE[key as keyof State] = value as never
  })
  outputTokensAtTurnStart = 0
  currentTurnTokenBudget = null
  budgetContinuationCount = 0
  sessionSwitched.clear()
}

export function getModelStrings(): ModelStrings | null {
  return STATE.modelStrings
}

export function setModelStrings(modelStrings: ModelStrings): void {
  STATE.modelStrings = modelStrings
}

export function resetModelStringsForTestingOnly() {
  STATE.modelStrings = null
}

export function setMeter(
  meter: Meter,
  createCounter: (name: string, options: MetricOptions) => AttributedCounter,
): void {
  STATE.meter = meter

  
  STATE.sessionCounter = createCounter('claude_code_next.session.count', {
    description: 'Count of CLI sessions started',
  })
  STATE.locCounter = createCounter('claude_code_next.lines_of_code.count', {
    description:
      "Count of lines of code modified, with the 'type' attribute indicating whether lines were added or removed",
  })
  STATE.prCounter = createCounter('claude_code_next.pull_request.count', {
    description: 'Number of pull requests created',
  })
  STATE.commitCounter = createCounter('claude_code_next.commit.count', {
    description: 'Number of git commits created',
  })
  STATE.costCounter = createCounter('claude_code_next.cost.usage', {
    description: 'Cost of the Claude Code Next session',
    unit: 'USD',
  })
  STATE.tokenCounter = createCounter('claude_code_next.token.usage', {
    description: 'Number of tokens used',
    unit: 'tokens',
  })
  STATE.codeEditToolDecisionCounter = createCounter(
    'claude_code_next.code_edit_tool.decision',
    {
      description:
        'Count of code editing tool permission decisions (accept/reject) for Edit, Write, and NotebookEdit tools',
    },
  )
  STATE.activeTimeCounter = createCounter('claude_code_next.active_time.total', {
    description: 'Total active time in seconds',
    unit: 's',
  })
}

export function getMeter(): Meter | null {
  return STATE.meter
}

export function getSessionCounter(): AttributedCounter | null {
  return STATE.sessionCounter
}

export function getLocCounter(): AttributedCounter | null {
  return STATE.locCounter
}

export function getPrCounter(): AttributedCounter | null {
  return STATE.prCounter
}

export function getCommitCounter(): AttributedCounter | null {
  return STATE.commitCounter
}

export function getCostCounter(): AttributedCounter | null {
  return STATE.costCounter
}

export function getTokenCounter(): AttributedCounter | null {
  return STATE.tokenCounter
}

export function getCodeEditToolDecisionCounter(): AttributedCounter | null {
  return STATE.codeEditToolDecisionCounter
}

export function getActiveTimeCounter(): AttributedCounter | null {
  return STATE.activeTimeCounter
}

export function getLoggerProvider(): LoggerProvider | null {
  return STATE.loggerProvider
}

export function setLoggerProvider(provider: LoggerProvider | null): void {
  STATE.loggerProvider = provider
}

export function getEventLogger(): ReturnType<typeof logs.getLogger> | null {
  return STATE.eventLogger
}

export function setEventLogger(
  logger: ReturnType<typeof logs.getLogger> | null,
): void {
  STATE.eventLogger = logger
}

export function getMeterProvider(): MeterProvider | null {
  return STATE.meterProvider
}

export function setMeterProvider(provider: MeterProvider | null): void {
  STATE.meterProvider = provider
}
export function getTracerProvider(): BasicTracerProvider | null {
  return STATE.tracerProvider
}
export function setTracerProvider(provider: BasicTracerProvider | null): void {
  STATE.tracerProvider = provider
}

export function getIsNonInteractiveSession(): boolean {
  return !STATE.isInteractive
}

export function getIsInteractive(): boolean {
  return STATE.isInteractive
}

export function setIsInteractive(value: boolean): void {
  STATE.isInteractive = value
}

export function getClientType(): string {
  return STATE.clientType
}

export function setClientType(type: string): void {
  STATE.clientType = type
}

export function getSdkAgentProgressSummariesEnabled(): boolean {
  return STATE.sdkAgentProgressSummariesEnabled
}

export function setSdkAgentProgressSummariesEnabled(value: boolean): void {
  STATE.sdkAgentProgressSummariesEnabled = value
}

export function getKairosActive(): boolean {
  return STATE.kairosActive
}

export function setKairosActive(value: boolean): void {
  STATE.kairosActive = value
}

export function getStrictToolResultPairing(): boolean {
  return STATE.strictToolResultPairing
}

export function setStrictToolResultPairing(value: boolean): void {
  STATE.strictToolResultPairing = value
}

export function getUserMsgOptIn(): boolean {
  return STATE.userMsgOptIn
}

export function setUserMsgOptIn(value: boolean): void {
  STATE.userMsgOptIn = value
}

export function getSessionSource(): string | undefined {
  return STATE.sessionSource
}

export function setSessionSource(source: string): void {
  STATE.sessionSource = source
}

export function getQuestionPreviewFormat(): 'markdown' | 'html' | undefined {
  return STATE.questionPreviewFormat
}

export function setQuestionPreviewFormat(format: 'markdown' | 'html'): void {
  STATE.questionPreviewFormat = format
}

export function getAgentColorMap(): Map<string, AgentColorName> {
  return STATE.agentColorMap
}

export function getFlagSettingsPath(): string | undefined {
  return STATE.flagSettingsPath
}

export function setFlagSettingsPath(path: string | undefined): void {
  STATE.flagSettingsPath = path
}

export function getFlagSettingsInline(): Record<string, unknown> | null {
  return STATE.flagSettingsInline
}

export function setFlagSettingsInline(
  settings: Record<string, unknown> | null,
): void {
  STATE.flagSettingsInline = settings
}

export function getSessionIngressToken(): string | null | undefined {
  return STATE.sessionIngressToken
}

export function setSessionIngressToken(token: string | null): void {
  STATE.sessionIngressToken = token
}

export function getOauthTokenFromFd(): string | null | undefined {
  return STATE.oauthTokenFromFd
}

export function setOauthTokenFromFd(token: string | null): void {
  STATE.oauthTokenFromFd = token
}

export function getApiKeyFromFd(): string | null | undefined {
  return STATE.apiKeyFromFd
}

export function setApiKeyFromFd(key: string | null): void {
  STATE.apiKeyFromFd = key
}

export function setLastAPIRequest(
  params: Omit<BetaMessageStreamParams, 'messages'> | null,
): void {
  STATE.lastAPIRequest = params
}

export function getLastAPIRequest(): Omit<
  BetaMessageStreamParams,
  'messages'
> | null {
  return STATE.lastAPIRequest
}

export function setLastAPIRequestMessages(
  messages: BetaMessageStreamParams['messages'] | null,
): void {
  STATE.lastAPIRequestMessages = messages
}

export function getLastAPIRequestMessages():
  | BetaMessageStreamParams['messages']
  | null {
  return STATE.lastAPIRequestMessages
}

export function setLastClassifierRequests(requests: unknown[] | null): void {
  STATE.lastClassifierRequests = requests
}

export function getLastClassifierRequests(): unknown[] | null {
  return STATE.lastClassifierRequests
}

export function setCachedClaudeMdContent(content: string | null): void {
  STATE.cachedClaudeMdContent = content
}

export function getCachedClaudeMdContent(): string | null {
  return STATE.cachedClaudeMdContent
}

export function addToInMemoryErrorLog(errorInfo: {
  error: string
  timestamp: string
}): void {
  const MAX_IN_MEMORY_ERRORS = 100
  if (STATE.inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {
    STATE.inMemoryErrorLog.shift() 
  }
  STATE.inMemoryErrorLog.push(errorInfo)
}

export function getAllowedSettingSources(): SettingSource[] {
  return STATE.allowedSettingSources
}

export function setAllowedSettingSources(sources: SettingSource[]): void {
  STATE.allowedSettingSources = sources
}

export function preferThirdPartyAuthentication(): boolean {
  
  return getIsNonInteractiveSession() && STATE.clientType !== 'claude-vscode'
}

export function setInlinePlugins(plugins: Array<string>): void {
  STATE.inlinePlugins = plugins
}

export function getInlinePlugins(): Array<string> {
  return STATE.inlinePlugins
}

export function setChromeFlagOverride(value: boolean | undefined): void {
  STATE.chromeFlagOverride = value
}

export function getChromeFlagOverride(): boolean | undefined {
  return STATE.chromeFlagOverride
}

export function setUseCoworkPlugins(value: boolean): void {
  STATE.useCoworkPlugins = value
  resetSettingsCache()
}

export function getUseCoworkPlugins(): boolean {
  return STATE.useCoworkPlugins
}

export function setSessionBypassPermissionsMode(enabled: boolean): void {
  STATE.sessionBypassPermissionsMode = enabled
}

export function getSessionBypassPermissionsMode(): boolean {
  return STATE.sessionBypassPermissionsMode
}

export function setScheduledTasksEnabled(enabled: boolean): void {
  STATE.scheduledTasksEnabled = enabled
}

export function getScheduledTasksEnabled(): boolean {
  return STATE.scheduledTasksEnabled
}

export type SessionCronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
  

  agentId?: string
}

export function getSessionCronTasks(): SessionCronTask[] {
  return STATE.sessionCronTasks
}

export function addSessionCronTask(task: SessionCronTask): void {
  STATE.sessionCronTasks.push(task)
}

export function removeSessionCronTasks(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  const idSet = new Set(ids)
  const remaining = STATE.sessionCronTasks.filter(t => !idSet.has(t.id))
  const removed = STATE.sessionCronTasks.length - remaining.length
  if (removed === 0) return 0
  STATE.sessionCronTasks = remaining
  return removed
}

export function setSessionTrustAccepted(accepted: boolean): void {
  STATE.sessionTrustAccepted = accepted
}

export function getSessionTrustAccepted(): boolean {
  return STATE.sessionTrustAccepted
}

export function setSessionPersistenceDisabled(disabled: boolean): void {
  STATE.sessionPersistenceDisabled = disabled
}

export function isSessionPersistenceDisabled(): boolean {
  return STATE.sessionPersistenceDisabled
}

export function hasExitedPlanModeInSession(): boolean {
  return STATE.hasExitedPlanMode
}

export function setHasExitedPlanMode(value: boolean): void {
  STATE.hasExitedPlanMode = value
}

export function needsPlanModeExitAttachment(): boolean {
  return STATE.needsPlanModeExitAttachment
}

export function setNeedsPlanModeExitAttachment(value: boolean): void {
  STATE.needsPlanModeExitAttachment = value
}

export function handlePlanModeTransition(
  fromMode: string,
  toMode: string,
): void {
  
  
  if (toMode === 'plan' && fromMode !== 'plan') {
    STATE.needsPlanModeExitAttachment = false
  }

  
  if (fromMode === 'plan' && toMode !== 'plan') {
    STATE.needsPlanModeExitAttachment = true
  }
}

export function needsAutoModeExitAttachment(): boolean {
  return STATE.needsAutoModeExitAttachment
}

export function setNeedsAutoModeExitAttachment(value: boolean): void {
  STATE.needsAutoModeExitAttachment = value
}

export function handleAutoModeTransition(
  fromMode: string,
  toMode: string,
): void {
  
  
  
  if (
    (fromMode === 'auto' && toMode === 'plan') ||
    (fromMode === 'plan' && toMode === 'auto')
  ) {
    return
  }
  const fromIsAuto = fromMode === 'auto'
  const toIsAuto = toMode === 'auto'

  
  
  if (toIsAuto && !fromIsAuto) {
    STATE.needsAutoModeExitAttachment = false
  }

  
  if (fromIsAuto && !toIsAuto) {
    STATE.needsAutoModeExitAttachment = true
  }
}

export function hasShownLspRecommendationThisSession(): boolean {
  return STATE.lspRecommendationShownThisSession
}

export function setLspRecommendationShownThisSession(value: boolean): void {
  STATE.lspRecommendationShownThisSession = value
}

export function setInitJsonSchema(schema: Record<string, unknown>): void {
  STATE.initJsonSchema = schema
}

export function getInitJsonSchema(): Record<string, unknown> | null {
  return STATE.initJsonSchema
}

export function registerHookCallbacks(
  hooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>>,
): void {
  if (!STATE.registeredHooks) {
    STATE.registeredHooks = {}
  }

  
  for (const [event, matchers] of Object.entries(hooks)) {
    const eventKey = event as HookEvent
    if (!STATE.registeredHooks[eventKey]) {
      STATE.registeredHooks[eventKey] = []
    }
    STATE.registeredHooks[eventKey]!.push(...matchers)
  }
}

export function getRegisteredHooks(): Partial<
  Record<HookEvent, RegisteredHookMatcher[]>
> | null {
  return STATE.registeredHooks
}

export function clearRegisteredHooks(): void {
  STATE.registeredHooks = null
}

export function clearRegisteredPluginHooks(): void {
  if (!STATE.registeredHooks) {
    return
  }

  const filtered: Partial<Record<HookEvent, RegisteredHookMatcher[]>> = {}
  for (const [event, matchers] of Object.entries(STATE.registeredHooks)) {
    
    const callbackHooks = matchers.filter(m => !('pluginRoot' in m))
    if (callbackHooks.length > 0) {
      filtered[event as HookEvent] = callbackHooks
    }
  }

  STATE.registeredHooks = Object.keys(filtered).length > 0 ? filtered : null
}

export function resetSdkInitState(): void {
  STATE.initJsonSchema = null
  STATE.registeredHooks = null
}

export function getPlanSlugCache(): Map<string, string> {
  return STATE.planSlugCache
}

export function getSessionCreatedTeams(): Set<string> {
  return STATE.sessionCreatedTeams
}

export function setTeleportedSessionInfo(info: {
  sessionId: string | null
}): void {
  STATE.teleportedSessionInfo = {
    isTeleported: true,
    hasLoggedFirstMessage: false,
    sessionId: info.sessionId,
  }
}

export function getTeleportedSessionInfo(): {
  isTeleported: boolean
  hasLoggedFirstMessage: boolean
  sessionId: string | null
} | null {
  return STATE.teleportedSessionInfo
}

export function markFirstTeleportMessageLogged(): void {
  if (STATE.teleportedSessionInfo) {
    STATE.teleportedSessionInfo.hasLoggedFirstMessage = true
  }
}

export type InvokedSkillInfo = {
  skillName: string
  skillPath: string
  content: string
  invokedAt: number
  agentId: string | null
}

export function addInvokedSkill(
  skillName: string,
  skillPath: string,
  content: string,
  agentId: string | null = null,
): void {
  const key = `${agentId ?? ''}:${skillName}`
  STATE.invokedSkills.set(key, {
    skillName,
    skillPath,
    content,
    invokedAt: Date.now(),
    agentId,
  })
}

export function getInvokedSkills(): Map<string, InvokedSkillInfo> {
  return STATE.invokedSkills
}

export function getInvokedSkillsForAgent(
  agentId: string | undefined | null,
): Map<string, InvokedSkillInfo> {
  const normalizedId = agentId ?? null
  const filtered = new Map<string, InvokedSkillInfo>()
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === normalizedId) {
      filtered.set(key, skill)
    }
  }
  return filtered
}

export function clearInvokedSkills(
  preservedAgentIds?: ReadonlySet<string>,
): void {
  if (!preservedAgentIds || preservedAgentIds.size === 0) {
    STATE.invokedSkills.clear()
    return
  }
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === null || !preservedAgentIds.has(skill.agentId)) {
      STATE.invokedSkills.delete(key)
    }
  }
}

export function clearInvokedSkillsForAgent(agentId: string): void {
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === agentId) {
      STATE.invokedSkills.delete(key)
    }
  }
}

const MAX_SLOW_OPERATIONS = 10
const SLOW_OPERATION_TTL_MS = 10000

export function addSlowOperation(operation: string, durationMs: number): void {
  if (process.env.USER_TYPE !== 'ant') return
  
  
  if (operation.includes('exec') && operation.includes('claude-prompt-')) {
    return
  }
  const now = Date.now()
  
  STATE.slowOperations = STATE.slowOperations.filter(
    op => now - op.timestamp < SLOW_OPERATION_TTL_MS,
  )
  
  STATE.slowOperations.push({ operation, durationMs, timestamp: now })
  
  if (STATE.slowOperations.length > MAX_SLOW_OPERATIONS) {
    STATE.slowOperations = STATE.slowOperations.slice(-MAX_SLOW_OPERATIONS)
  }
}

const EMPTY_SLOW_OPERATIONS: ReadonlyArray<{
  operation: string
  durationMs: number
  timestamp: number
}> = []

export function getSlowOperations(): ReadonlyArray<{
  operation: string
  durationMs: number
  timestamp: number
}> {
  
  
  if (STATE.slowOperations.length === 0) {
    return EMPTY_SLOW_OPERATIONS
  }
  const now = Date.now()
  
  
  if (
    STATE.slowOperations.some(op => now - op.timestamp >= SLOW_OPERATION_TTL_MS)
  ) {
    STATE.slowOperations = STATE.slowOperations.filter(
      op => now - op.timestamp < SLOW_OPERATION_TTL_MS,
    )
    if (STATE.slowOperations.length === 0) {
      return EMPTY_SLOW_OPERATIONS
    }
  }
  
  
  return STATE.slowOperations
}

export function getMainThreadAgentType(): string | undefined {
  return STATE.mainThreadAgentType
}

export function setMainThreadAgentType(agentType: string | undefined): void {
  STATE.mainThreadAgentType = agentType
}

export function getIsRemoteMode(): boolean {
  return STATE.isRemoteMode
}

export function setIsRemoteMode(value: boolean): void {
  STATE.isRemoteMode = value
}

export function getSystemPromptSectionCache(): Map<string, string | null> {
  return STATE.systemPromptSectionCache
}

export function setSystemPromptSectionCacheEntry(
  name: string,
  value: string | null,
): void {
  STATE.systemPromptSectionCache.set(name, value)
}

export function clearSystemPromptSectionState(): void {
  STATE.systemPromptSectionCache.clear()
}

export function getLastEmittedDate(): string | null {
  return STATE.lastEmittedDate
}

export function setLastEmittedDate(date: string | null): void {
  STATE.lastEmittedDate = date
}

export function getAdditionalDirectoriesForClaudeMd(): string[] {
  return STATE.additionalDirectoriesForClaudeMd
}

export function setAdditionalDirectoriesForClaudeMd(
  directories: string[],
): void {
  STATE.additionalDirectoriesForClaudeMd = directories
}

export function getAllowedChannels(): ChannelEntry[] {
  return STATE.allowedChannels
}

export function setAllowedChannels(entries: ChannelEntry[]): void {
  STATE.allowedChannels = entries
}

export function getHasDevChannels(): boolean {
  return STATE.hasDevChannels
}

export function setHasDevChannels(value: boolean): void {
  STATE.hasDevChannels = value
}

export function getPromptCache1hAllowlist(): string[] | null {
  return STATE.promptCache1hAllowlist
}

export function setPromptCache1hAllowlist(allowlist: string[] | null): void {
  STATE.promptCache1hAllowlist = allowlist
}

export function getPromptCache1hEligible(): boolean | null {
  return STATE.promptCache1hEligible
}

export function setPromptCache1hEligible(eligible: boolean | null): void {
  STATE.promptCache1hEligible = eligible
}

export function getAfkModeHeaderLatched(): boolean | null {
  return STATE.afkModeHeaderLatched
}

export function setAfkModeHeaderLatched(v: boolean): void {
  STATE.afkModeHeaderLatched = v
}

export function getFastModeHeaderLatched(): boolean | null {
  return STATE.fastModeHeaderLatched
}

export function setFastModeHeaderLatched(v: boolean): void {
  STATE.fastModeHeaderLatched = v
}

export function getCacheEditingHeaderLatched(): boolean | null {
  return STATE.cacheEditingHeaderLatched
}

export function setCacheEditingHeaderLatched(v: boolean): void {
  STATE.cacheEditingHeaderLatched = v
}

export function getThinkingClearLatched(): boolean | null {
  return STATE.thinkingClearLatched
}

export function setThinkingClearLatched(v: boolean): void {
  STATE.thinkingClearLatched = v
}

export function clearBetaHeaderLatches(): void {
  STATE.afkModeHeaderLatched = null
  STATE.fastModeHeaderLatched = null
  STATE.cacheEditingHeaderLatched = null
  STATE.thinkingClearLatched = null
}

export function getPromptId(): string | null {
  return STATE.promptId
}

export function setPromptId(id: string | null): void {
  STATE.promptId = id
}

