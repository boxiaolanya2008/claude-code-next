import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { z } from 'zod/v4'
import { logForDebugging } from '../utils/debug.js'
import { isENOENT } from '../utils/errors.js'
import { getWorktreePathsPortable } from '../utils/getWorktreePathsPortable.js'
import { lazySchema } from '../utils/lazySchema.js'
import {
  getProjectsDir,
  sanitizePath,
} from '../utils/sessionStoragePortable.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

const MAX_WORKTREE_FANOUT = 50

export const BRIDGE_POINTER_TTL_MS = 4 * 60 * 60 * 1000

const BridgePointerSchema = lazySchema(() =>
  z.object({
    sessionId: z.string(),
    environmentId: z.string(),
    source: z.enum(['standalone', 'repl']),
  }),
)

export type BridgePointer = z.infer<ReturnType<typeof BridgePointerSchema>>

export function getBridgePointerPath(dir: string): string {
  return join(getProjectsDir(), sanitizePath(dir), 'bridge-pointer.json')
}

/**
 * Write the pointer. Also used to refresh mtime during long sessions —
 * calling with the same IDs is a cheap no-content-change write that bumps
 * the staleness clock. Best-effort — a crash-recovery file must never
 * itself cause a crash. Logs and swallows on error.
 */
export async function writeBridgePointer(
  dir: string,
  pointer: BridgePointer,
): Promise<void> {
  const path = getBridgePointerPath(dir)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, jsonStringify(pointer), 'utf8')
    logForDebugging(`[bridge:pointer] wrote ${path}`)
  } catch (err: unknown) {
    logForDebugging(`[bridge:pointer] write failed: ${err}`, { level: 'warn' })
  }
}

/**
 * Read the pointer and its age (ms since last write). Operates directly
 * and handles errors — no existence check (CLAUDE.md TOCTOU rule). Returns
 * null on any failure: missing file, corrupted JSON, schema mismatch, or
 * stale (mtime > 4h ago). Stale/invalid pointers are deleted so they don't
 * keep re-prompting after the backend has already GC'd the env.
 */
export async function readBridgePointer(
  dir: string,
): Promise<(BridgePointer & { ageMs: number }) | null> {
  const path = getBridgePointerPath(dir)
  let raw: string
  let mtimeMs: number
  try {
    // stat for mtime (staleness anchor), then read. Two syscalls, but both
    
    mtimeMs = (await stat(path)).mtimeMs
    raw = await readFile(path, 'utf8')
  } catch {
    return null
  }

  const parsed = BridgePointerSchema().safeParse(safeJsonParse(raw))
  if (!parsed.success) {
    logForDebugging(`[bridge:pointer] invalid schema, clearing: ${path}`)
    await clearBridgePointer(dir)
    return null
  }

  const ageMs = Math.max(0, Date.now() - mtimeMs)
  if (ageMs > BRIDGE_POINTER_TTL_MS) {
    logForDebugging(`[bridge:pointer] stale (>4h mtime), clearing: ${path}`)
    await clearBridgePointer(dir)
    return null
  }

  return { ...parsed.data, ageMs }
}

/**
 * Worktree-aware read for `--continue`. The REPL bridge writes its pointer
 * to `getOriginalCwd()` which EnterWorktreeTool/activeWorktreeSession can
 * mutate to a worktree path — but `claude remote-control --continue` runs
 * with `resolve('.')` = shell CWD. This fans out across git worktree
 * siblings to find the freshest pointer, matching /resume's semantics.
 *
 * Fast path: checks `dir` first. Only shells out to `git worktree list` if
 * that misses — the common case (pointer in launch dir) is one stat, zero
 * exec. Fanout reads run in parallel; capped at MAX_WORKTREE_FANOUT.
 *
 * Returns the pointer AND the dir it was found in, so the caller can clear
 * the right file on resume failure.
 */
export async function readBridgePointerAcrossWorktrees(
  dir: string,
): Promise<{ pointer: BridgePointer & { ageMs: number }; dir: string } | null> {
  // Fast path: current dir. Covers standalone bridge (always matches) and
  // REPL bridge when no worktree mutation happened.
  const here = await readBridgePointer(dir)
  if (here) {
    return { pointer: here, dir }
  }

  // Fanout: scan worktree siblings. getWorktreePathsPortable has a 5s
  // timeout and returns [] on any error (not a git repo, git not installed).
  const worktrees = await getWorktreePathsPortable(dir)
  if (worktrees.length <= 1) return null
  if (worktrees.length > MAX_WORKTREE_FANOUT) {
    logForDebugging(
      `[bridge:pointer] ${worktrees.length} worktrees exceeds fanout cap ${MAX_WORKTREE_FANOUT}, skipping`,
    )
    return null
  }

  // Dedupe against `dir` so we don't re-stat it. sanitizePath normalizes
  
  
  const dirKey = sanitizePath(dir)
  const candidates = worktrees.filter(wt => sanitizePath(wt) !== dirKey)

  
  
  
  const results = await Promise.all(
    candidates.map(async wt => {
      const p = await readBridgePointer(wt)
      return p ? { pointer: p, dir: wt } : null
    }),
  )

  
  
  
  let freshest: {
    pointer: BridgePointer & { ageMs: number }
    dir: string
  } | null = null
  for (const r of results) {
    if (r && (!freshest || r.pointer.ageMs < freshest.pointer.ageMs)) {
      freshest = r
    }
  }
  if (freshest) {
    logForDebugging(
      `[bridge:pointer] fanout found pointer in worktree ${freshest.dir} (ageMs=${freshest.pointer.ageMs})`,
    )
  }
  return freshest
}

/**
 * Delete the pointer. Idempotent — ENOENT is expected when the process
 * shut down clean previously.
 */
export async function clearBridgePointer(dir: string): Promise<void> {
  const path = getBridgePointerPath(dir)
  try {
    await unlink(path)
    logForDebugging(`[bridge:pointer] cleared ${path}`)
  } catch (err: unknown) {
    if (!isENOENT(err)) {
      logForDebugging(`[bridge:pointer] clear failed: ${err}`, {
        level: 'warn',
      })
    }
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return jsonParse(raw)
  } catch {
    return null
  }
}
