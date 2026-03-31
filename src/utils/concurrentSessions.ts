import { feature } from "../utils/bundle-mock.ts"
import { chmod, mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  getOriginalCwd,
  getSessionId,
  onSessionSwitch,
} from '../bootstrap/state.js'
import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { errorMessage, isFsInaccessible } from './errors.js'
import { isProcessRunning } from './genericProcessUtils.js'
import { getPlatform } from './platform.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import { getAgentId } from './teammate.js'

export type SessionKind = 'interactive' | 'bg' | 'daemon' | 'daemon-worker'
export type SessionStatus = 'busy' | 'idle' | 'waiting'

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

function envSessionKind(): SessionKind | undefined {
  if (feature('BG_SESSIONS')) {
    const k = process.env.CLAUDE_CODE_NEXT_SESSION_KIND
    if (k === 'bg' || k === 'daemon' || k === 'daemon-worker') return k
  }
  return undefined
}

export function isBgSession(): boolean {
  return envSessionKind() === 'bg'
}

export async function registerSession(): Promise<boolean> {
  if (getAgentId() != null) return false

  const kind: SessionKind = envSessionKind() ?? 'interactive'
  const dir = getSessionsDir()
  const pidFile = join(dir, `${process.pid}.json`)

  registerCleanup(async () => {
    try {
      await unlink(pidFile)
    } catch {
      
    }
  })

  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    await writeFile(
      pidFile,
      jsonStringify({
        pid: process.pid,
        sessionId: getSessionId(),
        cwd: getOriginalCwd(),
        startedAt: Date.now(),
        kind,
        entrypoint: process.env.CLAUDE_CODE_NEXT_ENTRYPOINT,
        ...(feature('UDS_INBOX')
          ? { messagingSocketPath: process.env.CLAUDE_CODE_NEXT_MESSAGING_SOCKET }
          : {}),
        ...(feature('BG_SESSIONS')
          ? {
              name: process.env.CLAUDE_CODE_NEXT_SESSION_NAME,
              logPath: process.env.CLAUDE_CODE_NEXT_SESSION_LOG,
              agent: process.env.CLAUDE_CODE_NEXT_AGENT,
            }
          : {}),
      }),
    )
    
    
    
    onSessionSwitch(id => {
      void updatePidFile({ sessionId: id })
    })
    return true
  } catch (e) {
    logForDebugging(`[concurrentSessions] register failed: ${errorMessage(e)}`)
    return false
  }
}

async function updatePidFile(patch: Record<string, unknown>): Promise<void> {
  const pidFile = join(getSessionsDir(), `${process.pid}.json`)
  try {
    const data = jsonParse(await readFile(pidFile, 'utf8')) as Record<
      string,
      unknown
    >
    await writeFile(pidFile, jsonStringify({ ...data, ...patch }))
  } catch (e) {
    logForDebugging(
      `[concurrentSessions] updatePidFile failed: ${errorMessage(e)}`,
    )
  }
}

export async function updateSessionName(
  name: string | undefined,
): Promise<void> {
  if (!name) return
  await updatePidFile({ name })
}

export async function updateSessionBridgeId(
  bridgeSessionId: string | null,
): Promise<void> {
  await updatePidFile({ bridgeSessionId })
}

export async function updateSessionActivity(patch: {
  status?: SessionStatus
  waitingFor?: string
}): Promise<void> {
  if (!feature('BG_SESSIONS')) return
  await updatePidFile({ ...patch, updatedAt: Date.now() })
}

export async function countConcurrentSessions(): Promise<number> {
  const dir = getSessionsDir()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch (e) {
    if (!isFsInaccessible(e)) {
      logForDebugging(`[concurrentSessions] readdir failed: ${errorMessage(e)}`)
    }
    return 0
  }

  let count = 0
  for (const file of files) {
    
    
    
    
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (pid === process.pid) {
      count++
      continue
    }
    if (isProcessRunning(pid)) {
      count++
    } else if (getPlatform() !== 'wsl') {
      
      
      
      
      
      void unlink(join(dir, file)).catch(() => {})
    }
  }
  return count
}
