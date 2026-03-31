import { useCallback, useSyncExternalStore } from 'react'
import { formatDuration } from '../utils/format.js'

export function useElapsedTime(
  startTime: number,
  isRunning: boolean,
  ms: number = 1000,
  pausedMs: number = 0,
  endTime?: number,
): string {
  const get = () =>
    formatDuration(Math.max(0, (endTime ?? Date.now()) - startTime - pausedMs))

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!isRunning) return () => {}
      const interval = setInterval(notify, ms)
      return () => clearInterval(interval)
    },
    [isRunning, ms],
  )

  return useSyncExternalStore(subscribe, get, get)
}
