

import type { AppState } from '../state/AppState.js'
import { getTeamName } from './teammate.js'

export function getStandaloneAgentName(appState: AppState): string | undefined {
  // If in a team (swarm), don't return standalone name
  if (getTeamName()) {
    return undefined
  }
  return appState.standaloneAgentContext?.name
}
