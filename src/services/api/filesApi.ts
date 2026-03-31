

import axios from 'axios'
import { randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import { count } from '../../utils/array.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

const FILES_API_BETA_HEADER = 'files-api-2025-04-14,oauth-2025-04-20'
const ANTHROPIC_VERSION = '2023-06-01'

function getDefaultApiBaseUrl(): string {
  return (
    process.env.ANTHROPIC_BASE_URL ||
    process.env.CLAUDE_CODE_NEXT_API_BASE_URL ||
    'https://api.anthropic.com'
  )
}

function logDebugError(message: string): void {
  logForDebugging(`[files-api] ${message}`, { level: 'error' })
}

function logDebug(message: string): void {
  logForDebugging(`[files-api] ${message}`)
}

export type File = {
  fileId: string
  relativePath: string
}

export type FilesApiConfig = {
  
  oauthToken: string
  
  baseUrl?: string
  
  sessionId: string
}

export type DownloadResult = {
  fileId: string
  path: string
  success: boolean
  error?: string
  bytesWritten?: number
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024 

type RetryResult<T> = { done: true; value: T } | { done: false; error?: string }

async function retryWithBackoff<T>(
  operation: string,
  attemptFn: (attempt: number) => Promise<RetryResult<T>>,
): Promise<T> {
  let lastError = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await attemptFn(attempt)

    if (result.done) {
      return result.value
    }

    lastError = result.error || `${operation} failed`
    logDebug(
      `${operation} attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`,
    )

    if (attempt < MAX_RETRIES) {
      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      logDebug(`Retrying ${operation} in ${delayMs}ms...`)
      await sleep(delayMs)
    }
  }

  throw new Error(`${lastError} after ${MAX_RETRIES} attempts`)
}

export async function downloadFile(
  fileId: string,
  config: FilesApiConfig,
): Promise<Buffer> {
  const baseUrl = config.baseUrl || getDefaultApiBaseUrl()
  const url = `${baseUrl}/v1/files/${fileId}/content`

  const headers = {
    Authorization: `Bearer ${config.oauthToken}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': FILES_API_BETA_HEADER,
  }

  logDebug(`Downloading file ${fileId} from ${url}`)

  return retryWithBackoff(`Download file ${fileId}`, async () => {
    try {
      const response = await axios.get(url, {
        headers,
        responseType: 'arraybuffer',
        timeout: 60000, 
        validateStatus: status => status < 500,
      })

      if (response.status === 200) {
        logDebug(`Downloaded file ${fileId} (${response.data.length} bytes)`)
        return { done: true, value: Buffer.from(response.data) }
      }

      
      if (response.status === 404) {
        throw new Error(`File not found: ${fileId}`)
      }
      if (response.status === 401) {
        throw new Error('Authentication failed: invalid or missing API key')
      }
      if (response.status === 403) {
        throw new Error(`Access denied to file: ${fileId}`)
      }

      return { done: false, error: `status ${response.status}` }
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        throw error
      }
      return { done: false, error: error.message }
    }
  })
}

export function buildDownloadPath(
  basePath: string,
  sessionId: string,
  relativePath: string,
): string | null {
  const normalized = path.normalize(relativePath)
  if (normalized.startsWith('..')) {
    logDebugError(
      `Invalid file path: ${relativePath}. Path must not traverse above workspace`,
    )
    return null
  }

  const uploadsBase = path.join(basePath, sessionId, 'uploads')
  const redundantPrefixes = [
    path.join(basePath, sessionId, 'uploads') + path.sep,
    path.sep + 'uploads' + path.sep,
  ]
  const matchedPrefix = redundantPrefixes.find(p => normalized.startsWith(p))
  const cleanPath = matchedPrefix
    ? normalized.slice(matchedPrefix.length)
    : normalized
  return path.join(uploadsBase, cleanPath)
}

export async function downloadAndSaveFile(
  attachment: File,
  config: FilesApiConfig,
): Promise<DownloadResult> {
  const { fileId, relativePath } = attachment
  const fullPath = buildDownloadPath(getCwd(), config.sessionId, relativePath)

  if (!fullPath) {
    return {
      fileId,
      path: '',
      success: false,
      error: `Invalid file path: ${relativePath}`,
    }
  }

  try {
    
    const content = await downloadFile(fileId, config)

    
    const parentDir = path.dirname(fullPath)
    await fs.mkdir(parentDir, { recursive: true })

    
    await fs.writeFile(fullPath, content)

    logDebug(`Saved file ${fileId} to ${fullPath} (${content.length} bytes)`)

    return {
      fileId,
      path: fullPath,
      success: true,
      bytesWritten: content.length,
    }
  } catch (error) {
    logDebugError(`Failed to download file ${fileId}: ${errorMessage(error)}`)
    if (error instanceof Error) {
      logError(error)
    }

    return {
      fileId,
      path: fullPath,
      success: false,
      error: errorMessage(error),
    }
  }
}

const DEFAULT_CONCURRENCY = 5

async function parallelWithLimit<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++
      const item = items[index]
      if (item !== undefined) {
        results[index] = await fn(item, index)
      }
    }
  }

  
  const workers: Promise<void>[] = []
  const workerCount = Math.min(concurrency, items.length)
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }

  await Promise.all(workers)
  return results
}

export async function downloadSessionFiles(
  files: File[],
  config: FilesApiConfig,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<DownloadResult[]> {
  if (files.length === 0) {
    return []
  }

  logDebug(
    `Downloading ${files.length} file(s) for session ${config.sessionId}`,
  )
  const startTime = Date.now()

  
  const results = await parallelWithLimit(
    files,
    file => downloadAndSaveFile(file, config),
    concurrency,
  )

  const elapsedMs = Date.now() - startTime
  const successCount = count(results, r => r.success)
  logDebug(
    `Downloaded ${successCount}/${files.length} file(s) in ${elapsedMs}ms`,
  )

  return results
}

export type UploadResult =
  | {
      path: string
      fileId: string
      size: number
      success: true
    }
  | {
      path: string
      error: string
      success: false
    }

export async function uploadFile(
  filePath: string,
  relativePath: string,
  config: FilesApiConfig,
  opts?: { signal?: AbortSignal },
): Promise<UploadResult> {
  const baseUrl = config.baseUrl || getDefaultApiBaseUrl()
  const url = `${baseUrl}/v1/files`

  const headers = {
    Authorization: `Bearer ${config.oauthToken}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': FILES_API_BETA_HEADER,
  }

  logDebug(`Uploading file ${filePath} as ${relativePath}`)

  
  let content: Buffer
  try {
    content = await fs.readFile(filePath)
  } catch (error) {
    logEvent('tengu_file_upload_failed', {
      error_type:
        'file_read' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      path: relativePath,
      error: errorMessage(error),
      success: false,
    }
  }

  const fileSize = content.length

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    logEvent('tengu_file_upload_failed', {
      error_type:
        'file_too_large' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      path: relativePath,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${fileSize})`,
      success: false,
    }
  }

  
  const boundary = `----FormBoundary${randomUUID()}`
  const filename = path.basename(relativePath)

  
  const bodyParts: Buffer[] = []

  
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
  )
  bodyParts.push(content)
  bodyParts.push(Buffer.from('\r\n'))

  
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="purpose"\r\n\r\n` +
        `user_data\r\n`,
    ),
  )

  
  bodyParts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(bodyParts)

  try {
    return await retryWithBackoff(`Upload file ${relativePath}`, async () => {
      try {
        const response = await axios.post(url, body, {
          headers: {
            ...headers,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length.toString(),
          },
          timeout: 120000, 
          signal: opts?.signal,
          validateStatus: status => status < 500,
        })

        if (response.status === 200 || response.status === 201) {
          const fileId = response.data?.id
          if (!fileId) {
            return {
              done: false,
              error: 'Upload succeeded but no file ID returned',
            }
          }
          logDebug(`Uploaded file ${filePath} -> ${fileId} (${fileSize} bytes)`)
          return {
            done: true,
            value: {
              path: relativePath,
              fileId,
              size: fileSize,
              success: true as const,
            },
          }
        }

        
        if (response.status === 401) {
          logEvent('tengu_file_upload_failed', {
            error_type:
              'auth' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new UploadNonRetriableError(
            'Authentication failed: invalid or missing API key',
          )
        }

        if (response.status === 403) {
          logEvent('tengu_file_upload_failed', {
            error_type:
              'forbidden' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new UploadNonRetriableError('Access denied for upload')
        }

        if (response.status === 413) {
          logEvent('tengu_file_upload_failed', {
            error_type:
              'size' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          throw new UploadNonRetriableError('File too large for upload')
        }

        return { done: false, error: `status ${response.status}` }
      } catch (error) {
        
        if (error instanceof UploadNonRetriableError) {
          throw error
        }
        if (axios.isCancel(error)) {
          throw new UploadNonRetriableError('Upload canceled')
        }
        
        if (axios.isAxiosError(error)) {
          return { done: false, error: error.message }
        }
        throw error
      }
    })
  } catch (error) {
    if (error instanceof UploadNonRetriableError) {
      return {
        path: relativePath,
        error: error.message,
        success: false,
      }
    }
    logEvent('tengu_file_upload_failed', {
      error_type:
        'network' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return {
      path: relativePath,
      error: errorMessage(error),
      success: false,
    }
  }
}

class UploadNonRetriableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadNonRetriableError'
  }
}

export async function uploadSessionFiles(
  files: Array<{ path: string; relativePath: string }>,
  config: FilesApiConfig,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<UploadResult[]> {
  if (files.length === 0) {
    return []
  }

  logDebug(`Uploading ${files.length} file(s) for session ${config.sessionId}`)
  const startTime = Date.now()

  const results = await parallelWithLimit(
    files,
    file => uploadFile(file.path, file.relativePath, config),
    concurrency,
  )

  const elapsedMs = Date.now() - startTime
  const successCount = count(results, r => r.success)
  logDebug(`Uploaded ${successCount}/${files.length} file(s) in ${elapsedMs}ms`)

  return results
}

export type FileMetadata = {
  filename: string
  fileId: string
  size: number
}

export async function listFilesCreatedAfter(
  afterCreatedAt: string,
  config: FilesApiConfig,
): Promise<FileMetadata[]> {
  const baseUrl = config.baseUrl || getDefaultApiBaseUrl()
  const headers = {
    Authorization: `Bearer ${config.oauthToken}`,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': FILES_API_BETA_HEADER,
  }

  logDebug(`Listing files created after ${afterCreatedAt}`)

  const allFiles: FileMetadata[] = []
  let afterId: string | undefined

  
  while (true) {
    const params: Record<string, string> = {
      after_created_at: afterCreatedAt,
    }
    if (afterId) {
      params.after_id = afterId
    }

    const page = await retryWithBackoff(
      `List files after ${afterCreatedAt}`,
      async () => {
        try {
          const response = await axios.get(`${baseUrl}/v1/files`, {
            headers,
            params,
            timeout: 60000,
            validateStatus: status => status < 500,
          })

          if (response.status === 200) {
            return { done: true, value: response.data }
          }

          if (response.status === 401) {
            logEvent('tengu_file_list_failed', {
              error_type:
                'auth' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            throw new Error('Authentication failed: invalid or missing API key')
          }
          if (response.status === 403) {
            logEvent('tengu_file_list_failed', {
              error_type:
                'forbidden' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            })
            throw new Error('Access denied to list files')
          }

          return { done: false, error: `status ${response.status}` }
        } catch (error) {
          if (!axios.isAxiosError(error)) {
            throw error
          }
          logEvent('tengu_file_list_failed', {
            error_type:
              'network' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return { done: false, error: error.message }
        }
      },
    )

    const files = page.data || []
    for (const f of files) {
      allFiles.push({
        filename: f.filename,
        fileId: f.id,
        size: f.size_bytes,
      })
    }

    if (!page.has_more) {
      break
    }

    
    const lastFile = files.at(-1)
    if (!lastFile?.id) {
      break
    }
    afterId = lastFile.id
  }

  logDebug(`Listed ${allFiles.length} files created after ${afterCreatedAt}`)
  return allFiles
}

export function parseFileSpecs(fileSpecs: string[]): File[] {
  const files: File[] = []

  
  const expandedSpecs = fileSpecs.flatMap(s => s.split(' ').filter(Boolean))

  for (const spec of expandedSpecs) {
    const colonIndex = spec.indexOf(':')
    if (colonIndex === -1) {
      continue
    }

    const fileId = spec.substring(0, colonIndex)
    const relativePath = spec.substring(colonIndex + 1)

    if (!fileId || !relativePath) {
      logDebugError(
        `Invalid file spec: ${spec}. Both file_id and path are required`,
      )
      continue
    }

    files.push({ fileId, relativePath })
  }

  return files
}
