import { useEffect, useRef } from 'react'
import { KeyboardEvent } from '../ink/events/keyboard-event.js'

import { useInput } from '../ink.js'
import {
  type AppState,
  useAppState,
  useSetAppState,
} from '../state/AppState.js'
import {
  enterTeammateView,
  exitTeammateView,
} from '../state/teammateViewHelpers.js'
import {
  getRunningTeammatesSorted,
  InProcessTeammateTask,
} from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import {
  type InProcessTeammateTaskState,
  isInProcessTeammateTask,
} from '../tasks/InProcessTeammateTask/types.js'
import { isBackgroundTask } from '../tasks/types.js'

function stepTeammateSelection(
  delta: 1 | -1,
  setAppState: (updater: (prev: AppState) => AppState) => void,
): void {
  setAppState(prev => {
    const currentCount = getRunningTeammatesSorted(prev.tasks).length
    if (currentCount === 0) return prev

    if (prev.expandedView !== 'teammates') {
      return {
        ...prev,
        expandedView: 'teammates' as const,
        viewSelectionMode: 'selecting-agent',
        selectedIPAgentIndex: -1,
      }
    }

    const maxIdx = currentCount 
    const cur = prev.selectedIPAgentIndex
    const next =
      delta === 1
        ? cur >= maxIdx
          ? -1
          : cur + 1
        : cur <= -1
          ? maxIdx
          : cur - 1
    return {
      ...prev,
      selectedIPAgentIndex: next,
      viewSelectionMode: 'selecting-agent',
    }
  })
}

export function useBackgroundTaskNavigation(options?: {
  onOpenBackgroundTasks?: () => void
}): { handleKeyDown: (e: KeyboardEvent) => void } {
  const tasks = useAppState(s => s.tasks)
  const viewSelectionMode = useAppState(s => s.viewSelectionMode)
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId)
  const selectedIPAgentIndex = useAppState(s => s.selectedIPAgentIndex)
  const setAppState = useSetAppState()

  
  const teammateTasks = getRunningTeammatesSorted(tasks)
  const teammateCount = teammateTasks.length

  
  const hasNonTeammateBackgroundTasks = Object.values(tasks).some(
    t => isBackgroundTask(t) && t.type !== 'in_process_teammate',
  )

  
  const prevTeammateCountRef = useRef<number>(teammateCount)

  
  useEffect(() => {
    const prevCount = prevTeammateCountRef.current
    prevTeammateCountRef.current = teammateCount

    setAppState(prev => {
      const currentTeammates = getRunningTeammatesSorted(prev.tasks)
      const currentCount = currentTeammates.length

      
      
      
      
      if (
        currentCount === 0 &&
        prevCount > 0 &&
        prev.selectedIPAgentIndex !== -1
      ) {
        if (prev.viewSelectionMode === 'viewing-agent') {
          return {
            ...prev,
            selectedIPAgentIndex: -1,
          }
        }
        return {
          ...prev,
          selectedIPAgentIndex: -1,
          viewSelectionMode: 'none',
        }
      }

      
      
      const maxIndex =
        prev.expandedView === 'teammates' ? currentCount : currentCount - 1
      if (currentCount > 0 && prev.selectedIPAgentIndex > maxIndex) {
        return {
          ...prev,
          selectedIPAgentIndex: maxIndex,
        }
      }

      return prev
    })
  }, [teammateCount, setAppState])

  
  const getSelectedTeammate = (): {
    taskId: string
    task: InProcessTeammateTaskState
  } | null => {
    if (teammateCount === 0) return null
    const selectedIndex = selectedIPAgentIndex
    const task = teammateTasks[selectedIndex]
    if (!task) return null

    return { taskId: task.id, task }
  }

  const handleKeyDown = (e: KeyboardEvent): void => {
    
    
    
    if (e.key === 'escape' && viewSelectionMode === 'viewing-agent') {
      e.preventDefault()
      const taskId = viewingAgentTaskId
      if (taskId) {
        const task = tasks[taskId]
        if (isInProcessTeammateTask(task) && task.status === 'running') {
          
          task.currentWorkAbortController?.abort()
          return
        }
      }
      
      exitTeammateView(setAppState)
      return
    }

    
    if (e.key === 'escape' && viewSelectionMode === 'selecting-agent') {
      e.preventDefault()
      setAppState(prev => ({
        ...prev,
        viewSelectionMode: 'none',
        selectedIPAgentIndex: -1,
      }))
      return
    }

    
    
    
    if (e.shift && (e.key === 'up' || e.key === 'down')) {
      e.preventDefault()
      if (teammateCount > 0) {
        stepTeammateSelection(e.key === 'down' ? 1 : -1, setAppState)
      } else if (hasNonTeammateBackgroundTasks) {
        options?.onOpenBackgroundTasks?.()
      }
      return
    }

    
    if (
      e.key === 'f' &&
      viewSelectionMode === 'selecting-agent' &&
      teammateCount > 0
    ) {
      e.preventDefault()
      const selected = getSelectedTeammate()
      if (selected) {
        enterTeammateView(selected.taskId, setAppState)
      }
      return
    }

    
    if (e.key === 'return' && viewSelectionMode === 'selecting-agent') {
      e.preventDefault()
      if (selectedIPAgentIndex === -1) {
        exitTeammateView(setAppState)
      } else if (selectedIPAgentIndex >= teammateCount) {
        
        setAppState(prev => ({
          ...prev,
          expandedView: 'none' as const,
          viewSelectionMode: 'none',
          selectedIPAgentIndex: -1,
        }))
      } else {
        const selected = getSelectedTeammate()
        if (selected) {
          enterTeammateView(selected.taskId, setAppState)
        }
      }
      return
    }

    
    if (
      e.key === 'k' &&
      viewSelectionMode === 'selecting-agent' &&
      selectedIPAgentIndex >= 0
    ) {
      e.preventDefault()
      const selected = getSelectedTeammate()
      if (selected && selected.task.status === 'running') {
        void InProcessTeammateTask.kill(selected.taskId, setAppState)
      }
      return
    }
  }

  
  
  
  
  useInput((_input, _key, event) => {
    handleKeyDown(new KeyboardEvent(event.keypress))
  })

  return { handleKeyDown }
}
