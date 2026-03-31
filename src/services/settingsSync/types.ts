

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const UserSyncContentSchema = lazySchema(() =>
  z.object({
    entries: z.record(z.string(), z.string()),
  }),
)

export const UserSyncDataSchema = lazySchema(() =>
  z.object({
    userId: z.string(),
    version: z.number(),
    lastModified: z.string(), 
    checksum: z.string(), 
    content: UserSyncContentSchema(),
  }),
)

export type UserSyncData = z.infer<ReturnType<typeof UserSyncDataSchema>>

export type SettingsSyncFetchResult = {
  success: boolean
  data?: UserSyncData
  isEmpty?: boolean 
  error?: string
  skipRetry?: boolean
}

export type SettingsSyncUploadResult = {
  success: boolean
  checksum?: string
  lastModified?: string
  error?: string
}

export const SYNC_KEYS = {
  USER_SETTINGS: '~/.claude/settings.json',
  USER_MEMORY: '~/.claude/CLAUDE.md',
  projectSettings: (projectId: string) =>
    `projects/${projectId}/.claude/settings.local.json`,
  projectMemory: (projectId: string) => `projects/${projectId}/CLAUDE.local.md`,
} as const
