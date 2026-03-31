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
    
    if (!viewingAgentTaskId) {
      return
    }

    
    
    
    if (!taskExists) {
      exitTeammateView(setAppState)
      return
    }
    
    
    if (!viewedTask) return

    
    
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
