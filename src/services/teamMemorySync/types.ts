

import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema.js'

export const TeamMemoryContentSchema = lazySchema(() =>
  z.object({
    entries: z.record(z.string(), z.string()),
    // Per-key SHA-256 of entry content (`sha256:<hex>`). Added in
    // anthropic/anthropic#283027. Optional for forward-compat with older
    
    entryChecksums: z.record(z.string(), z.string()).optional(),
  }),
)

export const TeamMemoryDataSchema = lazySchema(() =>
  z.object({
    organizationId: z.string(),
    repo: z.string(),
    version: z.number(),
    lastModified: z.string(), // ISO 8601 timestamp
    checksum: z.string(), // SHA256 with 'sha256:' prefix
    content: TeamMemoryContentSchema(),
  }),
)

export const TeamMemoryTooManyEntriesSchema = lazySchema(() =>
  z.object({
    error: z.object({
      details: z.object({
        error_code: z.literal('team_memory_too_many_entries'),
        max_entries: z.number().int().positive(),
        received_entries: z.number().int().positive(),
      }),
    }),
  }),
)

export type TeamMemoryData = z.infer<ReturnType<typeof TeamMemoryDataSchema>>

export type SkippedSecretFile = {
  path: string
  
  ruleId: string
  
  label: string
}

/**
 * Result from fetching team memory
 */
export type TeamMemorySyncFetchResult = {
  success: boolean
  data?: TeamMemoryData
  isEmpty?: boolean 
  notModified?: boolean 
  checksum?: string 
  error?: string
  skipRetry?: boolean
  errorType?: 'auth' | 'timeout' | 'network' | 'parse' | 'unknown'
  httpStatus?: number
}

/**
 * Lightweight metadata-only probe result (GET ?view=hashes).
 * Contains per-key checksums without entry bodies. Used to refresh
 * serverChecksums cheaply during 412 conflict resolution.
 */
export type TeamMemoryHashesResult = {
  success: boolean
  version?: number
  checksum?: string
  entryChecksums?: Record<string, string>
  error?: string
  errorType?: 'auth' | 'timeout' | 'network' | 'parse' | 'unknown'
  httpStatus?: number
}

/**
 * Result from uploading team memory with conflict info
 */
export type TeamMemorySyncPushResult = {
  success: boolean
  filesUploaded: number
  checksum?: string
  conflict?: boolean 
  error?: string
  
  skippedSecrets?: SkippedSecretFile[]
  errorType?:
    | 'auth'
    | 'timeout'
    | 'network'
    | 'conflict'
    | 'unknown'
    | 'no_oauth'
    | 'no_repo'
  httpStatus?: number
}

/**
 * Result from uploading team memory
 */
export type TeamMemorySyncUploadResult = {
  success: boolean
  checksum?: string
  lastModified?: string
  conflict?: boolean 
  error?: string
  errorType?: 'auth' | 'timeout' | 'network' | 'unknown'
  httpStatus?: number
  

  serverErrorCode?: 'team_memory_too_many_entries'
  

  serverMaxEntries?: number
  

  serverReceivedEntries?: number
}
