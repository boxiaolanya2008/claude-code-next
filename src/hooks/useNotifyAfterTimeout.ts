import { useEffect } from 'react'
import {
  getLastInteractionTime,
  updateLastInteractionTime,
} from '../bootstrap/state.js'
import { useTerminalNotification } from '../ink/useTerminalNotification.js'
import { sendNotification } from '../services/notifier.js'

export const DEFAULT_INTERACTION_THRESHOLD_MS = 6000

function getTimeSinceLastInteraction(): number {
  return Date.now() - getLastInteractionTime()
}

function hasRecentInteraction(threshold: number): boolean {
  return getTimeSinceLastInteraction() < threshold
}

function shouldNotify(threshold: number): boolean {
  return process.env.NODE_ENV !== 'test' && !hasRecentInteraction(threshold)
}

export function useNotifyAfterTimeout(
  message: string,
  notificationType: string,
): void {
  const terminal = useTerminalNotification()

  
  
  
  
  
  useEffect(() => {
    updateLastInteractionTime(true)
  }, [])

  useEffect(() => {
    let hasNotified = false
    const timer = setInterval(() => {
      if (shouldNotify(DEFAULT_INTERACTION_THRESHOLD_MS) && !hasNotified) {
        hasNotified = true
        clearInterval(timer)
        void sendNotification({ message, notificationType }, terminal)
      }
    }, DEFAULT_INTERACTION_THRESHOLD_MS)

    return () => clearInterval(timer)
  }, [message, notificationType, terminal])
}
