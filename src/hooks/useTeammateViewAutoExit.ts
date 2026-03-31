import { useEffect } from 'react'
import { useAppState, useSetAppState } from '../state/AppState.js'
import { exitTeammateView } from '../state/teammateViewHelpers.js'
import { isInProcessTeammateTask } from '../tasks/InProcessTeammateTask/types.js'

export function useTeammateViewAutoExit(): void {
  const setAppState = useSetAppState()
  const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId)
  
  
  const task = useAppState(s =>
    s.viewingAgentTaskId ? s.tasks[s.viewingAgentTaskId] : undefined,
  )

  const viewedTask = task && isInProcessTeammateTask(task) ? task : undefined
  const viewedStatus = viewedTask?.status
  const viewedError = viewedTask?.error
  const taskExists = task !== undefined

  useEffect(() => {
    // Not viewing any teammate
    if (!viewingAgentTaskId) {
      return
    }

    // Task no longer exists in the map — evicted out from under us.
    
    
    if (!taskExists) {
      exitTeammateView(setAppState)
      return
    }
    // Status checks below are teammate-only (viewedTask is teammate-narrowed).
    
    if (!viewedTask) return

    // Auto-exit if teammate is killed, stopped, has error, or is no longer running
    
    if (
      viewedStatus === 'killed' ||
      viewedStatus === 'failed' ||
      viewedError ||
      (viewedStatus !== 'running' &&
        viewedStatus !== 'completed' &&
        viewedStatus !== 'pending')
    ) {
      exitTeammateView(setAppState)
      return
    }
  }, [
    viewingAgentTaskId,
    taskExists,
    viewedTask,
    viewedStatus,
    viewedError,
    setAppState,
  ])
}
