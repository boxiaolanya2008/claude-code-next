import { type FSWatcher, watch } from 'fs'
import { useEffect, useSyncExternalStore } from 'react'
import { useAppState, useSetAppState } from '../state/AppState.js'
import { createSignal } from '../utils/signal.js'
import type { Task } from '../utils/tasks.js'
import {
  getTaskListId,
  getTasksDir,
  isTodoV2Enabled,
  listTasks,
  onTasksUpdated,
  resetTaskList,
} from '../utils/tasks.js'
import { isTeamLead } from '../utils/teammate.js'

const HIDE_DELAY_MS = 5000
const DEBOUNCE_MS = 50
const FALLBACK_POLL_MS = 5000 

class TasksV2Store {
  
  #tasks: Task[] | undefined = undefined
  

  #hidden = false
  #watcher: FSWatcher | null = null
  #watchedDir: string | null = null
  #hideTimer: ReturnType<typeof setTimeout> | null = null
  #debounceTimer: ReturnType<typeof setTimeout> | null = null
  #pollTimer: ReturnType<typeof setTimeout> | null = null
  #unsubscribeTasksUpdated: (() => void) | null = null
  #changed = createSignal()
  #subscriberCount = 0
  #started = false

  

  getSnapshot = (): Task[] | undefined => {
    return this.#hidden ? undefined : this.#tasks
  }

  subscribe = (fn: () => void): (() => void) => {
    
    
    
    
    const unsubscribe = this.#changed.subscribe(fn)
    this.#subscriberCount++
    if (!this.#started) {
      this.#started = true
      this.#unsubscribeTasksUpdated = onTasksUpdated(this.#debouncedFetch)
      
      
      void this.#fetch()
    }
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      unsubscribe()
      this.#subscriberCount--
      if (this.#subscriberCount === 0) this.#stop()
    }
  }

  #notify(): void {
    this.#changed.emit()
  }

  

  #rewatch(dir: string): void {
    
    
    if (dir === this.#watchedDir && this.#watcher !== null) return
    this.#watcher?.close()
    this.#watcher = null
    this.#watchedDir = dir
    try {
      this.#watcher = watch(dir, this.#debouncedFetch)
      this.#watcher.unref()
    } catch {
      
      
      
    }
  }

  #debouncedFetch = (): void => {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer)
    this.#debounceTimer = setTimeout(() => void this.#fetch(), DEBOUNCE_MS)
    this.#debounceTimer.unref()
  }

  #fetch = async (): Promise<void> => {
    const taskListId = getTaskListId()
    
    
    this.#rewatch(getTasksDir(taskListId))
    const current = (await listTasks(taskListId)).filter(
      t => !t.metadata?._internal,
    )
    this.#tasks = current

    const hasIncomplete = current.some(t => t.status !== 'completed')

    if (hasIncomplete || current.length === 0) {
      
      this.#hidden = current.length === 0
      this.#clearHideTimer()
    } else if (this.#hideTimer === null && !this.#hidden) {
      
      this.#hideTimer = setTimeout(
        this.#onHideTimerFired.bind(this, taskListId),
        HIDE_DELAY_MS,
      )
      this.#hideTimer.unref()
    }

    this.#notify()

    
    
    
    
    if (this.#pollTimer) {
      clearTimeout(this.#pollTimer)
      this.#pollTimer = null
    }
    if (hasIncomplete) {
      this.#pollTimer = setTimeout(this.#debouncedFetch, FALLBACK_POLL_MS)
      this.#pollTimer.unref()
    }
  }

  #onHideTimerFired(scheduledForTaskListId: string): void {
    this.#hideTimer = null
    
    
    const currentId = getTaskListId()
    if (currentId !== scheduledForTaskListId) return
    
    void listTasks(currentId).then(async tasksToCheck => {
      const allStillCompleted =
        tasksToCheck.length > 0 &&
        tasksToCheck.every(t => t.status === 'completed')
      if (allStillCompleted) {
        await resetTaskList(currentId)
        this.#tasks = []
        this.#hidden = true
      }
      this.#notify()
    })
  }

  #clearHideTimer(): void {
    if (this.#hideTimer) {
      clearTimeout(this.#hideTimer)
      this.#hideTimer = null
    }
  }

  

  #stop(): void {
    this.#watcher?.close()
    this.#watcher = null
    this.#watchedDir = null
    this.#unsubscribeTasksUpdated?.()
    this.#unsubscribeTasksUpdated = null
    this.#clearHideTimer()
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer)
    if (this.#pollTimer) clearTimeout(this.#pollTimer)
    this.#debounceTimer = null
    this.#pollTimer = null
    this.#started = false
  }
}

let _store: TasksV2Store | null = null
function getStore(): TasksV2Store {
  return (_store ??= new TasksV2Store())
}

const NOOP = (): void => {}
const NOOP_SUBSCRIBE = (): (() => void) => NOOP
const NOOP_SNAPSHOT = (): undefined => undefined

export function useTasksV2(): Task[] | undefined {
  const teamContext = useAppState(s => s.teamContext)

  const enabled = isTodoV2Enabled() && (!teamContext || isTeamLead(teamContext))

  const store = enabled ? getStore() : null

  return useSyncExternalStore(
    store ? store.subscribe : NOOP_SUBSCRIBE,
    store ? store.getSnapshot : NOOP_SNAPSHOT,
  )
}

export function useTasksV2WithCollapseEffect(): Task[] | undefined {
  const tasks = useTasksV2()
  const setAppState = useSetAppState()

  const hidden = tasks === undefined
  useEffect(() => {
    if (!hidden) return
    setAppState(prev => {
      if (prev.expandedView !== 'tasks') return prev
      return { ...prev, expandedView: 'none' as const }
    })
  }, [hidden, setAppState])

  return tasks
}
