

import type { UUID } from 'crypto'
import { randomBytes } from 'crypto'
import {
  OUTPUT_FILE_TAG,
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_ID_TAG,
  TASK_NOTIFICATION_TAG,
  TOOL_USE_ID_TAG,
} from '../constants/xml.js'
import { type QueryParams, query } from '../query.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import type { SetAppState } from '../Task.js'
import { createTaskStateBase } from '../Task.js'
import type {
  AgentDefinition,
  CustomAgentDefinition,
} from '../tools/AgentTool/loadAgentsDir.js'
import { asAgentId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import { createAbortController } from '../utils/abortController.js'
import {
  runWithAgentContext,
  type SubagentContext,
} from '../utils/agentContext.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import {
  getAgentTranscriptPath,
  recordSidechainTranscript,
} from '../utils/sessionStorage.js'
import {
  evictTaskOutput,
  getTaskOutputPath,
  initTaskOutputAsSymlink,
} from '../utils/task/diskOutput.js'
import { registerTask, updateTaskState } from '../utils/task/framework.js'
import type { LocalAgentTaskState } from './LocalAgentTask/LocalAgentTask.js'

export type LocalMainSessionTaskState = LocalAgentTaskState & {
  agentType: 'main-session'
}

/**
 * Default agent definition for main session tasks when no agent is specified.
 */
const DEFAULT_MAIN_SESSION_AGENT: CustomAgentDefinition = {
  agentType: 'main-session',
  whenToUse: 'Main session query',
  source: 'userSettings',
  getSystemPrompt: () => '',
}

/**
 * Generate a unique task ID for main session tasks.
 * Uses 's' prefix to distinguish from agent tasks ('a' prefix).
 */
const TASK_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function generateMainSessionTaskId(): string {
  const bytes = randomBytes(8)
  let id = 's'
  for (let i = 0; i < 8; i++) {
    id += TASK_ID_ALPHABET[bytes[i]! % TASK_ID_ALPHABET.length]
  }
  return id
}

/**
 * Register a backgrounded main session task.
 * Called when the user backgrounds the current session query.
 *
 * @param description - Description of the task
 * @param setAppState - State setter function
 * @param mainThreadAgentDefinition - Optional agent definition if running with --agent
 * @param existingAbortController - Optional abort controller to reuse (for backgrounding an active query)
 * @returns Object with task ID and abort signal for stopping the background query
 */
export function registerMainSessionTask(
  description: string,
  setAppState: SetAppState,
  mainThreadAgentDefinition?: AgentDefinition,
  existingAbortController?: AbortController,
): { taskId: string; abortSignal: AbortSignal } {
  const taskId = generateMainSessionTaskId()

  
  
  
  
  
  void initTaskOutputAsSymlink(
    taskId,
    getAgentTranscriptPath(asAgentId(taskId)),
  )

  
  
  const abortController = existingAbortController ?? createAbortController()

  const unregisterCleanup = registerCleanup(async () => {
    // Clean up on process exit
    setAppState(prev => {
      const { [taskId]: removed, ...rest } = prev.tasks
      return { ...prev, tasks: rest }
    })
  })

  
  const selectedAgent = mainThreadAgentDefinition ?? DEFAULT_MAIN_SESSION_AGENT

  
  const taskState: LocalMainSessionTaskState = {
    ...createTaskStateBase(taskId, 'local_agent', description),
    type: 'local_agent',
    status: 'running',
    agentId: taskId,
    prompt: description,
    selectedAgent,
    agentType: 'main-session',
    abortController,
    unregisterCleanup,
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true, // Already backgrounded
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
  }

  logForDebugging(
    `[LocalMainSessionTask] Registering task ${taskId} with description: ${description}`,
  )
  registerTask(taskState, setAppState)

  
  setAppState(prev => {
    const hasTask = taskId in prev.tasks
    logForDebugging(
      `[LocalMainSessionTask] After registration, task ${taskId} exists in state: ${hasTask}`,
    )
    return prev
  })

  return { taskId, abortSignal: abortController.signal }
}

/**
 * Complete the main session task and send notification.
 * Called when the backgrounded query finishes.
 */
export function completeMainSessionTask(
  taskId: string,
  success: boolean,
  setAppState: SetAppState,
): void {
  let wasBackgrounded = true
  let toolUseId: string | undefined

  updateTaskState<LocalMainSessionTaskState>(taskId, setAppState, task => {
    if (task.status !== 'running') {
      return task
    }

    // Track if task was backgrounded (for notification decision)
    wasBackgrounded = task.isBackgrounded ?? true
    toolUseId = task.toolUseId

    task.unregisterCleanup?.()

    return {
      ...task,
      status: success ? 'completed' : 'failed',
      endTime: Date.now(),
      messages: task.messages?.length ? [task.messages.at(-1)!] : undefined,
    }
  })

  void evictTaskOutput(taskId)

  
  
  if (wasBackgrounded) {
    enqueueMainSessionNotification(
      taskId,
      'Background session',
      success ? 'completed' : 'failed',
      setAppState,
      toolUseId,
    )
  } else {
    // Foregrounded: no XML notification (TUI user is watching), but SDK
    
    
    
    
    updateTaskState(taskId, setAppState, task => ({ ...task, notified: true }))
    emitTaskTerminatedSdk(taskId, success ? 'completed' : 'failed', {
      toolUseId,
      summary: 'Background session',
    })
  }
}

/**
 * Enqueue a notification about the backgrounded session completing.
 */
function enqueueMainSessionNotification(
  taskId: string,
  description: string,
  status: 'completed' | 'failed',
  setAppState: SetAppState,
  toolUseId?: string,
): void {
  // Atomically check and set notified flag to prevent duplicate notifications.
  let shouldEnqueue = false
  updateTaskState(taskId, setAppState, task => {
    if (task.notified) {
      return task
    }
    shouldEnqueue = true
    return { ...task, notified: true }
  })

  if (!shouldEnqueue) {
    return
  }

  const summary =
    status === 'completed'
      ? `Background session "${description}" completed`
      : `Background session "${description}" failed`

  const toolUseIdLine = toolUseId
    ? `\n<${TOOL_USE_ID_TAG}>${toolUseId}</${TOOL_USE_ID_TAG}>`
    : ''

  const outputPath = getTaskOutputPath(taskId)
  const message = `<${TASK_NOTIFICATION_TAG}>
<${TASK_ID_TAG}>${taskId}</${TASK_ID_TAG}>${toolUseIdLine}
<${OUTPUT_FILE_TAG}>${outputPath}</${OUTPUT_FILE_TAG}>
<${STATUS_TAG}>${status}</${STATUS_TAG}>
<${SUMMARY_TAG}>${summary}</${SUMMARY_TAG}>
</${TASK_NOTIFICATION_TAG}>`

  enqueuePendingNotification({ value: message, mode: 'task-notification' })
}

/**
 * Foreground a main session task - mark it as foregrounded so its output
 * appears in the main view. The background query keeps running.
 * Returns the task's accumulated messages, or undefined if task not found.
 */
export function foregroundMainSessionTask(
  taskId: string,
  setAppState: SetAppState,
): Message[] | undefined {
  let taskMessages: Message[] | undefined

  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (!task || task.type !== 'local_agent') {
      return prev
    }

    taskMessages = (task as LocalMainSessionTaskState).messages

    
    const prevId = prev.foregroundedTaskId
    const prevTask = prevId ? prev.tasks[prevId] : undefined
    const restorePrev =
      prevId && prevId !== taskId && prevTask?.type === 'local_agent'

    return {
      ...prev,
      foregroundedTaskId: taskId,
      tasks: {
        ...prev.tasks,
        ...(restorePrev && { [prevId]: { ...prevTask, isBackgrounded: true } }),
        [taskId]: { ...task, isBackgrounded: false },
      },
    }
  })

  return taskMessages
}

/**
 * Check if a task is a main session task (vs a regular agent task).
 */
export function isMainSessionTask(
  task: unknown,
): task is LocalMainSessionTaskState {
  if (
    typeof task !== 'object' ||
    task === null ||
    !('type' in task) ||
    !('agentType' in task)
  ) {
    return false
  }
  return (
    task.type === 'local_agent' &&
    (task as LocalMainSessionTaskState).agentType === 'main-session'
  )
}

// Max recent activities to keep for display
const MAX_RECENT_ACTIVITIES = 5

type ToolActivity = {
  toolName: string
  input: Record<string, unknown>
}

/**
 * Start a fresh background session with the given messages.
 *
 * Spawns an independent query() call with the current messages and registers it
 * as a background task. The caller's foreground query continues running normally.
 */
export function startBackgroundSession({
  messages,
  queryParams,
  description,
  setAppState,
  agentDefinition,
}: {
  messages: Message[]
  queryParams: Omit<QueryParams, 'messages'>
  description: string
  setAppState: SetAppState
  agentDefinition?: AgentDefinition
}): string {
  const { taskId, abortSignal } = registerMainSessionTask(
    description,
    setAppState,
    agentDefinition,
  )

  
  
  
  void recordSidechainTranscript(messages, taskId).catch(err =>
    logForDebugging(`bg-session initial transcript write failed: ${err}`),
  )

  
  
  
  
  const agentContext: SubagentContext = {
    agentId: taskId,
    agentType: 'subagent',
    subagentName: 'main-session',
    isBuiltIn: true,
  }

  void runWithAgentContext(agentContext, async () => {
    try {
      const bgMessages: Message[] = [...messages]
      const recentActivities: ToolActivity[] = []
      let toolCount = 0
      let tokenCount = 0
      let lastRecordedUuid: UUID | null = messages.at(-1)?.uuid ?? null

      for await (const event of query({
        messages: bgMessages,
        ...queryParams,
      })) {
        if (abortSignal.aborted) {
          // Aborted mid-stream — completeMainSessionTask won't be reached.
          // chat:killAgents path already marked notified + emitted; stopTask path did not.
          let alreadyNotified = false
          updateTaskState(taskId, setAppState, task => {
            alreadyNotified = task.notified === true
            return alreadyNotified ? task : { ...task, notified: true }
          })
          if (!alreadyNotified) {
            emitTaskTerminatedSdk(taskId, 'stopped', {
              summary: description,
            })
          }
          return
        }

        if (
          event.type !== 'user' &&
          event.type !== 'assistant' &&
          event.type !== 'system'
        ) {
          continue
        }

        bgMessages.push(event)

        // Per-message write (matches runAgent.ts pattern) — gives live
        // TaskOutput progress and keeps the transcript file current even if
        // /clear re-links the symlink mid-run.
        void recordSidechainTranscript([event], taskId, lastRecordedUuid).catch(
          err => logForDebugging(`bg-session transcript write failed: ${err}`),
        )
        lastRecordedUuid = event.uuid

        if (event.type === 'assistant') {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              tokenCount += roughTokenCountEstimation(block.text)
            } else if (block.type === 'tool_use') {
              toolCount++
              const activity: ToolActivity = {
                toolName: block.name,
                input: block.input as Record<string, unknown>,
              }
              recentActivities.push(activity)
              if (recentActivities.length > MAX_RECENT_ACTIVITIES) {
                recentActivities.shift()
              }
            }
          }
        }

        setAppState(prev => {
          const task = prev.tasks[taskId]
          if (!task || task.type !== 'local_agent') return prev
          const prevProgress = task.progress
          if (
            prevProgress?.tokenCount === tokenCount &&
            prevProgress.toolUseCount === toolCount &&
            task.messages === bgMessages
          ) {
            return prev
          }
          return {
            ...prev,
            tasks: {
              ...prev.tasks,
              [taskId]: {
                ...task,
                progress: {
                  tokenCount,
                  toolUseCount: toolCount,
                  recentActivities:
                    prevProgress?.toolUseCount === toolCount
                      ? prevProgress.recentActivities
                      : [...recentActivities],
                },
                messages: bgMessages,
              },
            },
          }
        })
      }

      completeMainSessionTask(taskId, true, setAppState)
    } catch (error) {
      logError(error)
      completeMainSessionTask(taskId, false, setAppState)
    }
  })

  return taskId
}
