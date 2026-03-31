

import memoize from 'lodash-es/memoize.js'
import { which } from '../which.js'

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    return !!(await which(command))
  } catch {
    return false
  }
}

/**
 * Check if git is available on the system.
 *
 * This is memoized so repeated calls within a session return the cached result.
 * Git availability is unlikely to change during a single CLI session.
 *
 * Only checks PATH — does not exec git. On macOS this means the /usr/bin/git
 * xcrun shim passes even without Xcode CLT installed; callers that hit
 * `xcrun: error:` at exec time should call markGitUnavailable() so the rest
 * of the session behaves as though git is absent.
 *
 * @returns True if git is installed and executable
 */
export const checkGitAvailable = memoize(async (): Promise<boolean> => {
  return isCommandAvailable('git')
})

export function markGitUnavailable(): void {
  checkGitAvailable.cache?.set?.(undefined, Promise.resolve(false))
}

/**
 * Clear the git availability cache.
 * Used for testing purposes.
 */
export function clearGitAvailabilityCache(): void {
  checkGitAvailable.cache?.clear?.()
}
