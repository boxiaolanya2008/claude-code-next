import { z } from 'zod/v4'
import { getFeatureValue_DEPRECATED } from '../services/analytics/growthbook.js'
import { lazySchema } from '../utils/lazySchema.js'
import { lt } from '../utils/semver.js'
import { isEnvLessBridgeEnabled } from './bridgeEnabled.js'

export type EnvLessBridgeConfig = {
  
  init_retry_max_attempts: number
  init_retry_base_delay_ms: number
  init_retry_jitter_fraction: number
  init_retry_max_delay_ms: number
  
  http_timeout_ms: number
  
  uuid_dedup_buffer_size: number
  
  heartbeat_interval_ms: number
  
  heartbeat_jitter_fraction: number
  
  
  token_refresh_buffer_ms: number
  
  
  
  
  teardown_archive_timeout_ms: number
  
  
  
  
  connect_timeout_ms: number
  
  
  
  min_version: string
  
  
  
  should_show_app_upgrade_message: boolean
}

export const DEFAULT_ENV_LESS_BRIDGE_CONFIG: EnvLessBridgeConfig = {
  init_retry_max_attempts: 3,
  init_retry_base_delay_ms: 500,
  init_retry_jitter_fraction: 0.25,
  init_retry_max_delay_ms: 4000,
  http_timeout_ms: 10_000,
  uuid_dedup_buffer_size: 2000,
  heartbeat_interval_ms: 20_000,
  heartbeat_jitter_fraction: 0.1,
  token_refresh_buffer_ms: 300_000,
  teardown_archive_timeout_ms: 1500,
  connect_timeout_ms: 15_000,
  min_version: '0.0.0',
  should_show_app_upgrade_message: false,
}

const envLessBridgeConfigSchema = lazySchema(() =>
  z.object({
    init_retry_max_attempts: z.number().int().min(1).max(10).default(3),
    init_retry_base_delay_ms: z.number().int().min(100).default(500),
    init_retry_jitter_fraction: z.number().min(0).max(1).default(0.25),
    init_retry_max_delay_ms: z.number().int().min(500).default(4000),
    http_timeout_ms: z.number().int().min(2000).default(10_000),
    uuid_dedup_buffer_size: z.number().int().min(100).max(50_000).default(2000),
    
    heartbeat_interval_ms: z
      .number()
      .int()
      .min(5000)
      .max(30_000)
      .default(20_000),
    
    
    heartbeat_jitter_fraction: z.number().min(0).max(0.5).default(0.1),
    
    
    
    
    
    
    token_refresh_buffer_ms: z
      .number()
      .int()
      .min(30_000)
      .max(1_800_000)
      .default(300_000),
    
    
    teardown_archive_timeout_ms: z
      .number()
      .int()
      .min(500)
      .max(2000)
      .default(1500),
    
    
    
    connect_timeout_ms: z.number().int().min(5_000).max(60_000).default(15_000),
    min_version: z
      .string()
      .refine(v => {
        try {
          lt(v, '0.0.0')
          return true
        } catch {
          return false
        }
      })
      .default('0.0.0'),
    should_show_app_upgrade_message: z.boolean().default(false),
  }),
)

export async function getEnvLessBridgeConfig(): Promise<EnvLessBridgeConfig> {
  const raw = await getFeatureValue_DEPRECATED<unknown>(
    'tengu_bridge_repl_v2_config',
    DEFAULT_ENV_LESS_BRIDGE_CONFIG,
  )
  const parsed = envLessBridgeConfigSchema().safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_ENV_LESS_BRIDGE_CONFIG
}

export async function checkEnvLessBridgeMinVersion(): Promise<string | null> {
  const cfg = await getEnvLessBridgeConfig()
  if (cfg.min_version && lt(MACRO.VERSION, cfg.min_version)) {
    return `Your version of Claude Code Next (${MACRO.VERSION}) is too old for Remote Control.\nVersion ${cfg.min_version} or higher is required. Run \`claude update\` to update.`
  }
  return null
}

export async function shouldShowAppUpgradeMessage(): Promise<boolean> {
  if (!isEnvLessBridgeEnabled()) return false
  const cfg = await getEnvLessBridgeConfig()
  return cfg.should_show_app_upgrade_message
}
