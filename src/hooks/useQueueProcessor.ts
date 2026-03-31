import { useEffect, useSyncExternalStore } from 'react'
import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  getCommandQueueSnapshot,
  subscribeToCommandQueue,
} from '../utils/messageQueueManager.js'
import type { QueryGuard } from '../utils/QueryGuard.js'
import { processQueueIfReady } from '../utils/queueProcessor.js'

type UseQueueProcessorParams = {
  executeQueuedInput: (commands: QueuedCommand[]) => Promise<void>
  hasActiveLocalJsxUI: boolean
  queryGuard: QueryGuard
}

export function useQueueProcessor({
  executeQueuedInput,
  hasActiveLocalJsxUI,
  queryGuard,
}: UseQueueProcessorParams): void {
  
  
  const isQueryActive = useSyncExternalStore(
    queryGuard.subscribe,
    queryGuard.getSnapshot,
  )

  
  
  
  const queueSnapshot = useSyncExternalStore(
    subscribeToCommandQueue,
    getCommandQueueSnapshot,
  )

  useEffect(() => {
    if (isQueryActive) return
    if (hasActiveLocalJsxUI) return
    if (queueSnapshot.length === 0) return

    
    
    
    
    
    
    
    processQueueIfReady({ executeInput: executeQueuedInput })
  }, [
    queueSnapshot,
    isQueryActive,
    executeQueuedInput,
    hasActiveLocalJsxUI,
    queryGuard,
  ])
}
