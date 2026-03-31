

import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  createUserMessage,
  createMemorySavedMessage,
} from '../../utils/messages.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import type { ToolUseContext } from '../../Tool.js'
import { logEvent } from '../analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { isAutoMemoryEnabled, getAutoMemPath } from '../../memdir/paths.js'
import { isAutoDreamEnabled } from './config.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import {
  getOriginalCwd,
  getKairosActive,
  getIsRemoteMode,
  getSessionId,
} from '../../bootstrap/state.js'
import { createAutoMemCanUseTool } from '../extractMemories/extractMemories.js'
import { buildConsolidationPrompt } from './consolidationPrompt.js'
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
} from './consolidationLock.js'
import {
  registerDreamTask,
  addDreamTurn,
  completeDreamTask,
  failDreamTask,
  isDreamTask,
} from '../../tasks/DreamTask/DreamTask.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'

const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000

type AutoDreamConfig = {
  minHours: number
  minSessions: number
}

const DEFAULTS: AutoDreamConfig = {
  minHours: 24,
  minSessions: 5,
}

function getConfig(): AutoDreamConfig {
  const raw =
    getFeatureValue_CACHED_MAY_BE_STALE<Partial<AutoDreamConfig> | null>(
      'tengu_onyx_plover',
      null,
    )
  return {
    minHours:
      typeof raw?.minHours === 'number' &&
      Number.isFinite(raw.minHours) &&
      raw.minHours > 0
        ? raw.minHours
        : DEFAULTS.minHours,
    minSessions:
      typeof raw?.minSessions === 'number' &&
      Number.isFinite(raw.minSessions) &&
      raw.minSessions > 0
        ? raw.minSessions
        : DEFAULTS.minSessions,
  }
}

function isGateOpen(): boolean {
  if (getKairosActive()) return false 
  if (getIsRemoteMode()) return false
  if (!isAutoMemoryEnabled()) return false
  return isAutoDreamEnabled()
}

function isForced(): boolean {
  return false
}

type AppendSystemMessageFn = NonNullable<ToolUseContext['appendSystemMessage']>

let runner:
  | ((
      context: REPLHookContext,
      appendSystemMessage?: AppendSystemMessageFn,
    ) => Promise<void>)
  | null = null

export function initAutoDream(): void {
  let lastSessionScanAt = 0

  runner = async function runAutoDream(context, appendSystemMessage) {
    const cfg = getConfig()
    const force = isForced()
    if (!force && !isGateOpen()) return

    
    let lastAt: number
    try {
      lastAt = await readLastConsolidatedAt()
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] readLastConsolidatedAt failed: ${(e as Error).message}`,
      )
      return
    }
    const hoursSince = (Date.now() - lastAt) / 3_600_000
    if (!force && hoursSince < cfg.minHours) return

    
    const sinceScanMs = Date.now() - lastSessionScanAt
    if (!force && sinceScanMs < SESSION_SCAN_INTERVAL_MS) {
      logForDebugging(
        `[autoDream] scan throttle — time-gate passed but last scan was ${Math.round(sinceScanMs / 1000)}s ago`,
      )
      return
    }
    lastSessionScanAt = Date.now()

    
    let sessionIds: string[]
    try {
      sessionIds = await listSessionsTouchedSince(lastAt)
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] listSessionsTouchedSince failed: ${(e as Error).message}`,
      )
      return
    }
    
    const currentSession = getSessionId()
    sessionIds = sessionIds.filter(id => id !== currentSession)
    if (!force && sessionIds.length < cfg.minSessions) {
      logForDebugging(
        `[autoDream] skip — ${sessionIds.length} sessions since last consolidation, need ${cfg.minSessions}`,
      )
      return
    }

    
    
    
    
    let priorMtime: number | null
    if (force) {
      priorMtime = lastAt
    } else {
      try {
        priorMtime = await tryAcquireConsolidationLock()
      } catch (e: unknown) {
        logForDebugging(
          `[autoDream] lock acquire failed: ${(e as Error).message}`,
        )
        return
      }
      if (priorMtime === null) return
    }

    logForDebugging(
      `[autoDream] firing — ${hoursSince.toFixed(1)}h since last, ${sessionIds.length} sessions to review`,
    )
    logEvent('tengu_auto_dream_fired', {
      hours_since: Math.round(hoursSince),
      sessions_since: sessionIds.length,
    })

    const setAppState =
      context.toolUseContext.setAppStateForTasks ??
      context.toolUseContext.setAppState
    const abortController = new AbortController()
    const taskId = registerDreamTask(setAppState, {
      sessionsReviewing: sessionIds.length,
      priorMtime,
      abortController,
    })

    try {
      const memoryRoot = getAutoMemPath()
      const transcriptDir = getProjectDir(getOriginalCwd())
      
      
      
      const extra = `

**Tool constraints for this run:** Bash is restricted to read-only commands (\`ls\`, \`find\`, \`grep\`, \`cat\`, \`stat\`, \`wc\`, \`head\`, \`tail\`, and similar). Anything that writes, redirects to a file, or modifies state will be denied. Plan your exploration with this in mind — no need to probe.

Sessions since last consolidation (${sessionIds.length}):
${sessionIds.map(id => `- ${id}`).join('\n')}`
      const prompt = buildConsolidationPrompt(memoryRoot, transcriptDir, extra)

      const result = await runForkedAgent({
        promptMessages: [createUserMessage({ content: prompt })],
        cacheSafeParams: createCacheSafeParams(context),
        canUseTool: createAutoMemCanUseTool(memoryRoot),
        querySource: 'auto_dream',
        forkLabel: 'auto_dream',
        skipTranscript: true,
        overrides: { abortController },
        onMessage: makeDreamProgressWatcher(taskId, setAppState),
      })

      completeDreamTask(taskId, setAppState)
      
      
      const dreamState = context.toolUseContext.getAppState().tasks?.[taskId]
      if (
        appendSystemMessage &&
        isDreamTask(dreamState) &&
        dreamState.filesTouched.length > 0
      ) {
        appendSystemMessage({
          ...createMemorySavedMessage(dreamState.filesTouched),
          verb: 'Improved',
        })
      }
      logForDebugging(
        `[autoDream] completed — cache: read=${result.totalUsage.cache_read_input_tokens} created=${result.totalUsage.cache_creation_input_tokens}`,
      )
      logEvent('tengu_auto_dream_completed', {
        cache_read: result.totalUsage.cache_read_input_tokens,
        cache_created: result.totalUsage.cache_creation_input_tokens,
        output: result.totalUsage.output_tokens,
        sessions_reviewed: sessionIds.length,
      })
    } catch (e: unknown) {
      
      
      
      if (abortController.signal.aborted) {
        logForDebugging('[autoDream] aborted by user')
        return
      }
      logForDebugging(`[autoDream] fork failed: ${(e as Error).message}`)
      logEvent('tengu_auto_dream_failed', {})
      failDreamTask(taskId, setAppState)
      
      await rollbackConsolidationLock(priorMtime)
    }
  }
}

function makeDreamProgressWatcher(
  taskId: string,
  setAppState: import('../../Task.js').SetAppState,
): (msg: Message) => void {
  return msg => {
    if (msg.type !== 'assistant') return
    let text = ''
    let toolUseCount = 0
    const touchedPaths: string[] = []
    for (const block of msg.message.content) {
      if (block.type === 'text') {
        text += block.text
      } else if (block.type === 'tool_use') {
        toolUseCount++
        if (
          block.name === FILE_EDIT_TOOL_NAME ||
          block.name === FILE_WRITE_TOOL_NAME
        ) {
          const input = block.input as { file_path?: unknown }
          if (typeof input.file_path === 'string') {
            touchedPaths.push(input.file_path)
          }
        }
      }
    }
    addDreamTurn(
      taskId,
      { text: text.trim(), toolUseCount },
      touchedPaths,
      setAppState,
    )
  }
}

export async function executeAutoDream(
  context: REPLHookContext,
  appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {
  await runner?.(context, appendSystemMessage)
}
