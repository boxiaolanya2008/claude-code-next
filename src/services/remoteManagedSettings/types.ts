import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'
import type { SettingsJson } from '../../utils/settings/types.js'

export const RemoteManagedSettingsResponseSchema = lazySchema(() =>
  z.object({
    uuid: z.string(), 
    checksum: z.string(),
    settings: z.record(z.string(), z.unknown()) as z.ZodType<SettingsJson>,
  }),
)

export type RemoteManagedSettingsResponse = z.infer<
  ReturnType<typeof RemoteManagedSettingsResponseSchema>
>

export type RemoteManagedSettingsFetchResult = {
  success: boolean
  settings?: SettingsJson | null 
  checksum?: string
  error?: string
  skipRetry?: boolean 
}
