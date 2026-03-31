

import { stat } from 'fs/promises'
import { homedir } from 'os'
import { join, sep } from 'path'
import { formatNumber, formatRelativeTimeAgo } from '../format.js'
import { getCommonDir } from '../git/gitFilesystem.js'
import { getGitDir } from '../git.js'

const STALE_FETCH_WARN_MS = 7 * 24 * 60 * 60 * 1000

const LONG_PREFILL_THRESHOLD = 1000

export type DeepLinkBannerInfo = {
  
  cwd: string
  
  prefillLength?: number
  
  repo?: string
  
  lastFetch?: Date
}

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

function tildify(p: string): string {
  const home = homedir()
  if (p === home) return '~'
  if (p.startsWith(home + sep)) return '~' + p.slice(home.length)
  return p
}
