import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { checkGate_CACHED_OR_BLOCKING } from '../../../services/analytics/growthbook.js'
import { isPolicyAllowed } from '../../../services/policyLimits/index.js'
import { detectCurrentRepositoryWithHost } from '../../detectRepository.js'
import { isEnvTruthy } from '../../envUtils.js'
import type { TodoList } from '../../todo/types.js'
import {
  checkGithubAppInstalled,
  checkHasRemoteEnvironment,
  checkIsInGitRepo,
  checkNeedsClaudeAiLogin,
} from './preconditions.js'

export type BackgroundRemoteSession = {
  id: string
  command: string
  startTime: number
  status: 'starting' | 'running' | 'completed' | 'failed' | 'killed'
  todoList: TodoList
  title: string
  type: 'remote_session'
  log: SDKMessage[]
}

export type BackgroundRemoteSessionPrecondition =
  | { type: 'not_logged_in' }
  | { type: 'no_remote_environment' }
  | { type: 'not_in_git_repo' }
  | { type: 'no_git_remote' }
  | { type: 'github_app_not_installed' }
  | { type: 'policy_blocked' }

export async function checkBackgroundRemoteSessionEligibility({
  skipBundle = false,
}: {
  skipBundle?: boolean
} = {}): Promise<BackgroundRemoteSessionPrecondition[]> {
  const errors: BackgroundRemoteSessionPrecondition[] = []

  
  if (!isPolicyAllowed('allow_remote_sessions')) {
    errors.push({ type: 'policy_blocked' })
    return errors
  }

  const [needsLogin, hasRemoteEnv, repository] = await Promise.all([
    checkNeedsClaudeAiLogin(),
    checkHasRemoteEnvironment(),
    detectCurrentRepositoryWithHost(),
  ])

  if (needsLogin) {
    errors.push({ type: 'not_logged_in' })
  }

  if (!hasRemoteEnv) {
    errors.push({ type: 'no_remote_environment' })
  }

  
  
  
  const bundleSeedGateOn =
    !skipBundle &&
    (isEnvTruthy(process.env.CCR_FORCE_BUNDLE) ||
      isEnvTruthy(process.env.CCR_ENABLE_BUNDLE) ||
      (await checkGate_CACHED_OR_BLOCKING('tengu_ccr_bundle_seed_enabled')))

  if (!checkIsInGitRepo()) {
    errors.push({ type: 'not_in_git_repo' })
  } else if (bundleSeedGateOn) {
    
  } else if (repository === null) {
    errors.push({ type: 'no_git_remote' })
  } else if (repository.host === 'github.com') {
    const hasGithubApp = await checkGithubAppInstalled(
      repository.owner,
      repository.name,
    )
    if (!hasGithubApp) {
      errors.push({ type: 'github_app_not_installed' })
    }
  }

  return errors
}
