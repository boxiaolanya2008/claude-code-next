import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  dequeue,
  dequeueAllMatching,
  hasCommandsInQueue,
  peek,
} from './messageQueueManager.js'

type ProcessQueueParams = {
  executeInput: (commands: QueuedCommand[]) => Promise<void>
}

type ProcessQueueResult = {
  processed: boolean
}

function isSlashCommand(cmd: QueuedCommand): boolean {
  if (typeof cmd.value === 'string') {
    return cmd.value.trim().startsWith('/')
  }
  
  for (const block of cmd.value) {
    if (block.type === 'text') {
      return block.text.trim().startsWith('/')
    }
  }
  return false
}

export function processQueueIfReady({
  executeInput,
}: ProcessQueueParams): ProcessQueueResult {
  
  
  
  
  
  
  const isMainThread = (cmd: QueuedCommand) => cmd.agentId === undefined

  const next = peek(isMainThread)
  if (!next) {
    return { processed: false }
  }

  
  
  if (isSlashCommand(next) || next.mode === 'bash') {
    const cmd = dequeue(isMainThread)!
    void executeInput([cmd])
    return { processed: true }
  }

  
  const targetMode = next.mode
  const commands = dequeueAllMatching(
    cmd => isMainThread(cmd) && !isSlashCommand(cmd) && cmd.mode === targetMode,
  )
  if (commands.length === 0) {
    return { processed: false }
  }

  void executeInput(commands)
  return { processed: true }
}

export function hasQueuedCommands(): boolean {
  return hasCommandsInQueue()
}
