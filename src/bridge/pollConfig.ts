import { z } from 'zod/v4'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../services/analytics/growthbook.js'
import { lazySchema } from '../utils/lazySchema.js'
import {
  DEFAULT_POLL_CONFIG,
  type PollIntervalConfig,
} from './pollConfigDefaults.js'

const zeroOrAtLeast100 = {
  message: 'must be 0 (disabled) or ≥100ms',
}
const pollIntervalConfigSchema = lazySchema(() =>
  z
    .object({
      poll_interval_ms_not_at_capacity: z.number().int().min(100),
      
      
      poll_interval_ms_at_capacity: z
        .number()
        .int()
        .refine(v => v === 0 || v >= 100, zeroOrAtLeast100),
      
      
      
      
      
      non_exclusive_heartbeat_interval_ms: z.number().int().min(0).default(0),
      
      
      
      multisession_poll_interval_ms_not_at_capacity: z
        .number()
        .int()
        .min(100)
        .default(
          DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_not_at_capacity,
        ),
      multisession_poll_interval_ms_partial_capacity: z
        .number()
        .int()
        .min(100)
        .default(
          DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_partial_capacity,
        ),
      multisession_poll_interval_ms_at_capacity: z
        .number()
        .int()
        .refine(v => v === 0 || v >= 100, zeroOrAtLeast100)
        .default(DEFAULT_POLL_CONFIG.multisession_poll_interval_ms_at_capacity),
      
      reclaim_older_than_ms: z.number().int().min(1).default(5000),
      session_keepalive_interval_v2_ms: z
        .number()
        .int()
        .min(0)
        .default(120_000),
    })
    .refine(
      cfg =>
        cfg.non_exclusive_heartbeat_interval_ms > 0 ||
        cfg.poll_interval_ms_at_capacity > 0,
      {
        message:
          'at-capacity liveness requires non_exclusive_heartbeat_interval_ms > 0 or poll_interval_ms_at_capacity > 0',
      },
    )
    .refine(
      cfg =>
        cfg.non_exclusive_heartbeat_interval_ms > 0 ||
        cfg.multisession_poll_interval_ms_at_capacity > 0,
      {
        message:
          'at-capacity liveness requires non_exclusive_heartbeat_interval_ms > 0 or multisession_poll_interval_ms_at_capacity > 0',
      },
    ),
)

export function getPollIntervalConfig(): PollIntervalConfig {
  const raw = getFeatureValue_CACHED_WITH_REFRESH<unknown>(
    'tengu_bridge_poll_interval_config',
    DEFAULT_POLL_CONFIG,
    5 * 60 * 1000,
  )
  const parsed = pollIntervalConfigSchema().safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_POLL_CONFIG
}
