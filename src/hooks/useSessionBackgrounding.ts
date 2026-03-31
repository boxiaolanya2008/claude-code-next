

import { useCallback, useEffect, useRef } from 'react'
import { useAppState, useSetAppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'

type UseSessionBackgroundingProps = {
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
  setIsLoading: (loading: boolean) => void
  resetLoadingState: () => void
  setAbortController: (controller: AbortController | null) => void
  onBackgroundQuery: () => void
}

type UseSessionBackgroundingResult = {
  
  handleBackgroundSession: () => void
}

export function useSessionBackgrounding({
  setMessages,
  setIsLoading,
  resetLoadingState,
  setAbortController,
  onBackgroundQuery,
}: UseSessionBackgroundingProps): UseSessionBackgroundingResult {
  const foregroundedTaskId = useAppState(s => s.foregroundedTaskId)
  const foregroundedTask = useAppState(s =>
    s.foregroundedTaskId ? s.tasks[s.foregroundedTaskId] : undefined,
  )
  const setAppState = useSetAppState()
  const lastSyncedMessagesLengthRef = useRef<number>(0)

  const handleBackgroundSession = useCallback(() => {
    if (foregroundedTaskId) {
      
      setAppState(prev => {
        const taskId = prev.foregroundedTaskId
        if (!taskId) return prev
        const task = prev.tasks[taskId]
        if (!task) {
          return { ...prev, foregroundedTaskId: undefined }
        }
        return {
          ...prev,
          foregroundedTaskId: undefined,
          tasks: {
            ...prev.tasks,
            [taskId]: { ...task, isBackgrounded: true },
          },
        }
      })
      setMessages([])
      resetLoadingState()
      setAbortController(null)
      return
    }

    onBackgroundQuery()
  }, [
    foregroundedTaskId,
    setAppState,
    setMessages,
    resetLoadingState,
    setAbortController,
    onBackgroundQuery,
  ])

  
  useEffect(() => {
    if (!foregroundedTaskId) {
      
      lastSyncedMessagesLengthRef.current = 0
      return
    }

    if (!foregroundedTask || foregroundedTask.type !== 'local_agent') {
      setAppState(prev => ({ ...prev, foregroundedTaskId: undefined }))
      resetLoadingState()
      lastSyncedMessagesLengthRef.current = 0
      return
    }

    
    
    const taskMessages = foregroundedTask.messages ?? []
    if (taskMessages.length !== lastSyncedMessagesLengthRef.current) {
      lastSyncedMessagesLengthRef.current = taskMessages.length
      setMessages([...taskMessages])
    }

    if (foregroundedTask.status === 'running') {
      
      const taskAbortController = foregroundedTask.abortController
      if (taskAbortController?.signal.aborted) {
        
        setAppState(prev => {
          if (!prev.foregroundedTaskId) return prev
          const task = prev.tasks[prev.foregroundedTaskId]
          if (!task) return { ...prev, foregroundedTaskId: undefined }
          return {
            ...prev,
            foregroundedTaskId: undefined,
            tasks: {
              ...prev.tasks,
              [prev.foregroundedTaskId]: { ...task, isBackgrounded: true },
            },
          }
        })
        resetLoadingState()
        setAbortController(null)
        lastSyncedMessagesLengthRef.current = 0
        return
      }

      setIsLoading(true)
      
      if (taskAbortController) {
        setAbortController(taskAbortController)
      }
    } else {
      
      setAppState(prev => {
        const taskId = prev.foregroundedTaskId
        if (!taskId) return prev
        const task = prev.tasks[taskId]
        if (!task) return { ...prev, foregroundedTaskId: undefined }
        return {
          ...prev,
          foregroundedTaskId: undefined,
          tasks: { ...prev.tasks, [taskId]: { ...task, isBackgrounded: true } },
        }
      })
      resetLoadingState()
      setAbortController(null)
      lastSyncedMessagesLengthRef.current = 0
    }
  }, [
    foregroundedTaskId,
    foregroundedTask,
    setAppState,
    setMessages,
    setIsLoading,
    resetLoadingState,
    setAbortController,
  ])

  return {
    handleBackgroundSession,
  }
}
