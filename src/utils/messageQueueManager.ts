import { feature } from "../utils/bundle-mock.ts"
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Permutations } from 'src/types/utils.js'
import { getSessionId } from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import type {
  QueueOperation,
  QueueOperationMessage,
} from '../types/messageQueueTypes.js'
import type {
  EditablePromptInputMode,
  PromptInputMode,
  QueuedCommand,
  QueuePriority,
} from '../types/textInputTypes.js'
import type { PastedContent } from './config.js'
import { extractTextContent } from './messages.js'
import { objectGroupBy } from './objectGroupBy.js'
import { recordQueueOperation } from './sessionStorage.js'
import { createSignal } from './signal.js'

export type SetAppState = (f: (prev: AppState) => AppState) => void

function logOperation(operation: QueueOperation, content?: string): void {
  const sessionId = getSessionId()
  const queueOp: QueueOperationMessage = {
    type: 'queue-operation',
    operation,
    timestamp: new Date().toISOString(),
    sessionId,
    ...(content !== undefined && { content }),
  }
  void recordQueueOperation(queueOp)
}

const commandQueue: QueuedCommand[] = []

let snapshot: readonly QueuedCommand[] = Object.freeze([])
const queueChanged = createSignal()

function notifySubscribers(): void {
  snapshot = Object.freeze([...commandQueue])
  queueChanged.emit()
}

export const subscribeToCommandQueue = queueChanged.subscribe

export function getCommandQueueSnapshot(): readonly QueuedCommand[] {
  return snapshot
}

export function getCommandQueue(): QueuedCommand[] {
  return [...commandQueue]
}

export function getCommandQueueLength(): number {
  return commandQueue.length
}

export function hasCommandsInQueue(): boolean {
  return commandQueue.length > 0
}

export function recheckCommandQueue(): void {
  if (commandQueue.length > 0) {
    notifySubscribers()
  }
}

export function enqueue(command: QueuedCommand): void {
  commandQueue.push({ ...command, priority: command.priority ?? 'next' })
  notifySubscribers()
  logOperation(
    'enqueue',
    typeof command.value === 'string' ? command.value : undefined,
  )
}

export function enqueuePendingNotification(command: QueuedCommand): void {
  commandQueue.push({ ...command, priority: command.priority ?? 'later' })
  notifySubscribers()
  logOperation(
    'enqueue',
    typeof command.value === 'string' ? command.value : undefined,
  )
}

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
}

export function dequeue(
  filter?: (cmd: QueuedCommand) => boolean,
): QueuedCommand | undefined {
  if (commandQueue.length === 0) {
    return undefined
  }

  
  let bestIdx = -1
  let bestPriority = Infinity
  for (let i = 0; i < commandQueue.length; i++) {
    const cmd = commandQueue[i]!
    if (filter && !filter(cmd)) continue
    const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
    if (priority < bestPriority) {
      bestIdx = i
      bestPriority = priority
    }
  }

  if (bestIdx === -1) return undefined

  const [dequeued] = commandQueue.splice(bestIdx, 1)
  notifySubscribers()
  logOperation('dequeue')
  return dequeued
}

export function dequeueAll(): QueuedCommand[] {
  if (commandQueue.length === 0) {
    return []
  }

  const commands = [...commandQueue]
  commandQueue.length = 0
  notifySubscribers()

  for (const _cmd of commands) {
    logOperation('dequeue')
  }

  return commands
}

export function peek(
  filter?: (cmd: QueuedCommand) => boolean,
): QueuedCommand | undefined {
  if (commandQueue.length === 0) {
    return undefined
  }
  let bestIdx = -1
  let bestPriority = Infinity
  for (let i = 0; i < commandQueue.length; i++) {
    const cmd = commandQueue[i]!
    if (filter && !filter(cmd)) continue
    const priority = PRIORITY_ORDER[cmd.priority ?? 'next']
    if (priority < bestPriority) {
      bestIdx = i
      bestPriority = priority
    }
  }
  if (bestIdx === -1) return undefined
  return commandQueue[bestIdx]
}

export function dequeueAllMatching(
  predicate: (cmd: QueuedCommand) => boolean,
): QueuedCommand[] {
  const matched: QueuedCommand[] = []
  const remaining: QueuedCommand[] = []
  for (const cmd of commandQueue) {
    if (predicate(cmd)) {
      matched.push(cmd)
    } else {
      remaining.push(cmd)
    }
  }
  if (matched.length === 0) {
    return []
  }
  commandQueue.length = 0
  commandQueue.push(...remaining)
  notifySubscribers()
  for (const _cmd of matched) {
    logOperation('dequeue')
  }
  return matched
}

export function remove(commandsToRemove: QueuedCommand[]): void {
  if (commandsToRemove.length === 0) {
    return
  }

  const before = commandQueue.length
  for (let i = commandQueue.length - 1; i >= 0; i--) {
    if (commandsToRemove.includes(commandQueue[i]!)) {
      commandQueue.splice(i, 1)
    }
  }

  if (commandQueue.length !== before) {
    notifySubscribers()
  }

  for (const _cmd of commandsToRemove) {
    logOperation('remove')
  }
}

export function removeByFilter(
  predicate: (cmd: QueuedCommand) => boolean,
): QueuedCommand[] {
  const removed: QueuedCommand[] = []
  for (let i = commandQueue.length - 1; i >= 0; i--) {
    if (predicate(commandQueue[i]!)) {
      removed.unshift(commandQueue.splice(i, 1)[0]!)
    }
  }

  if (removed.length > 0) {
    notifySubscribers()
    for (const _cmd of removed) {
      logOperation('remove')
    }
  }

  return removed
}

export function clearCommandQueue(): void {
  if (commandQueue.length === 0) {
    return
  }
  commandQueue.length = 0
  notifySubscribers()
}

export function resetCommandQueue(): void {
  commandQueue.length = 0
  snapshot = Object.freeze([])
}

const NON_EDITABLE_MODES = new Set<PromptInputMode>([
  'task-notification',
] satisfies Permutations<Exclude<PromptInputMode, EditablePromptInputMode>>)

export function isPromptInputModeEditable(
  mode: PromptInputMode,
): mode is EditablePromptInputMode {
  return !NON_EDITABLE_MODES.has(mode)
}

export function isQueuedCommandEditable(cmd: QueuedCommand): boolean {
  return isPromptInputModeEditable(cmd.mode) && !cmd.isMeta
}

export function isQueuedCommandVisible(cmd: QueuedCommand): boolean {
  if (
    (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
    cmd.origin?.kind === 'channel'
  )
    return true
  return isQueuedCommandEditable(cmd)
}

function extractTextFromValue(value: string | ContentBlockParam[]): string {
  return typeof value === 'string' ? value : extractTextContent(value, '\n')
}

function extractImagesFromValue(
  value: string | ContentBlockParam[],
  startId: number,
): PastedContent[] {
  if (typeof value === 'string') {
    return []
  }

  const images: PastedContent[] = []
  let imageIndex = 0
  for (const block of value) {
    if (block.type === 'image' && block.source.type === 'base64') {
      images.push({
        id: startId + imageIndex,
        type: 'image',
        content: block.source.data,
        mediaType: block.source.media_type,
        filename: `image${imageIndex + 1}`,
      })
      imageIndex++
    }
  }
  return images
}

export type PopAllEditableResult = {
  text: string
  cursorOffset: number
  images: PastedContent[]
}

export function popAllEditable(
  currentInput: string,
  currentCursorOffset: number,
): PopAllEditableResult | undefined {
  if (commandQueue.length === 0) {
    return undefined
  }

  const { editable = [], nonEditable = [] } = objectGroupBy(
    [...commandQueue],
    cmd => (isQueuedCommandEditable(cmd) ? 'editable' : 'nonEditable'),
  )

  if (editable.length === 0) {
    return undefined
  }

  
  const queuedTexts = editable.map(cmd => extractTextFromValue(cmd.value))
  const newInput = [...queuedTexts, currentInput].filter(Boolean).join('\n')

  
  const cursorOffset = queuedTexts.join('\n').length + 1 + currentCursorOffset

  
  const images: PastedContent[] = []
  let nextImageId = Date.now() 
  for (const cmd of editable) {
    
    
    if (cmd.pastedContents) {
      for (const content of Object.values(cmd.pastedContents)) {
        if (content.type === 'image') {
          images.push(content)
        }
      }
    }
    
    const cmdImages = extractImagesFromValue(cmd.value, nextImageId)
    images.push(...cmdImages)
    nextImageId += cmdImages.length
  }

  for (const command of editable) {
    logOperation(
      'popAll',
      typeof command.value === 'string' ? command.value : undefined,
    )
  }

  
  commandQueue.length = 0
  commandQueue.push(...nonEditable)
  notifySubscribers()

  return { text: newInput, cursorOffset, images }
}

export const subscribeToPendingNotifications = subscribeToCommandQueue

export function getPendingNotificationsSnapshot(): readonly QueuedCommand[] {
  return snapshot
}

export const hasPendingNotifications = hasCommandsInQueue

export const getPendingNotificationsCount = getCommandQueueLength

export const recheckPendingNotifications = recheckCommandQueue

export function dequeuePendingNotification(): QueuedCommand | undefined {
  return dequeue()
}

export const resetPendingNotifications = resetCommandQueue

export const clearPendingNotifications = clearCommandQueue

export function getCommandsByMaxPriority(
  maxPriority: QueuePriority,
): QueuedCommand[] {
  const threshold = PRIORITY_ORDER[maxPriority]
  return commandQueue.filter(
    cmd => PRIORITY_ORDER[cmd.priority ?? 'next'] <= threshold,
  )
}

export function isSlashCommand(cmd: QueuedCommand): boolean {
  return (
    typeof cmd.value === 'string' &&
    cmd.value.trim().startsWith('/') &&
    !cmd.skipSlashCommands
  )
}
