

import type { AppState } from '../../state/AppState.js'
import { logForDebugging } from '../debug.js'
import { logError } from '../log.js'
import { getDynamicTeamContext } from '../teammate.js'
import { getTeamFilePath, readTeamFile } from './teamHelpers.js'

export function computeInitialTeamContext():
  | AppState['teamContext']
  | undefined {
  
  const context = getDynamicTeamContext()

  if (!context?.teamName || !context?.agentName) {
    logForDebugging(
      '[Reconnection] computeInitialTeamContext: No teammate context set (not a teammate)',
    )
    return undefined
  }

  const { teamName, agentId, agentName } = context

  
  const teamFile = readTeamFile(teamName)
  if (!teamFile) {
    logError(
      new Error(
        `[computeInitialTeamContext] Could not read team file for ${teamName}`,
      ),
    )
    return undefined
  }

  const teamFilePath = getTeamFilePath(teamName)

  const isLeader = !agentId

  logForDebugging(
    `[Reconnection] Computed initial team context for ${isLeader ? 'leader' : `teammate ${agentName}`} in team ${teamName}`,
  )

  return {
    teamName,
    teamFilePath,
    leadAgentId: teamFile.leadAgentId,
    selfAgentId: agentId,
    selfAgentName: agentName,
    isLeader,
    teammates: {},
  }
}

export function initializeTeammateContextFromSession(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  teamName: string,
  agentName: string,
): void {
  
  const teamFile = readTeamFile(teamName)
  if (!teamFile) {
    logError(
      new Error(
        `[initializeTeammateContextFromSession] Could not read team file for ${teamName} (agent: ${agentName})`,
      ),
    )
    return
  }

  
  const member = teamFile.members.find(m => m.name === agentName)
  if (!member) {
    logForDebugging(
      `[Reconnection] Member ${agentName} not found in team ${teamName} - may have been removed`,
    )
  }
  const agentId = member?.agentId

  const teamFilePath = getTeamFilePath(teamName)

  
  setAppState(prev => ({
    ...prev,
    teamContext: {
      teamName,
      teamFilePath,
      leadAgentId: teamFile.leadAgentId,
      selfAgentId: agentId,
      selfAgentName: agentName,
      isLeader: false,
      teammates: {},
    },
  }))

  logForDebugging(
    `[Reconnection] Initialized agent context from session for ${agentName} in team ${teamName}`,
  )
}
