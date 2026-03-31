import { type FSWatcher, watch } from 'fs'
import { useEffect, useRef } from 'react'
import { logForDebugging } from '../utils/debug.js'
import {
  claimTask,
  DEFAULT_TASKS_MODE_TASK_LIST_ID,
  ensureTasksDir,
  getTasksDir,
  listTasks,
  type Task,
  updateTask,
} from '../utils/tasks.js'

const DEBOUNCE_MS = 1000

type Props = {
  /** When undefined, the hook does nothing. The task list id is also used as the agent ID. */
  taskListId?: string
  isLoading: boolean
  

  onSubmitTask: (prompt: string) => boolean
}

/**
 * Hook that watches a task list directory and automatically picks up
 * open, unowned tasks to work on.
 *
 * This enables "tasks mode" where Claude watches for externally-created
 * tasks and processes them one at a time.
 */
export function useTaskListWatcher({
  taskListId,
  isLoading,
  onSubmitTask,
}: Props): void {
  const currentTaskRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  
  
  
  
  
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading
  const onSubmitTaskRef = useRef(onSubmitTask)
  onSubmitTaskRef.current = onSubmitTask

  const enabled = taskListId !== undefined
  const agentId = taskListId ?? DEFAULT_TASKS_MODE_TASK_LIST_ID

  
  
  
  
  const checkForTasksRef = useRef<() => Promise<void>>(async () => {})
  checkForTasksRef.current = async () => {
    if (!enabled) {
      return
    }

    // Don't need to submit new tasks if we are already working
    if (isLoadingRef.current) {
      return
    }

    const tasks = await listTasks(taskListId)

    // If we have a current task, check if it's been resolved
    if (currentTaskRef.current !== null) {
      const currentTask = tasks.find(t => t.id === currentTaskRef.current)
      if (!currentTask || currentTask.status === 'completed') {
        logForDebugging(
          `[TaskListWatcher] Task #${currentTaskRef.current} is marked complete, ready for next task`,
        )
        currentTaskRef.current = null
      } else {
        // Still working on current task
        return
      }
    }

    // Find an open task with no owner that isn't blocked
    const availableTask = findAvailableTask(tasks)

    if (!availableTask) {
      return
    }

    logForDebugging(
      `[TaskListWatcher] Found available task #${availableTask.id}: ${availableTask.subject}`,
    )

    // Claim the task using the task list's agent ID
    const result = await claimTask(taskListId, availableTask.id, agentId)

    if (!result.success) {
      logForDebugging(
        `[TaskListWatcher] Failed to claim task #${availableTask.id}: ${result.reason}`,
      )
      return
    }

    currentTaskRef.current = availableTask.id

    
    const prompt = formatTaskAsPrompt(availableTask)

    logForDebugging(
      `[TaskListWatcher] Submitting task #${availableTask.id} as prompt`,
    )

    const submitted = onSubmitTaskRef.current(prompt)
    if (!submitted) {
      logForDebugging(
        `[TaskListWatcher] Failed to submit task #${availableTask.id}, releasing claim`,
      )
      
      await updateTask(taskListId, availableTask.id, { owner: undefined })
      currentTaskRef.current = null
    }
  }

  // -- Watcher setup

  
  
  const scheduleCheckRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return

    void ensureTasksDir(taskListId)
    const tasksDir = getTasksDir(taskListId)

    let watcher: FSWatcher | null = null

    const debouncedCheck = (): void => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(
        ref => void ref.current(),
        DEBOUNCE_MS,
        checkForTasksRef,
      )
    }
    scheduleCheckRef.current = debouncedCheck

    try {
      watcher = watch(tasksDir, debouncedCheck)
      watcher.unref()
      logForDebugging(`[TaskListWatcher] Watching for tasks in ${tasksDir}`)
    } catch (error) {
      // fs.watch throws synchronously on ENOENT — ensureTasksDir should have
      
      logForDebugging(`[TaskListWatcher] Failed to watch ${tasksDir}: ${error}`)
    }

    // Initial check
    debouncedCheck()

    return () => {
      // This cleanup only fires when taskListId changes or on unmount —
      
      
      scheduleCheckRef.current = () => {}
      if (watcher) {
        watcher.close()
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [enabled, taskListId])

  
  
  
  
  useEffect(() => {
    if (!enabled) return
    if (isLoading) return
    scheduleCheckRef.current()
  }, [enabled, isLoading])
}

/**
 * Find an available task that can be worked on:
 * - Status is 'pending'
 * - No owner assigned
 * - Not blocked by any unresolved tasks
 */
function findAvailableTask(tasks: Task[]): Task | undefined {
  const unresolvedTaskIds = new Set(
    tasks.filter(t => t.status !== 'completed').map(t => t.id),
  )

  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    
    return task.blockedBy.every(id => !unresolvedTaskIds.has(id))
  })
}

/**
 * Format a task as a prompt for Claude to work on.
 */
function formatTaskAsPrompt(task: Task): string {
  let prompt = `Complete all open tasks. Start with task #${task.id}: \n\n ${task.subject}`

  if (task.description) {
    prompt += `\n\n${task.description}`
  }

  return prompt
}
