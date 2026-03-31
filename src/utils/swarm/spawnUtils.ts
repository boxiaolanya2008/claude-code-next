

import {
  getChromeFlagOverride,
  getFlagSettingsPath,
  getInlinePlugins,
  getMainLoopModelOverride,
  getSessionBypassPermissionsMode,
} from '../../bootstrap/state.js'
import { quote } from '../bash/shellQuote.js'
import { isInBundledMode } from '../bundledMode.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getTeammateModeFromSnapshot } from './backends/teammateModeSnapshot.js'
import { TEAMMATE_COMMAND_ENV_VAR } from './constants.js'

export function getTeammateCommand(): string {
  if (process.env[TEAMMATE_COMMAND_ENV_VAR]) {
    return process.env[TEAMMATE_COMMAND_ENV_VAR]
  }
  return isInBundledMode() ? process.execPath : process.argv[1]!
}

export function buildInheritedCliFlags(options?: {
  planModeRequired?: boolean
  permissionMode?: PermissionMode
}): string {
  const flags: string[] = []
  const { planModeRequired, permissionMode } = options || {}

  
  
  if (planModeRequired) {
    
  } else if (
    permissionMode === 'bypassPermissions' ||
    getSessionBypassPermissionsMode()
  ) {
    flags.push('--dangerously-skip-permissions')
  } else if (permissionMode === 'acceptEdits') {
    flags.push('--permission-mode acceptEdits')
  }

  
  const modelOverride = getMainLoopModelOverride()
  if (modelOverride) {
    flags.push(`--model ${quote([modelOverride])}`)
  }

  
  const settingsPath = getFlagSettingsPath()
  if (settingsPath) {
    flags.push(`--settings ${quote([settingsPath])}`)
  }

  
  const inlinePlugins = getInlinePlugins()
  for (const pluginDir of inlinePlugins) {
    flags.push(`--plugin-dir ${quote([pluginDir])}`)
  }

  
  const sessionMode = getTeammateModeFromSnapshot()
  flags.push(`--teammate-mode ${sessionMode}`)

  
  const chromeFlagOverride = getChromeFlagOverride()
  if (chromeFlagOverride === true) {
    flags.push('--chrome')
  } else if (chromeFlagOverride === false) {
    flags.push('--no-chrome')
  }

  return flags.join(' ')
}

const TEAMMATE_ENV_VARS = [
  
  
  'CLAUDE_CODE_NEXT_USE_BEDROCK',
  'CLAUDE_CODE_NEXT_USE_VERTEX',
  'CLAUDE_CODE_NEXT_USE_FOUNDRY',
  
  'ANTHROPIC_BASE_URL',
  
  'CLAUDE_CONFIG_DIR',
  
  
  
  'CLAUDE_CODE_NEXT_REMOTE',
  
  
  
  'CLAUDE_CODE_NEXT_REMOTE_MEMORY_DIR',
  
  
  
  
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
] as const

export function buildInheritedEnvVars(): string {
  const envVars = ['CLAUDECODE=1', 'CLAUDE_CODE_NEXT_EXPERIMENTAL_AGENT_TEAMS=1']

  for (const key of TEAMMATE_ENV_VARS) {
    const value = process.env[key]
    if (value !== undefined && value !== '') {
      envVars.push(`${key}=${quote([value])}`)
    }
  }

  return envVars.join(' ')
}
