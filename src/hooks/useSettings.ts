import { type AppState, useAppState } from '../state/AppState.js'

export type ReadonlySettings = AppState['settings']

export function useSettings(): ReadonlySettings {
  return useAppState(s => s.settings)
}
