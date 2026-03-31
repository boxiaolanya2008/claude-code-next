

import { z } from 'zod/v4'
import { getFeatureValue_CACHED_WITH_REFRESH } from '../services/analytics/growthbook.js'
import {
  type CronJitterConfig,
  DEFAULT_CRON_JITTER_CONFIG,
} from './cronTasks.js'
import { lazySchema } from './lazySchema.js'

const JITTER_CONFIG_REFRESH_MS = 60 * 1000

const HALF_HOUR_MS = 30 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const cronJitterConfigSchema = lazySchema(() =>
  z
    .object({
      recurringFrac: z.number().min(0).max(1),
      recurringCapMs: z.number().int().min(0).max(HALF_HOUR_MS),
      oneShotMaxMs: z.number().int().min(0).max(HALF_HOUR_MS),
      oneShotFloorMs: z.number().int().min(0).max(HALF_HOUR_MS),
      oneShotMinuteMod: z.number().int().min(1).max(60),
      recurringMaxAgeMs: z
        .number()
        .int()
        .min(0)
        .max(THIRTY_DAYS_MS)
        .default(DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs),
    })
    .refine(c => c.oneShotFloorMs <= c.oneShotMaxMs),
)

export function getCronJitterConfig(): CronJitterConfig {
  const raw = getFeatureValue_CACHED_WITH_REFRESH<unknown>(
    'tengu_kairos_cron_config',
    DEFAULT_CRON_JITTER_CONFIG,
    JITTER_CONFIG_REFRESH_MS,
  )
  const parsed = cronJitterConfigSchema().safeParse(raw)
  return parsed.success ? parsed.data : DEFAULT_CRON_JITTER_CONFIG
}
