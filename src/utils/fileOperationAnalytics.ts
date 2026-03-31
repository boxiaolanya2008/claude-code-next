import { createHash } from 'crypto'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import { logEvent } from 'src/services/analytics/index.js'

function hashFilePath(
  filePath: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

function hashFileContent(
  content: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return createHash('sha256')
    .update(content)
    .digest('hex') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

const MAX_CONTENT_HASH_SIZE = 100 * 1024

export function logFileOperation(params: {
  operation: 'read' | 'write' | 'edit'
  tool: 'FileReadTool' | 'FileWriteTool' | 'FileEditTool'
  filePath: string
  content?: string
  type?: 'create' | 'update'
}): void {
  const metadata: Record<
    string,
    | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    | number
    | boolean
  > = {
    operation:
      params.operation as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    tool: params.tool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    filePathHash: hashFilePath(params.filePath),
  }

  
  
  if (
    params.content !== undefined &&
    params.content.length <= MAX_CONTENT_HASH_SIZE
  ) {
    metadata.contentHash = hashFileContent(params.content)
  }

  if (params.type !== undefined) {
    metadata.type =
      params.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }

  logEvent('tengu_file_operation', metadata)
}
