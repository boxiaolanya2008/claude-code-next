

import { useEffect } from 'react'
import { getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js'
import { initializeTeammateContextFromSession } from '../utils/swarm/reconnection.js'
import { readTeamFile } from '../utils/swarm/teamHelpers.js'
import { initializeTeammateHooks } from '../utils/swarm/teammateInit.js'
import { getDynamicTeamContext } from '../utils/teammate.js'

type SetAppState = (f: (prevState: AppState) => AppState) => void

/**
 * Hook that initializes swarm features when ENABLE_AGENT_SWARMS is true.
 *
 * Handles both:
 * - Resumed teammate sessions (from --resume or /resume) where teamName/agentName
 *   are stored in transcript messages
 * - Fresh spawns where context is read from environment variables
 */
export function useSwarmInitialization(
  setAppState: SetAppState,
  initialMessages: Message[] | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  useEffect(() => {
    if (!enabled) return
    if (isAgentSwarmsEnabled()) {
      // Check if this is a resumed agent session (from --resume or /resume)
      
      const firstMessage = initialMessages?.[0]
      const teamName =
        firstMessage && 'teamName' in firstMessage
          ? (firstMessage.teamName as string | undefined)
          : undefined
      const agentName =
        firstMessage && 'agentName' in firstMessage
          ? (firstMessage.agentName as string | undefined)
          : undefined

      if (teamName && agentName) {
        // Resumed agent session - set up team context from stored info
        initializeTeammateContextFromSession(setAppState, teamName, agentName)

        
        const teamFile = readTeamFile(teamName)
        const member = teamFile?.members.find(
          (m: { name: string }) => m.name === agentName,
        )
        if (member) {
          initializeTeammateHooks(setAppState, getSessionId(), {
            teamName,
            agentId: member.agentId,
            agentName,
          })
        }
      } else {
        // Fresh spawn or standalone session
        
        
        const context = getDynamicTeamContext?.()
        if (context?.teamName && context?.agentId && context?.agentName) {
          initializeTeammateHooks(setAppState, getSessionId(), {
            teamName: context.teamName,
            agentId: context.agentId,
            agentName: context.agentName,
          })
        }
      }
    }
  }, [setAppState, initialMessages, enabled])
}
