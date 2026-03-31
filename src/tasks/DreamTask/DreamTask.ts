

import { rollbackConsolidationLock } from '../../services/autoDream/consolidationLock.js'
import type { SetAppState, Task, TaskStateBase } from '../../Task.js'
import { createTaskStateBase, generateTaskId } from '../../Task.js'
import { registerTask, updateTaskState } from '../../utils/task/framework.js'

const MAX_TURNS = 30

export type DreamTurn = {
  text: string
  toolUseCount: number
}

export type DreamPhase = 'starting' | 'updating'

export type DreamTaskState = TaskStateBase & {
  type: 'dream'
  phase: DreamPhase
  sessionsReviewing: number
  

  filesTouched: string[]
  
  turns: DreamTurn[]
  abortController?: AbortController
  
  priorMtime: number
}

export function isDreamTask(task: unknown): task is DreamTaskState {
  return (
    typeof task === 'object' &&
    task !== null &&
    'type' in task &&
    task.type === 'dream'
  )
}

export function registerDreamTask(
  setAppState: SetAppState,
  opts: {
    sessionsReviewing: number
    priorMtime: number
    abortController: AbortController
  },
): string {
  const id = generateTaskId('dream')
  const task: DreamTaskState = {
    ...createTaskStateBase(id, 'dream', 'dreaming'),
    type: 'dream',
    status: 'running',
    phase: 'starting',
    sessionsReviewing: opts.sessionsReviewing,
    filesTouched: [],
    turns: [],
    abortController: opts.abortController,
    priorMtime: opts.priorMtime,
  }
  registerTask(task, setAppState)
  return id
}

export function addDreamTurn(
  taskId: string,
  turn: DreamTurn,
  touchedPaths: string[],
  setAppState: SetAppState,
): void {
  updateTaskState<DreamTaskState>(taskId, setAppState, task => {
    const seen = new Set(task.filesTouched)
    const newTouched = touchedPaths.filter(p => !seen.has(p) && seen.add(p))
    
    
    if (
      turn.text === '' &&
      turn.toolUseCount === 0 &&
      newTouched.length === 0
    ) {
      return task
    }
    return {
      ...task,
      phase: newTouched.length > 0 ? 'updating' : task.phase,
      filesTouched:
        newTouched.length > 0
          ? [...task.filesTouched, ...newTouched]
          : task.filesTouched,
      turns: task.turns.slice(-(MAX_TURNS - 1)).concat(turn),
    }
  })
}

export function completeDreamTask(
  taskId: string,
  setAppState: SetAppState,
): void {
  
  
  
  updateTaskState<DreamTaskState>(taskId, setAppState, task => ({
    ...task,
    status: 'completed',
    endTime: Date.now(),
    notified: true,
    abortController: undefined,
  }))
}

export function failDreamTask(taskId: string, setAppState: SetAppState): void {
  updateTaskState<DreamTaskState>(taskId, setAppState, task => ({
    ...task,
    status: 'failed',
    endTime: Date.now(),
    notified: true,
    abortController: undefined,
  }))
}

export const DreamTask: Task = {
  name: 'DreamTask',
  type: 'dream',

  async kill(taskId, setAppState) {
    let priorMtime: number | undefined
    updateTaskState<DreamTaskState>(taskId, setAppState, task => {
      if (task.status !== 'running') return task
      task.abortController?.abort()
      priorMtime = task.priorMtime
      return {
        ...task,
        status: 'killed',
        endTime: Date.now(),
        notified: true,
        abortController: undefined,
      }
    })
    
    
    
    if (priorMtime !== undefined) {
      await rollbackConsolidationLock(priorMtime)
    }
  },
}
