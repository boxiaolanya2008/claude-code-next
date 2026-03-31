

import { isPaneBackend, type PaneBackendType } from './swarm/backends/types.js'
import { readTeamFile } from './swarm/teamHelpers.js'

export type TeamSummary = {
  name: string
  memberCount: number
  runningCount: number
  idleCount: number
}

export type TeammateStatus = {
  name: string
  agentId: string
  agentType?: string
  model?: string
  prompt?: string
  status: 'running' | 'idle' | 'unknown'
  color?: string
  idleSince?: string 
  tmuxPaneId: string
  cwd: string
  worktreePath?: string
  isHidden?: boolean 
  backendType?: PaneBackendType 
  mode?: string 
}

/**
 * Get detailed teammate statuses for a team
 * Reads isActive from config to determine status
 */
export function getTeammateStatuses(teamName: string): TeammateStatus[] {
  const teamFile = readTeamFile(teamName)
  if (!teamFile) {
    return []
  }

  const hiddenPaneIds = new Set(teamFile.hiddenPaneIds ?? [])
  const statuses: TeammateStatus[] = []

  for (const member of teamFile.members) {
    // Exclude team-lead from the list
    if (member.name === 'team-lead') {
      continue
    }

    // Read isActive from config, defaulting to true (active) if undefined
    const isActive = member.isActive !== false
    const status: 'running' | 'idle' = isActive ? 'running' : 'idle'

    statuses.push({
      name: member.name,
      agentId: member.agentId,
      agentType: member.agentType,
      model: member.model,
      prompt: member.prompt,
      status,
      color: member.color,
      tmuxPaneId: member.tmuxPaneId,
      cwd: member.cwd,
      worktreePath: member.worktreePath,
      isHidden: hiddenPaneIds.has(member.tmuxPaneId),
      backendType:
        member.backendType && isPaneBackend(member.backendType)
          ? member.backendType
          : undefined,
      mode: member.mode,
    })
  }

  return statuses
}

// Note: For time formatting, use formatRelativeTimeAgo from '../utils/format.js'
