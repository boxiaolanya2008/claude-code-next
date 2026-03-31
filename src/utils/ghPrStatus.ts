import { execFileNoThrow } from './execFileNoThrow.js'
import { getBranch, getDefaultBranch, getIsGit } from './git.js'
import { jsonParse } from './slowOperations.js'

export type PrReviewState =
  | 'approved'
  | 'pending'
  | 'changes_requested'
  | 'draft'
  | 'merged'
  | 'closed'

export type PrStatus = {
  number: number
  url: string
  reviewState: PrReviewState
}

const GH_TIMEOUT_MS = 5000

export function deriveReviewState(
  isDraft: boolean,
  reviewDecision: string,
): PrReviewState {
  if (isDraft) return 'draft'
  switch (reviewDecision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    default:
      return 'pending'
  }
}

/**
 * Fetch PR status for the current branch using `gh pr view`.
 * Returns null on any failure (gh not installed, no PR, not in git repo, etc).
 * Also returns null if the PR's head branch is the default branch (e.g., main/master).
 */
export async function fetchPrStatus(): Promise<PrStatus | null> {
  const isGit = await getIsGit()
  if (!isGit) return null

  
  
  const [branch, defaultBranch] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
  ])
  if (branch === defaultBranch) return null

  const { stdout, code } = await execFileNoThrow(
    'gh',
    [
      'pr',
      'view',
      '--json',
      'number,url,reviewDecision,isDraft,headRefName,state',
    ],
    { timeout: GH_TIMEOUT_MS, preserveOutputOnError: false },
  )

  if (code !== 0 || !stdout.trim()) return null

  try {
    const data = jsonParse(stdout) as {
      number: number
      url: string
      reviewDecision: string
      isDraft: boolean
      headRefName: string
      state: string
    }

    // Don't show PR status for PRs from the default branch (e.g., main, master)
    // This can happen when someone opens a PR from main to another branch
    if (
      data.headRefName === defaultBranch ||
      data.headRefName === 'main' ||
      data.headRefName === 'master'
    ) {
      return null
    }

    // Don't show PR status for merged or closed PRs — `gh pr view` returns
    
    
    if (data.state === 'MERGED' || data.state === 'CLOSED') {
      return null
    }

    return {
      number: data.number,
      url: data.url,
      reviewState: deriveReviewState(data.isDraft, data.reviewDecision),
    }
  } catch {
    return null
  }
}
