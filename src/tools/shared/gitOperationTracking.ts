

import { getCommitCounter, getPrCounter } from '../../bootstrap/state.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'

function gitCmdRe(subcmd: string, suffix = ''): RegExp {
  return new RegExp(
    `\\bgit(?:\\s+-[cC]\\s+\\S+|\\s+--\\S+=\\S+)*\\s+${subcmd}\\b${suffix}`,
  )
}

const GIT_COMMIT_RE = gitCmdRe('commit')
const GIT_PUSH_RE = gitCmdRe('push')
const GIT_CHERRY_PICK_RE = gitCmdRe('cherry-pick')
const GIT_MERGE_RE = gitCmdRe('merge', '(?!-)')
const GIT_REBASE_RE = gitCmdRe('rebase')

export type CommitKind = 'committed' | 'amended' | 'cherry-picked'
export type BranchAction = 'merged' | 'rebased'
export type PrAction =
  | 'created'
  | 'edited'
  | 'merged'
  | 'commented'
  | 'closed'
  | 'ready'

const GH_PR_ACTIONS: readonly { re: RegExp; action: PrAction; op: string }[] = [
  { re: /\bgh\s+pr\s+create\b/, action: 'created', op: 'pr_create' },
  { re: /\bgh\s+pr\s+edit\b/, action: 'edited', op: 'pr_edit' },
  { re: /\bgh\s+pr\s+merge\b/, action: 'merged', op: 'pr_merge' },
  { re: /\bgh\s+pr\s+comment\b/, action: 'commented', op: 'pr_comment' },
  { re: /\bgh\s+pr\s+close\b/, action: 'closed', op: 'pr_close' },
  { re: /\bgh\s+pr\s+ready\b/, action: 'ready', op: 'pr_ready' },
]

function parsePrUrl(
  url: string,
): { prNumber: number; prUrl: string; prRepository: string } | null {
  const match = url.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (match?.[1] && match?.[2]) {
    return {
      prNumber: parseInt(match[2], 10),
      prUrl: url,
      prRepository: match[1],
    }
  }
  return null
}

function findPrInStdout(stdout: string): ReturnType<typeof parsePrUrl> {
  const m = stdout.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/)
  return m ? parsePrUrl(m[0]) : null
}

export function parseGitCommitId(stdout: string): string | undefined {
  
  
  const match = stdout.match(/\[[\w./-]+(?: \(root-commit\))? ([0-9a-f]+)\]/)
  return match?.[1]
}

function parseGitPushBranch(output: string): string | undefined {
  const match = output.match(
    /^\s*[+\-*!= ]?\s*(?:\[new branch\]|\S+\.\.+\S+)\s+\S+\s*->\s*(\S+)/m,
  )
  return match?.[1]
}

function parsePrNumberFromText(stdout: string): number | undefined {
  const match = stdout.match(/[Pp]ull request (?:\S+#)?#?(\d+)/)
  return match?.[1] ? parseInt(match[1], 10) : undefined
}

function parseRefFromCommand(
  command: string,
  verb: string,
): string | undefined {
  const after = command.split(gitCmdRe(verb))[1]
  if (!after) return undefined
  for (const t of after.trim().split(/\s+/)) {
    if (/^[&|;><]/.test(t)) break
    if (t.startsWith('-')) continue
    return t
  }
  return undefined
}

export function detectGitOperation(
  command: string,
  output: string,
): {
  commit?: { sha: string; kind: CommitKind }
  push?: { branch: string }
  branch?: { ref: string; action: BranchAction }
  pr?: { number: number; url?: string; action: PrAction }
} {
  const result: ReturnType<typeof detectGitOperation> = {}
  
  const isCherryPick = GIT_CHERRY_PICK_RE.test(command)
  if (GIT_COMMIT_RE.test(command) || isCherryPick) {
    const sha = parseGitCommitId(output)
    if (sha) {
      result.commit = {
        sha: sha.slice(0, 6),
        kind: isCherryPick
          ? 'cherry-picked'
          : /--amend\b/.test(command)
            ? 'amended'
            : 'committed',
      }
    }
  }
  if (GIT_PUSH_RE.test(command)) {
    const branch = parseGitPushBranch(output)
    if (branch) result.push = { branch }
  }
  if (
    GIT_MERGE_RE.test(command) &&
    /(Fast-forward|Merge made by)/.test(output)
  ) {
    const ref = parseRefFromCommand(command, 'merge')
    if (ref) result.branch = { ref, action: 'merged' }
  }
  if (GIT_REBASE_RE.test(command) && /Successfully rebased/.test(output)) {
    const ref = parseRefFromCommand(command, 'rebase')
    if (ref) result.branch = { ref, action: 'rebased' }
  }
  const prAction = GH_PR_ACTIONS.find(a => a.re.test(command))?.action
  if (prAction) {
    const pr = findPrInStdout(output)
    if (pr) {
      result.pr = { number: pr.prNumber, url: pr.prUrl, action: prAction }
    } else {
      const num = parsePrNumberFromText(output)
      if (num) result.pr = { number: num, action: prAction }
    }
  }
  return result
}

export function trackGitOperations(
  command: string,
  exitCode: number,
  stdout?: string,
): void {
  const success = exitCode === 0
  if (!success) {
    return
  }

  if (GIT_COMMIT_RE.test(command)) {
    logEvent('tengu_git_operation', {
      operation:
        'commit' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (command.match(/--amend\b/)) {
      logEvent('tengu_git_operation', {
        operation:
          'commit_amend' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    getCommitCounter()?.add(1)
  }
  if (GIT_PUSH_RE.test(command)) {
    logEvent('tengu_git_operation', {
      operation:
        'push' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  const prHit = GH_PR_ACTIONS.find(a => a.re.test(command))
  if (prHit) {
    logEvent('tengu_git_operation', {
      operation:
        prHit.op as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  if (prHit?.action === 'created') {
    getPrCounter()?.add(1)
    
    if (stdout) {
      const prInfo = findPrInStdout(stdout)
      if (prInfo) {
        
        void import('../../utils/sessionStorage.js').then(
          ({ linkSessionToPR }) => {
            void import('../../bootstrap/state.js').then(({ getSessionId }) => {
              const sessionId = getSessionId()
              if (sessionId) {
                void linkSessionToPR(
                  sessionId as `${string}-${string}-${string}-${string}-${string}`,
                  prInfo.prNumber,
                  prInfo.prUrl,
                  prInfo.prRepository,
                )
              }
            })
          },
        )
      }
    }
  }
  if (command.match(/\bglab\s+mr\s+create\b/)) {
    logEvent('tengu_git_operation', {
      operation:
        'pr_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    getPrCounter()?.add(1)
  }
  
  
  
  const isCurlPost =
    command.match(/\bcurl\b/) &&
    (command.match(/-X\s*POST\b/i) ||
      command.match(/--request\s*=?\s*POST\b/i) ||
      command.match(/\s-d\s/))
  
  
  const isPrEndpoint = command.match(
    /https?:\/\/[^\s'"]*\/(pulls|pull-requests|merge[-_]requests)(?!\/\d)/i,
  )
  if (isCurlPost && isPrEndpoint) {
    logEvent('tengu_git_operation', {
      operation:
        'pr_create' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    getPrCounter()?.add(1)
  }
}
