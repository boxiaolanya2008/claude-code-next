import { useSyncExternalStore } from 'react'
import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  getCommandQueueSnapshot,
  subscribeToCommandQueue,
} from '../utils/messageQueueManager.js'

export function useCommandQueue(): readonly QueuedCommand[] {
  return useSyncExternalStore(subscribeToCommandQueue, getCommandQueueSnapshot)
}
