import { useCallback, useEffect } from 'react'
import type { Command } from '../commands.js'
import {
  clearCommandMemoizationCaches,
  clearCommandsCache,
  getCommands,
} from '../commands.js'
import { onGrowthBookRefresh } from '../services/analytics/growthbook.js'
import { logError } from '../utils/log.js'
import { skillChangeDetector } from '../utils/skills/skillChangeDetector.js'

export function useSkillsChange(
  cwd: string | undefined,
  onCommandsChange: (commands: Command[]) => void,
): void {
  const handleChange = useCallback(async () => {
    if (!cwd) return
    try {
      // Clear all command caches to ensure fresh load
      clearCommandsCache()
      const commands = await getCommands(cwd)
      onCommandsChange(commands)
    } catch (error) {
      // Errors during reload are non-fatal - log and continue
      if (error instanceof Error) {
        logError(error)
      }
    }
  }, [cwd, onCommandsChange])

  useEffect(() => skillChangeDetector.subscribe(handleChange), [handleChange])

  const handleGrowthBookRefresh = useCallback(async () => {
    if (!cwd) return
    try {
      clearCommandMemoizationCaches()
      const commands = await getCommands(cwd)
      onCommandsChange(commands)
    } catch (error) {
      if (error instanceof Error) {
        logError(error)
      }
    }
  }, [cwd, onCommandsChange])

  useEffect(
    () => onGrowthBookRefresh(handleGrowthBookRefresh),
    [handleGrowthBookRefresh],
  )
}
