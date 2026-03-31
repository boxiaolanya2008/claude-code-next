import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import type { Dirent } from 'fs'

import { closeSync, fstatSync, openSync, readSync } from 'fs'
import {
  appendFile as fsAppendFile,
  open as fsOpen,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { basename, dirname, join } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  getOriginalCwd,
  getPlanSlugCache,
  getPromptId,
  getSessionId,
  getSessionProjectDir,
  isSessionPersistenceDisabled,
  switchSession,
} from '../bootstrap/state.js'
import { builtInCommandNames } from '../commands.js'
import { COMMAND_NAME_TAG, TICK_TAG } from '../constants/xml.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import * as sessionIngress from '../services/api/sessionIngress.js'
import { REPL_TOOL_NAME } from '../tools/REPLTool/constants.js'
import {
  type AgentId,
  asAgentId,
  asSessionId,
  type SessionId,
} from '../types/ids.js'
import type { AttributionSnapshotMessage } from '../types/logs.js'
import {
  type ContentReplacementEntry,
  type ContextCollapseCommitEntry,
  type ContextCollapseSnapshotEntry,
  type Entry,
  type FileHistorySnapshotMessage,
  type LogOption,
  type PersistedWorktreeSession,
  type SerializedMessage,
  sortLogs,
  type TranscriptMessage,
} from '../types/logs.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from '../types/message.js'
import type { QueueOperationMessage } from '../types/messageQueueTypes.js'
import { uniq } from './array.js'
import { registerCleanup } from './cleanupRegistry.js'
import { updateSessionName } from './concurrentSessions.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { isFsInaccessible } from './errors.js'
import type { FileHistorySnapshot } from './fileHistory.js'
import { formatFileSize } from './format.js'
import { getFsImplementation } from './fsOperations.js'
import { getWorktreePaths } from './getWorktreePaths.js'
import { getBranch } from './git.js'
import { gracefulShutdownSync, isShuttingDown } from './gracefulShutdown.js'
import { parseJSONL } from './json.js'
import { logError } from './log.js'
import { extractTag, isCompactBoundaryMessage } from './messages.js'
import { sanitizePath } from './path.js'
import {
  extractJsonStringField,
  extractLastJsonStringField,
  LITE_READ_BUF_SIZE,
  readHeadAndTail,
  readTranscriptForLoad,
  SKIP_PRECOMPACT_THRESHOLD,
} from './sessionStoragePortable.js'
import { getSettings_DEPRECATED } from './settings/settings.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import type { ContentReplacementRecord } from './toolResultStorage.js'
import { validateUuid } from './uuid.js'

const VERSION = typeof MACRO !== 'undefined' ? MACRO.VERSION : 'unknown'

type Transcript = (
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
)[]

const MAX_TOMBSTONE_REWRITE_BYTES = 50 * 1024 * 1024

const SKIP_FIRST_PROMPT_PATTERN =
  /^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/

export function isTranscriptMessage(entry: Entry): entry is TranscriptMessage {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    entry.type === 'system'
  )
}

export function isChainParticipant(m: Pick<Message, 'type'>): boolean {
  return m.type !== 'progress'
}

type LegacyProgressEntry = {
  type: 'progress'
  uuid: UUID
  parentUuid: UUID | null
}

function isLegacyProgressEntry(entry: unknown): entry is LegacyProgressEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'type' in entry &&
    entry.type === 'progress' &&
    'uuid' in entry &&
    typeof entry.uuid === 'string'
  )
}

const EPHEMERAL_PROGRESS_TYPES = new Set([
  'bash_progress',
  'powershell_progress',
  'mcp_progress',
  ...(feature('PROACTIVE') || feature('KAIROS')
    ? (['sleep_progress'] as const)
    : []),
])
export function isEphemeralToolProgress(dataType: unknown): boolean {
  return typeof dataType === 'string' && EPHEMERAL_PROGRESS_TYPES.has(dataType)
}

export function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

export function getTranscriptPath(): string {
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, `${getSessionId()}.jsonl`)
}

export function getTranscriptPathForSession(sessionId: string): string {
  
  
  
  
  
  
  
  
  
  
  
  
  if (sessionId === getSessionId()) {
    return getTranscriptPath()
  }
  const projectDir = getProjectDir(getOriginalCwd())
  return join(projectDir, `${sessionId}.jsonl`)
}

export const MAX_TRANSCRIPT_READ_BYTES = 50 * 1024 * 1024

const agentTranscriptSubdirs = new Map<string, string>()

export function setAgentTranscriptSubdir(
  agentId: string,
  subdir: string,
): void {
  agentTranscriptSubdirs.set(agentId, subdir)
}

export function clearAgentTranscriptSubdir(agentId: string): void {
  agentTranscriptSubdirs.delete(agentId)
}

export function getAgentTranscriptPath(agentId: AgentId): string {
  
  
  
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  const sessionId = getSessionId()
  const subdir = agentTranscriptSubdirs.get(agentId)
  const base = subdir
    ? join(projectDir, sessionId, 'subagents', subdir)
    : join(projectDir, sessionId, 'subagents')
  return join(base, `agent-${agentId}.jsonl`)
}

function getAgentMetadataPath(agentId: AgentId): string {
  return getAgentTranscriptPath(agentId).replace(/\.jsonl$/, '.meta.json')
}

export type AgentMetadata = {
  agentType: string
  
  worktreePath?: string
  

  description?: string
}

export async function writeAgentMetadata(
  agentId: AgentId,
  metadata: AgentMetadata,
): Promise<void> {
  const path = getAgentMetadataPath(agentId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(metadata))
}

export async function readAgentMetadata(
  agentId: AgentId,
): Promise<AgentMetadata | null> {
  const path = getAgentMetadataPath(agentId)
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as AgentMetadata
  } catch (e) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

export type RemoteAgentMetadata = {
  taskId: string
  remoteTaskType: string
  
  sessionId: string
  title: string
  command: string
  spawnedAt: number
  toolUseId?: string
  isLongRunning?: boolean
  isUltraplan?: boolean
  isRemoteReview?: boolean
  remoteTaskMetadata?: Record<string, unknown>
}

function getRemoteAgentsDir(): string {
  
  
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  return join(projectDir, getSessionId(), 'remote-agents')
}

function getRemoteAgentMetadataPath(taskId: string): string {
  return join(getRemoteAgentsDir(), `remote-agent-${taskId}.meta.json`)
}

export async function writeRemoteAgentMetadata(
  taskId: string,
  metadata: RemoteAgentMetadata,
): Promise<void> {
  const path = getRemoteAgentMetadataPath(taskId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(metadata))
}

export async function readRemoteAgentMetadata(
  taskId: string,
): Promise<RemoteAgentMetadata | null> {
  const path = getRemoteAgentMetadataPath(taskId)
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as RemoteAgentMetadata
  } catch (e) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

export async function deleteRemoteAgentMetadata(taskId: string): Promise<void> {
  const path = getRemoteAgentMetadataPath(taskId)
  try {
    await unlink(path)
  } catch (e) {
    if (isFsInaccessible(e)) return
    throw e
  }
}

export async function listRemoteAgentMetadata(): Promise<
  RemoteAgentMetadata[]
> {
  const dir = getRemoteAgentsDir()
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    if (isFsInaccessible(e)) return []
    throw e
  }
  const results: RemoteAgentMetadata[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.meta.json')) continue
    try {
      const raw = await readFile(join(dir, entry.name), 'utf-8')
      results.push(JSON.parse(raw) as RemoteAgentMetadata)
    } catch (e) {
      
      
      logForDebugging(
        `listRemoteAgentMetadata: skipping ${entry.name}: ${String(e)}`,
      )
    }
  }
  return results
}

export function sessionIdExists(sessionId: string): boolean {
  const projectDir = getProjectDir(getOriginalCwd())
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)
  const fs = getFsImplementation()
  try {
    fs.statSync(sessionFile)
    return true
  } catch {
    return false
  }
}

export function getNodeEnv(): string {
  return process.env.NODE_ENV || 'development'
}

export function getUserType(): string {
  return process.env.USER_TYPE || 'external'
}

function getEntrypoint(): string | undefined {
  return process.env.CLAUDE_CODE_NEXT_ENTRYPOINT
}

export function isCustomTitleEnabled(): boolean {
  return true
}

export const getProjectDir = memoize((projectDir: string): string => {
  return join(getProjectsDir(), sanitizePath(projectDir))
})

let project: Project | null = null
let cleanupRegistered = false

function getProject(): Project {
  if (!project) {
    project = new Project()

    
    if (!cleanupRegistered) {
      registerCleanup(async () => {
        
        
        
        
        
        
        await project?.flush()
        try {
          project?.reAppendSessionMetadata()
        } catch {
          
        }
      })
      cleanupRegistered = true
    }
  }
  return project
}

export function resetProjectFlushStateForTesting(): void {
  project?._resetFlushState()
}

export function resetProjectForTesting(): void {
  project = null
}

export function setSessionFileForTesting(path: string): void {
  getProject().sessionFile = path
}

type InternalEventWriter = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: { isCompaction?: boolean; agentId?: string },
) => Promise<void>

export function setInternalEventWriter(writer: InternalEventWriter): void {
  getProject().setInternalEventWriter(writer)
}

type InternalEventReader = () => Promise<
  { payload: Record<string, unknown>; agent_id?: string }[] | null
>

export function setInternalEventReader(
  reader: InternalEventReader,
  subagentReader: InternalEventReader,
): void {
  getProject().setInternalEventReader(reader)
  getProject().setInternalSubagentEventReader(subagentReader)
}

export function setRemoteIngressUrlForTesting(url: string): void {
  getProject().setRemoteIngressUrl(url)
}

const REMOTE_FLUSH_INTERVAL_MS = 10

class Project {
  
  currentSessionTag: string | undefined
  currentSessionTitle: string | undefined
  currentSessionAgentName: string | undefined
  currentSessionAgentColor: string | undefined
  currentSessionLastPrompt: string | undefined
  currentSessionAgentSetting: string | undefined
  currentSessionMode: 'coordinator' | 'normal' | undefined
  
  
  
  currentSessionWorktree: PersistedWorktreeSession | null | undefined
  currentSessionPrNumber: number | undefined
  currentSessionPrUrl: string | undefined
  currentSessionPrRepository: string | undefined

  sessionFile: string | null = null
  
  
  private pendingEntries: Entry[] = []
  private remoteIngressUrl: string | null = null
  private internalEventWriter: InternalEventWriter | null = null
  private internalEventReader: InternalEventReader | null = null
  private internalSubagentEventReader: InternalEventReader | null = null
  private pendingWriteCount: number = 0
  private flushResolvers: Array<() => void> = []
  
  
  private writeQueues = new Map<
    string,
    Array<{ entry: Entry; resolve: () => void }>
  >()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private activeDrain: Promise<void> | null = null
  private FLUSH_INTERVAL_MS = 100
  private readonly MAX_CHUNK_BYTES = 100 * 1024 * 1024

  constructor() {}

  
  _resetFlushState(): void {
    this.pendingWriteCount = 0
    this.flushResolvers = []
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    this.activeDrain = null
    this.writeQueues = new Map()
  }

  private incrementPendingWrites(): void {
    this.pendingWriteCount++
  }

  private decrementPendingWrites(): void {
    this.pendingWriteCount--
    if (this.pendingWriteCount === 0) {
      
      for (const resolve of this.flushResolvers) {
        resolve()
      }
      this.flushResolvers = []
    }
  }

  private async trackWrite<T>(fn: () => Promise<T>): Promise<T> {
    this.incrementPendingWrites()
    try {
      return await fn()
    } finally {
      this.decrementPendingWrites()
    }
  }

  private enqueueWrite(filePath: string, entry: Entry): Promise<void> {
    return new Promise<void>(resolve => {
      let queue = this.writeQueues.get(filePath)
      if (!queue) {
        queue = []
        this.writeQueues.set(filePath, queue)
      }
      queue.push({ entry, resolve })
      this.scheduleDrain()
    })
  }

  private scheduleDrain(): void {
    if (this.flushTimer) {
      return
    }
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null
      this.activeDrain = this.drainWriteQueue()
      await this.activeDrain
      this.activeDrain = null
      
      if (this.writeQueues.size > 0) {
        this.scheduleDrain()
      }
    }, this.FLUSH_INTERVAL_MS)
  }

  private async appendToFile(filePath: string, data: string): Promise<void> {
    try {
      await fsAppendFile(filePath, data, { mode: 0o600 })
    } catch {
      
      
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await fsAppendFile(filePath, data, { mode: 0o600 })
    }
  }

  private async drainWriteQueue(): Promise<void> {
    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) {
        continue
      }
      const batch = queue.splice(0)

      let content = ''
      const resolvers: Array<() => void> = []

      for (const { entry, resolve } of batch) {
        const line = jsonStringify(entry) + '\n'

        if (content.length + line.length >= this.MAX_CHUNK_BYTES) {
          
          await this.appendToFile(filePath, content)
          for (const r of resolvers) {
            r()
          }
          resolvers.length = 0
          content = ''
        }

        content += line
        resolvers.push(resolve)
      }

      if (content.length > 0) {
        await this.appendToFile(filePath, content)
        for (const r of resolvers) {
          r()
        }
      }
    }

    
    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) {
        this.writeQueues.delete(filePath)
      }
    }
  }

  resetSessionFile(): void {
    this.sessionFile = null
    this.pendingEntries = []
  }

  

  reAppendSessionMetadata(skipTitleRefresh = false): void {
    if (!this.sessionFile) return
    const sessionId = getSessionId() as UUID
    if (!sessionId) return

    
    
    
    const tail = readFileTailSync(this.sessionFile)

    
    
    
    
    
    
    
    
    const tailLines = tail.split('\n')
    if (!skipTitleRefresh) {
      const titleLine = tailLines.findLast(l =>
        l.startsWith('{"type":"custom-title"'),
      )
      if (titleLine) {
        const tailTitle = extractLastJsonStringField(titleLine, 'customTitle')
        
        
        
        
        if (tailTitle !== undefined) {
          this.currentSessionTitle = tailTitle || undefined
        }
      }
    }
    const tagLine = tailLines.findLast(l => l.startsWith('{"type":"tag"'))
    if (tagLine) {
      const tailTag = extractLastJsonStringField(tagLine, 'tag')
      
      if (tailTag !== undefined) {
        this.currentSessionTag = tailTag || undefined
      }
    }

    
    
    
    if (this.currentSessionLastPrompt) {
      appendEntryToFile(this.sessionFile, {
        type: 'last-prompt',
        lastPrompt: this.currentSessionLastPrompt,
        sessionId,
      })
    }
    
    
    if (this.currentSessionTitle) {
      appendEntryToFile(this.sessionFile, {
        type: 'custom-title',
        customTitle: this.currentSessionTitle,
        sessionId,
      })
    }
    if (this.currentSessionTag) {
      appendEntryToFile(this.sessionFile, {
        type: 'tag',
        tag: this.currentSessionTag,
        sessionId,
      })
    }
    if (this.currentSessionAgentName) {
      appendEntryToFile(this.sessionFile, {
        type: 'agent-name',
        agentName: this.currentSessionAgentName,
        sessionId,
      })
    }
    if (this.currentSessionAgentColor) {
      appendEntryToFile(this.sessionFile, {
        type: 'agent-color',
        agentColor: this.currentSessionAgentColor,
        sessionId,
      })
    }
    if (this.currentSessionAgentSetting) {
      appendEntryToFile(this.sessionFile, {
        type: 'agent-setting',
        agentSetting: this.currentSessionAgentSetting,
        sessionId,
      })
    }
    if (this.currentSessionMode) {
      appendEntryToFile(this.sessionFile, {
        type: 'mode',
        mode: this.currentSessionMode,
        sessionId,
      })
    }
    if (this.currentSessionWorktree !== undefined) {
      appendEntryToFile(this.sessionFile, {
        type: 'worktree-state',
        worktreeSession: this.currentSessionWorktree,
        sessionId,
      })
    }
    if (
      this.currentSessionPrNumber !== undefined &&
      this.currentSessionPrUrl &&
      this.currentSessionPrRepository
    ) {
      appendEntryToFile(this.sessionFile, {
        type: 'pr-link',
        sessionId,
        prNumber: this.currentSessionPrNumber,
        prUrl: this.currentSessionPrUrl,
        prRepository: this.currentSessionPrRepository,
        timestamp: new Date().toISOString(),
      })
    }
  }

  async flush(): Promise<void> {
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    
    if (this.activeDrain) {
      await this.activeDrain
    }
    
    await this.drainWriteQueue()

    
    if (this.pendingWriteCount === 0) {
      return
    }
    return new Promise<void>(resolve => {
      this.flushResolvers.push(resolve)
    })
  }

  

  async removeMessageByUuid(targetUuid: UUID): Promise<void> {
    return this.trackWrite(async () => {
      if (this.sessionFile === null) return
      try {
        let fileSize = 0
        const fh = await fsOpen(this.sessionFile, 'r+')
        try {
          const { size } = await fh.stat()
          fileSize = size
          if (size === 0) return

          const chunkLen = Math.min(size, LITE_READ_BUF_SIZE)
          const tailStart = size - chunkLen
          const buf = Buffer.allocUnsafe(chunkLen)
          const { bytesRead } = await fh.read(buf, 0, chunkLen, tailStart)
          const tail = buf.subarray(0, bytesRead)

          
          
          
          
          
          const needle = `"uuid":"${targetUuid}"`
          const matchIdx = tail.lastIndexOf(needle)

          if (matchIdx >= 0) {
            
            
            
            const prevNl = tail.lastIndexOf(0x0a, matchIdx)
            
            
            
            if (prevNl >= 0 || tailStart === 0) {
              const lineStart = prevNl + 1 
              const nextNl = tail.indexOf(0x0a, matchIdx + needle.length)
              const lineEnd = nextNl >= 0 ? nextNl + 1 : bytesRead

              const absLineStart = tailStart + lineStart
              const afterLen = bytesRead - lineEnd
              
              
              
              await fh.truncate(absLineStart)
              if (afterLen > 0) {
                await fh.write(tail, lineEnd, afterLen, absLineStart)
              }
              return
            }
          }
        } finally {
          await fh.close()
        }

        
        
        if (fileSize > MAX_TOMBSTONE_REWRITE_BYTES) {
          logForDebugging(
            `Skipping tombstone removal: session file too large (${formatFileSize(fileSize)})`,
            { level: 'warn' },
          )
          return
        }
        const content = await readFile(this.sessionFile, { encoding: 'utf-8' })
        const lines = content.split('\n').filter((line: string) => {
          if (!line.trim()) return true
          try {
            const entry = jsonParse(line)
            return entry.uuid !== targetUuid
          } catch {
            return true 
          }
        })
        await writeFile(this.sessionFile, lines.join('\n'), {
          encoding: 'utf8',
        })
      } catch {
        
      }
    })
  }

  

  private shouldSkipPersistence(): boolean {
    const allowTestPersistence = isEnvTruthy(
      process.env.TEST_ENABLE_SESSION_PERSISTENCE,
    )
    return (
      (getNodeEnv() === 'test' && !allowTestPersistence) ||
      getSettings_DEPRECATED()?.cleanupPeriodDays === 0 ||
      isSessionPersistenceDisabled() ||
      isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SKIP_PROMPT_HISTORY)
    )
  }

  

  private async materializeSessionFile(): Promise<void> {
    
    
    
    if (this.shouldSkipPersistence()) return
    this.ensureCurrentSessionFile()
    
    this.reAppendSessionMetadata()
    if (this.pendingEntries.length > 0) {
      const buffered = this.pendingEntries
      this.pendingEntries = []
      for (const entry of buffered) {
        await this.appendEntry(entry)
      }
    }
  }

  async insertMessageChain(
    messages: Transcript,
    isSidechain: boolean = false,
    agentId?: string,
    startingParentUuid?: UUID | null,
    teamInfo?: { teamName?: string; agentName?: string },
  ) {
    return this.trackWrite(async () => {
      let parentUuid: UUID | null = startingParentUuid ?? null

      
      
      if (
        this.sessionFile === null &&
        messages.some(m => m.type === 'user' || m.type === 'assistant')
      ) {
        await this.materializeSessionFile()
      }

      
      let gitBranch: string | undefined
      try {
        gitBranch = await getBranch()
      } catch {
        
        gitBranch = undefined
      }

      
      const sessionId = getSessionId()
      const slug = getPlanSlugCache().get(sessionId)

      for (const message of messages) {
        const isCompactBoundary = isCompactBoundaryMessage(message)

        
        
        let effectiveParentUuid = parentUuid
        if (
          message.type === 'user' &&
          'sourceToolAssistantUUID' in message &&
          message.sourceToolAssistantUUID
        ) {
          effectiveParentUuid = message.sourceToolAssistantUUID
        }

        const transcriptMessage: TranscriptMessage = {
          parentUuid: isCompactBoundary ? null : effectiveParentUuid,
          logicalParentUuid: isCompactBoundary ? parentUuid : undefined,
          isSidechain,
          teamName: teamInfo?.teamName,
          agentName: teamInfo?.agentName,
          promptId:
            message.type === 'user' ? (getPromptId() ?? undefined) : undefined,
          agentId,
          ...message,
          
          
          
          
          
          
          
          
          userType: getUserType(),
          entrypoint: getEntrypoint(),
          cwd: getCwd(),
          sessionId,
          version: VERSION,
          gitBranch,
          slug,
        }
        await this.appendEntry(transcriptMessage)
        if (isChainParticipant(message)) {
          parentUuid = message.uuid
        }
      }

      
      
      
      if (!isSidechain) {
        const text = getFirstMeaningfulUserMessageTextContent(messages)
        if (text) {
          const flat = text.replace(/\n/g, ' ').trim()
          this.currentSessionLastPrompt =
            flat.length > 200 ? flat.slice(0, 200).trim() + '…' : flat
        }
      }
    })
  }

  async insertFileHistorySnapshot(
    messageId: UUID,
    snapshot: FileHistorySnapshot,
    isSnapshotUpdate: boolean,
  ) {
    return this.trackWrite(async () => {
      const fileHistoryMessage: FileHistorySnapshotMessage = {
        type: 'file-history-snapshot',
        messageId,
        snapshot,
        isSnapshotUpdate,
      }
      await this.appendEntry(fileHistoryMessage)
    })
  }

  async insertQueueOperation(queueOp: QueueOperationMessage) {
    return this.trackWrite(async () => {
      await this.appendEntry(queueOp)
    })
  }

  async insertAttributionSnapshot(snapshot: AttributionSnapshotMessage) {
    return this.trackWrite(async () => {
      await this.appendEntry(snapshot)
    })
  }

  async insertContentReplacement(
    replacements: ContentReplacementRecord[],
    agentId?: AgentId,
  ) {
    return this.trackWrite(async () => {
      const entry: ContentReplacementEntry = {
        type: 'content-replacement',
        sessionId: getSessionId() as UUID,
        agentId,
        replacements,
      }
      await this.appendEntry(entry)
    })
  }

  async appendEntry(entry: Entry, sessionId: UUID = getSessionId() as UUID) {
    if (this.shouldSkipPersistence()) {
      return
    }

    const currentSessionId = getSessionId() as UUID
    const isCurrentSession = sessionId === currentSessionId

    let sessionFile: string
    if (isCurrentSession) {
      
      if (this.sessionFile === null) {
        this.pendingEntries.push(entry)
        return
      }
      sessionFile = this.sessionFile
    } else {
      const existing = await this.getExistingSessionFile(sessionId)
      if (!existing) {
        logError(
          new Error(
            `appendEntry: session file not found for other session ${sessionId}`,
          ),
        )
        return
      }
      sessionFile = existing
    }

    
    if (entry.type === 'summary') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'custom-title') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'ai-title') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'last-prompt') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'task-summary') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'tag') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'agent-name') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'agent-color') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'agent-setting') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'pr-link') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'file-history-snapshot') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'attribution-snapshot') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'speculation-accept') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'mode') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'worktree-state') {
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'content-replacement') {
      
      
      
      const targetFile = entry.agentId
        ? getAgentTranscriptPath(entry.agentId)
        : sessionFile
      void this.enqueueWrite(targetFile, entry)
    } else if (entry.type === 'marble-origami-commit') {
      
      
      
      void this.enqueueWrite(sessionFile, entry)
    } else if (entry.type === 'marble-origami-snapshot') {
      
      void this.enqueueWrite(sessionFile, entry)
    } else {
      const messageSet = await getSessionMessages(sessionId)
      if (entry.type === 'queue-operation') {
        
        void this.enqueueWrite(sessionFile, entry)
      } else {
        
        
        const isAgentSidechain =
          entry.isSidechain && entry.agentId !== undefined
        const targetFile = isAgentSidechain
          ? getAgentTranscriptPath(asAgentId(entry.agentId!))
          : sessionFile

        
        
        
        
        
        
        
        
        
        
        
        
        const isNewUuid = !messageSet.has(entry.uuid)
        if (isAgentSidechain || isNewUuid) {
          
          void this.enqueueWrite(targetFile, entry)

          if (!isAgentSidechain) {
            
            
            
            
            
            
            
            
            messageSet.add(entry.uuid)

            if (isTranscriptMessage(entry)) {
              await this.persistToRemote(sessionId, entry)
            }
          }
        }
      }
    }
  }

  

  private ensureCurrentSessionFile(): string {
    if (this.sessionFile === null) {
      this.sessionFile = getTranscriptPath()
    }

    return this.sessionFile
  }

  

  private existingSessionFiles = new Map<string, string>()
  private async getExistingSessionFile(
    sessionId: UUID,
  ): Promise<string | null> {
    const cached = this.existingSessionFiles.get(sessionId)
    if (cached) return cached

    const targetFile = getTranscriptPathForSession(sessionId)
    try {
      await stat(targetFile)
      this.existingSessionFiles.set(sessionId, targetFile)
      return targetFile
    } catch (e) {
      if (isFsInaccessible(e)) return null
      throw e
    }
  }

  private async persistToRemote(sessionId: UUID, entry: TranscriptMessage) {
    if (isShuttingDown()) {
      return
    }

    
    if (this.internalEventWriter) {
      try {
        await this.internalEventWriter(
          'transcript',
          entry as unknown as Record<string, unknown>,
          {
            ...(isCompactBoundaryMessage(entry) && { isCompaction: true }),
            ...(entry.agentId && { agentId: entry.agentId }),
          },
        )
      } catch {
        logEvent('tengu_session_persistence_failed', {})
        logForDebugging('Failed to write transcript as internal event')
      }
      return
    }

    
    if (
      !isEnvTruthy(process.env.ENABLE_SESSION_PERSISTENCE) ||
      !this.remoteIngressUrl
    ) {
      return
    }

    const success = await sessionIngress.appendSessionLog(
      sessionId,
      entry,
      this.remoteIngressUrl,
    )

    if (!success) {
      logEvent('tengu_session_persistence_failed', {})
      gracefulShutdownSync(1, 'other')
    }
  }

  setRemoteIngressUrl(url: string): void {
    this.remoteIngressUrl = url
    logForDebugging(`Remote persistence enabled with URL: ${url}`)
    if (url) {
      
      this.FLUSH_INTERVAL_MS = REMOTE_FLUSH_INTERVAL_MS
    }
  }

  setInternalEventWriter(writer: InternalEventWriter): void {
    this.internalEventWriter = writer
    logForDebugging(
      'CCR v2 internal event writer registered for transcript persistence',
    )
    
    this.FLUSH_INTERVAL_MS = REMOTE_FLUSH_INTERVAL_MS
  }

  setInternalEventReader(reader: InternalEventReader): void {
    this.internalEventReader = reader
    logForDebugging(
      'CCR v2 internal event reader registered for session resume',
    )
  }

  setInternalSubagentEventReader(reader: InternalEventReader): void {
    this.internalSubagentEventReader = reader
    logForDebugging(
      'CCR v2 subagent event reader registered for session resume',
    )
  }

  getInternalEventReader(): InternalEventReader | null {
    return this.internalEventReader
  }

  getInternalSubagentEventReader(): InternalEventReader | null {
    return this.internalSubagentEventReader
  }
}

export type TeamInfo = {
  teamName?: string
  agentName?: string
}

export async function recordTranscript(
  messages: Message[],
  teamInfo?: TeamInfo,
  startingParentUuidHint?: UUID,
  allMessages?: readonly Message[],
): Promise<UUID | null> {
  const cleanedMessages = cleanMessagesForLogging(messages, allMessages)
  const sessionId = getSessionId() as UUID
  const messageSet = await getSessionMessages(sessionId)
  const newMessages: typeof cleanedMessages = []
  let startingParentUuid: UUID | undefined = startingParentUuidHint
  let seenNewMessage = false
  for (const m of cleanedMessages) {
    if (messageSet.has(m.uuid as UUID)) {
      
      
      if (!seenNewMessage && isChainParticipant(m)) {
        startingParentUuid = m.uuid as UUID
      }
    } else {
      newMessages.push(m)
      seenNewMessage = true
    }
  }
  if (newMessages.length > 0) {
    await getProject().insertMessageChain(
      newMessages,
      false,
      undefined,
      startingParentUuid,
      teamInfo,
    )
  }
  
  
  
  
  
  
  const lastRecorded = newMessages.findLast(isChainParticipant)
  return (lastRecorded?.uuid as UUID | undefined) ?? startingParentUuid ?? null
}

export async function recordSidechainTranscript(
  messages: Message[],
  agentId?: string,
  startingParentUuid?: UUID | null,
) {
  await getProject().insertMessageChain(
    cleanMessagesForLogging(messages),
    true,
    agentId,
    startingParentUuid,
  )
}

export async function recordQueueOperation(queueOp: QueueOperationMessage) {
  await getProject().insertQueueOperation(queueOp)
}

export async function removeTranscriptMessage(targetUuid: UUID): Promise<void> {
  await getProject().removeMessageByUuid(targetUuid)
}

export async function recordFileHistorySnapshot(
  messageId: UUID,
  snapshot: FileHistorySnapshot,
  isSnapshotUpdate: boolean,
) {
  await getProject().insertFileHistorySnapshot(
    messageId,
    snapshot,
    isSnapshotUpdate,
  )
}

export async function recordAttributionSnapshot(
  snapshot: AttributionSnapshotMessage,
) {
  await getProject().insertAttributionSnapshot(snapshot)
}

export async function recordContentReplacement(
  replacements: ContentReplacementRecord[],
  agentId?: AgentId,
) {
  await getProject().insertContentReplacement(replacements, agentId)
}

export async function resetSessionFilePointer() {
  getProject().resetSessionFile()
}

export function adoptResumedSessionFile(): void {
  const project = getProject()
  project.sessionFile = getTranscriptPath()
  project.reAppendSessionMetadata(true)
}

export async function recordContextCollapseCommit(commit: {
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
}): Promise<void> {
  const sessionId = getSessionId() as UUID
  if (!sessionId) return
  await getProject().appendEntry({
    type: 'marble-origami-commit',
    sessionId,
    ...commit,
  })
}

export async function recordContextCollapseSnapshot(snapshot: {
  staged: Array<{
    startUuid: string
    endUuid: string
    summary: string
    risk: number
    stagedAt: number
  }>
  armed: boolean
  lastSpawnTokens: number
}): Promise<void> {
  const sessionId = getSessionId() as UUID
  if (!sessionId) return
  await getProject().appendEntry({
    type: 'marble-origami-snapshot',
    sessionId,
    ...snapshot,
  })
}

export async function flushSessionStorage(): Promise<void> {
  await getProject().flush()
}

export async function hydrateRemoteSession(
  sessionId: string,
  ingressUrl: string,
): Promise<boolean> {
  switchSession(asSessionId(sessionId))

  const project = getProject()

  try {
    const remoteLogs =
      (await sessionIngress.getSessionLogs(sessionId, ingressUrl)) || []

    
    const projectDir = getProjectDir(getOriginalCwd())
    await mkdir(projectDir, { recursive: true, mode: 0o700 })

    const sessionFile = getTranscriptPathForSession(sessionId)

    
    
    const content = remoteLogs.map(e => jsonStringify(e) + '\n').join('')
    await writeFile(sessionFile, content, { encoding: 'utf8', mode: 0o600 })

    logForDebugging(`Hydrated ${remoteLogs.length} entries from remote`)
    return remoteLogs.length > 0
  } catch (error) {
    logForDebugging(`Error hydrating session from remote: ${error}`)
    logForDiagnosticsNoPII('error', 'hydrate_remote_session_fail')
    return false
  } finally {
    
    
    
    project.setRemoteIngressUrl(ingressUrl)
  }
}

export async function hydrateFromCCRv2InternalEvents(
  sessionId: string,
): Promise<boolean> {
  const startMs = Date.now()
  switchSession(asSessionId(sessionId))

  const project = getProject()
  const reader = project.getInternalEventReader()
  if (!reader) {
    logForDebugging('No internal event reader registered for CCR v2 resume')
    return false
  }

  try {
    
    const events = await reader()
    if (!events) {
      logForDebugging('Failed to read internal events for resume')
      logForDiagnosticsNoPII('error', 'hydrate_ccr_v2_read_fail')
      return false
    }

    const projectDir = getProjectDir(getOriginalCwd())
    await mkdir(projectDir, { recursive: true, mode: 0o700 })

    
    const sessionFile = getTranscriptPathForSession(sessionId)
    const fgContent = events.map(e => jsonStringify(e.payload) + '\n').join('')
    await writeFile(sessionFile, fgContent, { encoding: 'utf8', mode: 0o600 })

    logForDebugging(
      `Hydrated ${events.length} foreground entries from CCR v2 internal events`,
    )

    
    let subagentEventCount = 0
    const subagentReader = project.getInternalSubagentEventReader()
    if (subagentReader) {
      const subagentEvents = await subagentReader()
      if (subagentEvents && subagentEvents.length > 0) {
        subagentEventCount = subagentEvents.length
        
        const byAgent = new Map<string, Record<string, unknown>[]>()
        for (const e of subagentEvents) {
          const agentId = e.agent_id || ''
          if (!agentId) continue
          let list = byAgent.get(agentId)
          if (!list) {
            list = []
            byAgent.set(agentId, list)
          }
          list.push(e.payload)
        }

        
        for (const [agentId, entries] of byAgent) {
          const agentFile = getAgentTranscriptPath(asAgentId(agentId))
          await mkdir(dirname(agentFile), { recursive: true, mode: 0o700 })
          const agentContent = entries
            .map(p => jsonStringify(p) + '\n')
            .join('')
          await writeFile(agentFile, agentContent, {
            encoding: 'utf8',
            mode: 0o600,
          })
        }

        logForDebugging(
          `Hydrated ${subagentEvents.length} subagent entries across ${byAgent.size} agents`,
        )
      }
    }

    logForDiagnosticsNoPII('info', 'hydrate_ccr_v2_completed', {
      duration_ms: Date.now() - startMs,
      event_count: events.length,
      subagent_event_count: subagentEventCount,
    })
    return events.length > 0
  } catch (error) {
    
    if (
      error instanceof Error &&
      error.message === 'CCRClient: Epoch mismatch (409)'
    ) {
      throw error
    }
    logForDebugging(`Error hydrating session from CCR v2: ${error}`)
    logForDiagnosticsNoPII('error', 'hydrate_ccr_v2_fail')
    return false
  }
}

function extractFirstPrompt(transcript: TranscriptMessage[]): string {
  const textContent = getFirstMeaningfulUserMessageTextContent(transcript)
  if (textContent) {
    let result = textContent.replace(/\n/g, ' ').trim()

    
    
    if (result.length > 200) {
      result = result.slice(0, 200).trim() + '…'
    }

    return result
  }

  return 'No prompt'
}

export function getFirstMeaningfulUserMessageTextContent<T extends Message>(
  transcript: T[],
): string | undefined {
  for (const msg of transcript) {
    if (msg.type !== 'user' || msg.isMeta) continue
    
    if ('isCompactSummary' in msg && msg.isCompactSummary) continue

    const content = msg.message?.content
    if (!content) continue

    
    
    
    
    const texts: string[] = []
    if (typeof content === 'string') {
      texts.push(content)
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          texts.push(block.text)
        }
      }
    }

    for (const textContent of texts) {
      if (!textContent) continue

      const commandNameTag = extractTag(textContent, COMMAND_NAME_TAG)
      if (commandNameTag) {
        const commandName = commandNameTag.replace(/^\

        
        
        if (builtInCommandNames().has(commandName)) {
          continue
        } else {
          
          
          const commandArgs = extractTag(textContent, 'command-args')?.trim()
          if (!commandArgs) {
            continue
          }
          
          return `${commandNameTag} ${commandArgs}`
        }
      }

      
      
      const bashInput = extractTag(textContent, 'bash-input')
      if (bashInput) {
        return `! ${bashInput}`
      }

      
      
      if (SKIP_FIRST_PROMPT_PATTERN.test(textContent)) {
        continue
      }

      return textContent
    }
  }
  return undefined
}

export function removeExtraFields(
  transcript: TranscriptMessage[],
): SerializedMessage[] {
  return transcript.map(m => {
    const { isSidechain, parentUuid, ...serializedMessage } = m
    return serializedMessage
  })
}

function applyPreservedSegmentRelinks(
  messages: Map<UUID, TranscriptMessage>,
): void {
  type Seg = NonNullable<
    SystemCompactBoundaryMessage['compactMetadata']['preservedSegment']
  >

  
  
  let lastSeg: Seg | undefined
  let lastSegBoundaryIdx = -1
  let absoluteLastBoundaryIdx = -1
  const entryIndex = new Map<UUID, number>()
  let i = 0
  for (const entry of messages.values()) {
    entryIndex.set(entry.uuid, i)
    if (isCompactBoundaryMessage(entry)) {
      absoluteLastBoundaryIdx = i
      const seg = entry.compactMetadata?.preservedSegment
      if (seg) {
        lastSeg = seg
        lastSegBoundaryIdx = i
      }
    }
    i++
  }
  
  if (!lastSeg) return

  
  
  const segIsLive = lastSegBoundaryIdx === absoluteLastBoundaryIdx

  
  
  const preservedUuids = new Set<UUID>()
  if (segIsLive) {
    const walkSeen = new Set<UUID>()
    let cur = messages.get(lastSeg.tailUuid)
    let reachedHead = false
    while (cur && !walkSeen.has(cur.uuid)) {
      walkSeen.add(cur.uuid)
      preservedUuids.add(cur.uuid)
      if (cur.uuid === lastSeg.headUuid) {
        reachedHead = true
        break
      }
      cur = cur.parentUuid ? messages.get(cur.parentUuid) : undefined
    }
    if (!reachedHead) {
      
      
      
      
      
      logEvent('tengu_relink_walk_broken', {
        tailInTranscript: messages.has(lastSeg.tailUuid),
        headInTranscript: messages.has(lastSeg.headUuid),
        anchorInTranscript: messages.has(lastSeg.anchorUuid),
        walkSteps: walkSeen.size,
        transcriptSize: messages.size,
      })
      return
    }
  }

  if (segIsLive) {
    const head = messages.get(lastSeg.headUuid)
    if (head) {
      messages.set(lastSeg.headUuid, {
        ...head,
        parentUuid: lastSeg.anchorUuid,
      })
    }
    
    
    for (const [uuid, msg] of messages) {
      if (msg.parentUuid === lastSeg.anchorUuid && uuid !== lastSeg.headUuid) {
        messages.set(uuid, { ...msg, parentUuid: lastSeg.tailUuid })
      }
    }
    
    
    
    for (const uuid of preservedUuids) {
      const msg = messages.get(uuid)
      if (msg?.type !== 'assistant') continue
      messages.set(uuid, {
        ...msg,
        message: {
          ...msg.message,
          usage: {
            ...msg.message.usage,
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      })
    }
  }

  
  
  const toDelete: UUID[] = []
  for (const [uuid] of messages) {
    const idx = entryIndex.get(uuid)
    if (
      idx !== undefined &&
      idx < absoluteLastBoundaryIdx &&
      !preservedUuids.has(uuid)
    ) {
      toDelete.push(uuid)
    }
  }
  for (const uuid of toDelete) messages.delete(uuid)
}

function applySnipRemovals(messages: Map<UUID, TranscriptMessage>): void {
  
  
  
  type WithSnipMeta = { snipMetadata?: { removedUuids?: UUID[] } }
  const toDelete = new Set<UUID>()
  for (const entry of messages.values()) {
    const removedUuids = (entry as WithSnipMeta).snipMetadata?.removedUuids
    if (!removedUuids) continue
    for (const uuid of removedUuids) toDelete.add(uuid)
  }
  if (toDelete.size === 0) return

  
  
  
  
  
  const deletedParent = new Map<UUID, UUID | null>()
  let removedCount = 0
  for (const uuid of toDelete) {
    const entry = messages.get(uuid)
    if (!entry) continue
    deletedParent.set(uuid, entry.parentUuid)
    messages.delete(uuid)
    removedCount++
  }

  
  
  
  
  const resolve = (start: UUID): UUID | null => {
    const path: UUID[] = []
    let cur: UUID | null | undefined = start
    while (cur && toDelete.has(cur)) {
      path.push(cur)
      cur = deletedParent.get(cur)
      if (cur === undefined) {
        cur = null
        break
      }
    }
    for (const p of path) deletedParent.set(p, cur)
    return cur
  }
  let relinkedCount = 0
  for (const [uuid, msg] of messages) {
    if (!msg.parentUuid || !toDelete.has(msg.parentUuid)) continue
    messages.set(uuid, { ...msg, parentUuid: resolve(msg.parentUuid) })
    relinkedCount++
  }

  logEvent('tengu_snip_resume_filtered', {
    removed_count: removedCount,
    relinked_count: relinkedCount,
  })
}

function findLatestMessage<T extends { timestamp: string }>(
  messages: Iterable<T>,
  predicate: (m: T) => boolean,
): T | undefined {
  let latest: T | undefined
  let maxTime = -Infinity
  for (const m of messages) {
    if (!predicate(m)) continue
    const t = Date.parse(m.timestamp)
    if (t > maxTime) {
      maxTime = t
      latest = m
    }
  }
  return latest
}

export function buildConversationChain(
  messages: Map<UUID, TranscriptMessage>,
  leafMessage: TranscriptMessage,
): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = []
  const seen = new Set<UUID>()
  let currentMsg: TranscriptMessage | undefined = leafMessage
  while (currentMsg) {
    if (seen.has(currentMsg.uuid)) {
      logError(
        new Error(
          `Cycle detected in parentUuid chain at message ${currentMsg.uuid}. Returning partial transcript.`,
        ),
      )
      logEvent('tengu_chain_parent_cycle', {})
      break
    }
    seen.add(currentMsg.uuid)
    transcript.push(currentMsg)
    currentMsg = currentMsg.parentUuid
      ? messages.get(currentMsg.parentUuid)
      : undefined
  }
  transcript.reverse()
  return recoverOrphanedParallelToolResults(messages, transcript, seen)
}

function recoverOrphanedParallelToolResults(
  messages: Map<UUID, TranscriptMessage>,
  chain: TranscriptMessage[],
  seen: Set<UUID>,
): TranscriptMessage[] {
  type ChainAssistant = Extract<TranscriptMessage, { type: 'assistant' }>
  const chainAssistants = chain.filter(
    (m): m is ChainAssistant => m.type === 'assistant',
  )
  if (chainAssistants.length === 0) return chain

  
  
  const anchorByMsgId = new Map<string, ChainAssistant>()
  for (const a of chainAssistants) {
    if (a.message.id) anchorByMsgId.set(a.message.id, a)
  }

  
  
  
  const siblingsByMsgId = new Map<string, TranscriptMessage[]>()
  const toolResultsByAsst = new Map<UUID, TranscriptMessage[]>()
  for (const m of messages.values()) {
    if (m.type === 'assistant' && m.message.id) {
      const group = siblingsByMsgId.get(m.message.id)
      if (group) group.push(m)
      else siblingsByMsgId.set(m.message.id, [m])
    } else if (
      m.type === 'user' &&
      m.parentUuid &&
      Array.isArray(m.message.content) &&
      m.message.content.some(b => b.type === 'tool_result')
    ) {
      const group = toolResultsByAsst.get(m.parentUuid)
      if (group) group.push(m)
      else toolResultsByAsst.set(m.parentUuid, [m])
    }
  }

  
  
  
  
  const processedGroups = new Set<string>()
  const inserts = new Map<UUID, TranscriptMessage[]>()
  let recoveredCount = 0
  for (const asst of chainAssistants) {
    const msgId = asst.message.id
    if (!msgId || processedGroups.has(msgId)) continue
    processedGroups.add(msgId)

    const group = siblingsByMsgId.get(msgId) ?? [asst]
    const orphanedSiblings = group.filter(s => !seen.has(s.uuid))
    const orphanedTRs: TranscriptMessage[] = []
    for (const member of group) {
      const trs = toolResultsByAsst.get(member.uuid)
      if (!trs) continue
      for (const tr of trs) {
        if (!seen.has(tr.uuid)) orphanedTRs.push(tr)
      }
    }
    if (orphanedSiblings.length === 0 && orphanedTRs.length === 0) continue

    
    
    orphanedSiblings.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    orphanedTRs.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    const anchor = anchorByMsgId.get(msgId)!
    const recovered = [...orphanedSiblings, ...orphanedTRs]
    for (const r of recovered) seen.add(r.uuid)
    recoveredCount += recovered.length
    inserts.set(anchor.uuid, recovered)
  }

  if (recoveredCount === 0) return chain
  logEvent('tengu_chain_parallel_tr_recovered', {
    recovered_count: recoveredCount,
  })

  const result: TranscriptMessage[] = []
  for (const m of chain) {
    result.push(m)
    const toInsert = inserts.get(m.uuid)
    if (toInsert) result.push(...toInsert)
  }
  return result
}

export function checkResumeConsistency(chain: Message[]): void {
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i]!
    if (m.type !== 'system' || m.subtype !== 'turn_duration') continue
    const expected = m.messageCount
    if (expected === undefined) return
    
    
    
    const actual = i
    logEvent('tengu_resume_consistency_delta', {
      expected,
      actual,
      delta: actual - expected,
      chain_length: chain.length,
      checkpoint_age_entries: chain.length - 1 - i,
    })
    return
  }
}

function buildFileHistorySnapshotChain(
  fileHistorySnapshots: Map<UUID, FileHistorySnapshotMessage>,
  conversation: TranscriptMessage[],
): FileHistorySnapshot[] {
  const snapshots: FileHistorySnapshot[] = []
  
  const indexByMessageId = new Map<string, number>()
  for (const message of conversation) {
    const snapshotMessage = fileHistorySnapshots.get(message.uuid)
    if (!snapshotMessage) {
      continue
    }
    const { snapshot, isSnapshotUpdate } = snapshotMessage
    const existingIndex = isSnapshotUpdate
      ? indexByMessageId.get(snapshot.messageId)
      : undefined
    if (existingIndex === undefined) {
      indexByMessageId.set(snapshot.messageId, snapshots.length)
      snapshots.push(snapshot)
    } else {
      snapshots[existingIndex] = snapshot
    }
  }
  return snapshots
}

function buildAttributionSnapshotChain(
  attributionSnapshots: Map<UUID, AttributionSnapshotMessage>,
  _conversation: TranscriptMessage[],
): AttributionSnapshotMessage[] {
  
  return Array.from(attributionSnapshots.values())
}

export async function loadTranscriptFromFile(
  filePath: string,
): Promise<LogOption> {
  if (filePath.endsWith('.jsonl')) {
    const {
      messages,
      summaries,
      customTitles,
      tags,
      fileHistorySnapshots,
      attributionSnapshots,
      contextCollapseCommits,
      contextCollapseSnapshot,
      leafUuids,
      contentReplacements,
      worktreeStates,
    } = await loadTranscriptFile(filePath)

    if (messages.size === 0) {
      throw new Error('No messages found in JSONL file')
    }

    
    const leafMessage = findLatestMessage(messages.values(), msg =>
      leafUuids.has(msg.uuid),
    )

    if (!leafMessage) {
      throw new Error('No valid conversation chain found in JSONL file')
    }

    
    const transcript = buildConversationChain(messages, leafMessage)

    const summary = summaries.get(leafMessage.uuid)
    const customTitle = customTitles.get(leafMessage.sessionId as UUID)
    const tag = tags.get(leafMessage.sessionId as UUID)
    const sessionId = leafMessage.sessionId as UUID
    return {
      ...convertToLogOption(
        transcript,
        0,
        summary,
        customTitle,
        buildFileHistorySnapshotChain(fileHistorySnapshots, transcript),
        tag,
        filePath,
        buildAttributionSnapshotChain(attributionSnapshots, transcript),
        undefined,
        contentReplacements.get(sessionId) ?? [],
      ),
      contextCollapseCommits: contextCollapseCommits.filter(
        e => e.sessionId === sessionId,
      ),
      contextCollapseSnapshot:
        contextCollapseSnapshot?.sessionId === sessionId
          ? contextCollapseSnapshot
          : undefined,
      worktreeSession: worktreeStates.has(sessionId)
        ? worktreeStates.get(sessionId)
        : undefined,
    }
  }

  
  const content = await readFile(filePath, { encoding: 'utf-8' })
  let parsed: unknown

  try {
    parsed = jsonParse(content)
  } catch (error) {
    throw new Error(`Invalid JSON in transcript file: ${error}`)
  }

  let messages: TranscriptMessage[]

  if (Array.isArray(parsed)) {
    messages = parsed
  } else if (parsed && typeof parsed === 'object' && 'messages' in parsed) {
    if (!Array.isArray(parsed.messages)) {
      throw new Error('Transcript messages must be an array')
    }
    messages = parsed.messages
  } else {
    throw new Error(
      'Transcript must be an array of messages or an object with a messages array',
    )
  }

  return convertToLogOption(
    messages,
    0,
    undefined,
    undefined,
    undefined,
    undefined,
    filePath,
  )
}

function hasVisibleUserContent(message: TranscriptMessage): boolean {
  if (message.type !== 'user') return false

  
  if (message.isMeta) return false

  const content = message.message?.content
  if (!content) return false

  
  if (typeof content === 'string') {
    return content.trim().length > 0
  }

  
  if (Array.isArray(content)) {
    return content.some(
      block =>
        block.type === 'text' ||
        block.type === 'image' ||
        block.type === 'document',
    )
  }

  return false
}

function hasVisibleAssistantContent(message: TranscriptMessage): boolean {
  if (message.type !== 'assistant') return false

  const content = message.message?.content
  if (!content || !Array.isArray(content)) return false

  
  return content.some(
    block =>
      block.type === 'text' &&
      typeof block.text === 'string' &&
      block.text.trim().length > 0,
  )
}

function countVisibleMessages(transcript: TranscriptMessage[]): number {
  let count = 0
  for (const message of transcript) {
    switch (message.type) {
      case 'user':
        
        if (hasVisibleUserContent(message)) {
          count++
        }
        break
      case 'assistant':
        
        if (hasVisibleAssistantContent(message)) {
          count++
        }
        break
      case 'attachment':
      case 'system':
      case 'progress':
        
        break
    }
  }
  return count
}

function convertToLogOption(
  transcript: TranscriptMessage[],
  value: number = 0,
  summary?: string,
  customTitle?: string,
  fileHistorySnapshots?: FileHistorySnapshot[],
  tag?: string,
  fullPath?: string,
  attributionSnapshots?: AttributionSnapshotMessage[],
  agentSetting?: string,
  contentReplacements?: ContentReplacementRecord[],
): LogOption {
  const lastMessage = transcript.at(-1)!
  const firstMessage = transcript[0]!

  
  const firstPrompt = extractFirstPrompt(transcript)

  
  const created = new Date(firstMessage.timestamp)
  const modified = new Date(lastMessage.timestamp)

  return {
    date: lastMessage.timestamp,
    messages: removeExtraFields(transcript),
    fullPath,
    value,
    created,
    modified,
    firstPrompt,
    messageCount: countVisibleMessages(transcript),
    isSidechain: firstMessage.isSidechain,
    teamName: firstMessage.teamName,
    agentName: firstMessage.agentName,
    agentSetting,
    leafUuid: lastMessage.uuid,
    summary,
    customTitle,
    tag,
    fileHistorySnapshots: fileHistorySnapshots,
    attributionSnapshots: attributionSnapshots,
    contentReplacements,
    gitBranch: lastMessage.gitBranch,
    projectPath: firstMessage.cwd,
  }
}

async function trackSessionBranchingAnalytics(
  logs: LogOption[],
): Promise<void> {
  const sessionIdCounts = new Map<string, number>()
  let maxCount = 0
  for (const log of logs) {
    const sessionId = getSessionIdFromLog(log)
    if (sessionId) {
      const newCount = (sessionIdCounts.get(sessionId) || 0) + 1
      sessionIdCounts.set(sessionId, newCount)
      maxCount = Math.max(newCount, maxCount)
    }
  }

  
  if (maxCount <= 1) {
    return
  }

  
  const branchCounts = Array.from(sessionIdCounts.values()).filter(c => c > 1)
  const sessionsWithBranches = branchCounts.length
  const totalBranches = branchCounts.reduce((sum, count) => sum + count, 0)

  logEvent('tengu_session_forked_branches_fetched', {
    total_sessions: sessionIdCounts.size,
    sessions_with_branches: sessionsWithBranches,
    max_branches_per_session: Math.max(...branchCounts),
    avg_branches_per_session: Math.round(totalBranches / sessionsWithBranches),
    total_transcript_count: logs.length,
  })
}

export async function fetchLogs(limit?: number): Promise<LogOption[]> {
  const projectDir = getProjectDir(getOriginalCwd())
  const logs = await getSessionFilesLite(projectDir, limit, getOriginalCwd())

  await trackSessionBranchingAnalytics(logs)

  return logs
}

function appendEntryToFile(
  fullPath: string,
  entry: Record<string, unknown>,
): void {
  const fs = getFsImplementation()
  const line = jsonStringify(entry) + '\n'
  try {
    fs.appendFileSync(fullPath, line, { mode: 0o600 })
  } catch {
    fs.mkdirSync(dirname(fullPath), { mode: 0o700 })
    fs.appendFileSync(fullPath, line, { mode: 0o600 })
  }
}

function readFileTailSync(fullPath: string): string {
  let fd: number | undefined
  try {
    fd = openSync(fullPath, 'r')
    const st = fstatSync(fd)
    const tailOffset = Math.max(0, st.size - LITE_READ_BUF_SIZE)
    const buf = Buffer.allocUnsafe(
      Math.min(LITE_READ_BUF_SIZE, st.size - tailOffset),
    )
    const bytesRead = readSync(fd, buf, 0, buf.length, tailOffset)
    return buf.toString('utf8', 0, bytesRead)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        
      }
    }
  }
}

export async function saveCustomTitle(
  sessionId: UUID,
  customTitle: string,
  fullPath?: string,
  source: 'user' | 'auto' = 'user',
) {
  
  const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
  appendEntryToFile(resolvedPath, {
    type: 'custom-title',
    customTitle,
    sessionId,
  })
  
  if (sessionId === getSessionId()) {
    getProject().currentSessionTitle = customTitle
  }
  logEvent('tengu_session_renamed', {
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export function saveAiGeneratedTitle(sessionId: UUID, aiTitle: string): void {
  appendEntryToFile(getTranscriptPathForSession(sessionId), {
    type: 'ai-title',
    aiTitle,
    sessionId,
  })
}

export function saveTaskSummary(sessionId: UUID, summary: string): void {
  appendEntryToFile(getTranscriptPathForSession(sessionId), {
    type: 'task-summary',
    summary,
    sessionId,
    timestamp: new Date().toISOString(),
  })
}

export async function saveTag(sessionId: UUID, tag: string, fullPath?: string) {
  
  const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
  appendEntryToFile(resolvedPath, { type: 'tag', tag, sessionId })
  
  if (sessionId === getSessionId()) {
    getProject().currentSessionTag = tag
  }
  logEvent('tengu_session_tagged', {})
}

export async function linkSessionToPR(
  sessionId: UUID,
  prNumber: number,
  prUrl: string,
  prRepository: string,
  fullPath?: string,
): Promise<void> {
  const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
  appendEntryToFile(resolvedPath, {
    type: 'pr-link',
    sessionId,
    prNumber,
    prUrl,
    prRepository,
    timestamp: new Date().toISOString(),
  })
  
  if (sessionId === getSessionId()) {
    const project = getProject()
    project.currentSessionPrNumber = prNumber
    project.currentSessionPrUrl = prUrl
    project.currentSessionPrRepository = prRepository
  }
  logEvent('tengu_session_linked_to_pr', { prNumber })
}

export function getCurrentSessionTag(sessionId: UUID): string | undefined {
  
  if (sessionId === getSessionId()) {
    return getProject().currentSessionTag
  }
  return undefined
}

export function getCurrentSessionTitle(
  sessionId: SessionId,
): string | undefined {
  
  if (sessionId === getSessionId()) {
    return getProject().currentSessionTitle
  }
  return undefined
}

export function getCurrentSessionAgentColor(): string | undefined {
  return getProject().currentSessionAgentColor
}

export function restoreSessionMetadata(meta: {
  customTitle?: string
  tag?: string
  agentName?: string
  agentColor?: string
  agentSetting?: string
  mode?: 'coordinator' | 'normal'
  worktreeSession?: PersistedWorktreeSession | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
}): void {
  const project = getProject()
  
  
  if (meta.customTitle) project.currentSessionTitle ??= meta.customTitle
  if (meta.tag !== undefined) project.currentSessionTag = meta.tag || undefined
  if (meta.agentName) project.currentSessionAgentName = meta.agentName
  if (meta.agentColor) project.currentSessionAgentColor = meta.agentColor
  if (meta.agentSetting) project.currentSessionAgentSetting = meta.agentSetting
  if (meta.mode) project.currentSessionMode = meta.mode
  if (meta.worktreeSession !== undefined)
    project.currentSessionWorktree = meta.worktreeSession
  if (meta.prNumber !== undefined)
    project.currentSessionPrNumber = meta.prNumber
  if (meta.prUrl) project.currentSessionPrUrl = meta.prUrl
  if (meta.prRepository) project.currentSessionPrRepository = meta.prRepository
}

export function clearSessionMetadata(): void {
  const project = getProject()
  project.currentSessionTitle = undefined
  project.currentSessionTag = undefined
  project.currentSessionAgentName = undefined
  project.currentSessionAgentColor = undefined
  project.currentSessionLastPrompt = undefined
  project.currentSessionAgentSetting = undefined
  project.currentSessionMode = undefined
  project.currentSessionWorktree = undefined
  project.currentSessionPrNumber = undefined
  project.currentSessionPrUrl = undefined
  project.currentSessionPrRepository = undefined
}

export function reAppendSessionMetadata(): void {
  getProject().reAppendSessionMetadata()
}

export async function saveAgentName(
  sessionId: UUID,
  agentName: string,
  fullPath?: string,
  source: 'user' | 'auto' = 'user',
) {
  const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
  appendEntryToFile(resolvedPath, { type: 'agent-name', agentName, sessionId })
  
  if (sessionId === getSessionId()) {
    getProject().currentSessionAgentName = agentName
    void updateSessionName(agentName)
  }
  logEvent('tengu_agent_name_set', {
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

export async function saveAgentColor(
  sessionId: UUID,
  agentColor: string,
  fullPath?: string,
) {
  const resolvedPath = fullPath ?? getTranscriptPathForSession(sessionId)
  appendEntryToFile(resolvedPath, {
    type: 'agent-color',
    agentColor,
    sessionId,
  })
  
  if (sessionId === getSessionId()) {
    getProject().currentSessionAgentColor = agentColor
  }
  logEvent('tengu_agent_color_set', {})
}

export function saveAgentSetting(agentSetting: string): void {
  getProject().currentSessionAgentSetting = agentSetting
}

export function cacheSessionTitle(customTitle: string): void {
  getProject().currentSessionTitle = customTitle
}

export function saveMode(mode: 'coordinator' | 'normal'): void {
  getProject().currentSessionMode = mode
}

export function saveWorktreeState(
  worktreeSession: PersistedWorktreeSession | null,
): void {
  
  
  
  const stripped: PersistedWorktreeSession | null = worktreeSession
    ? {
        originalCwd: worktreeSession.originalCwd,
        worktreePath: worktreeSession.worktreePath,
        worktreeName: worktreeSession.worktreeName,
        worktreeBranch: worktreeSession.worktreeBranch,
        originalBranch: worktreeSession.originalBranch,
        originalHeadCommit: worktreeSession.originalHeadCommit,
        sessionId: worktreeSession.sessionId,
        tmuxSessionName: worktreeSession.tmuxSessionName,
        hookBased: worktreeSession.hookBased,
      }
    : null
  const project = getProject()
  project.currentSessionWorktree = stripped
  
  
  
  if (project.sessionFile) {
    appendEntryToFile(project.sessionFile, {
      type: 'worktree-state',
      worktreeSession: stripped,
      sessionId: getSessionId(),
    })
  }
}

export function getSessionIdFromLog(log: LogOption): UUID | undefined {
  
  if (log.sessionId) {
    return log.sessionId as UUID
  }
  
  return log.messages[0]?.sessionId as UUID | undefined
}

export function isLiteLog(log: LogOption): boolean {
  return log.messages.length === 0 && log.sessionId !== undefined
}

export async function loadFullLog(log: LogOption): Promise<LogOption> {
  
  if (!isLiteLog(log)) {
    return log
  }

  
  const sessionFile = log.fullPath
  if (!sessionFile) {
    return log
  }

  try {
    const {
      messages,
      summaries,
      customTitles,
      tags,
      agentNames,
      agentColors,
      agentSettings,
      prNumbers,
      prUrls,
      prRepositories,
      modes,
      worktreeStates,
      fileHistorySnapshots,
      attributionSnapshots,
      contentReplacements,
      contextCollapseCommits,
      contextCollapseSnapshot,
      leafUuids,
    } = await loadTranscriptFile(sessionFile)

    if (messages.size === 0) {
      return log
    }

    
    const mostRecentLeaf = findLatestMessage(
      messages.values(),
      msg =>
        leafUuids.has(msg.uuid) &&
        (msg.type === 'user' || msg.type === 'assistant'),
    )
    if (!mostRecentLeaf) {
      return log
    }

    
    const transcript = buildConversationChain(messages, mostRecentLeaf)
    
    
    const sessionId = mostRecentLeaf.sessionId as UUID | undefined
    return {
      ...log,
      messages: removeExtraFields(transcript),
      firstPrompt: extractFirstPrompt(transcript),
      messageCount: countVisibleMessages(transcript),
      summary: mostRecentLeaf
        ? summaries.get(mostRecentLeaf.uuid)
        : log.summary,
      customTitle: sessionId ? customTitles.get(sessionId) : log.customTitle,
      tag: sessionId ? tags.get(sessionId) : log.tag,
      agentName: sessionId ? agentNames.get(sessionId) : log.agentName,
      agentColor: sessionId ? agentColors.get(sessionId) : log.agentColor,
      agentSetting: sessionId ? agentSettings.get(sessionId) : log.agentSetting,
      mode: sessionId ? (modes.get(sessionId) as LogOption['mode']) : log.mode,
      worktreeSession:
        sessionId && worktreeStates.has(sessionId)
          ? worktreeStates.get(sessionId)
          : log.worktreeSession,
      prNumber: sessionId ? prNumbers.get(sessionId) : log.prNumber,
      prUrl: sessionId ? prUrls.get(sessionId) : log.prUrl,
      prRepository: sessionId
        ? prRepositories.get(sessionId)
        : log.prRepository,
      gitBranch: mostRecentLeaf?.gitBranch ?? log.gitBranch,
      isSidechain: transcript[0]?.isSidechain ?? log.isSidechain,
      teamName: transcript[0]?.teamName ?? log.teamName,
      leafUuid: mostRecentLeaf?.uuid ?? log.leafUuid,
      fileHistorySnapshots: buildFileHistorySnapshotChain(
        fileHistorySnapshots,
        transcript,
      ),
      attributionSnapshots: buildAttributionSnapshotChain(
        attributionSnapshots,
        transcript,
      ),
      contentReplacements: sessionId
        ? (contentReplacements.get(sessionId) ?? [])
        : log.contentReplacements,
      
      
      
      contextCollapseCommits: sessionId
        ? contextCollapseCommits.filter(e => e.sessionId === sessionId)
        : undefined,
      contextCollapseSnapshot:
        sessionId && contextCollapseSnapshot?.sessionId === sessionId
          ? contextCollapseSnapshot
          : undefined,
    }
  } catch {
    
    return log
  }
}

export async function searchSessionsByCustomTitle(
  query: string,
  options?: { limit?: number; exact?: boolean },
): Promise<LogOption[]> {
  const { limit, exact } = options || {}
  
  const worktreePaths = await getWorktreePaths(getOriginalCwd())
  const allStatLogs = await getStatOnlyLogsForWorktrees(worktreePaths)
  
  const { logs } = await enrichLogs(allStatLogs, 0, allStatLogs.length)
  const normalizedQuery = query.toLowerCase().trim()

  const matchingLogs = logs.filter(log => {
    const title = log.customTitle?.toLowerCase().trim()
    if (!title) return false
    return exact ? title === normalizedQuery : title.includes(normalizedQuery)
  })

  
  
  const sessionIdToLog = new Map<UUID, LogOption>()
  for (const log of matchingLogs) {
    const sessionId = getSessionIdFromLog(log)
    if (sessionId) {
      const existing = sessionIdToLog.get(sessionId)
      if (!existing || log.modified > existing.modified) {
        sessionIdToLog.set(sessionId, log)
      }
    }
  }
  const deduplicated = Array.from(sessionIdToLog.values())

  
  deduplicated.sort((a, b) => b.modified.getTime() - a.modified.getTime())

  
  if (limit) {
    return deduplicated.slice(0, limit)
  }

  return deduplicated
}

const METADATA_TYPE_MARKERS = [
  '"type":"summary"',
  '"type":"custom-title"',
  '"type":"tag"',
  '"type":"agent-name"',
  '"type":"agent-color"',
  '"type":"agent-setting"',
  '"type":"mode"',
  '"type":"worktree-state"',
  '"type":"pr-link"',
]
const METADATA_MARKER_BUFS = METADATA_TYPE_MARKERS.map(m => Buffer.from(m))

const METADATA_PREFIX_BOUND = 25

function resolveMetadataBuf(
  carry: Buffer | null,
  chunkBuf: Buffer,
): Buffer | null {
  if (carry === null || carry.length === 0) return chunkBuf
  if (carry.length < METADATA_PREFIX_BOUND) {
    return Buffer.concat([carry, chunkBuf])
  }
  if (carry[0] === 0x7b ) {
    for (const m of METADATA_MARKER_BUFS) {
      if (carry.compare(m, 0, m.length, 1, 1 + m.length) === 0) {
        return Buffer.concat([carry, chunkBuf])
      }
    }
  }
  const firstNl = chunkBuf.indexOf(0x0a)
  return firstNl === -1 ? null : chunkBuf.subarray(firstNl + 1)
}

async function scanPreBoundaryMetadata(
  filePath: string,
  endOffset: number,
): Promise<string[]> {
  const { createReadStream } = await import('fs')
  const NEWLINE = 0x0a

  const stream = createReadStream(filePath, { end: endOffset - 1 })
  const metadataLines: string[] = []
  let carry: Buffer | null = null

  for await (const chunk of stream) {
    const chunkBuf = chunk as Buffer
    const buf = resolveMetadataBuf(carry, chunkBuf)
    if (buf === null) {
      carry = null
      continue
    }

    
    let hasAnyMarker = false
    for (const m of METADATA_MARKER_BUFS) {
      if (buf.includes(m)) {
        hasAnyMarker = true
        break
      }
    }

    if (hasAnyMarker) {
      let lineStart = 0
      let nl = buf.indexOf(NEWLINE)
      while (nl !== -1) {
        
        for (const m of METADATA_MARKER_BUFS) {
          const mIdx = buf.indexOf(m, lineStart)
          if (mIdx !== -1 && mIdx < nl) {
            metadataLines.push(buf.toString('utf-8', lineStart, nl))
            break
          }
        }
        lineStart = nl + 1
        nl = buf.indexOf(NEWLINE, lineStart)
      }
      carry = buf.subarray(lineStart)
    } else {
      
      const lastNl = buf.lastIndexOf(NEWLINE)
      carry = lastNl >= 0 ? buf.subarray(lastNl + 1) : buf
    }

    
    
    
    if (carry.length > 64 * 1024) carry = null
  }

  
  if (carry !== null && carry.length > 0) {
    for (const m of METADATA_MARKER_BUFS) {
      if (carry.includes(m)) {
        metadataLines.push(carry.toString('utf-8'))
        break
      }
    }
  }

  return metadataLines
}

function pickDepthOneUuidCandidate(
  buf: Buffer,
  lineStart: number,
  candidates: number[],
): number {
  const QUOTE = 0x22
  const BACKSLASH = 0x5c
  const OPEN_BRACE = 0x7b
  const CLOSE_BRACE = 0x7d
  let depth = 0
  let inString = false
  let escapeNext = false
  let ci = 0
  for (let i = lineStart; ci < candidates.length; i++) {
    if (i === candidates[ci]) {
      if (depth === 1 && !inString) return candidates[ci]!
      ci++
    }
    const b = buf[i]!
    if (escapeNext) {
      escapeNext = false
    } else if (inString) {
      if (b === BACKSLASH) escapeNext = true
      else if (b === QUOTE) inString = false
    } else if (b === QUOTE) inString = true
    else if (b === OPEN_BRACE) depth++
    else if (b === CLOSE_BRACE) depth--
  }
  return candidates.at(-1)!
}

function walkChainBeforeParse(buf: Buffer): Buffer {
  const NEWLINE = 0x0a
  const OPEN_BRACE = 0x7b
  const QUOTE = 0x22
  const PARENT_PREFIX = Buffer.from('{"parentUuid":')
  const UUID_KEY = Buffer.from('"uuid":"')
  const SIDECHAIN_TRUE = Buffer.from('"isSidechain":true')
  const UUID_LEN = 36
  const TS_SUFFIX = Buffer.from('","timestamp":"')
  const TS_SUFFIX_LEN = TS_SUFFIX.length
  const PREFIX_LEN = PARENT_PREFIX.length
  const KEY_LEN = UUID_KEY.length

  
  
  
  
  const msgIdx: number[] = []
  const metaRanges: number[] = []
  const uuidToSlot = new Map<string, number>()

  let pos = 0
  const len = buf.length
  while (pos < len) {
    const nl = buf.indexOf(NEWLINE, pos)
    const lineEnd = nl === -1 ? len : nl + 1
    if (
      lineEnd - pos > PREFIX_LEN &&
      buf[pos] === OPEN_BRACE &&
      buf.compare(PARENT_PREFIX, 0, PREFIX_LEN, pos, pos + PREFIX_LEN) === 0
    ) {
      
      const parentStart =
        buf[pos + PREFIX_LEN] === QUOTE ? pos + PREFIX_LEN + 1 : -1
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      let firstAny = -1
      let suffix0 = -1
      let suffixN: number[] | undefined
      let from = pos
      for (;;) {
        const next = buf.indexOf(UUID_KEY, from)
        if (next < 0 || next >= lineEnd) break
        if (firstAny < 0) firstAny = next
        const after = next + KEY_LEN + UUID_LEN
        if (
          after + TS_SUFFIX_LEN <= lineEnd &&
          buf.compare(
            TS_SUFFIX,
            0,
            TS_SUFFIX_LEN,
            after,
            after + TS_SUFFIX_LEN,
          ) === 0
        ) {
          if (suffix0 < 0) suffix0 = next
          else (suffixN ??= [suffix0]).push(next)
        }
        from = next + KEY_LEN
      }
      const uk = suffixN
        ? pickDepthOneUuidCandidate(buf, pos, suffixN)
        : suffix0 >= 0
          ? suffix0
          : firstAny
      if (uk >= 0) {
        const uuidStart = uk + KEY_LEN
        
        const uuid = buf.toString('latin1', uuidStart, uuidStart + UUID_LEN)
        uuidToSlot.set(uuid, msgIdx.length)
        msgIdx.push(pos, lineEnd, parentStart)
      } else {
        metaRanges.push(pos, lineEnd)
      }
    } else {
      metaRanges.push(pos, lineEnd)
    }
    pos = lineEnd
  }

  
  
  
  
  let leafSlot = -1
  for (let i = msgIdx.length - 3; i >= 0; i -= 3) {
    const sc = buf.indexOf(SIDECHAIN_TRUE, msgIdx[i]!)
    if (sc === -1 || sc >= msgIdx[i + 1]!) {
      leafSlot = i
      break
    }
  }
  if (leafSlot < 0) return buf

  
  
  
  
  
  
  const seen = new Set<number>()
  const chain = new Set<number>()
  let chainBytes = 0
  let slot: number | undefined = leafSlot
  while (slot !== undefined) {
    if (seen.has(slot)) break
    seen.add(slot)
    chain.add(msgIdx[slot]!)
    chainBytes += msgIdx[slot + 1]! - msgIdx[slot]!
    const parentStart = msgIdx[slot + 2]!
    if (parentStart < 0) break
    const parent = buf.toString('latin1', parentStart, parentStart + UUID_LEN)
    slot = uuidToSlot.get(parent)
  }

  
  
  
  
  
  
  
  
  
  
  if (len - chainBytes < len >> 1) return buf

  
  
  
  const parts: Buffer[] = []
  let m = 0
  for (let i = 0; i < msgIdx.length; i += 3) {
    const start = msgIdx[i]!
    while (m < metaRanges.length && metaRanges[m]! < start) {
      parts.push(buf.subarray(metaRanges[m]!, metaRanges[m + 1]!))
      m += 2
    }
    if (chain.has(start)) {
      parts.push(buf.subarray(start, msgIdx[i + 1]!))
    }
  }
  while (m < metaRanges.length) {
    parts.push(buf.subarray(metaRanges[m]!, metaRanges[m + 1]!))
    m += 2
  }
  return Buffer.concat(parts)
}

export async function loadTranscriptFile(
  filePath: string,
  opts?: { keepAllLeaves?: boolean },
): Promise<{
  messages: Map<UUID, TranscriptMessage>
  summaries: Map<UUID, string>
  customTitles: Map<UUID, string>
  tags: Map<UUID, string>
  agentNames: Map<UUID, string>
  agentColors: Map<UUID, string>
  agentSettings: Map<UUID, string>
  prNumbers: Map<UUID, number>
  prUrls: Map<UUID, string>
  prRepositories: Map<UUID, string>
  modes: Map<UUID, string>
  worktreeStates: Map<UUID, PersistedWorktreeSession | null>
  fileHistorySnapshots: Map<UUID, FileHistorySnapshotMessage>
  attributionSnapshots: Map<UUID, AttributionSnapshotMessage>
  contentReplacements: Map<UUID, ContentReplacementRecord[]>
  agentContentReplacements: Map<AgentId, ContentReplacementRecord[]>
  contextCollapseCommits: ContextCollapseCommitEntry[]
  contextCollapseSnapshot: ContextCollapseSnapshotEntry | undefined
  leafUuids: Set<UUID>
}> {
  const messages = new Map<UUID, TranscriptMessage>()
  const summaries = new Map<UUID, string>()
  const customTitles = new Map<UUID, string>()
  const tags = new Map<UUID, string>()
  const agentNames = new Map<UUID, string>()
  const agentColors = new Map<UUID, string>()
  const agentSettings = new Map<UUID, string>()
  const prNumbers = new Map<UUID, number>()
  const prUrls = new Map<UUID, string>()
  const prRepositories = new Map<UUID, string>()
  const modes = new Map<UUID, string>()
  const worktreeStates = new Map<UUID, PersistedWorktreeSession | null>()
  const fileHistorySnapshots = new Map<UUID, FileHistorySnapshotMessage>()
  const attributionSnapshots = new Map<UUID, AttributionSnapshotMessage>()
  const contentReplacements = new Map<UUID, ContentReplacementRecord[]>()
  const agentContentReplacements = new Map<
    AgentId,
    ContentReplacementRecord[]
  >()
  
  const contextCollapseCommits: ContextCollapseCommitEntry[] = []
  
  let contextCollapseSnapshot: ContextCollapseSnapshotEntry | undefined

  try {
    
    
    
    
    
    
    
    
    
    
    
    
    let buf: Buffer | null = null
    let metadataLines: string[] | null = null
    let hasPreservedSegment = false
    if (!isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_PRECOMPACT_SKIP)) {
      const { size } = await stat(filePath)
      if (size > SKIP_PRECOMPACT_THRESHOLD) {
        const scan = await readTranscriptForLoad(filePath, size)
        buf = scan.postBoundaryBuf
        hasPreservedSegment = scan.hasPreservedSegment
        
        
        
        
        
        
        
        if (scan.boundaryStartOffset > 0) {
          metadataLines = await scanPreBoundaryMetadata(
            filePath,
            scan.boundaryStartOffset,
          )
        }
      }
    }
    buf ??= await readFile(filePath)
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    if (
      !opts?.keepAllLeaves &&
      !hasPreservedSegment &&
      !isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_PRECOMPACT_SKIP) &&
      buf.length > SKIP_PRECOMPACT_THRESHOLD
    ) {
      buf = walkChainBeforeParse(buf)
    }

    
    
    
    
    if (metadataLines && metadataLines.length > 0) {
      const metaEntries = parseJSONL<Entry>(
        Buffer.from(metadataLines.join('\n')),
      )
      for (const entry of metaEntries) {
        if (entry.type === 'summary' && entry.leafUuid) {
          summaries.set(entry.leafUuid, entry.summary)
        } else if (entry.type === 'custom-title' && entry.sessionId) {
          customTitles.set(entry.sessionId, entry.customTitle)
        } else if (entry.type === 'tag' && entry.sessionId) {
          tags.set(entry.sessionId, entry.tag)
        } else if (entry.type === 'agent-name' && entry.sessionId) {
          agentNames.set(entry.sessionId, entry.agentName)
        } else if (entry.type === 'agent-color' && entry.sessionId) {
          agentColors.set(entry.sessionId, entry.agentColor)
        } else if (entry.type === 'agent-setting' && entry.sessionId) {
          agentSettings.set(entry.sessionId, entry.agentSetting)
        } else if (entry.type === 'mode' && entry.sessionId) {
          modes.set(entry.sessionId, entry.mode)
        } else if (entry.type === 'worktree-state' && entry.sessionId) {
          worktreeStates.set(entry.sessionId, entry.worktreeSession)
        } else if (entry.type === 'pr-link' && entry.sessionId) {
          prNumbers.set(entry.sessionId, entry.prNumber)
          prUrls.set(entry.sessionId, entry.prUrl)
          prRepositories.set(entry.sessionId, entry.prRepository)
        }
      }
    }

    const entries = parseJSONL<Entry>(buf)

    
    
    
    
    
    
    
    const progressBridge = new Map<UUID, UUID | null>()

    for (const entry of entries) {
      
      
      
      if (isLegacyProgressEntry(entry)) {
        
        
        
        const parent = entry.parentUuid
        progressBridge.set(
          entry.uuid,
          parent && progressBridge.has(parent)
            ? (progressBridge.get(parent) ?? null)
            : parent,
        )
        continue
      }
      if (isTranscriptMessage(entry)) {
        if (entry.parentUuid && progressBridge.has(entry.parentUuid)) {
          entry.parentUuid = progressBridge.get(entry.parentUuid) ?? null
        }
        messages.set(entry.uuid, entry)
        
        
        
        
        
        
        
        if (isCompactBoundaryMessage(entry)) {
          contextCollapseCommits.length = 0
          contextCollapseSnapshot = undefined
        }
      } else if (entry.type === 'summary' && entry.leafUuid) {
        summaries.set(entry.leafUuid, entry.summary)
      } else if (entry.type === 'custom-title' && entry.sessionId) {
        customTitles.set(entry.sessionId, entry.customTitle)
      } else if (entry.type === 'tag' && entry.sessionId) {
        tags.set(entry.sessionId, entry.tag)
      } else if (entry.type === 'agent-name' && entry.sessionId) {
        agentNames.set(entry.sessionId, entry.agentName)
      } else if (entry.type === 'agent-color' && entry.sessionId) {
        agentColors.set(entry.sessionId, entry.agentColor)
      } else if (entry.type === 'agent-setting' && entry.sessionId) {
        agentSettings.set(entry.sessionId, entry.agentSetting)
      } else if (entry.type === 'mode' && entry.sessionId) {
        modes.set(entry.sessionId, entry.mode)
      } else if (entry.type === 'worktree-state' && entry.sessionId) {
        worktreeStates.set(entry.sessionId, entry.worktreeSession)
      } else if (entry.type === 'pr-link' && entry.sessionId) {
        prNumbers.set(entry.sessionId, entry.prNumber)
        prUrls.set(entry.sessionId, entry.prUrl)
        prRepositories.set(entry.sessionId, entry.prRepository)
      } else if (entry.type === 'file-history-snapshot') {
        fileHistorySnapshots.set(entry.messageId, entry)
      } else if (entry.type === 'attribution-snapshot') {
        attributionSnapshots.set(entry.messageId, entry)
      } else if (entry.type === 'content-replacement') {
        
        
        if (entry.agentId) {
          const existing = agentContentReplacements.get(entry.agentId) ?? []
          agentContentReplacements.set(entry.agentId, existing)
          existing.push(...entry.replacements)
        } else {
          const existing = contentReplacements.get(entry.sessionId) ?? []
          contentReplacements.set(entry.sessionId, existing)
          existing.push(...entry.replacements)
        }
      } else if (entry.type === 'marble-origami-commit') {
        contextCollapseCommits.push(entry)
      } else if (entry.type === 'marble-origami-snapshot') {
        contextCollapseSnapshot = entry
      }
    }
  } catch {
    
  }

  applyPreservedSegmentRelinks(messages)
  applySnipRemovals(messages)

  
  
  
  
  
  
  
  
  
  const allMessages = [...messages.values()]

  
  const parentUuids = new Set(
    allMessages
      .map(msg => msg.parentUuid)
      .filter((uuid): uuid is UUID => uuid !== null),
  )

  
  const terminalMessages = allMessages.filter(msg => !parentUuids.has(msg.uuid))

  const leafUuids = new Set<UUID>()
  let hasCycle = false

  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_pebble_leaf_prune', false)) {
    
    
    const hasUserAssistantChild = new Set<UUID>()
    for (const msg of allMessages) {
      if (msg.parentUuid && (msg.type === 'user' || msg.type === 'assistant')) {
        hasUserAssistantChild.add(msg.parentUuid)
      }
    }

    
    
    
    
    for (const terminal of terminalMessages) {
      const seen = new Set<UUID>()
      let current: TranscriptMessage | undefined = terminal
      while (current) {
        if (seen.has(current.uuid)) {
          hasCycle = true
          break
        }
        seen.add(current.uuid)
        if (current.type === 'user' || current.type === 'assistant') {
          if (!hasUserAssistantChild.has(current.uuid)) {
            leafUuids.add(current.uuid)
          }
          break
        }
        current = current.parentUuid
          ? messages.get(current.parentUuid)
          : undefined
      }
    }
  } else {
    
    
    for (const terminal of terminalMessages) {
      const seen = new Set<UUID>()
      let current: TranscriptMessage | undefined = terminal
      while (current) {
        if (seen.has(current.uuid)) {
          hasCycle = true
          break
        }
        seen.add(current.uuid)
        if (current.type === 'user' || current.type === 'assistant') {
          leafUuids.add(current.uuid)
          break
        }
        current = current.parentUuid
          ? messages.get(current.parentUuid)
          : undefined
      }
    }
  }

  if (hasCycle) {
    logEvent('tengu_transcript_parent_cycle', {})
  }

  return {
    messages,
    summaries,
    customTitles,
    tags,
    agentNames,
    agentColors,
    agentSettings,
    prNumbers,
    prUrls,
    prRepositories,
    modes,
    worktreeStates,
    fileHistorySnapshots,
    attributionSnapshots,
    contentReplacements,
    agentContentReplacements,
    contextCollapseCommits,
    contextCollapseSnapshot,
    leafUuids,
  }
}

async function loadSessionFile(sessionId: UUID): Promise<{
  messages: Map<UUID, TranscriptMessage>
  summaries: Map<UUID, string>
  customTitles: Map<UUID, string>
  tags: Map<UUID, string>
  agentSettings: Map<UUID, string>
  worktreeStates: Map<UUID, PersistedWorktreeSession | null>
  fileHistorySnapshots: Map<UUID, FileHistorySnapshotMessage>
  attributionSnapshots: Map<UUID, AttributionSnapshotMessage>
  contentReplacements: Map<UUID, ContentReplacementRecord[]>
  contextCollapseCommits: ContextCollapseCommitEntry[]
  contextCollapseSnapshot: ContextCollapseSnapshotEntry | undefined
}> {
  const sessionFile = join(
    getSessionProjectDir() ?? getProjectDir(getOriginalCwd()),
    `${sessionId}.jsonl`,
  )
  return loadTranscriptFile(sessionFile)
}

const getSessionMessages = memoize(
  async (sessionId: UUID): Promise<Set<UUID>> => {
    const { messages } = await loadSessionFile(sessionId)
    return new Set(messages.keys())
  },
  (sessionId: UUID) => sessionId,
)

export function clearSessionMessagesCache(): void {
  getSessionMessages.cache.clear?.()
}

export async function doesMessageExistInSession(
  sessionId: UUID,
  messageUuid: UUID,
): Promise<boolean> {
  const messageSet = await getSessionMessages(sessionId)
  return messageSet.has(messageUuid)
}

export async function getLastSessionLog(
  sessionId: UUID,
): Promise<LogOption | null> {
  
  const {
    messages,
    summaries,
    customTitles,
    tags,
    agentSettings,
    worktreeStates,
    fileHistorySnapshots,
    attributionSnapshots,
    contentReplacements,
    contextCollapseCommits,
    contextCollapseSnapshot,
  } = await loadSessionFile(sessionId)
  if (messages.size === 0) return null
  
  
  
  
  
  if (!getSessionMessages.cache.has(sessionId)) {
    getSessionMessages.cache.set(
      sessionId,
      Promise.resolve(new Set(messages.keys())),
    )
  }

  
  const lastMessage = findLatestMessage(messages.values(), m => !m.isSidechain)
  if (!lastMessage) return null

  
  const transcript = buildConversationChain(messages, lastMessage)

  const summary = summaries.get(lastMessage.uuid)
  const customTitle = customTitles.get(lastMessage.sessionId as UUID)
  const tag = tags.get(lastMessage.sessionId as UUID)
  const agentSetting = agentSettings.get(sessionId)
  return {
    ...convertToLogOption(
      transcript,
      0,
      summary,
      customTitle,
      buildFileHistorySnapshotChain(fileHistorySnapshots, transcript),
      tag,
      getTranscriptPathForSession(sessionId),
      buildAttributionSnapshotChain(attributionSnapshots, transcript),
      agentSetting,
      contentReplacements.get(sessionId) ?? [],
    ),
    worktreeSession: worktreeStates.get(sessionId),
    contextCollapseCommits: contextCollapseCommits.filter(
      e => e.sessionId === sessionId,
    ),
    contextCollapseSnapshot:
      contextCollapseSnapshot?.sessionId === sessionId
        ? contextCollapseSnapshot
        : undefined,
  }
}

export async function loadMessageLogs(limit?: number): Promise<LogOption[]> {
  const sessionLogs = await fetchLogs(limit)
  
  
  const { logs: enriched } = await enrichLogs(
    sessionLogs,
    0,
    sessionLogs.length,
  )

  
  
  const sorted = sortLogs(enriched)
  sorted.forEach((log, i) => {
    log.value = i
  })
  return sorted
}

export async function loadAllProjectsMessageLogs(
  limit?: number,
  options?: { skipIndex?: boolean; initialEnrichCount?: number },
): Promise<LogOption[]> {
  if (options?.skipIndex) {
    
    return loadAllProjectsMessageLogsFull(limit)
  }
  const result = await loadAllProjectsMessageLogsProgressive(
    limit,
    options?.initialEnrichCount ?? INITIAL_ENRICH_COUNT,
  )
  return result.logs
}

async function loadAllProjectsMessageLogsFull(
  limit?: number,
): Promise<LogOption[]> {
  const projectsDir = getProjectsDir()

  let dirents: Dirent[]
  try {
    dirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const projectDirs = dirents
    .filter(dirent => dirent.isDirectory())
    .map(dirent => join(projectsDir, dirent.name))

  const logsPerProject = await Promise.all(
    projectDirs.map(projectDir => getLogsWithoutIndex(projectDir, limit)),
  )
  const allLogs = logsPerProject.flat()

  
  
  const deduped = new Map<string, LogOption>()
  for (const log of allLogs) {
    const key = `${log.sessionId ?? ''}:${log.leafUuid ?? ''}`
    const existing = deduped.get(key)
    if (!existing || log.modified.getTime() > existing.modified.getTime()) {
      deduped.set(key, log)
    }
  }

  
  const sorted = sortLogs([...deduped.values()])
  sorted.forEach((log, i) => {
    log.value = i
  })
  return sorted
}

export async function loadAllProjectsMessageLogsProgressive(
  limit?: number,
  initialEnrichCount: number = INITIAL_ENRICH_COUNT,
): Promise<SessionLogResult> {
  const projectsDir = getProjectsDir()

  let dirents: Dirent[]
  try {
    dirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return { logs: [], allStatLogs: [], nextIndex: 0 }
  }

  const projectDirs = dirents
    .filter(dirent => dirent.isDirectory())
    .map(dirent => join(projectsDir, dirent.name))

  const rawLogs: LogOption[] = []
  for (const projectDir of projectDirs) {
    rawLogs.push(...(await getSessionFilesLite(projectDir, limit)))
  }
  
  const sorted = deduplicateLogsBySessionId(rawLogs)

  const { logs, nextIndex } = await enrichLogs(sorted, 0, initialEnrichCount)

  
  logs.forEach((log, i) => {
    log.value = i
  })
  return { logs, allStatLogs: sorted, nextIndex }
}

export type SessionLogResult = {
  
  logs: LogOption[]
  
  allStatLogs: LogOption[]
  
  nextIndex: number
}

export async function loadSameRepoMessageLogs(
  worktreePaths: string[],
  limit?: number,
  initialEnrichCount: number = INITIAL_ENRICH_COUNT,
): Promise<LogOption[]> {
  const result = await loadSameRepoMessageLogsProgressive(
    worktreePaths,
    limit,
    initialEnrichCount,
  )
  return result.logs
}

export async function loadSameRepoMessageLogsProgressive(
  worktreePaths: string[],
  limit?: number,
  initialEnrichCount: number = INITIAL_ENRICH_COUNT,
): Promise<SessionLogResult> {
  logForDebugging(
    `/resume: loading sessions for cwd=${getOriginalCwd()}, worktrees=[${worktreePaths.join(', ')}]`,
  )
  const allStatLogs = await getStatOnlyLogsForWorktrees(worktreePaths, limit)
  logForDebugging(`/resume: found ${allStatLogs.length} session files on disk`)

  const { logs, nextIndex } = await enrichLogs(
    allStatLogs,
    0,
    initialEnrichCount,
  )

  
  logs.forEach((log, i) => {
    log.value = i
  })
  return { logs, allStatLogs, nextIndex }
}

async function getStatOnlyLogsForWorktrees(
  worktreePaths: string[],
  limit?: number,
): Promise<LogOption[]> {
  const projectsDir = getProjectsDir()

  if (worktreePaths.length <= 1) {
    const cwd = getOriginalCwd()
    const projectDir = getProjectDir(cwd)
    return getSessionFilesLite(projectDir, undefined, cwd)
  }

  
  
  
  const caseInsensitive = process.platform === 'win32'

  
  
  
  
  const indexed = worktreePaths.map(wt => {
    const sanitized = sanitizePath(wt)
    return {
      path: wt,
      prefix: caseInsensitive ? sanitized.toLowerCase() : sanitized,
    }
  })
  indexed.sort((a, b) => b.prefix.length - a.prefix.length)

  const allLogs: LogOption[] = []
  const seenDirs = new Set<string>()

  let allDirents: Dirent[]
  try {
    allDirents = await readdir(projectsDir, { withFileTypes: true })
  } catch (e) {
    
    logForDebugging(
      `Failed to read projects dir ${projectsDir}, falling back to current project: ${e}`,
    )
    const projectDir = getProjectDir(getOriginalCwd())
    return getSessionFilesLite(projectDir, limit, getOriginalCwd())
  }

  for (const dirent of allDirents) {
    if (!dirent.isDirectory()) continue
    const dirName = caseInsensitive ? dirent.name.toLowerCase() : dirent.name
    if (seenDirs.has(dirName)) continue

    for (const { path: wtPath, prefix } of indexed) {
      if (dirName === prefix || dirName.startsWith(prefix + '-')) {
        seenDirs.add(dirName)
        allLogs.push(
          ...(await getSessionFilesLite(
            join(projectsDir, dirent.name),
            undefined,
            wtPath,
          )),
        )
        break
      }
    }
  }

  
  
  return deduplicateLogsBySessionId(allLogs)
}

export async function getAgentTranscript(agentId: AgentId): Promise<{
  messages: Message[]
  contentReplacements: ContentReplacementRecord[]
} | null> {
  const agentFile = getAgentTranscriptPath(agentId)

  try {
    const { messages, agentContentReplacements } =
      await loadTranscriptFile(agentFile)

    
    const agentMessages = Array.from(messages.values()).filter(
      msg => msg.agentId === agentId && msg.isSidechain,
    )

    if (agentMessages.length === 0) {
      return null
    }

    
    const parentUuids = new Set(agentMessages.map(msg => msg.parentUuid))
    const leafMessage = findLatestMessage(
      agentMessages,
      msg => !parentUuids.has(msg.uuid),
    )

    if (!leafMessage) {
      return null
    }

    
    const transcript = buildConversationChain(messages, leafMessage)

    
    const agentTranscript = transcript.filter(msg => msg.agentId === agentId)

    return {
      
      messages: agentTranscript.map(
        ({ isSidechain, parentUuid, ...msg }) => msg,
      ),
      contentReplacements: agentContentReplacements.get(agentId) ?? [],
    }
  } catch {
    return null
  }
}

export function extractAgentIdsFromMessages(messages: Message[]): string[] {
  const agentIds: string[] = []

  for (const message of messages) {
    if (
      message.type === 'progress' &&
      message.data &&
      typeof message.data === 'object' &&
      'type' in message.data &&
      (message.data.type === 'agent_progress' ||
        message.data.type === 'skill_progress') &&
      'agentId' in message.data &&
      typeof message.data.agentId === 'string'
    ) {
      agentIds.push(message.data.agentId)
    }
  }

  return uniq(agentIds)
}

export function extractTeammateTranscriptsFromTasks(tasks: {
  [taskId: string]: {
    type: string
    identity?: { agentId: string }
    messages?: Message[]
  }
}): { [agentId: string]: Message[] } {
  const transcripts: { [agentId: string]: Message[] } = {}

  for (const task of Object.values(tasks)) {
    if (
      task.type === 'in_process_teammate' &&
      task.identity?.agentId &&
      task.messages &&
      task.messages.length > 0
    ) {
      transcripts[task.identity.agentId] = task.messages
    }
  }

  return transcripts
}

export async function loadSubagentTranscripts(
  agentIds: string[],
): Promise<{ [agentId: string]: Message[] }> {
  const results = await Promise.all(
    agentIds.map(async agentId => {
      try {
        const result = await getAgentTranscript(asAgentId(agentId))
        if (result && result.messages.length > 0) {
          return { agentId, transcript: result.messages }
        }
        return null
      } catch {
        
        return null
      }
    }),
  )

  const transcripts: { [agentId: string]: Message[] } = {}
  for (const result of results) {
    if (result) {
      transcripts[result.agentId] = result.transcript
    }
  }
  return transcripts
}

export async function loadAllSubagentTranscriptsFromDisk(): Promise<{
  [agentId: string]: Message[]
}> {
  const subagentsDir = join(
    getSessionProjectDir() ?? getProjectDir(getOriginalCwd()),
    getSessionId(),
    'subagents',
  )
  let entries: Dirent[]
  try {
    entries = await readdir(subagentsDir, { withFileTypes: true })
  } catch {
    return {}
  }
  
  const agentIds = entries
    .filter(
      d =>
        d.isFile() && d.name.startsWith('agent-') && d.name.endsWith('.jsonl'),
    )
    .map(d => d.name.slice('agent-'.length, -'.jsonl'.length))
  return loadSubagentTranscripts(agentIds)
}

export function isLoggableMessage(m: Message): boolean {
  if (m.type === 'progress') return false
  
  
  
  
  if (m.type === 'attachment' && getUserType() !== 'ant') {
    if (
      m.attachment.type === 'hook_additional_context' &&
      isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SAVE_HOOK_ADDITIONAL_CONTEXT)
    ) {
      return true
    }
    return false
  }
  return true
}

function collectReplIds(messages: readonly Message[]): Set<string> {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.type === 'assistant' && Array.isArray(m.message.content)) {
      for (const b of m.message.content) {
        if (b.type === 'tool_use' && b.name === REPL_TOOL_NAME) {
          ids.add(b.id)
        }
      }
    }
  }
  return ids
}

function transformMessagesForExternalTranscript(
  messages: Transcript,
  replIds: Set<string>,
): Transcript {
  return messages.flatMap(m => {
    if (m.type === 'assistant' && Array.isArray(m.message.content)) {
      const content = m.message.content
      const hasRepl = content.some(
        b => b.type === 'tool_use' && b.name === REPL_TOOL_NAME,
      )
      const filtered = hasRepl
        ? content.filter(
            b => !(b.type === 'tool_use' && b.name === REPL_TOOL_NAME),
          )
        : content
      if (filtered.length === 0) return []
      if (m.isVirtual) {
        const { isVirtual: _omit, ...rest } = m
        return [{ ...rest, message: { ...m.message, content: filtered } }]
      }
      if (filtered !== content) {
        return [{ ...m, message: { ...m.message, content: filtered } }]
      }
      return [m]
    }
    if (m.type === 'user' && Array.isArray(m.message.content)) {
      const content = m.message.content
      const hasRepl = content.some(
        b => b.type === 'tool_result' && replIds.has(b.tool_use_id),
      )
      const filtered = hasRepl
        ? content.filter(
            b => !(b.type === 'tool_result' && replIds.has(b.tool_use_id)),
          )
        : content
      if (filtered.length === 0) return []
      if (m.isVirtual) {
        const { isVirtual: _omit, ...rest } = m
        return [{ ...rest, message: { ...m.message, content: filtered } }]
      }
      if (filtered !== content) {
        return [{ ...m, message: { ...m.message, content: filtered } }]
      }
      return [m]
    }
    
    if ('isVirtual' in m && m.isVirtual) {
      const { isVirtual: _omit, ...rest } = m
      return [rest]
    }
    return [m]
  }) as Transcript
}

export function cleanMessagesForLogging(
  messages: Message[],
  allMessages: readonly Message[] = messages,
): Transcript {
  const filtered = messages.filter(isLoggableMessage) as Transcript
  return getUserType() !== 'ant'
    ? transformMessagesForExternalTranscript(
        filtered,
        collectReplIds(allMessages),
      )
    : filtered
}

export async function getLogByIndex(index: number): Promise<LogOption | null> {
  const logs = await loadMessageLogs()
  return logs[index] || null
}

export async function findUnresolvedToolUse(
  toolUseId: string,
): Promise<AssistantMessage | null> {
  try {
    const transcriptPath = getTranscriptPath()
    const { messages } = await loadTranscriptFile(transcriptPath)

    let toolUseMessage = null

    
    for (const message of messages.values()) {
      if (message.type === 'assistant') {
        const content = message.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use' && block.id === toolUseId) {
              toolUseMessage = message
              break
            }
          }
        }
      } else if (message.type === 'user') {
        const content = message.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (
              block.type === 'tool_result' &&
              block.tool_use_id === toolUseId
            ) {
              
              return null
            }
          }
        }
      }
    }

    return toolUseMessage
  } catch {
    return null
  }
}

export async function getSessionFilesWithMtime(
  projectDir: string,
): Promise<
  Map<string, { path: string; mtime: number; ctime: number; size: number }>
> {
  const sessionFilesMap = new Map<
    string,
    { path: string; mtime: number; ctime: number; size: number }
  >()

  let dirents: Dirent[]
  try {
    dirents = await readdir(projectDir, { withFileTypes: true })
  } catch {
    
    return sessionFilesMap
  }

  const candidates: Array<{ sessionId: string; filePath: string }> = []
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith('.jsonl')) continue
    const sessionId = validateUuid(basename(dirent.name, '.jsonl'))
    if (!sessionId) continue
    candidates.push({ sessionId, filePath: join(projectDir, dirent.name) })
  }

  await Promise.all(
    candidates.map(async ({ sessionId, filePath }) => {
      try {
        const st = await stat(filePath)
        sessionFilesMap.set(sessionId, {
          path: filePath,
          mtime: st.mtime.getTime(),
          ctime: st.birthtime.getTime(),
          size: st.size,
        })
      } catch {
        logForDebugging(`Failed to stat session file: ${filePath}`)
      }
    }),
  )

  return sessionFilesMap
}

const INITIAL_ENRICH_COUNT = 50

type LiteMetadata = {
  firstPrompt: string
  gitBranch?: string
  isSidechain: boolean
  projectPath?: string
  teamName?: string
  customTitle?: string
  summary?: string
  tag?: string
  agentSetting?: string
  prNumber?: number
  prUrl?: string
  prRepository?: string
}

export async function loadAllLogsFromSessionFile(
  sessionFile: string,
  projectPathOverride?: string,
): Promise<LogOption[]> {
  const {
    messages,
    summaries,
    customTitles,
    tags,
    agentNames,
    agentColors,
    agentSettings,
    prNumbers,
    prUrls,
    prRepositories,
    modes,
    fileHistorySnapshots,
    attributionSnapshots,
    contentReplacements,
    leafUuids,
  } = await loadTranscriptFile(sessionFile, { keepAllLeaves: true })

  if (messages.size === 0) return []

  const leafMessages: TranscriptMessage[] = []
  
  const childrenByParent = new Map<UUID, TranscriptMessage[]>()
  for (const msg of messages.values()) {
    if (leafUuids.has(msg.uuid)) {
      leafMessages.push(msg)
    } else if (msg.parentUuid) {
      const siblings = childrenByParent.get(msg.parentUuid)
      if (siblings) {
        siblings.push(msg)
      } else {
        childrenByParent.set(msg.parentUuid, [msg])
      }
    }
  }

  const logs: LogOption[] = []

  for (const leafMessage of leafMessages) {
    const chain = buildConversationChain(messages, leafMessage)
    if (chain.length === 0) continue

    
    const trailingMessages = childrenByParent.get(leafMessage.uuid)
    if (trailingMessages) {
      
      trailingMessages.sort((a, b) =>
        a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
      )
      chain.push(...trailingMessages)
    }

    const firstMessage = chain[0]!
    const sessionId = leafMessage.sessionId as UUID

    logs.push({
      date: leafMessage.timestamp,
      messages: removeExtraFields(chain),
      fullPath: sessionFile,
      value: 0,
      created: new Date(firstMessage.timestamp),
      modified: new Date(leafMessage.timestamp),
      firstPrompt: extractFirstPrompt(chain),
      messageCount: countVisibleMessages(chain),
      isSidechain: firstMessage.isSidechain ?? false,
      sessionId,
      leafUuid: leafMessage.uuid,
      summary: summaries.get(leafMessage.uuid),
      customTitle: customTitles.get(sessionId),
      tag: tags.get(sessionId),
      agentName: agentNames.get(sessionId),
      agentColor: agentColors.get(sessionId),
      agentSetting: agentSettings.get(sessionId),
      mode: modes.get(sessionId) as LogOption['mode'],
      prNumber: prNumbers.get(sessionId),
      prUrl: prUrls.get(sessionId),
      prRepository: prRepositories.get(sessionId),
      gitBranch: leafMessage.gitBranch,
      projectPath: projectPathOverride ?? firstMessage.cwd,
      fileHistorySnapshots: buildFileHistorySnapshotChain(
        fileHistorySnapshots,
        chain,
      ),
      attributionSnapshots: buildAttributionSnapshotChain(
        attributionSnapshots,
        chain,
      ),
      contentReplacements: contentReplacements.get(sessionId) ?? [],
    })
  }

  return logs
}

async function getLogsWithoutIndex(
  projectDir: string,
  limit?: number,
): Promise<LogOption[]> {
  const sessionFilesMap = await getSessionFilesWithMtime(projectDir)
  if (sessionFilesMap.size === 0) return []

  
  let filesToProcess: Array<{ path: string; mtime: number }>
  if (limit && sessionFilesMap.size > limit) {
    filesToProcess = [...sessionFilesMap.values()]
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
  } else {
    filesToProcess = [...sessionFilesMap.values()]
  }

  const logs: LogOption[] = []
  for (const fileInfo of filesToProcess) {
    try {
      const fileLogOptions = await loadAllLogsFromSessionFile(fileInfo.path)
      logs.push(...fileLogOptions)
    } catch {
      logForDebugging(`Failed to load session file: ${fileInfo.path}`)
    }
  }

  return logs
}

async function readLiteMetadata(
  filePath: string,
  fileSize: number,
  buf: Buffer,
): Promise<LiteMetadata> {
  const { head, tail } = await readHeadAndTail(filePath, fileSize, buf)
  if (!head) return { firstPrompt: '', isSidechain: false }

  
  
  const isSidechain =
    head.includes('"isSidechain":true') || head.includes('"isSidechain": true')
  const projectPath = extractJsonStringField(head, 'cwd')
  const teamName = extractJsonStringField(head, 'teamName')
  const agentSetting = extractJsonStringField(head, 'agentSetting')

  
  
  
  
  
  const firstPrompt =
    extractLastJsonStringField(tail, 'lastPrompt') ||
    extractFirstPromptFromChunk(head) ||
    extractJsonStringFieldPrefix(head, 'content', 200) ||
    extractJsonStringFieldPrefix(head, 'text', 200) ||
    ''

  
  
  
  
  const customTitle =
    extractLastJsonStringField(tail, 'customTitle') ??
    extractLastJsonStringField(head, 'customTitle') ??
    extractLastJsonStringField(tail, 'aiTitle') ??
    extractLastJsonStringField(head, 'aiTitle')
  const summary = extractLastJsonStringField(tail, 'summary')
  const tag = extractLastJsonStringField(tail, 'tag')
  const gitBranch =
    extractLastJsonStringField(tail, 'gitBranch') ??
    extractJsonStringField(head, 'gitBranch')

  
  const prUrl = extractLastJsonStringField(tail, 'prUrl')
  const prRepository = extractLastJsonStringField(tail, 'prRepository')
  let prNumber: number | undefined
  const prNumStr = extractLastJsonStringField(tail, 'prNumber')
  if (prNumStr) {
    prNumber = parseInt(prNumStr, 10) || undefined
  }
  if (!prNumber) {
    const prNumMatch = tail.lastIndexOf('"prNumber":')
    if (prNumMatch >= 0) {
      const afterColon = tail.slice(prNumMatch + 11, prNumMatch + 25)
      const num = parseInt(afterColon.trim(), 10)
      if (num > 0) prNumber = num
    }
  }

  return {
    firstPrompt,
    gitBranch,
    isSidechain,
    projectPath,
    teamName,
    customTitle,
    summary,
    tag,
    agentSetting,
    prNumber,
    prUrl,
    prRepository,
  }
}

function extractFirstPromptFromChunk(chunk: string): string {
  let start = 0
  let hasTickMessages = false
  let firstCommandFallback = ''
  while (start < chunk.length) {
    const newlineIdx = chunk.indexOf('\n', start)
    const line =
      newlineIdx >= 0 ? chunk.slice(start, newlineIdx) : chunk.slice(start)
    start = newlineIdx >= 0 ? newlineIdx + 1 : chunk.length

    if (!line.includes('"type":"user"') && !line.includes('"type": "user"')) {
      continue
    }
    if (line.includes('"tool_result"')) continue
    if (line.includes('"isMeta":true') || line.includes('"isMeta": true'))
      continue

    try {
      const entry = jsonParse(line) as Record<string, unknown>
      if (entry.type !== 'user') continue

      const message = entry.message as Record<string, unknown> | undefined
      if (!message) continue

      const content = message.content
      
      
      
      
      const texts: string[] = []
      if (typeof content === 'string') {
        texts.push(content)
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>
          if (b.type === 'text' && typeof b.text === 'string') {
            texts.push(b.text as string)
          }
        }
      }

      for (const text of texts) {
        if (!text) continue

        let result = text.replace(/\n/g, ' ').trim()

        
        
        
        
        
        const commandNameTag = extractTag(result, COMMAND_NAME_TAG)
        if (commandNameTag) {
          const name = commandNameTag.replace(/^\
          const commandArgs = extractTag(result, 'command-args')?.trim() || ''
          if (builtInCommandNames().has(name) || !commandArgs) {
            if (!firstCommandFallback) {
              firstCommandFallback = commandNameTag
            }
            continue
          }
          
          return commandArgs
            ? `${commandNameTag} ${commandArgs}`
            : commandNameTag
        }

        
        const bashInput = extractTag(result, 'bash-input')
        if (bashInput) return `! ${bashInput}`

        if (SKIP_FIRST_PROMPT_PATTERN.test(result)) {
          if (
            (feature('PROACTIVE') || feature('KAIROS')) &&
            result.startsWith(`<${TICK_TAG}>`)
          )
            hasTickMessages = true
          continue
        }
        if (result.length > 200) {
          result = result.slice(0, 200).trim() + '…'
        }
        return result
      }
    } catch {
      continue
    }
  }
  
  
  if (firstCommandFallback) return firstCommandFallback
  
  
  if ((feature('PROACTIVE') || feature('KAIROS')) && hasTickMessages)
    return 'Proactive session'
  return ''
}

function extractJsonStringFieldPrefix(
  text: string,
  key: string,
  maxLen: number,
): string {
  const patterns = [`"${key}":"`, `"${key}": "`]
  for (const pattern of patterns) {
    const idx = text.indexOf(pattern)
    if (idx < 0) continue

    const valueStart = idx + pattern.length
    
    let i = valueStart
    let collected = 0
    while (i < text.length && collected < maxLen) {
      if (text[i] === '\\') {
        i += 2 
        collected++
        continue
      }
      if (text[i] === '"') break
      i++
      collected++
    }
    const raw = text.slice(valueStart, i)
    return raw.replace(/\\n/g, ' ').replace(/\\t/g, ' ').trim()
  }
  return ''
}

function deduplicateLogsBySessionId(logs: LogOption[]): LogOption[] {
  const deduped = new Map<string, LogOption>()
  for (const log of logs) {
    if (!log.sessionId) continue
    const existing = deduped.get(log.sessionId)
    if (!existing || log.modified.getTime() > existing.modified.getTime()) {
      deduped.set(log.sessionId, log)
    }
  }
  return sortLogs([...deduped.values()]).map((log, i) => ({
    ...log,
    value: i,
  }))
}

export async function getSessionFilesLite(
  projectDir: string,
  limit?: number,
  projectPath?: string,
): Promise<LogOption[]> {
  const sessionFilesMap = await getSessionFilesWithMtime(projectDir)

  
  let entries = [...sessionFilesMap.entries()].sort(
    (a, b) => b[1].mtime - a[1].mtime,
  )
  if (limit && entries.length > limit) {
    entries = entries.slice(0, limit)
  }

  const logs: LogOption[] = []

  for (const [sessionId, fileInfo] of entries) {
    logs.push({
      date: new Date(fileInfo.mtime).toISOString(),
      messages: [],
      isLite: true,
      fullPath: fileInfo.path,
      value: 0,
      created: new Date(fileInfo.ctime),
      modified: new Date(fileInfo.mtime),
      firstPrompt: '',
      messageCount: 0,
      fileSize: fileInfo.size,
      isSidechain: false,
      sessionId,
      projectPath,
    })
  }

  
  const sorted = sortLogs(logs)
  sorted.forEach((log, i) => {
    log.value = i
  })
  return sorted
}

async function enrichLog(
  log: LogOption,
  readBuf: Buffer,
): Promise<LogOption | null> {
  if (!log.isLite || !log.fullPath) return log

  const meta = await readLiteMetadata(log.fullPath, log.fileSize ?? 0, readBuf)

  const enriched: LogOption = {
    ...log,
    isLite: false,
    firstPrompt: meta.firstPrompt,
    gitBranch: meta.gitBranch,
    isSidechain: meta.isSidechain,
    teamName: meta.teamName,
    customTitle: meta.customTitle,
    summary: meta.summary,
    tag: meta.tag,
    agentSetting: meta.agentSetting,
    prNumber: meta.prNumber,
    prUrl: meta.prUrl,
    prRepository: meta.prRepository,
    projectPath: meta.projectPath ?? log.projectPath,
  }

  
  
  
  
  if (!enriched.firstPrompt && !enriched.customTitle) {
    enriched.firstPrompt = '(session)'
  }
  
  if (enriched.isSidechain) {
    logForDebugging(
      `Session ${log.sessionId} filtered from /resume: isSidechain=true`,
    )
    return null
  }
  if (enriched.teamName) {
    logForDebugging(
      `Session ${log.sessionId} filtered from /resume: teamName=${enriched.teamName}`,
    )
    return null
  }

  return enriched
}

export async function enrichLogs(
  allLogs: LogOption[],
  startIndex: number,
  count: number,
): Promise<{ logs: LogOption[]; nextIndex: number }> {
  const result: LogOption[] = []
  const readBuf = Buffer.alloc(LITE_READ_BUF_SIZE)
  let i = startIndex

  while (i < allLogs.length && result.length < count) {
    const log = allLogs[i]!
    i++

    const enriched = await enrichLog(log, readBuf)
    if (enriched) {
      result.push(enriched)
    }
  }

  const scanned = i - startIndex
  const filtered = scanned - result.length
  if (filtered > 0) {
    logForDebugging(
      `/resume: enriched ${scanned} sessions, ${filtered} filtered out, ${result.length} visible (${allLogs.length - i} remaining on disk)`,
    )
  }

  return { logs: result, nextIndex: i }
}
