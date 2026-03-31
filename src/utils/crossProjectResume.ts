import { sep } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import type { LogOption } from '../types/logs.js'
import { quote } from './bash/shellQuote.js'
import { getSessionIdFromLog } from './sessionStorage.js'

export type CrossProjectResumeResult =
  | {
      isCrossProject: false
    }
  | {
      isCrossProject: true
      isSameRepoWorktree: true
      projectPath: string
    }
  | {
      isCrossProject: true
      isSameRepoWorktree: false
      command: string
      projectPath: string
    }

export function checkCrossProjectResume(
  log: LogOption,
  showAllProjects: boolean,
  worktreePaths: string[],
): CrossProjectResumeResult {
  const currentCwd = getOriginalCwd()

  if (!showAllProjects || !log.projectPath || log.projectPath === currentCwd) {
    return { isCrossProject: false }
  }

  
  if (process.env.USER_TYPE !== 'ant') {
    const sessionId = getSessionIdFromLog(log)
    const command = `cd ${quote([log.projectPath])} && claude --resume ${sessionId}`
    return {
      isCrossProject: true,
      isSameRepoWorktree: false,
      command,
      projectPath: log.projectPath,
    }
  }

  
  const isSameRepo = worktreePaths.some(
    wt => log.projectPath === wt || log.projectPath!.startsWith(wt + sep),
  )

  if (isSameRepo) {
    return {
      isCrossProject: true,
      isSameRepoWorktree: true,
      projectPath: log.projectPath,
    }
  }

  
  const sessionId = getSessionIdFromLog(log)
  const command = `cd ${quote([log.projectPath])} && claude --resume ${sessionId}`
  return {
    isCrossProject: true,
    isSameRepoWorktree: false,
    command,
    projectPath: log.projectPath,
  }
}
