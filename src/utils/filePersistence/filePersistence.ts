

import { feature } from "../utils/bundle-mock.ts"
import { join, relative } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import {
  type FilesApiConfig,
  uploadSessionFiles,
} from '../../services/api/filesApi.js'
import { getCwd } from '../cwd.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { getSessionIngressAuthToken } from '../sessionIngressAuth.js'
import {
  findModifiedFiles,
  getEnvironmentKind,
  logDebug,
} from './outputsScanner.js'
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  type FailedPersistence,
  FILE_COUNT_LIMIT,
  type FilesPersistedEventData,
  OUTPUTS_SUBDIR,
  type PersistedFile,
  type TurnStartTime,
} from './types.js'

export async function runFilePersistence(
  turnStartTime: TurnStartTime,
  signal?: AbortSignal,
): Promise<FilesPersistedEventData | null> {
  const environmentKind = getEnvironmentKind()
  if (environmentKind !== 'byoc') {
    return null
  }

  const sessionAccessToken = getSessionIngressAuthToken()
  if (!sessionAccessToken) {
    return null
  }

  const sessionId = process.env.CLAUDE_CODE_NEXT_REMOTE_SESSION_ID
  if (!sessionId) {
    logError(
      new Error(
        'File persistence enabled but CLAUDE_CODE_NEXT_REMOTE_SESSION_ID is not set',
      ),
    )
    return null
  }

  const config: FilesApiConfig = {
    oauthToken: sessionAccessToken,
    sessionId,
  }

  const outputsDir = join(getCwd(), sessionId, OUTPUTS_SUBDIR)

  
  if (signal?.aborted) {
    logDebug('Persistence aborted before processing')
    return null
  }

  const startTime = Date.now()
  logEvent('tengu_file_persistence_started', {
    mode: environmentKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  try {
    let result: FilesPersistedEventData
    if (environmentKind === 'byoc') {
      result = await executeBYOCPersistence(
        turnStartTime,
        config,
        outputsDir,
        signal,
      )
    } else {
      result = await executeCloudPersistence()
    }

    
    if (result.files.length === 0 && result.failed.length === 0) {
      return null
    }

    const durationMs = Date.now() - startTime
    logEvent('tengu_file_persistence_completed', {
      success_count: result.files.length,
      failure_count: result.failed.length,
      duration_ms: durationMs,
      mode: environmentKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    return result
  } catch (error) {
    logError(error)
    logDebug(`File persistence failed: ${error}`)

    const durationMs = Date.now() - startTime
    logEvent('tengu_file_persistence_completed', {
      success_count: 0,
      failure_count: 0,
      duration_ms: durationMs,
      mode: environmentKind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error:
        'exception' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    return {
      files: [],
      failed: [
        {
          filename: outputsDir,
          error: errorMessage(error),
        },
      ],
    }
  }
}

async function executeBYOCPersistence(
  turnStartTime: TurnStartTime,
  config: FilesApiConfig,
  outputsDir: string,
  signal?: AbortSignal,
): Promise<FilesPersistedEventData> {
  
  
  const modifiedFiles = await findModifiedFiles(turnStartTime, outputsDir)

  if (modifiedFiles.length === 0) {
    logDebug('No modified files to persist')
    return { files: [], failed: [] }
  }

  logDebug(`Found ${modifiedFiles.length} modified files`)

  if (signal?.aborted) {
    return { files: [], failed: [] }
  }

  
  if (modifiedFiles.length > FILE_COUNT_LIMIT) {
    logDebug(
      `File count limit exceeded: ${modifiedFiles.length} > ${FILE_COUNT_LIMIT}`,
    )
    logEvent('tengu_file_persistence_limit_exceeded', {
      file_count: modifiedFiles.length,
      limit: FILE_COUNT_LIMIT,
    })
    return {
      files: [],
      failed: [
        {
          filename: outputsDir,
          error: `Too many files modified (${modifiedFiles.length}). Maximum: ${FILE_COUNT_LIMIT}.`,
        },
      ],
    }
  }

  const filesToProcess = modifiedFiles
    .map(filePath => ({
      path: filePath,
      relativePath: relative(outputsDir, filePath),
    }))
    .filter(({ relativePath }) => {
      
      if (relativePath.startsWith('..')) {
        logDebug(`Skipping file outside outputs directory: ${relativePath}`)
        return false
      }
      return true
    })

  logDebug(`BYOC mode: uploading ${filesToProcess.length} files`)

  
  const results = await uploadSessionFiles(
    filesToProcess,
    config,
    DEFAULT_UPLOAD_CONCURRENCY,
  )

  
  const persistedFiles: PersistedFile[] = []
  const failedFiles: FailedPersistence[] = []

  for (const result of results) {
    if (result.success) {
      persistedFiles.push({
        filename: result.path,
        file_id: result.fileId,
      })
    } else {
      failedFiles.push({
        filename: result.path,
        error: result.error,
      })
    }
  }

  logDebug(
    `BYOC persistence complete: ${persistedFiles.length} uploaded, ${failedFiles.length} failed`,
  )

  return {
    files: persistedFiles,
    failed: failedFiles,
  }
}

function executeCloudPersistence(): FilesPersistedEventData {
  logDebug('Cloud mode: xattr-based file ID reading not yet implemented')
  return { files: [], failed: [] }
}

export async function executeFilePersistence(
  turnStartTime: TurnStartTime,
  signal: AbortSignal,
  onResult: (result: FilesPersistedEventData) => void,
): Promise<void> {
  try {
    const result = await runFilePersistence(turnStartTime, signal)
    if (result) {
      onResult(result)
    }
  } catch (error) {
    logError(error)
  }
}

export function isFilePersistenceEnabled(): boolean {
  if (feature('FILE_PERSISTENCE')) {
    return (
      getEnvironmentKind() === 'byoc' &&
      !!getSessionIngressAuthToken() &&
      !!process.env.CLAUDE_CODE_NEXT_REMOTE_SESSION_ID
    )
  }
  return false
}
