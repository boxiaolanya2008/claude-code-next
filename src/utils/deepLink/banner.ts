

import { stat } from 'fs/promises'
import { homedir } from 'os'
import { join, sep } from 'path'
import { formatNumber, formatRelativeTimeAgo } from '../format.js'
import { getCommonDir } from '../git/gitFilesystem.js'
import { getGitDir } from '../git.js'

const STALE_FETCH_WARN_MS = 7 * 24 * 60 * 60 * 1000

const LONG_PREFILL_THRESHOLD = 1000

export type DeepLinkBannerInfo = {
  /** Resolved working directory the session launched in. */
  cwd: string
  
  prefillLength?: number
  
  repo?: string
  
  lastFetch?: Date
}

/**
 * Build the multi-line warning banner for a deep-link-originated session.
 *
 * Always shows the working directory so the user can see which CLAUDE.md
 * will load. When the link pre-filled a prompt, adds a second line prompting
 * the user to review it — the prompt itself is visible in the input box.
 *
 * When the cwd was resolved from a ?repo= slug, also shows the slug and the
 * clone's last-fetch age so the user knows which local clone was selected
 * and whether its CLAUDE.md may be stale relative to upstream.
 */
export function buildDeepLinkBanner(info: DeepLinkBannerInfo): string {
  const lines = [
    `This session was opened by an external deep link in ${tildify(info.cwd)}`,
  ]
  if (info.repo) {
    const age = info.lastFetch ? formatRelativeTimeAgo(info.lastFetch) : 'never'
    const stale =
      !info.lastFetch ||
      Date.now() - info.lastFetch.getTime() > STALE_FETCH_WARN_MS
    lines.push(
      `Resolved ${info.repo} from local clones · last fetched ${age}${stale ? ' — CLAUDE.md may be stale' : ''}`,
    )
  }
  if (info.prefillLength) {
    lines.push(
      info.prefillLength > LONG_PREFILL_THRESHOLD
        ? `The prompt below (${formatNumber(info.prefillLength)} chars) was supplied by the link — scroll to review the entire prompt before pressing Enter.`
        : 'The prompt below was supplied by the link — review carefully before pressing Enter.',
    )
  }
  return lines.join('\n')
}

/**
 * Read the mtime of .git/FETCH_HEAD, which git updates on every fetch or
 * pull. Returns undefined if the directory is not a git repo or has never
 * been fetched.
 *
 * FETCH_HEAD is per-worktree — fetching from the main worktree does not
 * touch a sibling worktree's FETCH_HEAD. When cwd is a worktree, we check
 * both and return whichever is newer so a recently-fetched main repo
 * doesn't read as "never fetched" just because the deep link landed in
 * a worktree.
 */
export async function readLastFetchTime(
  cwd: string,
): Promise<Date | undefined> {
  const gitDir = await getGitDir(cwd)
  if (!gitDir) return undefined
  const commonDir = await getCommonDir(gitDir)
  const [local, common] = await Promise.all([
    mtimeOrUndefined(join(gitDir, 'FETCH_HEAD')),
    commonDir
      ? mtimeOrUndefined(join(commonDir, 'FETCH_HEAD'))
      : Promise.resolve(undefined),
  ])
  if (local && common) return local > common ? local : common
  return local ?? common
}

async function mtimeOrUndefined(p: string): Promise<Date | undefined> {
  try {
    const { mtime } = await stat(p)
    return mtime
  } catch {
    return undefined
  }
}

/**
 * Shorten home-dir-prefixed paths to ~ notation for the banner.
 * Not using getDisplayPath() because cwd is the current working directory,
 * so the relative-path branch would collapse it to the empty string.
 */
function tildify(p: string): string {
  const home = homedir()
  if (p === home) return '~'
  if (p.startsWith(home + sep)) return '~' + p.slice(home.length)
  return p
}
