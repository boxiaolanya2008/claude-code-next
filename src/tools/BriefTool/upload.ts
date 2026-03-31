

import { feature } from "../utils/bundle-mock.ts"
import axios from 'axios'
import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { z } from 'zod/v4'

import {
  getBridgeAccessToken,
  getBridgeBaseUrlOverride,
} from '../../bridge/bridgeConfig.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { logForDebugging } from '../../utils/debug.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

const UPLOAD_TIMEOUT_MS = 30_000

function getBridgeBaseUrl(): string {
  return (
    getBridgeBaseUrlOverride() ??
    process.env.ANTHROPIC_BASE_URL ??
    getOauthConfig().BASE_API_URL
  )
}

const uploadResponseSchema = lazySchema(() =>
  z.object({ file_uuid: z.string() }),
)

export type BriefUploadContext = {
  replBridgeEnabled: boolean
  signal?: AbortSignal
}

export async function uploadBriefAttachment(
  fullPath: string,
  size: number,
  ctx: BriefUploadContext,
): Promise<string | undefined> {
  
  
  if (feature('BRIDGE_MODE')) {
    if (!ctx.replBridgeEnabled) return undefined

    if (size > MAX_UPLOAD_BYTES) {
      debug(`skip ${fullPath}: ${size} bytes exceeds ${MAX_UPLOAD_BYTES} limit`)
      return undefined
    }

    const token = getBridgeAccessToken()
    if (!token) {
      debug('skip: no oauth token')
      return undefined
    }

    let content: Buffer
    try {
      content = await readFile(fullPath)
    } catch (e) {
      debug(`read failed for ${fullPath}: ${e}`)
      return undefined
    }

    const baseUrl = getBridgeBaseUrl()
    const url = `${baseUrl}/api/oauth/file_upload`
    const filename = basename(fullPath)
    const mimeType = guessMimeType(filename)
    const boundary = `----FormBoundary${randomUUID()}`

    
    
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])

    try {
      const response = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString(),
        },
        timeout: UPLOAD_TIMEOUT_MS,
        signal: ctx.signal,
        validateStatus: () => true,
      })

      if (response.status !== 201) {
        debug(
          `upload failed for ${fullPath}: status=${response.status} body=${jsonStringify(response.data).slice(0, 200)}`,
        )
        return undefined
      }

      const parsed = uploadResponseSchema().safeParse(response.data)
      if (!parsed.success) {
        debug(
          `unexpected response shape for ${fullPath}: ${parsed.error.message}`,
        )
        return undefined
      }

      debug(`uploaded ${fullPath} → ${parsed.data.file_uuid} (${size} bytes)`)
      return parsed.data.file_uuid
    } catch (e) {
      debug(`upload threw for ${fullPath}: ${e}`)
      return undefined
    }
  }
  return undefined
}
