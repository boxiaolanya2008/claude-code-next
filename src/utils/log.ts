import { feature } from "../utils/bundle-mock.ts"
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { readdir, readFile, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join } from 'path'
import type { QuerySource } from 'src/constants/querySource.js'
import {
  setLastAPIRequest,
  setLastAPIRequestMessages,
} from '../bootstrap/state.js'
import { TICK_TAG } from '../constants/xml.js'
import {
  type LogOption,
  type SerializedMessage,
  sortLogs,
} from '../types/logs.js'
import { CACHE_PATHS } from './cachePaths.js'
import { stripDisplayTags, stripDisplayTagsAllowEmpty } from './displayTags.js'
import { isEnvTruthy } from './envUtils.js'
import { toError } from './errors.js'
import { isEssentialTrafficOnly } from './privacyLevel.js'
import { jsonParse } from './slowOperations.js'

export function getLogDisplayTitle(
  log: LogOption,
  defaultTitle?: string,
): string {
  
  const isAutonomousPrompt = log.firstPrompt?.startsWith(`<${TICK_TAG}>`)
  
  
  
  
  
  const strippedFirstPrompt = log.firstPrompt
    ? stripDisplayTagsAllowEmpty(log.firstPrompt)
    : ''
  const useFirstPrompt = strippedFirstPrompt && !isAutonomousPrompt
  const title =
    log.agentName ||
    log.customTitle ||
    log.summary ||
    (useFirstPrompt ? strippedFirstPrompt : undefined) ||
    defaultTitle ||
    
    (isAutonomousPrompt ? 'Autonomous session' : undefined) ||
    
    (log.sessionId ? log.sessionId.slice(0, 8) : '') ||
    ''
  
  return stripDisplayTags(title).trim()
}

export function dateToFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

const MAX_IN_MEMORY_ERRORS = 100
let inMemoryErrorLog: Array<{ error: string; timestamp: string }> = []

function addToInMemoryErrorLog(errorInfo: {
  error: string
  timestamp: string
}): void {
  if (inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {
    inMemoryErrorLog.shift() 
  }
  inMemoryErrorLog.push(errorInfo)
}

export type ErrorLogSink = {
  logError: (error: Error) => void
  logMCPError: (serverName: string, error: unknown) => void
  logMCPDebug: (serverName: string, message: string) => void
  getErrorsPath: () => string
  getMCPLogsPath: (serverName: string) => string
}

type QueuedErrorEvent =
  | { type: 'error'; error: Error }
  | { type: 'mcpError'; serverName: string; error: unknown }
  | { type: 'mcpDebug'; serverName: string; message: string }

const errorQueue: QueuedErrorEvent[] = []

let errorLogSink: ErrorLogSink | null = null

export function attachErrorLogSink(newSink: ErrorLogSink): void {
  if (errorLogSink !== null) {
    return
  }
  errorLogSink = newSink

  
  if (errorQueue.length > 0) {
    const queuedEvents = [...errorQueue]
    errorQueue.length = 0

    for (const event of queuedEvents) {
      switch (event.type) {
        case 'error':
          errorLogSink.logError(event.error)
          break
        case 'mcpError':
          errorLogSink.logMCPError(event.serverName, event.error)
          break
        case 'mcpDebug':
          errorLogSink.logMCPDebug(event.serverName, event.message)
          break
      }
    }
  }
}

const isHardFailMode = memoize((): boolean => {
  return process.argv.includes('--hard-fail')
})

export function logError(error: unknown): void {
  const err = toError(error)
  if (feature('HARD_FAIL') && isHardFailMode()) {
    
    console.error('[HARD FAIL] logError called with:', err.stack || err.message)
    
    process.exit(1)
  }
  try {
    
    if (
      
      isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_BEDROCK) ||
      isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_VERTEX) ||
      isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_FOUNDRY) ||
      process.env.DISABLE_ERROR_REPORTING ||
      isEssentialTrafficOnly()
    ) {
      return
    }

    const errorStr = err.stack || err.message

    const errorInfo = {
      error: errorStr,
      timestamp: new Date().toISOString(),
    }

    
    addToInMemoryErrorLog(errorInfo)

    
    if (errorLogSink === null) {
      errorQueue.push({ type: 'error', error: err })
      return
    }

    errorLogSink.logError(err)
  } catch {
    
  }
}

export function getInMemoryErrors(): { error: string; timestamp: string }[] {
  return [...inMemoryErrorLog]
}

export function loadErrorLogs(): Promise<LogOption[]> {
  return loadLogList(CACHE_PATHS.errors())
}

export async function getErrorLogByIndex(
  index: number,
): Promise<LogOption | null> {
  const logs = await loadErrorLogs()
  return logs[index] || null
}

async function loadLogList(path: string): Promise<LogOption[]> {
  let files: Awaited<ReturnType<typeof readdir>>
  try {
    files = await readdir(path, { withFileTypes: true })
  } catch {
    logError(new Error(`No logs found at ${path}`))
    return []
  }
  const logData = await Promise.all(
    files.map(async (file, i) => {
      const fullPath = join(path, file.name)
      const content = await readFile(fullPath, { encoding: 'utf8' })
      const messages = jsonParse(content) as SerializedMessage[]
      const firstMessage = messages[0]
      const lastMessage = messages[messages.length - 1]
      const firstPrompt =
        firstMessage?.type === 'user' &&
        typeof firstMessage?.message?.content === 'string'
          ? firstMessage?.message?.content
          : 'No prompt'

      
      const fileStats = await stat(fullPath)

      
      const isSidechain = fullPath.includes('sidechain')

      
      const date = dateToFilename(fileStats.mtime)

      return {
        date,
        fullPath,
        messages,
        value: i, 
        created: parseISOString(firstMessage?.timestamp || date),
        modified: lastMessage?.timestamp
          ? parseISOString(lastMessage.timestamp)
          : parseISOString(date),
        firstPrompt:
          firstPrompt.split('\n')[0]?.slice(0, 50) +
            (firstPrompt.length > 50 ? '…' : '') || 'No prompt',
        messageCount: messages.length,
        isSidechain,
      }
    }),
  )

  return sortLogs(logData.filter(_ => _ !== null)).map((_, i) => ({
    ..._,
    value: i,
  }))
}

function parseISOString(s: string): Date {
  const b = s.split(/\D+/)
  return new Date(
    Date.UTC(
      parseInt(b[0]!, 10),
      parseInt(b[1]!, 10) - 1,
      parseInt(b[2]!, 10),
      parseInt(b[3]!, 10),
      parseInt(b[4]!, 10),
      parseInt(b[5]!, 10),
      parseInt(b[6]!, 10),
    ),
  )
}

export function logMCPError(serverName: string, error: unknown): void {
  try {
    
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpError', serverName, error })
      return
    }

    errorLogSink.logMCPError(serverName, error)
  } catch {
    
  }
}

export function logMCPDebug(serverName: string, message: string): void {
  try {
    
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpDebug', serverName, message })
      return
    }

    errorLogSink.logMCPDebug(serverName, message)
  } catch {
    
  }
}

export function captureAPIRequest(
  params: BetaMessageStreamParams,
  querySource?: QuerySource,
): void {
  
  
  if (!querySource || !querySource.startsWith('repl_main_thread')) {
    return
  }

  
  
  
  const { messages, ...paramsWithoutMessages } = params
  setLastAPIRequest(paramsWithoutMessages)
  
  
  
  
  
  setLastAPIRequestMessages(process.env.USER_TYPE === 'ant' ? messages : null)
}

export function _resetErrorLogForTesting(): void {
  errorLogSink = null
  errorQueue.length = 0
  inMemoryErrorLog = []
}
