import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'
import { logForDebugging } from '../../../utils/debug.js'
import { execFileNoThrow } from '../../../utils/execFileNoThrow.js'
import { logError } from '../../../utils/log.js'
import { count } from '../../array.js'
import { sleep } from '../../sleep.js'
import {
  getSwarmSocketName,
  HIDDEN_SESSION_NAME,
  SWARM_SESSION_NAME,
  SWARM_VIEW_WINDOW_NAME,
  TMUX_COMMAND,
} from '../constants.js'
import {
  getLeaderPaneId,
  isInsideTmux as isInsideTmuxFromDetection,
  isTmuxAvailable,
} from './detection.js'
import { registerTmuxBackend } from './registry.js'
import type { CreatePaneResult, PaneBackend, PaneId } from './types.js'

let firstPaneUsedForExternal = false

let cachedLeaderWindowTarget: string | null = null

let paneCreationLock: Promise<void> = Promise.resolve()

const PANE_SHELL_INIT_DELAY_MS = 200

function waitForPaneShellReady(): Promise<void> {
  return sleep(PANE_SHELL_INIT_DELAY_MS)
}

function acquirePaneCreationLock(): Promise<() => void> {
  let release: () => void
  const newLock = new Promise<void>(resolve => {
    release = resolve
  })

  const previousLock = paneCreationLock
  paneCreationLock = newLock

  return previousLock.then(() => release!)
}

function getTmuxColorName(color: AgentColorName): string {
  const tmuxColors: Record<AgentColorName, string> = {
    red: 'red',
    blue: 'blue',
    green: 'green',
    yellow: 'yellow',
    purple: 'magenta',
    orange: 'colour208',
    pink: 'colour205',
    cyan: 'cyan',
  }
  return tmuxColors[color]
}

function runTmuxInUserSession(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return execFileNoThrow(TMUX_COMMAND, args)
}

function runTmuxInSwarm(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return execFileNoThrow(TMUX_COMMAND, ['-L', getSwarmSocketName(), ...args])
}

export class TmuxBackend implements PaneBackend {
  readonly type = 'tmux' as const
  readonly displayName = 'tmux'
  readonly supportsHideShow = true

  

  async isAvailable(): Promise<boolean> {
    return isTmuxAvailable()
  }

  

  async isRunningInside(): Promise<boolean> {
    return isInsideTmuxFromDetection()
  }

  

  async createTeammatePaneInSwarmView(
    name: string,
    color: AgentColorName,
  ): Promise<CreatePaneResult> {
    const releaseLock = await acquirePaneCreationLock()

    try {
      const insideTmux = await this.isRunningInside()

      if (insideTmux) {
        return await this.createTeammatePaneWithLeader(name, color)
      }

      return await this.createTeammatePaneExternal(name, color)
    } finally {
      releaseLock()
    }
  }

  

  async sendCommandToPane(
    paneId: PaneId,
    command: string,
    useExternalSession = false,
  ): Promise<void> {
    const runTmux = useExternalSession ? runTmuxInSwarm : runTmuxInUserSession
    const result = await runTmux(['send-keys', '-t', paneId, command, 'Enter'])

    if (result.code !== 0) {
      throw new Error(
        `Failed to send command to pane ${paneId}: ${result.stderr}`,
      )
    }
  }

  

  async setPaneBorderColor(
    paneId: PaneId,
    color: AgentColorName,
    useExternalSession = false,
  ): Promise<void> {
    const tmuxColor = getTmuxColorName(color)
    const runTmux = useExternalSession ? runTmuxInSwarm : runTmuxInUserSession

    
    await runTmux([
      'select-pane',
      '-t',
      paneId,
      '-P',
      `bg=default,fg=${tmuxColor}`,
    ])

    await runTmux([
      'set-option',
      '-p',
      '-t',
      paneId,
      'pane-border-style',
      `fg=${tmuxColor}`,
    ])

    await runTmux([
      'set-option',
      '-p',
      '-t',
      paneId,
      'pane-active-border-style',
      `fg=${tmuxColor}`,
    ])
  }

  

  async setPaneTitle(
    paneId: PaneId,
    name: string,
    color: AgentColorName,
    useExternalSession = false,
  ): Promise<void> {
    const tmuxColor = getTmuxColorName(color)
    const runTmux = useExternalSession ? runTmuxInSwarm : runTmuxInUserSession

    
    await runTmux(['select-pane', '-t', paneId, '-T', name])

    
    await runTmux([
      'set-option',
      '-p',
      '-t',
      paneId,
      'pane-border-format',
      `#[fg=${tmuxColor},bold] #{pane_title} #[default]`,
    ])
  }

  

  async enablePaneBorderStatus(
    windowTarget?: string,
    useExternalSession = false,
  ): Promise<void> {
    const target = windowTarget || (await this.getCurrentWindowTarget())
    if (!target) {
      return
    }

    const runTmux = useExternalSession ? runTmuxInSwarm : runTmuxInUserSession
    await runTmux([
      'set-option',
      '-w',
      '-t',
      target,
      'pane-border-status',
      'top',
    ])
  }

  

  async rebalancePanes(
    windowTarget: string,
    hasLeader: boolean,
  ): Promise<void> {
    if (hasLeader) {
      await this.rebalancePanesWithLeader(windowTarget)
    } else {
      await this.rebalancePanesTiled(windowTarget)
    }
  }

  

  async killPane(paneId: PaneId, useExternalSession = false): Promise<boolean> {
    const runTmux = useExternalSession ? runTmuxInSwarm : runTmuxInUserSession
    const result = await runTmux(['kill-pane', '-t', paneId])
    return result.code === 0
  }

  

  async hidePane(paneId: PaneId, useExternalSession = false): Promise<boolean> {
    const runTmux = useExternalSession ? runTmuxInSwarm : runTmuxInUserSession

    
    await runTmux(['new-session', '-d', '-s', HIDDEN_SESSION_NAME])

    
    const result = await runTmux([
      'break-pane',
      '-d',
      '-s',
      paneId,
      '-t',
      `${HIDDEN_SESSION_NAME}:`,
    ])

    if (result.code === 0) {
      logForDebugging(`[TmuxBackend] Hidden pane ${paneId}`)
    } else {
      logForDebugging(
        `[TmuxBackend] Failed to hide pane ${paneId}: ${result.stderr}`,
      )
    }

    return result.code === 0
  }

  

  async showPane(
    paneId: PaneId,
    targetWindowOrPane: string,
    useExternalSession = false,
  ): Promise<boolean> {
    const runTmux = useExternalSession ? runTmuxInSwarm : runTmuxInUserSession

    
    
    
    const result = await runTmux([
      'join-pane',
      '-h',
      '-s',
      paneId,
      '-t',
      targetWindowOrPane,
    ])

    if (result.code !== 0) {
      logForDebugging(
        `[TmuxBackend] Failed to show pane ${paneId}: ${result.stderr}`,
      )
      return false
    }

    logForDebugging(
      `[TmuxBackend] Showed pane ${paneId} in ${targetWindowOrPane}`,
    )

    
    await runTmux(['select-layout', '-t', targetWindowOrPane, 'main-vertical'])

    
    const panesResult = await runTmux([
      'list-panes',
      '-t',
      targetWindowOrPane,
      '-F',
      '#{pane_id}',
    ])

    const panes = panesResult.stdout.trim().split('\n').filter(Boolean)
    if (panes[0]) {
      await runTmux(['resize-pane', '-t', panes[0], '-x', '30%'])
    }

    return true
  }

  

  

  private async getCurrentPaneId(): Promise<string | null> {
    
    const leaderPane = getLeaderPaneId()
    if (leaderPane) {
      return leaderPane
    }

    
    const result = await execFileNoThrow(TMUX_COMMAND, [
      'display-message',
      '-p',
      '#{pane_id}',
    ])

    if (result.code !== 0) {
      logForDebugging(
        `[TmuxBackend] Failed to get current pane ID (exit ${result.code}): ${result.stderr}`,
      )
      return null
    }

    return result.stdout.trim()
  }

  

  private async getCurrentWindowTarget(): Promise<string | null> {
    
    if (cachedLeaderWindowTarget) {
      return cachedLeaderWindowTarget
    }

    
    const leaderPane = getLeaderPaneId()
    const args = ['display-message']
    if (leaderPane) {
      args.push('-t', leaderPane)
    }
    args.push('-p', '#{session_name}:#{window_index}')

    const result = await execFileNoThrow(TMUX_COMMAND, args)

    if (result.code !== 0) {
      logForDebugging(
        `[TmuxBackend] Failed to get current window target (exit ${result.code}): ${result.stderr}`,
      )
      return null
    }

    cachedLeaderWindowTarget = result.stdout.trim()
    return cachedLeaderWindowTarget
  }

  

  private async getCurrentWindowPaneCount(
    windowTarget?: string,
    useSwarmSocket = false,
  ): Promise<number | null> {
    const target = windowTarget || (await this.getCurrentWindowTarget())
    if (!target) {
      return null
    }

    const args = ['list-panes', '-t', target, '-F', '#{pane_id}']
    const result = useSwarmSocket
      ? await runTmuxInSwarm(args)
      : await runTmuxInUserSession(args)

    if (result.code !== 0) {
      logError(
        new Error(
          `[TmuxBackend] Failed to get pane count for ${target} (exit ${result.code}): ${result.stderr}`,
        ),
      )
      return null
    }

    return count(result.stdout.trim().split('\n'), Boolean)
  }

  

  private async hasSessionInSwarm(sessionName: string): Promise<boolean> {
    const result = await runTmuxInSwarm(['has-session', '-t', sessionName])
    return result.code === 0
  }

  

  private async createExternalSwarmSession(): Promise<{
    windowTarget: string
    paneId: string
  }> {
    const sessionExists = await this.hasSessionInSwarm(SWARM_SESSION_NAME)

    if (!sessionExists) {
      const result = await runTmuxInSwarm([
        'new-session',
        '-d',
        '-s',
        SWARM_SESSION_NAME,
        '-n',
        SWARM_VIEW_WINDOW_NAME,
        '-P',
        '-F',
        '#{pane_id}',
      ])

      if (result.code !== 0) {
        throw new Error(
          `Failed to create swarm session: ${result.stderr || 'Unknown error'}`,
        )
      }

      const paneId = result.stdout.trim()
      const windowTarget = `${SWARM_SESSION_NAME}:${SWARM_VIEW_WINDOW_NAME}`

      logForDebugging(
        `[TmuxBackend] Created external swarm session with window ${windowTarget}, pane ${paneId}`,
      )

      return { windowTarget, paneId }
    }

    
    const listResult = await runTmuxInSwarm([
      'list-windows',
      '-t',
      SWARM_SESSION_NAME,
      '-F',
      '#{window_name}',
    ])

    const windows = listResult.stdout.trim().split('\n').filter(Boolean)
    const windowTarget = `${SWARM_SESSION_NAME}:${SWARM_VIEW_WINDOW_NAME}`

    if (windows.includes(SWARM_VIEW_WINDOW_NAME)) {
      const paneResult = await runTmuxInSwarm([
        'list-panes',
        '-t',
        windowTarget,
        '-F',
        '#{pane_id}',
      ])

      const panes = paneResult.stdout.trim().split('\n').filter(Boolean)
      return { windowTarget, paneId: panes[0] || '' }
    }

    
    const createResult = await runTmuxInSwarm([
      'new-window',
      '-t',
      SWARM_SESSION_NAME,
      '-n',
      SWARM_VIEW_WINDOW_NAME,
      '-P',
      '-F',
      '#{pane_id}',
    ])

    if (createResult.code !== 0) {
      throw new Error(
        `Failed to create swarm-view window: ${createResult.stderr || 'Unknown error'}`,
      )
    }

    return { windowTarget, paneId: createResult.stdout.trim() }
  }

  

  private async createTeammatePaneWithLeader(
    teammateName: string,
    teammateColor: AgentColorName,
  ): Promise<CreatePaneResult> {
    const currentPaneId = await this.getCurrentPaneId()
    const windowTarget = await this.getCurrentWindowTarget()

    if (!currentPaneId || !windowTarget) {
      throw new Error('Could not determine current tmux pane/window')
    }

    const paneCount = await this.getCurrentWindowPaneCount(windowTarget)
    if (paneCount === null) {
      throw new Error('Could not determine pane count for current window')
    }
    const isFirstTeammate = paneCount === 1

    let splitResult
    if (isFirstTeammate) {
      
      splitResult = await execFileNoThrow(TMUX_COMMAND, [
        'split-window',
        '-t',
        currentPaneId,
        '-h',
        '-l',
        '70%',
        '-P',
        '-F',
        '#{pane_id}',
      ])
    } else {
      
      const listResult = await execFileNoThrow(TMUX_COMMAND, [
        'list-panes',
        '-t',
        windowTarget,
        '-F',
        '#{pane_id}',
      ])

      const panes = listResult.stdout.trim().split('\n').filter(Boolean)
      const teammatePanes = panes.slice(1)
      const teammateCount = teammatePanes.length

      const splitVertically = teammateCount % 2 === 1
      const targetPaneIndex = Math.floor((teammateCount - 1) / 2)
      const targetPane =
        teammatePanes[targetPaneIndex] ||
        teammatePanes[teammatePanes.length - 1]

      splitResult = await execFileNoThrow(TMUX_COMMAND, [
        'split-window',
        '-t',
        targetPane!,
        splitVertically ? '-v' : '-h',
        '-P',
        '-F',
        '#{pane_id}',
      ])
    }

    if (splitResult.code !== 0) {
      throw new Error(`Failed to create teammate pane: ${splitResult.stderr}`)
    }

    const paneId = splitResult.stdout.trim()
    logForDebugging(
      `[TmuxBackend] Created teammate pane for ${teammateName}: ${paneId}`,
    )

    await this.setPaneBorderColor(paneId, teammateColor)
    await this.setPaneTitle(paneId, teammateName, teammateColor)
    await this.rebalancePanesWithLeader(windowTarget)

    
    await waitForPaneShellReady()

    return { paneId, isFirstTeammate }
  }

  

  private async createTeammatePaneExternal(
    teammateName: string,
    teammateColor: AgentColorName,
  ): Promise<CreatePaneResult> {
    const { windowTarget, paneId: firstPaneId } =
      await this.createExternalSwarmSession()

    const paneCount = await this.getCurrentWindowPaneCount(windowTarget, true)
    if (paneCount === null) {
      throw new Error('Could not determine pane count for swarm window')
    }
    const isFirstTeammate = !firstPaneUsedForExternal && paneCount === 1

    let paneId: string

    if (isFirstTeammate) {
      paneId = firstPaneId
      firstPaneUsedForExternal = true
      logForDebugging(
        `[TmuxBackend] Using initial pane for first teammate ${teammateName}: ${paneId}`,
      )

      await this.enablePaneBorderStatus(windowTarget, true)
    } else {
      const listResult = await runTmuxInSwarm([
        'list-panes',
        '-t',
        windowTarget,
        '-F',
        '#{pane_id}',
      ])

      const panes = listResult.stdout.trim().split('\n').filter(Boolean)
      const teammateCount = panes.length

      const splitVertically = teammateCount % 2 === 1
      const targetPaneIndex = Math.floor((teammateCount - 1) / 2)
      const targetPane = panes[targetPaneIndex] || panes[panes.length - 1]

      const splitResult = await runTmuxInSwarm([
        'split-window',
        '-t',
        targetPane!,
        splitVertically ? '-v' : '-h',
        '-P',
        '-F',
        '#{pane_id}',
      ])

      if (splitResult.code !== 0) {
        throw new Error(`Failed to create teammate pane: ${splitResult.stderr}`)
      }

      paneId = splitResult.stdout.trim()
      logForDebugging(
        `[TmuxBackend] Created teammate pane for ${teammateName}: ${paneId}`,
      )
    }

    await this.setPaneBorderColor(paneId, teammateColor, true)
    await this.setPaneTitle(paneId, teammateName, teammateColor, true)
    await this.rebalancePanesTiled(windowTarget)

    
    await waitForPaneShellReady()

    return { paneId, isFirstTeammate }
  }

  

  private async rebalancePanesWithLeader(windowTarget: string): Promise<void> {
    const listResult = await runTmuxInUserSession([
      'list-panes',
      '-t',
      windowTarget,
      '-F',
      '#{pane_id}',
    ])

    const panes = listResult.stdout.trim().split('\n').filter(Boolean)
    if (panes.length <= 2) {
      return
    }

    await runTmuxInUserSession([
      'select-layout',
      '-t',
      windowTarget,
      'main-vertical',
    ])

    const leaderPane = panes[0]
    await runTmuxInUserSession(['resize-pane', '-t', leaderPane!, '-x', '30%'])

    logForDebugging(
      `[TmuxBackend] Rebalanced ${panes.length - 1} teammate panes with leader`,
    )
  }

  

  private async rebalancePanesTiled(windowTarget: string): Promise<void> {
    const listResult = await runTmuxInSwarm([
      'list-panes',
      '-t',
      windowTarget,
      '-F',
      '#{pane_id}',
    ])

    const panes = listResult.stdout.trim().split('\n').filter(Boolean)
    if (panes.length <= 1) {
      return
    }

    await runTmuxInSwarm(['select-layout', '-t', windowTarget, 'tiled'])

    logForDebugging(
      `[TmuxBackend] Rebalanced ${panes.length} teammate panes with tiled layout`,
    )
  }
}

registerTmuxBackend(TmuxBackend)
