

import { feature } from "../utils/bundle-mock.ts"
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvDefinedFalsy } from '../utils/envUtils.js'
import { getAPIProvider } from '../utils/model/providers.js'
import { getWorkload } from '../utils/workloadContext.js'

const DEFAULT_PREFIX = `You are Claude Code Next, Anthropic's official CLI for Claude.`
const AGENT_SDK_CLAUDE_CODE_NEXT_PRESET_PREFIX = `You are Claude Code Next, Anthropic's official CLI for Claude, running within the Claude Agent SDK.`
const AGENT_SDK_PREFIX = `You are a Claude agent, built on Anthropic's Claude Agent SDK.`

const CLI_SYSPROMPT_PREFIX_VALUES = [
  DEFAULT_PREFIX,
  AGENT_SDK_CLAUDE_CODE_NEXT_PRESET_PREFIX,
  AGENT_SDK_PREFIX,
] as const

export type CLISyspromptPrefix = (typeof CLI_SYSPROMPT_PREFIX_VALUES)[number]

export const CLI_SYSPROMPT_PREFIXES: ReadonlySet<string> = new Set(
  CLI_SYSPROMPT_PREFIX_VALUES,
)

export function getCLISyspromptPrefix(options?: {
  isNonInteractive: boolean
  hasAppendSystemPrompt: boolean
}): CLISyspromptPrefix {
  const apiProvider = getAPIProvider()
  if (apiProvider === 'vertex') {
    return DEFAULT_PREFIX
  }

  if (options?.isNonInteractive) {
    if (options.hasAppendSystemPrompt) {
      return AGENT_SDK_CLAUDE_CODE_NEXT_PRESET_PREFIX
    }
    return AGENT_SDK_PREFIX
  }
  return DEFAULT_PREFIX
}

function isAttributionHeaderEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_NEXT_ATTRIBUTION_HEADER)) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_attribution_header', true)
}

export function getAttributionHeader(fingerprint: string): string {
  if (!isAttributionHeaderEnabled()) {
    return ''
  }

  const version = `${MACRO.VERSION}.${fingerprint}`
  const entrypoint = process.env.CLAUDE_CODE_NEXT_ENTRYPOINT ?? 'unknown'

  
  const cch = feature('NATIVE_CLIENT_ATTESTATION') ? ' cch=00000;' : ''
  
  
  
  
  
  
  const workload = getWorkload()
  const workloadPair = workload ? ` cc_workload=${workload};` : ''
  const header = `x-anthropic-billing-header: cc_version=${version}; cc_entrypoint=${entrypoint};${cch}${workloadPair}`

  logForDebugging(`attribution header ${header}`)
  return header
}
