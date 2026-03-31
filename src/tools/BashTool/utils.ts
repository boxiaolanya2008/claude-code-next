import type {
  Base64ImageSource,
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { readFile, stat } from 'fs/promises'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import { logEvent } from 'src/services/analytics/index.js'
import type { ToolPermissionContext } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { pathInAllowedWorkingPath } from 'src/utils/permissions/filesystem.js'
import { setCwd } from 'src/utils/Shell.js'
import { shouldMaintainProjectWorkingDir } from '../../utils/envUtils.js'
import { maybeResizeAndDownsampleImageBuffer } from '../../utils/imageResizer.js'
import { getMaxOutputLength } from '../../utils/shell/outputLimits.js'
import { countCharInString, plural } from '../../utils/stringUtils.js'

export function stripEmptyLines(content: string): string {
  const lines = content.split('\n')

  
  let startIndex = 0
  while (startIndex < lines.length && lines[startIndex]?.trim() === '') {
    startIndex++
  }

  // Find the last non-empty line
  let endIndex = lines.length - 1
  while (endIndex >= 0 && lines[endIndex]?.trim() === '') {
    endIndex--
  }

  // If all lines are empty, return empty string
  if (startIndex > endIndex) {
    return ''
  }

  // Return the slice with non-empty lines
  return lines.slice(startIndex, endIndex + 1).join('\n')
}

/**
 * Check if content is a base64 encoded image data URL
 */
export function isImageOutput(content: string): boolean {
  return /^data:image\/[a-z0-9.+_-]+;base64,/i.test(content)
}

const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/

export function parseDataUri(
  s: string,
): { mediaType: string; data: string } | null {
  const match = s.trim().match(DATA_URI_RE)
  if (!match || !match[1] || !match[2]) return null
  return { mediaType: match[1], data: match[2] }
}

/**
 * Build an image tool_result block from shell stdout containing a data URI.
 * Returns null if parse fails so callers can fall through to text handling.
 */
export function buildImageToolResult(
  stdout: string,
  toolUseID: string,
): ToolResultBlockParam | null {
  const parsed = parseDataUri(stdout)
  if (!parsed) return null
  return {
    tool_use_id: toolUseID,
    type: 'tool_result',
    content: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mediaType as Base64ImageSource['media_type'],
          data: parsed.data,
        },
      },
    ],
  }
}

// Cap file reads to 20 MB — any image data URI larger than this is

const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024

export async function resizeShellImageOutput(
  stdout: string,
  outputFilePath: string | undefined,
  outputFileSize: number | undefined,
): Promise<string | null> {
  let source = stdout
  if (outputFilePath) {
    const size = outputFileSize ?? (await stat(outputFilePath)).size
    if (size > MAX_IMAGE_FILE_SIZE) return null
    source = await readFile(outputFilePath, 'utf8')
  }
  const parsed = parseDataUri(source)
  if (!parsed) return null
  const buf = Buffer.from(parsed.data, 'base64')
  const ext = parsed.mediaType.split('/')[1] || 'png'
  const resized = await maybeResizeAndDownsampleImageBuffer(
    buf,
    buf.length,
    ext,
  )
  return `data:image/${resized.mediaType};base64,${resized.buffer.toString('base64')}`
}

export function formatOutput(content: string): {
  totalLines: number
  truncatedContent: string
  isImage?: boolean
} {
  const isImage = isImageOutput(content)
  if (isImage) {
    return {
      totalLines: 1,
      truncatedContent: content,
      isImage,
    }
  }

  const maxOutputLength = getMaxOutputLength()
  if (content.length <= maxOutputLength) {
    return {
      totalLines: countCharInString(content, '\n') + 1,
      truncatedContent: content,
      isImage,
    }
  }

  const truncatedPart = content.slice(0, maxOutputLength)
  const remainingLines = countCharInString(content, '\n', maxOutputLength) + 1
  const truncated = `${truncatedPart}\n\n... [${remainingLines} lines truncated] ...`

  return {
    totalLines: countCharInString(content, '\n') + 1,
    truncatedContent: truncated,
    isImage,
  }
}

export const stdErrAppendShellResetMessage = (stderr: string): string =>
  `${stderr.trim()}\nShell cwd was reset to ${getOriginalCwd()}`

export function resetCwdIfOutsideProject(
  toolPermissionContext: ToolPermissionContext,
): boolean {
  const cwd = getCwd()
  const originalCwd = getOriginalCwd()
  const shouldMaintain = shouldMaintainProjectWorkingDir()
  if (
    shouldMaintain ||
    // Fast path: originalCwd is unconditionally in allWorkingDirectories
    
    
    (cwd !== originalCwd &&
      !pathInAllowedWorkingPath(cwd, toolPermissionContext))
  ) {
    // Reset to original directory if maintaining project dir OR outside allowed working directory
    setCwd(originalCwd)
    if (!shouldMaintain) {
      logEvent('tengu_bash_tool_reset_to_original_dir', {})
      return true
    }
  }
  return false
}

/**
 * Creates a human-readable summary of structured content blocks.
 * Used to display MCP results with images and text in the UI.
 */
export function createContentSummary(content: ContentBlockParam[]): string {
  const parts: string[] = []
  let textCount = 0
  let imageCount = 0

  for (const block of content) {
    if (block.type === 'image') {
      imageCount++
    } else if (block.type === 'text' && 'text' in block) {
      textCount++
      
      const preview = block.text.slice(0, 200)
      parts.push(preview + (block.text.length > 200 ? '...' : ''))
    }
  }

  const summary: string[] = []
  if (imageCount > 0) {
    summary.push(`[${imageCount} ${plural(imageCount, 'image')}]`)
  }
  if (textCount > 0) {
    summary.push(`[${textCount} text ${plural(textCount, 'block')}]`)
  }

  return `MCP Result: ${summary.join(', ')}${parts.length > 0 ? '\n\n' + parts.join('\n\n') : ''}`
}
