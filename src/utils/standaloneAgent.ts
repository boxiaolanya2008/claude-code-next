

import type { AppState } from '../state/AppState.js'
import { getTeamName } from './teammate.js'

export function getStandaloneAgentName(appState: AppState): string | undefined {
  
  if (getTeamName()) {
    return undefined
  }
  return appState.standaloneAgentContext?.name
}
