

import type { Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'
import { getWorktreePathsPortable } from './getWorktreePathsPortable.js'
import type { LiteSessionFile } from './sessionStoragePortable.js'
import {
  canonicalizePath,
  extractFirstPromptFromHead,
  extractJsonStringField,
  extractLastJsonStringField,
  findProjectDir,
  getProjectsDir,
  MAX_SANITIZED_LENGTH,
  readSessionLite,
  sanitizePath,
  validateUuid,
} from './sessionStoragePortable.js'

export type SessionInfo = {
  sessionId: string
  summary: string
  lastModified: number
  fileSize?: number
  customTitle?: string
  firstPrompt?: string
  gitBranch?: string
  cwd?: string
  tag?: string
  
  createdAt?: number
}

export type ListSessionsOptions = {
  /**
   * Directory to list sessions for. When provided, returns sessions for
   * this project directory (and optionally its git worktrees). When omitted,
   * returns sessions across all projects.
   */
  dir?: string
  
  limit?: number
  

  offset?: number
  

  includeWorktrees?: boolean
}

// ---------------------------------------------------------------------------

export function parseSessionInfoFromLite(
  sessionId: string,
  lite: LiteSessionFile,
  projectPath?: string,
): SessionInfo | null {
  const { head, tail, mtime, size } = lite

  
  const firstNewline = head.indexOf('\n')
  const firstLine = firstNewline >= 0 ? head.slice(0, firstNewline) : head
  if (
    firstLine.includes('"isSidechain":true') ||
    firstLine.includes('"isSidechain": true')
  ) {
    return null
  }
  // User title (customTitle) wins over AI title (aiTitle); distinct
  
  const customTitle =
    extractLastJsonStringField(tail, 'customTitle') ||
    extractLastJsonStringField(head, 'customTitle') ||
    extractLastJsonStringField(tail, 'aiTitle') ||
    extractLastJsonStringField(head, 'aiTitle') ||
    undefined
  const firstPrompt = extractFirstPromptFromHead(head) || undefined
  
  
  const firstTimestamp = extractJsonStringField(head, 'timestamp')
  let createdAt: number | undefined
  if (firstTimestamp) {
    const parsed = Date.parse(firstTimestamp)
    if (!Number.isNaN(parsed)) createdAt = parsed
  }
  // last-prompt tail entry (captured by extractFirstPrompt at write
  
  
  const summary =
    customTitle ||
    extractLastJsonStringField(tail, 'lastPrompt') ||
    extractLastJsonStringField(tail, 'summary') ||
    firstPrompt

  
  if (!summary) return null
  const gitBranch =
    extractLastJsonStringField(tail, 'gitBranch') ||
    extractJsonStringField(head, 'gitBranch') ||
    undefined
  const sessionCwd =
    extractJsonStringField(head, 'cwd') || projectPath || undefined
  
  
  // Docker tags, cloud resource tags). Mirrors sessionStorage.ts:608.
  const tagLine = tail.split('\n').findLast(l => l.startsWith('{"type":"tag"'))
  const tag = tagLine
    ? extractLastJsonStringField(tagLine, 'tag') || undefined
    : undefined

  return {
    sessionId,
    summary,
    lastModified: mtime,
    fileSize: size,
    customTitle,
    firstPrompt,
    gitBranch,
    cwd: sessionCwd,
    tag,
    createdAt,
  }
}

// ---------------------------------------------------------------------------

type Candidate = {
  sessionId: string
  filePath: string
  mtime: number
  
  projectPath?: string
}

/**
 * Lists candidate session files in a directory via readdir, optionally
 * stat'ing each for mtime. When `doStat` is false, mtime is set to 0
 * (caller must sort/dedup after reading file contents instead).
 */
export async function listCandidates(
  projectDir: string,
  doStat: boolean,
  projectPath?: string,
): Promise<Candidate[]> {
  let names: string[]
  try {
    names = await readdir(projectDir)
  } catch {
    return []
  }

  const results = await Promise.all(
    names.map(async (name): Promise<Candidate | null> => {
      if (!name.endsWith('.jsonl')) return null
      const sessionId = validateUuid(name.slice(0, -6))
      if (!sessionId) return null
      const filePath = join(projectDir, name)
      if (!doStat) return { sessionId, filePath, mtime: 0, projectPath }
      try {
        const s = await stat(filePath)
        return { sessionId, filePath, mtime: s.mtime.getTime(), projectPath }
      } catch {
        return null
      }
    }),
  )

  return results.filter((c): c is Candidate => c !== null)
}

/**
 * Reads a candidate's file contents and extracts full SessionInfo.
 * Returns null if the session should be filtered out (sidechain, no summary).
 */
async function readCandidate(c: Candidate): Promise<SessionInfo | null> {
  const lite = await readSessionLite(c.filePath)
  if (!lite) return null

  const info = parseSessionInfoFromLite(c.sessionId, lite, c.projectPath)
  if (!info) return null

  
  
  if (c.mtime) info.lastModified = c.mtime

  return info
}

// ---------------------------------------------------------------------------

const READ_BATCH_SIZE = 32

function compareDesc(a: Candidate, b: Candidate): number {
  if (b.mtime !== a.mtime) return b.mtime - a.mtime
  return b.sessionId < a.sessionId ? -1 : b.sessionId > a.sessionId ? 1 : 0
}

async function applySortAndLimit(
  candidates: Candidate[],
  limit: number | undefined,
  offset: number,
): Promise<SessionInfo[]> {
  candidates.sort(compareDesc)

  const sessions: SessionInfo[] = []
  
  const want = limit && limit > 0 ? limit : Infinity
  let skipped = 0
  
  
  
  
  const seen = new Set<string>()

  for (let i = 0; i < candidates.length && sessions.length < want; ) {
    const batchEnd = Math.min(i + READ_BATCH_SIZE, candidates.length)
    const batch = candidates.slice(i, batchEnd)
    const results = await Promise.all(batch.map(readCandidate))
    for (let j = 0; j < results.length && sessions.length < want; j++) {
      i++
      const r = results[j]
      if (!r) continue
      if (seen.has(r.sessionId)) continue
      seen.add(r.sessionId)
      if (skipped < offset) {
        skipped++
        continue
      }
      sessions.push(r)
    }
  }

  return sessions
}

/**
 * Read-all path for when no limit/offset is set. Skips the stat pass
 * entirely — reads every candidate, then sorts/dedups on real mtimes
 * from readSessionLite. Matches pre-refactor I/O cost (no extra stats).
 */
async function readAllAndSort(candidates: Candidate[]): Promise<SessionInfo[]> {
  const all = await Promise.all(candidates.map(readCandidate))
  const byId = new Map<string, SessionInfo>()
  for (const s of all) {
    if (!s) continue
    const existing = byId.get(s.sessionId)
    if (!existing || s.lastModified > existing.lastModified) {
      byId.set(s.sessionId, s)
    }
  }
  const sessions = [...byId.values()]
  sessions.sort((a, b) =>
    b.lastModified !== a.lastModified
      ? b.lastModified - a.lastModified
      : b.sessionId < a.sessionId
        ? -1
        : b.sessionId > a.sessionId
          ? 1
          : 0,
  )
  return sessions
}

// ---------------------------------------------------------------------------

async function gatherProjectCandidates(
  dir: string,
  includeWorktrees: boolean,
  doStat: boolean,
): Promise<Candidate[]> {
  const canonicalDir = await canonicalizePath(dir)

  let worktreePaths: string[]
  if (includeWorktrees) {
    try {
      worktreePaths = await getWorktreePathsPortable(canonicalDir)
    } catch {
      worktreePaths = []
    }
  } else {
    worktreePaths = []
  }

  // No worktrees (or git not available / scanning disabled) — just scan the single project dir
  if (worktreePaths.length <= 1) {
    const projectDir = await findProjectDir(canonicalDir)
    if (!projectDir) return []
    return listCandidates(projectDir, doStat, canonicalDir)
  }

  // Worktree-aware scanning: find all project dirs matching any worktree
  const projectsDir = getProjectsDir()
  const caseInsensitive = process.platform === 'win32'

  
  
  const indexed = worktreePaths.map(wt => {
    const sanitized = sanitizePath(wt)
    return {
      path: wt,
      prefix: caseInsensitive ? sanitized.toLowerCase() : sanitized,
    }
  })
  indexed.sort((a, b) => b.prefix.length - a.prefix.length)

  let allDirents: Dirent[]
  try {
    allDirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    // Fall back to single project dir
    const projectDir = await findProjectDir(canonicalDir)
    if (!projectDir) return []
    return listCandidates(projectDir, doStat, canonicalDir)
  }

  const all: Candidate[] = []
  const seenDirs = new Set<string>()

  
  
  const canonicalProjectDir = await findProjectDir(canonicalDir)
  if (canonicalProjectDir) {
    const dirBase = basename(canonicalProjectDir)
    seenDirs.add(caseInsensitive ? dirBase.toLowerCase() : dirBase)
    all.push(
      ...(await listCandidates(canonicalProjectDir, doStat, canonicalDir)),
    )
  }

  for (const dirent of allDirents) {
    if (!dirent.isDirectory()) continue
    const dirName = caseInsensitive ? dirent.name.toLowerCase() : dirent.name
    if (seenDirs.has(dirName)) continue

    for (const { path: wtPath, prefix } of indexed) {
      // Only use startsWith for truncated paths (>MAX_SANITIZED_LENGTH) where
      
      
      const isMatch =
        dirName === prefix ||
        (prefix.length >= MAX_SANITIZED_LENGTH &&
          dirName.startsWith(prefix + '-'))
      if (isMatch) {
        seenDirs.add(dirName)
        all.push(
          ...(await listCandidates(
            join(projectsDir, dirent.name),
            doStat,
            wtPath,
          )),
        )
        break
      }
    }
  }

  return all
}

/**
 * Gathers candidate session files across all project directories.
 */
async function gatherAllCandidates(doStat: boolean): Promise<Candidate[]> {
  const projectsDir = getProjectsDir()

  let dirents: Dirent[]
  try {
    dirents = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const perProject = await Promise.all(
    dirents
      .filter(d => d.isDirectory())
      .map(d => listCandidates(join(projectsDir, d.name), doStat)),
  )

  return perProject.flat()
}

/**
 * Lists sessions with metadata extracted from stat + head/tail reads.
 *
 * When `dir` is provided, returns sessions for that project directory
 * and its git worktrees. When omitted, returns sessions across all
 * projects.
 *
 * Pagination via `limit`/`offset` operates on the filtered, sorted result
 * set. When either is set, a cheap stat-only pass sorts candidates before
 * expensive head/tail reads — so `limit: 20` on a directory with 1000
 * sessions does ~1000 stats + ~20 content reads, not 1000 content reads.
 * When neither is set, stat is skipped (read-all-then-sort, same I/O cost
 * as the original implementation).
 */
export async function listSessionsImpl(
  options?: ListSessionsOptions,
): Promise<SessionInfo[]> {
  const { dir, limit, offset, includeWorktrees } = options ?? {}
  const off = offset ?? 0
  
  
  const doStat = (limit !== undefined && limit > 0) || off > 0

  const candidates = dir
    ? await gatherProjectCandidates(dir, includeWorktrees ?? true, doStat)
    : await gatherAllCandidates(doStat)

  if (!doStat) return readAllAndSort(candidates)
  return applySortAndLimit(candidates, limit, off)
}
