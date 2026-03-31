import { randomUUID } from 'crypto'
import { copyFile, writeFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { join, resolve, sep } from 'path'
import type { AgentId, SessionId } from 'src/types/ids.js'
import type { LogOption } from 'src/types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  SystemFileSnapshotMessage,
  UserMessage,
} from 'src/types/message.js'
import { getPlanSlugCache, getSessionId } from '../bootstrap/state.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../tools/ExitPlanModeTool/constants.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'
import { getEnvironmentKind } from './filePersistence/outputsScanner.js'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'
import { getInitialSettings } from './settings/settings.js'
import { generateWordSlug } from './words.js'

const MAX_SLUG_RETRIES = 10

export function getPlanSlug(sessionId?: SessionId): string {
  const id = sessionId ?? getSessionId()
  const cache = getPlanSlugCache()
  let slug = cache.get(id)
  if (!slug) {
    const plansDir = getPlansDirectory()
    
    for (let i = 0; i < MAX_SLUG_RETRIES; i++) {
      slug = generateWordSlug()
      const filePath = join(plansDir, `${slug}.md`)
      if (!getFsImplementation().existsSync(filePath)) {
        break
      }
    }
    cache.set(id, slug!)
  }
  return slug!
}

export function setPlanSlug(sessionId: SessionId, slug: string): void {
  getPlanSlugCache().set(sessionId, slug)
}

export function clearPlanSlug(sessionId?: SessionId): void {
  const id = sessionId ?? getSessionId()
  getPlanSlugCache().delete(id)
}

export function clearAllPlanSlugs(): void {
  getPlanSlugCache().clear()
}

export const getPlansDirectory = memoize(function getPlansDirectory(): string {
  const settings = getInitialSettings()
  const settingsDir = settings.plansDirectory
  let plansPath: string

  if (settingsDir) {
    
    const cwd = getCwd()
    const resolved = resolve(cwd, settingsDir)

    
    if (!resolved.startsWith(cwd + sep) && resolved !== cwd) {
      logError(
        new Error(`plansDirectory must be within project root: ${settingsDir}`),
      )
      plansPath = join(getClaudeConfigHomeDir(), 'plans')
    } else {
      plansPath = resolved
    }
  } else {
    
    plansPath = join(getClaudeConfigHomeDir(), 'plans')
  }

  
  try {
    getFsImplementation().mkdirSync(plansPath)
  } catch (error) {
    logError(error)
  }

  return plansPath
})

export function getPlanFilePath(agentId?: AgentId): string {
  const planSlug = getPlanSlug(getSessionId())

  
  if (!agentId) {
    return join(getPlansDirectory(), `${planSlug}.md`)
  }

  
  return join(getPlansDirectory(), `${planSlug}-agent-${agentId}.md`)
}

export function getPlan(agentId?: AgentId): string | null {
  const filePath = getPlanFilePath(agentId)
  try {
    return getFsImplementation().readFileSync(filePath, { encoding: 'utf-8' })
  } catch (error) {
    if (isENOENT(error)) return null
    logError(error)
    return null
  }
}

function getSlugFromLog(log: LogOption): string | undefined {
  return log.messages.find(m => m.slug)?.slug
}

export async function copyPlanForResume(
  log: LogOption,
  targetSessionId?: SessionId,
): Promise<boolean> {
  const slug = getSlugFromLog(log)
  if (!slug) {
    return false
  }

  
  const sessionId = targetSessionId ?? getSessionId()
  setPlanSlug(sessionId, slug)

  
  const planPath = join(getPlansDirectory(), `${slug}.md`)
  try {
    await getFsImplementation().readFile(planPath, { encoding: 'utf-8' })
    return true
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      
      logError(e)
      return false
    }
    
    if (getEnvironmentKind() === null) {
      return false
    }

    logForDebugging(
      `Plan file missing during resume: ${planPath}. Attempting recovery.`,
    )

    
    const snapshotPlan = findFileSnapshotEntry(log.messages, 'plan')
    let recovered: string | null = null
    if (snapshotPlan && snapshotPlan.content.length > 0) {
      recovered = snapshotPlan.content
      logForDebugging(
        `Plan recovered from file snapshot, ${recovered.length} chars`,
        { level: 'info' },
      )
    } else {
      
      recovered = recoverPlanFromMessages(log)
      if (recovered) {
        logForDebugging(
          `Plan recovered from message history, ${recovered.length} chars`,
          { level: 'info' },
        )
      }
    }

    if (recovered) {
      try {
        await writeFile(planPath, recovered, { encoding: 'utf-8' })
        return true
      } catch (writeError) {
        logError(writeError)
        return false
      }
    }
    logForDebugging(
      'Plan file recovery failed: no file snapshot or plan content found in message history',
    )
    return false
  }
}

export async function copyPlanForFork(
  log: LogOption,
  targetSessionId: SessionId,
): Promise<boolean> {
  const originalSlug = getSlugFromLog(log)
  if (!originalSlug) {
    return false
  }

  const plansDir = getPlansDirectory()
  const originalPlanPath = join(plansDir, `${originalSlug}.md`)

  
  const newSlug = getPlanSlug(targetSessionId)
  const newPlanPath = join(plansDir, `${newSlug}.md`)
  try {
    await copyFile(originalPlanPath, newPlanPath)
    return true
  } catch (error) {
    if (isENOENT(error)) {
      return false
    }
    logError(error)
    return false
  }
}

function recoverPlanFromMessages(log: LogOption): string | null {
  for (let i = log.messages.length - 1; i >= 0; i--) {
    const msg = log.messages[i]
    if (!msg) {
      continue
    }

    if (msg.type === 'assistant') {
      const { content } = (msg as AssistantMessage).message
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block.type === 'tool_use' &&
            block.name === EXIT_PLAN_MODE_V2_TOOL_NAME
          ) {
            const input = block.input as Record<string, unknown> | undefined
            const plan = input?.plan
            if (typeof plan === 'string' && plan.length > 0) {
              return plan
            }
          }
        }
      }
    }

    if (msg.type === 'user') {
      const userMsg = msg as UserMessage
      if (
        typeof userMsg.planContent === 'string' &&
        userMsg.planContent.length > 0
      ) {
        return userMsg.planContent
      }
    }

    if (msg.type === 'attachment') {
      const attachmentMsg = msg as AttachmentMessage
      if (attachmentMsg.attachment?.type === 'plan_file_reference') {
        const plan = (attachmentMsg.attachment as { planContent?: string })
          .planContent
        if (typeof plan === 'string' && plan.length > 0) {
          return plan
        }
      }
    }
  }
  return null
}

function findFileSnapshotEntry(
  messages: LogOption['messages'],
  key: string,
): { key: string; path: string; content: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (
      msg?.type === 'system' &&
      'subtype' in msg &&
      msg.subtype === 'file_snapshot' &&
      'snapshotFiles' in msg
    ) {
      const files = msg.snapshotFiles as Array<{
        key: string
        path: string
        content: string
      }>
      return files.find(f => f.key === key)
    }
  }
  return undefined
}

export async function persistFileSnapshotIfRemote(): Promise<void> {
  if (getEnvironmentKind() === null) {
    return
  }
  try {
    const snapshotFiles: SystemFileSnapshotMessage['snapshotFiles'] = []

    
    const plan = getPlan()
    if (plan) {
      snapshotFiles.push({
        key: 'plan',
        path: getPlanFilePath(),
        content: plan,
      })
    }

    if (snapshotFiles.length === 0) {
      return
    }

    const message: SystemFileSnapshotMessage = {
      type: 'system',
      subtype: 'file_snapshot',
      content: 'File snapshot',
      level: 'info',
      isMeta: true,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      snapshotFiles,
    }

    const { recordTranscript } = await import('./sessionStorage.js')
    await recordTranscript([message])
  } catch (error) {
    logError(error)
  }
}
