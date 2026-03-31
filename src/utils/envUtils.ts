import memoize from 'lodash-es/memoize.js'
import { homedir } from 'os'
import { join } from 'path'

export const getClaudeConfigHomeDir = memoize(
  (): string => {
    return (
      process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    ).normalize('NFC')
  },
  () => process.env.CLAUDE_CONFIG_DIR,
)

export function getTeamsDir(): string {
  return join(getClaudeConfigHomeDir(), 'teams')
}

export function hasNodeOption(flag: string): boolean {
  const nodeOptions = process.env.NODE_OPTIONS
  if (!nodeOptions) {
    return false
  }
  return nodeOptions.split(/\s+/).includes(flag)
}

export function isEnvTruthy(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false
  if (typeof envVar === 'boolean') return envVar
  const normalizedValue = envVar.toLowerCase().trim()
  return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
}

export function isEnvDefinedFalsy(
  envVar: string | boolean | undefined,
): boolean {
  if (envVar === undefined) return false
  if (typeof envVar === 'boolean') return !envVar
  if (!envVar) return false
  const normalizedValue = envVar.toLowerCase().trim()
  return ['0', 'false', 'no', 'off'].includes(normalizedValue)
}

export function isBareMode(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SIMPLE) ||
    process.argv.includes('--bare')
  )
}

export function parseEnvVars(
  rawEnvArgs: string[] | undefined,
): Record<string, string> {
  const parsedEnv: Record<string, string> = {}

  
  if (rawEnvArgs) {
    for (const envStr of rawEnvArgs) {
      const [key, ...valueParts] = envStr.split('=')
      if (!key || valueParts.length === 0) {
        throw new Error(
          `Invalid environment variable format: ${envStr}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
        )
      }
      parsedEnv[key] = valueParts.join('=')
    }
  }
  return parsedEnv
}

export function getAWSRegion(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
}

export function getDefaultVertexRegion(): string {
  return process.env.CLOUD_ML_REGION || 'us-east5'
}

export function shouldMaintainProjectWorkingDir(): boolean {
  return isEnvTruthy(process.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR)
}

export function isRunningOnHomespace(): boolean {
  return (
    process.env.USER_TYPE === 'ant' &&
    isEnvTruthy(process.env.COO_RUNNING_ON_HOMESPACE)
  )
}

export function isInProtectedNamespace(): boolean {
  
  
  if (process.env.USER_TYPE === 'ant') {
    
    return (
      require('./protectedNamespace.js') as typeof import('./protectedNamespace.js')
    ).checkProtectedNamespace()
    
  }
  return false
}

const VERTEX_REGION_OVERRIDES: ReadonlyArray<[string, string]> = [
  ['claude-haiku-4-5', 'VERTEX_REGION_CLAUDE_HAIKU_4_5'],
  ['claude-3-5-haiku', 'VERTEX_REGION_CLAUDE_3_5_HAIKU'],
  ['claude-3-5-sonnet', 'VERTEX_REGION_CLAUDE_3_5_SONNET'],
  ['claude-3-7-sonnet', 'VERTEX_REGION_CLAUDE_3_7_SONNET'],
  ['claude-opus-4-1', 'VERTEX_REGION_CLAUDE_4_1_OPUS'],
  ['claude-opus-4', 'VERTEX_REGION_CLAUDE_4_0_OPUS'],
  ['claude-sonnet-4-6', 'VERTEX_REGION_CLAUDE_4_6_SONNET'],
  ['claude-sonnet-4-5', 'VERTEX_REGION_CLAUDE_4_5_SONNET'],
  ['claude-sonnet-4', 'VERTEX_REGION_CLAUDE_4_0_SONNET'],
]

export function getVertexRegionForModel(
  model: string | undefined,
): string | undefined {
  if (model) {
    const match = VERTEX_REGION_OVERRIDES.find(([prefix]) =>
      model.startsWith(prefix),
    )
    if (match) {
      return process.env[match[1]] || getDefaultVertexRegion()
    }
  }
  return getDefaultVertexRegion()
}
