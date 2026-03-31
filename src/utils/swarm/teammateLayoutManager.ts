import type { AgentColorName } from '../../tools/AgentTool/agentColorManager.js'
import { AGENT_COLORS } from '../../tools/AgentTool/agentColorManager.js'
import { detectAndGetBackend } from './backends/registry.js'
import type { PaneBackend } from './backends/types.js'

const teammateColorAssignments = new Map<string, AgentColorName>()
let colorIndex = 0

async function getBackend(): Promise<PaneBackend> {
  return (await detectAndGetBackend()).backend
}

export function assignTeammateColor(teammateId: string): AgentColorName {
  const existing = teammateColorAssignments.get(teammateId)
  if (existing) {
    return existing
  }

  const color = AGENT_COLORS[colorIndex % AGENT_COLORS.length]!
  teammateColorAssignments.set(teammateId, color)
  colorIndex++

  return color
}

export function getTeammateColor(
  teammateId: string,
): AgentColorName | undefined {
  return teammateColorAssignments.get(teammateId)
}

export function clearTeammateColors(): void {
  teammateColorAssignments.clear()
  colorIndex = 0
}

export async function isInsideTmux(): Promise<boolean> {
  const { isInsideTmux: checkTmux } = await import('./backends/detection.js')
  return checkTmux()
}

export async function createTeammatePaneInSwarmView(
  teammateName: string,
  teammateColor: AgentColorName,
): Promise<{ paneId: string; isFirstTeammate: boolean }> {
  const backend = await getBackend()
  return backend.createTeammatePaneInSwarmView(teammateName, teammateColor)
}

export async function enablePaneBorderStatus(
  windowTarget?: string,
  useSwarmSocket = false,
): Promise<void> {
  const backend = await getBackend()
  return backend.enablePaneBorderStatus(windowTarget, useSwarmSocket)
}

export async function sendCommandToPane(
  paneId: string,
  command: string,
  useSwarmSocket = false,
): Promise<void> {
  const backend = await getBackend()
  return backend.sendCommandToPane(paneId, command, useSwarmSocket)
}
