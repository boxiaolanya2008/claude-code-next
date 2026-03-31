import { feature } from "../utils/bundle-mock.ts"
import {
  checkGate_CACHED_OR_BLOCKING,
  getDynamicConfig_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '../services/analytics/growthbook.js'

import * as authModule from '../utils/auth.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { lt } from '../utils/semver.js'

export function isBridgeEnabled(): boolean {
  
  
  
  return feature('BRIDGE_MODE')
    ? isClaudeAISubscriber() &&
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_ccr_bridge', false)
    : false
}

export async function isBridgeEnabledBlocking(): Promise<boolean> {
  return feature('BRIDGE_MODE')
    ? isClaudeAISubscriber() &&
        (await checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge'))
    : false
}

export async function getBridgeDisabledReason(): Promise<string | null> {
  if (feature('BRIDGE_MODE')) {
    if (!isClaudeAISubscriber()) {
      return 'Remote Control requires a claude.ai subscription. Run `claude auth login` to sign in with your claude.ai account.'
    }
    if (!hasProfileScope()) {
      return 'Remote Control requires a full-scope login token. Long-lived tokens (from `claude setup-token` or CLAUDE_CODE_NEXT_OAUTH_TOKEN) are limited to inference-only for security reasons. Run `claude auth login` to use Remote Control.'
    }
    if (!getOauthAccountInfo()?.organizationUuid) {
      return 'Unable to determine your organization for Remote Control eligibility. Run `claude auth login` to refresh your account information.'
    }
    if (!(await checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge'))) {
      return 'Remote Control is not yet enabled for your account.'
    }
    return null
  }
  return 'Remote Control is not available in this build.'
}

function isClaudeAISubscriber(): boolean {
  try {
    return authModule.isClaudeAISubscriber()
  } catch {
    return false
  }
}
function hasProfileScope(): boolean {
  try {
    return authModule.hasProfileScope()
  } catch {
    return false
  }
}
function getOauthAccountInfo(): ReturnType<
  typeof authModule.getOauthAccountInfo
> {
  try {
    return authModule.getOauthAccountInfo()
  } catch {
    return undefined
  }
}

export function isEnvLessBridgeEnabled(): boolean {
  return feature('BRIDGE_MODE')
    ? getFeatureValue_CACHED_MAY_BE_STALE('tengu_bridge_repl_v2', false)
    : false
}

export function isCseShimEnabled(): boolean {
  return feature('BRIDGE_MODE')
    ? getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_bridge_repl_v2_cse_shim_enabled',
        true,
      )
    : true
}

export function checkBridgeMinVersion(): string | null {
  
  
  
  if (feature('BRIDGE_MODE')) {
    const config = getDynamicConfig_CACHED_MAY_BE_STALE<{
      minVersion: string
    }>('tengu_bridge_min_version', { minVersion: '0.0.0' })
    if (config.minVersion && lt(MACRO.VERSION, config.minVersion)) {
      return `Your version of Claude Code Next (${MACRO.VERSION}) is too old for Remote Control.\nVersion ${config.minVersion} or higher is required. Run \`claude update\` to update.`
    }
  }
  return null
}

export function getCcrAutoConnectDefault(): boolean {
  return feature('CCR_AUTO_CONNECT')
    ? getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_harbor', false)
    : false
}

export function isCcrMirrorEnabled(): boolean {
  return feature('CCR_MIRROR')
    ? isEnvTruthy(process.env.CLAUDE_CODE_NEXT_CCR_MIRROR) ||
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_ccr_mirror', false)
    : false
}
