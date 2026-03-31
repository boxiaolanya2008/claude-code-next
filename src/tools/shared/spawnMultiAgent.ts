

import React from 'react'
import {
  getChromeFlagOverride,
  getFlagSettingsPath,
  getInlinePlugins,
  getMainLoopModelOverride,
  getSessionBypassPermissionsMode,
  getSessionId,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import type { ToolUseContext } from '../../Tool.js'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'
import { formatAgentId } from '../../utils/agentId.js'
import { quote } from '../../utils/bash/shellQuote.js'
import { isInBundledMode } from '../../utils/bundledMode.js'
import { getGlobalConfig } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { parseUserSpecifiedModel } from '../../utils/model/model.js'
import type { PermissionMode } from '../../utils/permissions/PermissionMode.js'
import { isTmuxAvailable } from '../../utils/swarm/backends/detection.js'
import {
  detectAndGetBackend,
  getBackendByType,
  isInProcessEnabled,
  markInProcessFallback,
  resetBackendDetection,
} from '../../utils/swarm/backends/registry.js'
import { getTeammateModeFromSnapshot } from '../../utils/swarm/backends/teammateModeSnapshot.js'
import type { BackendType } from '../../utils/swarm/backends/types.js'
import { isPaneBackend } from '../../utils/swarm/backends/types.js'
import {
  SWARM_SESSION_NAME,
  TEAM_LEAD_NAME,
  TEAMMATE_COMMAND_ENV_VAR,
  TMUX_COMMAND,
} from '../../utils/swarm/constants.js'
import { It2SetupPrompt } from '../../utils/swarm/It2SetupPrompt.js'
import { startInProcessTeammate } from '../../utils/swarm/inProcessRunner.js'
import {
  type InProcessSpawnConfig,
  spawnInProcessTeammate,
} from '../../utils/swarm/spawnInProcess.js'
import { buildInheritedEnvVars } from '../../utils/swarm/spawnUtils.js'
import {
  readTeamFileAsync,
  sanitizeAgentName,
  sanitizeName,
  writeTeamFileAsync,
} from '../../utils/swarm/teamHelpers.js'
import {
  assignTeammateColor,
  createTeammatePaneInSwarmView,
  enablePaneBorderStatus,
  isInsideTmux,
  sendCommandToPane,
} from '../../utils/swarm/teammateLayoutManager.js'
import { getHardcodedTeammateModelFallback } from '../../utils/swarm/teammateModel.js'
import { registerTask } from '../../utils/task/framework.js'
import { writeToMailbox } from '../../utils/teammateMailbox.js'
import type { CustomAgentDefinition } from '../AgentTool/loadAgentsDir.js'
import { isCustomAgent } from '../AgentTool/loadAgentsDir.js'

function getDefaultTeammateModel(leaderModel: string | null): string {
  const configured = getGlobalConfig().teammateDefaultModel
  if (configured === null) {
    
    return leaderModel ?? getHardcodedTeammateModelFallback()
  }
  if (configured !== undefined) {
    return parseUserSpecifiedModel(configured)
  }
  return getHardcodedTeammateModelFallback()
}

export function resolveTeammateModel(
  inputModel: string | undefined,
  leaderModel: string | null,
): string {
  if (inputModel === 'inherit') {
    return leaderModel ?? getDefaultTeammateModel(leaderModel)
  }
  return inputModel ?? getDefaultTeammateModel(leaderModel)
}

export type SpawnOutput = {
  teammate_id: string
  agent_id: string
  agent_type?: string
  model?: string
  name: string
  color?: string
  tmux_session_name: string
  tmux_window_name: string
  tmux_pane_id: string
  team_name?: string
  is_splitpane?: boolean
  plan_mode_required?: boolean
}

export type SpawnTeammateConfig = {
  name: string
  prompt: string
  team_name?: string
  cwd?: string
  use_splitpane?: boolean
  plan_mode_required?: boolean
  model?: string
  agent_type?: string
  description?: string
  

  invokingRequestId?: string
}

type SpawnInput = {
  name: string
  prompt: string
  team_name?: string
  cwd?: string
  use_splitpane?: boolean
  plan_mode_required?: boolean
  model?: string
  agent_type?: string
  description?: string
  invokingRequestId?: string
}

async function hasSession(sessionName: string): Promise<boolean> {
  const result = await execFileNoThrow(TMUX_COMMAND, [
    'has-session',
    '-t',
    sessionName,
  ])
  return result.code === 0
}

async function ensureSession(sessionName: string): Promise<void> {
  const exists = await hasSession(sessionName)
  if (!exists) {
    const result = await execFileNoThrow(TMUX_COMMAND, [
      'new-session',
      '-d',
      '-s',
      sessionName,
    ])
    if (result.code !== 0) {
      throw new Error(
        `Failed to create tmux session '${sessionName}': ${result.stderr || 'Unknown error'}`,
      )
    }
  }
}

function getTeammateCommand(): string {
  if (process.env[TEAMMATE_COMMAND_ENV_VAR]) {
    return process.env[TEAMMATE_COMMAND_ENV_VAR]
  }
  return isInBundledMode() ? process.execPath : process.argv[1]!
}

function buildInheritedCliFlags(options?: {
  planModeRequired?: boolean
  permissionMode?: PermissionMode
}): string {
  const flags: string[] = []
  const { planModeRequired, permissionMode } = options || {}

  
  
  if (planModeRequired) {
    
  } else if (
    permissionMode === 'bypassPermissions' ||
    getSessionBypassPermissionsMode()
  ) {
    flags.push('--dangerously-skip-permissions')
  } else if (permissionMode === 'acceptEdits') {
    flags.push('--permission-mode acceptEdits')
  } else if (permissionMode === 'auto') {
    
    
    
    flags.push('--permission-mode auto')
  }

  
  const modelOverride = getMainLoopModelOverride()
  if (modelOverride) {
    flags.push(`--model ${quote([modelOverride])}`)
  }

  
  const settingsPath = getFlagSettingsPath()
  if (settingsPath) {
    flags.push(`--settings ${quote([settingsPath])}`)
  }

  
  const inlinePlugins = getInlinePlugins()
  for (const pluginDir of inlinePlugins) {
    flags.push(`--plugin-dir ${quote([pluginDir])}`)
  }

  
  const chromeFlagOverride = getChromeFlagOverride()
  if (chromeFlagOverride === true) {
    flags.push('--chrome')
  } else if (chromeFlagOverride === false) {
    flags.push('--no-chrome')
  }

  return flags.join(' ')
}

export async function generateUniqueTeammateName(
  baseName: string,
  teamName: string | undefined,
): Promise<string> {
  if (!teamName) {
    return baseName
  }

  const teamFile = await readTeamFileAsync(teamName)
  if (!teamFile) {
    return baseName
  }

  const existingNames = new Set(teamFile.members.map(m => m.name.toLowerCase()))

  
  if (!existingNames.has(baseName.toLowerCase())) {
    return baseName
  }

  
  let suffix = 2
  while (existingNames.has(`${baseName}-${suffix}`.toLowerCase())) {
    suffix++
  }

  return `${baseName}-${suffix}`
}

async function handleSpawnSplitPane(
  input: SpawnInput,
  context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  const { setAppState, getAppState } = context
  const { name, prompt, agent_type, cwd, plan_mode_required } = input

  
  const model = resolveTeammateModel(input.model, getAppState().mainLoopModel)

  if (!name || !prompt) {
    throw new Error('name and prompt are required for spawn operation')
  }

  
  const appState = getAppState()
  const teamName = input.team_name || appState.teamContext?.teamName

  if (!teamName) {
    throw new Error(
      'team_name is required for spawn operation. Either provide team_name in input or call spawnTeam first to establish team context.',
    )
  }

  
  const uniqueName = await generateUniqueTeammateName(name, teamName)

  
  const sanitizedName = sanitizeAgentName(uniqueName)

  
  const teammateId = formatAgentId(sanitizedName, teamName)
  const workingDir = cwd || getCwd()

  
  let detectionResult = await detectAndGetBackend()

  
  if (detectionResult.needsIt2Setup && context.setToolJSX) {
    const tmuxAvailable = await isTmuxAvailable()

    
    const setupResult = await new Promise<
      'installed' | 'use-tmux' | 'cancelled'
    >(resolve => {
      context.setToolJSX!({
        jsx: React.createElement(It2SetupPrompt, {
          onDone: resolve,
          tmuxAvailable,
        }),
        shouldHidePromptInput: true,
      })
    })

    
    context.setToolJSX(null)

    if (setupResult === 'cancelled') {
      throw new Error('Teammate spawn cancelled - iTerm2 setup required')
    }

    
    
    
    
    
    
    if (setupResult === 'installed' || setupResult === 'use-tmux') {
      resetBackendDetection()
      detectionResult = await detectAndGetBackend()
    }
  }

  
  const insideTmux = await isInsideTmux()

  
  const teammateColor = assignTeammateColor(teammateId)

  
  
  
  
  const { paneId, isFirstTeammate } = await createTeammatePaneInSwarmView(
    sanitizedName,
    teammateColor,
  )

  
  
  if (isFirstTeammate && insideTmux) {
    await enablePaneBorderStatus()
  }

  
  
  const binaryPath = getTeammateCommand()

  
  const teammateArgs = [
    `--agent-id ${quote([teammateId])}`,
    `--agent-name ${quote([sanitizedName])}`,
    `--team-name ${quote([teamName])}`,
    `--agent-color ${quote([teammateColor])}`,
    `--parent-session-id ${quote([getSessionId()])}`,
    plan_mode_required ? '--plan-mode-required' : '',
    agent_type ? `--agent-type ${quote([agent_type])}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  
  
  let inheritedFlags = buildInheritedCliFlags({
    planModeRequired: plan_mode_required,
    permissionMode: appState.toolPermissionContext.mode,
  })

  
  if (model) {
    
    inheritedFlags = inheritedFlags
      .split(' ')
      .filter((flag, i, arr) => flag !== '--model' && arr[i - 1] !== '--model')
      .join(' ')
    
    inheritedFlags = inheritedFlags
      ? `${inheritedFlags} --model ${quote([model])}`
      : `--model ${quote([model])}`
  }

  const flagsStr = inheritedFlags ? ` ${inheritedFlags}` : ''
  
  
  const envStr = buildInheritedEnvVars()
  const spawnCommand = `cd ${quote([workingDir])} && env ${envStr} ${quote([binaryPath])} ${teammateArgs}${flagsStr}`

  
  
  await sendCommandToPane(paneId, spawnCommand, !insideTmux)

  
  const sessionName = insideTmux ? 'current' : SWARM_SESSION_NAME
  const windowName = insideTmux ? 'current' : 'swarm-view'

  
  
  setAppState(prev => ({
    ...prev,
    teamContext: {
      ...prev.teamContext,
      teamName: teamName ?? prev.teamContext?.teamName ?? 'default',
      teamFilePath: prev.teamContext?.teamFilePath ?? '',
      leadAgentId: prev.teamContext?.leadAgentId ?? '',
      teammates: {
        ...(prev.teamContext?.teammates || {}),
        [teammateId]: {
          name: sanitizedName,
          agentType: agent_type,
          color: teammateColor,
          tmuxSessionName: sessionName,
          tmuxPaneId: paneId,
          cwd: workingDir,
          spawnedAt: Date.now(),
        },
      },
    },
  }))

  
  registerOutOfProcessTeammateTask(setAppState, {
    teammateId,
    sanitizedName,
    teamName,
    teammateColor,
    prompt,
    plan_mode_required,
    paneId,
    insideTmux,
    backendType: detectionResult.backend.type,
    toolUseId: context.toolUseId,
  })

  
  const teamFile = await readTeamFileAsync(teamName)
  if (!teamFile) {
    throw new Error(
      `Team "${teamName}" does not exist. Call spawnTeam first to create the team.`,
    )
  }
  teamFile.members.push({
    agentId: teammateId,
    name: sanitizedName,
    agentType: agent_type,
    model,
    prompt,
    color: teammateColor,
    planModeRequired: plan_mode_required,
    joinedAt: Date.now(),
    tmuxPaneId: paneId,
    cwd: workingDir,
    subscriptions: [],
    backendType: detectionResult.backend.type,
  })
  await writeTeamFileAsync(teamName, teamFile)

  
  
  await writeToMailbox(
    sanitizedName,
    {
      from: TEAM_LEAD_NAME,
      text: prompt,
      timestamp: new Date().toISOString(),
    },
    teamName,
  )

  return {
    data: {
      teammate_id: teammateId,
      agent_id: teammateId,
      agent_type,
      model,
      name: sanitizedName,
      color: teammateColor,
      tmux_session_name: sessionName,
      tmux_window_name: windowName,
      tmux_pane_id: paneId,
      team_name: teamName,
      is_splitpane: true,
      plan_mode_required,
    },
  }
}

async function handleSpawnSeparateWindow(
  input: SpawnInput,
  context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  const { setAppState, getAppState } = context
  const { name, prompt, agent_type, cwd, plan_mode_required } = input

  
  const model = resolveTeammateModel(input.model, getAppState().mainLoopModel)

  if (!name || !prompt) {
    throw new Error('name and prompt are required for spawn operation')
  }

  
  const appState = getAppState()
  const teamName = input.team_name || appState.teamContext?.teamName

  if (!teamName) {
    throw new Error(
      'team_name is required for spawn operation. Either provide team_name in input or call spawnTeam first to establish team context.',
    )
  }

  
  const uniqueName = await generateUniqueTeammateName(name, teamName)

  
  const sanitizedName = sanitizeAgentName(uniqueName)

  
  const teammateId = formatAgentId(sanitizedName, teamName)
  const windowName = `teammate-${sanitizeName(sanitizedName)}`
  const workingDir = cwd || getCwd()

  
  await ensureSession(SWARM_SESSION_NAME)

  
  const teammateColor = assignTeammateColor(teammateId)

  
  const createWindowResult = await execFileNoThrow(TMUX_COMMAND, [
    'new-window',
    '-t',
    SWARM_SESSION_NAME,
    '-n',
    windowName,
    '-P',
    '-F',
    '#{pane_id}',
  ])

  if (createWindowResult.code !== 0) {
    throw new Error(
      `Failed to create tmux window: ${createWindowResult.stderr}`,
    )
  }

  const paneId = createWindowResult.stdout.trim()

  
  
  const binaryPath = getTeammateCommand()

  
  const teammateArgs = [
    `--agent-id ${quote([teammateId])}`,
    `--agent-name ${quote([sanitizedName])}`,
    `--team-name ${quote([teamName])}`,
    `--agent-color ${quote([teammateColor])}`,
    `--parent-session-id ${quote([getSessionId()])}`,
    plan_mode_required ? '--plan-mode-required' : '',
    agent_type ? `--agent-type ${quote([agent_type])}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  
  
  let inheritedFlags = buildInheritedCliFlags({
    planModeRequired: plan_mode_required,
    permissionMode: appState.toolPermissionContext.mode,
  })

  
  if (model) {
    
    inheritedFlags = inheritedFlags
      .split(' ')
      .filter((flag, i, arr) => flag !== '--model' && arr[i - 1] !== '--model')
      .join(' ')
    
    inheritedFlags = inheritedFlags
      ? `${inheritedFlags} --model ${quote([model])}`
      : `--model ${quote([model])}`
  }

  const flagsStr = inheritedFlags ? ` ${inheritedFlags}` : ''
  
  
  const envStr = buildInheritedEnvVars()
  const spawnCommand = `cd ${quote([workingDir])} && env ${envStr} ${quote([binaryPath])} ${teammateArgs}${flagsStr}`

  
  const sendKeysResult = await execFileNoThrow(TMUX_COMMAND, [
    'send-keys',
    '-t',
    `${SWARM_SESSION_NAME}:${windowName}`,
    spawnCommand,
    'Enter',
  ])

  if (sendKeysResult.code !== 0) {
    throw new Error(
      `Failed to send command to tmux window: ${sendKeysResult.stderr}`,
    )
  }

  
  setAppState(prev => ({
    ...prev,
    teamContext: {
      ...prev.teamContext,
      teamName: teamName ?? prev.teamContext?.teamName ?? 'default',
      teamFilePath: prev.teamContext?.teamFilePath ?? '',
      leadAgentId: prev.teamContext?.leadAgentId ?? '',
      teammates: {
        ...(prev.teamContext?.teammates || {}),
        [teammateId]: {
          name: sanitizedName,
          agentType: agent_type,
          color: teammateColor,
          tmuxSessionName: SWARM_SESSION_NAME,
          tmuxPaneId: paneId,
          cwd: workingDir,
          spawnedAt: Date.now(),
        },
      },
    },
  }))

  
  
  registerOutOfProcessTeammateTask(setAppState, {
    teammateId,
    sanitizedName,
    teamName,
    teammateColor,
    prompt,
    plan_mode_required,
    paneId,
    insideTmux: false,
    backendType: 'tmux',
    toolUseId: context.toolUseId,
  })

  
  const teamFile = await readTeamFileAsync(teamName)
  if (!teamFile) {
    throw new Error(
      `Team "${teamName}" does not exist. Call spawnTeam first to create the team.`,
    )
  }
  teamFile.members.push({
    agentId: teammateId,
    name: sanitizedName,
    agentType: agent_type,
    model,
    prompt,
    color: teammateColor,
    planModeRequired: plan_mode_required,
    joinedAt: Date.now(),
    tmuxPaneId: paneId,
    cwd: workingDir,
    subscriptions: [],
    backendType: 'tmux', 
  })
  await writeTeamFileAsync(teamName, teamFile)

  
  
  await writeToMailbox(
    sanitizedName,
    {
      from: TEAM_LEAD_NAME,
      text: prompt,
      timestamp: new Date().toISOString(),
    },
    teamName,
  )

  return {
    data: {
      teammate_id: teammateId,
      agent_id: teammateId,
      agent_type,
      model,
      name: sanitizedName,
      color: teammateColor,
      tmux_session_name: SWARM_SESSION_NAME,
      tmux_window_name: windowName,
      tmux_pane_id: paneId,
      team_name: teamName,
      is_splitpane: false,
      plan_mode_required,
    },
  }
}

function registerOutOfProcessTeammateTask(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  {
    teammateId,
    sanitizedName,
    teamName,
    teammateColor,
    prompt,
    plan_mode_required,
    paneId,
    insideTmux,
    backendType,
    toolUseId,
  }: {
    teammateId: string
    sanitizedName: string
    teamName: string
    teammateColor: string
    prompt: string
    plan_mode_required?: boolean
    paneId: string
    insideTmux: boolean
    backendType: BackendType
    toolUseId?: string
  },
): void {
  const taskId = generateTaskId('in_process_teammate')
  const description = `${sanitizedName}: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`

  const abortController = new AbortController()

  const taskState: InProcessTeammateTaskState = {
    ...createTaskStateBase(
      taskId,
      'in_process_teammate',
      description,
      toolUseId,
    ),
    type: 'in_process_teammate',
    status: 'running',
    identity: {
      agentId: teammateId,
      agentName: sanitizedName,
      teamName,
      color: teammateColor,
      planModeRequired: plan_mode_required ?? false,
      parentSessionId: getSessionId(),
    },
    prompt,
    abortController,
    awaitingPlanApproval: false,
    permissionMode: plan_mode_required ? 'plan' : 'default',
    isIdle: false,
    shutdownRequested: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    pendingUserMessages: [],
  }

  registerTask(taskState, setAppState)

  
  
  
  
  abortController.signal.addEventListener(
    'abort',
    () => {
      if (isPaneBackend(backendType)) {
        void getBackendByType(backendType).killPane(paneId, !insideTmux)
      }
    },
    { once: true },
  )
}

async function handleSpawnInProcess(
  input: SpawnInput,
  context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  const { setAppState, getAppState } = context
  const { name, prompt, agent_type, plan_mode_required } = input

  
  const model = resolveTeammateModel(input.model, getAppState().mainLoopModel)

  if (!name || !prompt) {
    throw new Error('name and prompt are required for spawn operation')
  }

  
  const appState = getAppState()
  const teamName = input.team_name || appState.teamContext?.teamName

  if (!teamName) {
    throw new Error(
      'team_name is required for spawn operation. Either provide team_name in input or call spawnTeam first to establish team context.',
    )
  }

  
  const uniqueName = await generateUniqueTeammateName(name, teamName)

  
  const sanitizedName = sanitizeAgentName(uniqueName)

  
  const teammateId = formatAgentId(sanitizedName, teamName)

  
  const teammateColor = assignTeammateColor(teammateId)

  
  let agentDefinition: CustomAgentDefinition | undefined
  if (agent_type) {
    const allAgents = context.options.agentDefinitions.activeAgents
    const foundAgent = allAgents.find(a => a.agentType === agent_type)
    if (foundAgent && isCustomAgent(foundAgent)) {
      agentDefinition = foundAgent
    }
    logForDebugging(
      `[handleSpawnInProcess] agent_type=${agent_type}, found=${!!agentDefinition}`,
    )
  }

  
  const config: InProcessSpawnConfig = {
    name: sanitizedName,
    teamName,
    prompt,
    color: teammateColor,
    planModeRequired: plan_mode_required ?? false,
    model,
  }

  const result = await spawnInProcessTeammate(config, context)

  if (!result.success) {
    throw new Error(result.error ?? 'Failed to spawn in-process teammate')
  }

  
  logForDebugging(
    `[handleSpawnInProcess] spawn result: taskId=${result.taskId}, hasContext=${!!result.teammateContext}, hasAbort=${!!result.abortController}`,
  )

  
  if (result.taskId && result.teammateContext && result.abortController) {
    startInProcessTeammate({
      identity: {
        agentId: teammateId,
        agentName: sanitizedName,
        teamName,
        color: teammateColor,
        planModeRequired: plan_mode_required ?? false,
        parentSessionId: result.teammateContext.parentSessionId,
      },
      taskId: result.taskId,
      prompt,
      description: input.description,
      model,
      agentDefinition,
      teammateContext: result.teammateContext,
      
      
      
      
      toolUseContext: { ...context, messages: [] },
      abortController: result.abortController,
      invokingRequestId: input.invokingRequestId,
    })
    logForDebugging(
      `[handleSpawnInProcess] Started agent execution for ${teammateId}`,
    )
  }

  
  
  setAppState(prev => {
    const needsLeaderSetup = !prev.teamContext?.leadAgentId
    const leadAgentId = needsLeaderSetup
      ? formatAgentId(TEAM_LEAD_NAME, teamName)
      : prev.teamContext!.leadAgentId

    
    const existingTeammates = prev.teamContext?.teammates || {}
    const leadEntry = needsLeaderSetup
      ? {
          [leadAgentId]: {
            name: TEAM_LEAD_NAME,
            agentType: TEAM_LEAD_NAME,
            color: assignTeammateColor(leadAgentId),
            tmuxSessionName: 'in-process',
            tmuxPaneId: 'leader',
            cwd: getCwd(),
            spawnedAt: Date.now(),
          },
        }
      : {}

    return {
      ...prev,
      teamContext: {
        ...prev.teamContext,
        teamName: teamName ?? prev.teamContext?.teamName ?? 'default',
        teamFilePath: prev.teamContext?.teamFilePath ?? '',
        leadAgentId,
        teammates: {
          ...existingTeammates,
          ...leadEntry,
          [teammateId]: {
            name: sanitizedName,
            agentType: agent_type,
            color: teammateColor,
            tmuxSessionName: 'in-process',
            tmuxPaneId: 'in-process',
            cwd: getCwd(),
            spawnedAt: Date.now(),
          },
        },
      },
    }
  })

  
  const teamFile = await readTeamFileAsync(teamName)
  if (!teamFile) {
    throw new Error(
      `Team "${teamName}" does not exist. Call spawnTeam first to create the team.`,
    )
  }
  teamFile.members.push({
    agentId: teammateId,
    name: sanitizedName,
    agentType: agent_type,
    model,
    prompt,
    color: teammateColor,
    planModeRequired: plan_mode_required,
    joinedAt: Date.now(),
    tmuxPaneId: 'in-process',
    cwd: getCwd(),
    subscriptions: [],
    backendType: 'in-process',
  })
  await writeTeamFileAsync(teamName, teamFile)

  
  
  
  

  return {
    data: {
      teammate_id: teammateId,
      agent_id: teammateId,
      agent_type,
      model,
      name: sanitizedName,
      color: teammateColor,
      tmux_session_name: 'in-process',
      tmux_window_name: 'in-process',
      tmux_pane_id: 'in-process',
      team_name: teamName,
      is_splitpane: false,
      plan_mode_required,
    },
  }
}

async function handleSpawn(
  input: SpawnInput,
  context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  
  if (isInProcessEnabled()) {
    return handleSpawnInProcess(input, context)
  }

  
  
  
  
  try {
    await detectAndGetBackend()
  } catch (error) {
    
    
    
    if (getTeammateModeFromSnapshot() !== 'auto') {
      throw error
    }
    logForDebugging(
      `[handleSpawn] No pane backend available, falling back to in-process: ${errorMessage(error)}`,
    )
    
    
    markInProcessFallback()
    return handleSpawnInProcess(input, context)
  }

  
  
  const useSplitPane = input.use_splitpane !== false
  if (useSplitPane) {
    return handleSpawnSplitPane(input, context)
  }
  return handleSpawnSeparateWindow(input, context)
}

export async function spawnTeammate(
  config: SpawnTeammateConfig,
  context: ToolUseContext,
): Promise<{ data: SpawnOutput }> {
  return handleSpawn(config, context)
}
