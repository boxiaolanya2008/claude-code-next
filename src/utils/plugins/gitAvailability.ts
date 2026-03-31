

import memoize from 'lodash-es/memoize.js'
import { which } from '../which.js'

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    return !!(await which(command))
  } catch {
    return false
  }
}

export const checkGitAvailable = memoize(async (): Promise<boolean> => {
  return isCommandAvailable('git')
})

export function markGitUnavailable(): void {
  checkGitAvailable.cache?.set?.(undefined, Promise.resolve(false))
}

export function clearGitAvailabilityCache(): void {
  checkGitAvailable.cache?.clear?.()
}
