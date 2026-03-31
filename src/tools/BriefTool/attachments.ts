

import { feature } from 'bun:bundle'
import { stat } from 'fs/promises'

import type { ValidationResult } from '../../Tool.js'

import { getCwd } from '../../utils/cwd.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'
import { IMAGE_EXTENSION_REGEX } from '../../utils/imagePaste.js'
import { expandPath } from '../../utils/path.js'

export type ResolvedAttachment = {
  path: string
  size: number
  isImage: boolean
  file_uuid?: string
}

export async function validateAttachmentPaths(
  rawPaths: string[],
): Promise<ValidationResult> {
  const cwd = getCwd()
  for (const rawPath of rawPaths) {
    const fullPath = expandPath(rawPath)
    try {
      const stats = await stat(fullPath)
      if (!stats.isFile()) {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not a regular file.`,
          errorCode: 1,
        }
      }
    } catch (e) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return {
          result: false,
          message: `Attachment "${rawPath}" does not exist. Current working directory: ${cwd}.`,
          errorCode: 1,
        }
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not accessible (permission denied).`,
          errorCode: 1,
        }
      }
      throw e
    }
  }
  return { result: true }
}

export async function resolveAttachments(
  rawPaths: string[],
  uploadCtx: { replBridgeEnabled: boolean; signal?: AbortSignal },
): Promise<ResolvedAttachment[]> {
  
  
  
  const stated: ResolvedAttachment[] = []
  for (const rawPath of rawPaths) {
    const fullPath = expandPath(rawPath)
    
    
    
    const stats = await stat(fullPath)
    stated.push({
      path: fullPath,
      size: stats.size,
      isImage: IMAGE_EXTENSION_REGEX.test(fullPath),
    })
  }
  
  
  
  
  
  if (feature('BRIDGE_MODE')) {
    
    
    
    
    const shouldUpload =
      uploadCtx.replBridgeEnabled ||
      isEnvTruthy(process.env.CLAUDE_CODE_NEXT_BRIEF_UPLOAD)
    const { uploadBriefAttachment } = await import('./upload.js')
    const uuids = await Promise.all(
      stated.map(a =>
        uploadBriefAttachment(a.path, a.size, {
          replBridgeEnabled: shouldUpload,
          signal: uploadCtx.signal,
        }),
      ),
    )
    return stated.map((a, i) =>
      uuids[i] === undefined ? a : { ...a, file_uuid: uuids[i] },
    )
  }
  return stated
}
