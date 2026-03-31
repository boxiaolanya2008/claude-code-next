

import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { fetchUltrareviewQuota } from '../../services/api/ultrareviewQuota.js'
import { fetchUtilization } from '../../services/api/usage.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  checkRemoteAgentEligibility,
  formatPreconditionError,
  getRemoteTaskSessionUrl,
  registerRemoteAgentTask,
} from '../../tasks/RemoteAgentTask/RemoteAgentTask.js'
import { isEnterpriseSubscriber, isTeamSubscriber } from '../../utils/auth.js'
import { detectCurrentRepositoryWithHost } from '../../utils/detectRepository.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { getDefaultBranch, gitExe } from '../../utils/git.js'
import { teleportToRemote } from '../../utils/teleport.js'

let sessionOverageConfirmed = false

export function confirmOverage(): void {
  sessionOverageConfirmed = true
}

export type OverageGate =
  | { kind: 'proceed'; billingNote: string }
  | { kind: 'not-enabled' }
  | { kind: 'low-balance'; available: number }
  | { kind: 'needs-confirm' }

/**
 * Determine whether the user can launch an ultrareview and under what
 * billing terms. Fetches quota and utilization in parallel.
 */
export async function checkOverageGate(): Promise<OverageGate> {
  // Team and Enterprise plans include ultrareview — no free-review quota
  
  
  if (isTeamSubscriber() || isEnterpriseSubscriber()) {
    return { kind: 'proceed', billingNote: '' }
  }

  const [quota, utilization] = await Promise.all([
    fetchUltrareviewQuota(),
    fetchUtilization().catch(() => null),
  ])

  
  // server-side billing will handle it.
  if (!quota) {
    return { kind: 'proceed', billingNote: '' }
  }

  if (quota.reviews_remaining > 0) {
    return {
      kind: 'proceed',
      billingNote: ` This is free ultrareview ${quota.reviews_used + 1} of ${quota.reviews_limit}.`,
    }
  }

  // Utilization fetch failed (transient network error, timeout, etc.) —
  
  if (!utilization) {
    return { kind: 'proceed', billingNote: '' }
  }

  // Free reviews exhausted — check Extra Usage setup.
  const extraUsage = utilization.extra_usage
  if (!extraUsage?.is_enabled) {
    logEvent('tengu_review_overage_not_enabled', {})
    return { kind: 'not-enabled' }
  }

  // Check available balance (null monthly_limit = unlimited).
  const monthlyLimit = extraUsage.monthly_limit
  const usedCredits = extraUsage.used_credits ?? 0
  const available =
    monthlyLimit === null || monthlyLimit === undefined
      ? Infinity
      : monthlyLimit - usedCredits

  if (available < 10) {
    logEvent('tengu_review_overage_low_balance', { available })
    return { kind: 'low-balance', available }
  }

  if (!sessionOverageConfirmed) {
    logEvent('tengu_review_overage_dialog_shown', {})
    return { kind: 'needs-confirm' }
  }

  return {
    kind: 'proceed',
    billingNote: ' This review bills as Extra Usage.',
  }
}

/**
 * Launch a teleported review session. Returns ContentBlockParam[] describing
 * the launch outcome for injection into the local conversation (model is then
 * queried with this content, so it can narrate the launch to the user).
 *
 * Returns ContentBlockParam[] with user-facing error messages on recoverable
 * failures (missing merge-base, empty diff, bundle too large), or null on
 * other failures so the caller falls through to the local-review prompt.
 * Reason is captured in analytics.
 *
 * Caller must run checkOverageGate() BEFORE calling this function
 * (ultrareviewCommand.tsx handles the dialog).
 */
export async function launchRemoteReview(
  args: string,
  context: ToolUseContext,
  billingNote?: string,
): Promise<ContentBlockParam[] | null> {
  const eligibility = await checkRemoteAgentEligibility()
  
  
  
  
  if (!eligibility.eligible) {
    const blockers = eligibility.errors.filter(
      e => e.type !== 'no_remote_environment',
    )
    if (blockers.length > 0) {
      logEvent('tengu_review_remote_precondition_failed', {
        precondition_errors: blockers
          .map(e => e.type)
          .join(
            ',',
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      const reasons = blockers.map(formatPreconditionError).join('\n')
      return [
        {
          type: 'text',
          text: `Ultrareview cannot launch:\n${reasons}`,
        },
      ]
    }
  }

  const resolvedBillingNote = billingNote ?? ''

  const prNumber = args.trim()
  const isPrNumber = /^\d+$/.test(prNumber)
  
  // UUID{...,0x02}) encodes with version prefix '01' — NOT Python's
  // legacy tagged_id() format. Verified in prod.
  const CODE_REVIEW_ENV_ID = 'env_011111111111111111111113'
  // Lite-review bypasses bughunter.go entirely, so it doesn't see the
  
  
  
  
  
  
  
  
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<Record<
    string,
    unknown
  > | null>('tengu_review_bughunter_config', null)
  const posInt = (v: unknown, fallback: number, max?: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
    const n = Math.floor(v)
    if (n <= 0) return fallback
    return max !== undefined && n > max ? fallback : n
  }
  // Upper bounds: 27min on wallclock leaves ~3min for finalization under
  
  
  const commonEnvVars = {
    BUGHUNTER_DRY_RUN: '1',
    BUGHUNTER_FLEET_SIZE: String(posInt(raw?.fleet_size, 5, 20)),
    BUGHUNTER_MAX_DURATION: String(posInt(raw?.max_duration_minutes, 10, 25)),
    BUGHUNTER_AGENT_TIMEOUT: String(
      posInt(raw?.agent_timeout_seconds, 600, 1800),
    ),
    BUGHUNTER_TOTAL_WALLCLOCK: String(
      posInt(raw?.total_wallclock_minutes, 22, 27),
    ),
    ...(process.env.BUGHUNTER_DEV_BUNDLE_B64 && {
      BUGHUNTER_DEV_BUNDLE_B64: process.env.BUGHUNTER_DEV_BUNDLE_B64,
    }),
  }

  let session
  let command
  let target
  if (isPrNumber) {
    // PR mode: refs/pull/N/head via github.com. Orchestrator --pr N.
    const repo = await detectCurrentRepositoryWithHost()
    if (!repo || repo.host !== 'github.com') {
      logEvent('tengu_review_remote_precondition_failed', {})
      return null
    }
    session = await teleportToRemote({
      initialMessage: null,
      description: `ultrareview: ${repo.owner}/${repo.name}#${prNumber}`,
      signal: context.abortController.signal,
      branchName: `refs/pull/${prNumber}/head`,
      environmentId: CODE_REVIEW_ENV_ID,
      environmentVariables: {
        BUGHUNTER_PR_NUMBER: prNumber,
        BUGHUNTER_REPOSITORY: `${repo.owner}/${repo.name}`,
        ...commonEnvVars,
      },
    })
    command = `/ultrareview ${prNumber}`
    target = `${repo.owner}/${repo.name}#${prNumber}`
  } else {
    // Branch mode: bundle the working tree, orchestrator diffs against
    
    const baseBranch = (await getDefaultBranch()) || 'main'
    
    
    
    
    const { stdout: mbOut, code: mbCode } = await execFileNoThrow(
      gitExe(),
      ['merge-base', baseBranch, 'HEAD'],
      { preserveOutputOnError: false },
    )
    const mergeBaseSha = mbOut.trim()
    if (mbCode !== 0 || !mergeBaseSha) {
      logEvent('tengu_review_remote_precondition_failed', {})
      return [
        {
          type: 'text',
          text: `Could not find merge-base with ${baseBranch}. Make sure you're in a git repo with a ${baseBranch} branch.`,
        },
      ]
    }

    // Bail early on empty diffs instead of launching a container that
    
    const { stdout: diffStat, code: diffCode } = await execFileNoThrow(
      gitExe(),
      ['diff', '--shortstat', mergeBaseSha],
      { preserveOutputOnError: false },
    )
    if (diffCode === 0 && !diffStat.trim()) {
      logEvent('tengu_review_remote_precondition_failed', {})
      return [
        {
          type: 'text',
          text: `No changes against the ${baseBranch} fork point. Make some commits or stage files first.`,
        },
      ]
    }

    session = await teleportToRemote({
      initialMessage: null,
      description: `ultrareview: ${baseBranch}`,
      signal: context.abortController.signal,
      useBundle: true,
      environmentId: CODE_REVIEW_ENV_ID,
      environmentVariables: {
        BUGHUNTER_BASE_BRANCH: mergeBaseSha,
        ...commonEnvVars,
      },
    })
    if (!session) {
      logEvent('tengu_review_remote_teleport_failed', {})
      return [
        {
          type: 'text',
          text: 'Repo is too large. Push a PR and use `/ultrareview <PR#>` instead.',
        },
      ]
    }
    command = '/ultrareview'
    target = baseBranch
  }

  if (!session) {
    logEvent('tengu_review_remote_teleport_failed', {})
    return null
  }
  registerRemoteAgentTask({
    remoteTaskType: 'ultrareview',
    session,
    command,
    context,
    isRemoteReview: true,
  })
  logEvent('tengu_review_remote_launched', {})
  const sessionUrl = getRemoteTaskSessionUrl(session.id)
  
  
  
  return [
    {
      type: 'text',
      text: `Ultrareview launched for ${target} (~10–20 min, runs in the cloud). Track: ${sessionUrl}${resolvedBillingNote} Findings arrive via task-notification. Briefly acknowledge the launch to the user without repeating the target or URL — both are already visible in the tool output above.`,
    },
  ]
}
