import { appendFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getProjectRoot, getSessionId } from './bootstrap/state.js'
import { registerCleanup } from './utils/cleanupRegistry.js'
import type { HistoryEntry, PastedContent } from './utils/config.js'
import { logForDebugging } from './utils/debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './utils/envUtils.js'
import { getErrnoCode } from './utils/errors.js'
import { readLinesReverse } from './utils/fsOperations.js'
import { lock } from './utils/lockfile.js'
import {
  hashPastedText,
  retrievePastedText,
  storePastedText,
} from './utils/pasteStore.js'
import { sleep } from './utils/sleep.js'
import { jsonParse, jsonStringify } from './utils/slowOperations.js'

const MAX_HISTORY_ITEMS = 100
const MAX_PASTED_CONTENT_LENGTH = 1024

type StoredPastedContent = {
  id: number
  type: 'text' | 'image'
  content?: string 
  contentHash?: string 
  mediaType?: string
  filename?: string
}

export function getPastedTextRefNumLines(text: string): number {
  return (text.match(/\r\n|\r|\n/g) || []).length
}

export function formatPastedTextRef(id: number, numLines: number): string {
  if (numLines === 0) {
    return `[Pasted text #${id}]`
  }
  return `[Pasted text #${id} +${numLines} lines]`
}

export function formatImageRef(id: number): string {
  return `[Image #${id}]`
}

export function parseReferences(
  input: string,
): Array<{ id: number; match: string; index: number }> {
  const referencePattern =
    /\[(Pasted text|Image|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g
  const matches = [...input.matchAll(referencePattern)]
  return matches
    .map(match => ({
      id: parseInt(match[2] || '0'),
      match: match[0],
      index: match.index,
    }))
    .filter(match => match.id > 0)
}

export function expandPastedTextRefs(
  input: string,
  pastedContents: Record<number, PastedContent>,
): string {
  const refs = parseReferences(input)
  let expanded = input
  
  
  
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!
    const content = pastedContents[ref.id]
    if (content?.type !== 'text') continue
    expanded =
      expanded.slice(0, ref.index) +
      content.content +
      expanded.slice(ref.index + ref.match.length)
  }
  return expanded
}

function deserializeLogEntry(line: string): LogEntry {
  return jsonParse(line) as LogEntry
}

async function* makeLogEntryReader(): AsyncGenerator<LogEntry> {
  const currentSession = getSessionId()

  
  for (let i = pendingEntries.length - 1; i >= 0; i--) {
    yield pendingEntries[i]!
  }

  
  const historyPath = join(getClaudeConfigHomeDir(), 'history.jsonl')

  try {
    for await (const line of readLinesReverse(historyPath)) {
      try {
        const entry = deserializeLogEntry(line)
        
        
        
        if (
          entry.sessionId === currentSession &&
          skippedTimestamps.has(entry.timestamp)
        ) {
          continue
        }
        yield entry
      } catch (error) {
        
        logForDebugging(`Failed to parse history line: ${error}`)
      }
    }
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT') {
      return
    }
    throw e
  }
}

export async function* makeHistoryReader(): AsyncGenerator<HistoryEntry> {
  for await (const entry of makeLogEntryReader()) {
    yield await logEntryToHistoryEntry(entry)
  }
}

export type TimestampedHistoryEntry = {
  display: string
  timestamp: number
  resolve: () => Promise<HistoryEntry>
}

export async function* getTimestampedHistory(): AsyncGenerator<TimestampedHistoryEntry> {
  const currentProject = getProjectRoot()
  const seen = new Set<string>()

  for await (const entry of makeLogEntryReader()) {
    if (!entry || typeof entry.project !== 'string') continue
    if (entry.project !== currentProject) continue
    if (seen.has(entry.display)) continue
    seen.add(entry.display)

    yield {
      display: entry.display,
      timestamp: entry.timestamp,
      resolve: () => logEntryToHistoryEntry(entry),
    }

    if (seen.size >= MAX_HISTORY_ITEMS) return
  }
}

export async function* getHistory(): AsyncGenerator<HistoryEntry> {
  const currentProject = getProjectRoot()
  const currentSession = getSessionId()
  const otherSessionEntries: LogEntry[] = []
  let yielded = 0

  for await (const entry of makeLogEntryReader()) {
    
    if (!entry || typeof entry.project !== 'string') continue
    if (entry.project !== currentProject) continue

    if (entry.sessionId === currentSession) {
      yield await logEntryToHistoryEntry(entry)
      yielded++
    } else {
      otherSessionEntries.push(entry)
    }

    
    if (yielded + otherSessionEntries.length >= MAX_HISTORY_ITEMS) break
  }

  for (const entry of otherSessionEntries) {
    if (yielded >= MAX_HISTORY_ITEMS) return
    yield await logEntryToHistoryEntry(entry)
    yielded++
  }
}

type LogEntry = {
  display: string
  pastedContents: Record<number, StoredPastedContent>
  timestamp: number
  project: string
  sessionId?: string
}

async function resolveStoredPastedContent(
  stored: StoredPastedContent,
): Promise<PastedContent | null> {
  
  if (stored.content) {
    return {
      id: stored.id,
      type: stored.type,
      content: stored.content,
      mediaType: stored.mediaType,
      filename: stored.filename,
    }
  }

  
  if (stored.contentHash) {
    const content = await retrievePastedText(stored.contentHash)
    if (content) {
      return {
        id: stored.id,
        type: stored.type,
        content,
        mediaType: stored.mediaType,
        filename: stored.filename,
      }
    }
  }

  
  return null
}

async function logEntryToHistoryEntry(entry: LogEntry): Promise<HistoryEntry> {
  const pastedContents: Record<number, PastedContent> = {}

  for (const [id, stored] of Object.entries(entry.pastedContents || {})) {
    const resolved = await resolveStoredPastedContent(stored)
    if (resolved) {
      pastedContents[Number(id)] = resolved
    }
  }

  return {
    display: entry.display,
    pastedContents,
  }
}

let pendingEntries: LogEntry[] = []
let isWriting = false
let currentFlushPromise: Promise<void> | null = null
let cleanupRegistered = false
let lastAddedEntry: LogEntry | null = null

const skippedTimestamps = new Set<number>()

async function immediateFlushHistory(): Promise<void> {
  if (pendingEntries.length === 0) {
    return
  }

  let release
  try {
    const historyPath = join(getClaudeConfigHomeDir(), 'history.jsonl')

    
    await writeFile(historyPath, '', {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'a',
    })

    release = await lock(historyPath, {
      stale: 10000,
      retries: {
        retries: 3,
        minTimeout: 50,
      },
    })

    const jsonLines = pendingEntries.map(entry => jsonStringify(entry) + '\n')
    pendingEntries = []

    await appendFile(historyPath, jsonLines.join(''), { mode: 0o600 })
  } catch (error) {
    logForDebugging(`Failed to write prompt history: ${error}`)
  } finally {
    if (release) {
      await release()
    }
  }
}

async function flushPromptHistory(retries: number): Promise<void> {
  if (isWriting || pendingEntries.length === 0) {
    return
  }

  
  if (retries > 5) {
    return
  }

  isWriting = true

  try {
    await immediateFlushHistory()
  } finally {
    isWriting = false

    if (pendingEntries.length > 0) {
      
      await sleep(500)

      void flushPromptHistory(retries + 1)
    }
  }
}

async function addToPromptHistory(
  command: HistoryEntry | string,
): Promise<void> {
  const entry =
    typeof command === 'string'
      ? { display: command, pastedContents: {} }
      : command

  const storedPastedContents: Record<number, StoredPastedContent> = {}
  if (entry.pastedContents) {
    for (const [id, content] of Object.entries(entry.pastedContents)) {
      
      if (content.type === 'image') {
        continue
      }

      
      if (content.content.length <= MAX_PASTED_CONTENT_LENGTH) {
        storedPastedContents[Number(id)] = {
          id: content.id,
          type: content.type,
          content: content.content,
          mediaType: content.mediaType,
          filename: content.filename,
        }
      } else {
        
        
        const hash = hashPastedText(content.content)
        storedPastedContents[Number(id)] = {
          id: content.id,
          type: content.type,
          contentHash: hash,
          mediaType: content.mediaType,
          filename: content.filename,
        }
        
        void storePastedText(hash, content.content)
      }
    }
  }

  const logEntry: LogEntry = {
    ...entry,
    pastedContents: storedPastedContents,
    timestamp: Date.now(),
    project: getProjectRoot(),
    sessionId: getSessionId(),
  }

  pendingEntries.push(logEntry)
  lastAddedEntry = logEntry
  currentFlushPromise = flushPromptHistory(0)
  void currentFlushPromise
}

export function addToHistory(command: HistoryEntry | string): void {
  
  
  if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SKIP_PROMPT_HISTORY)) {
    return
  }

  
  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(async () => {
      
      if (currentFlushPromise) {
        await currentFlushPromise
      }
      
      if (pendingEntries.length > 0) {
        await immediateFlushHistory()
      }
    })
  }

  void addToPromptHistory(command)
}

export function clearPendingHistoryEntries(): void {
  pendingEntries = []
  lastAddedEntry = null
  skippedTimestamps.clear()
}

export function removeLastFromHistory(): void {
  if (!lastAddedEntry) return
  const entry = lastAddedEntry
  lastAddedEntry = null

  const idx = pendingEntries.lastIndexOf(entry)
  if (idx !== -1) {
    pendingEntries.splice(idx, 1)
  } else {
    skippedTimestamps.add(entry.timestamp)
  }
}
