import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import type { UUID } from 'crypto'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import { detectImageFormatFromBase64 } from '../utils/imageResizer.js'

export function extractInboundMessageFields(
  msg: SDKMessage,
):
  | { content: string | Array<ContentBlockParam>; uuid: UUID | undefined }
  | undefined {
  if (msg.type !== 'user') return undefined
  const content = msg.message?.content
  if (!content) return undefined
  if (Array.isArray(content) && content.length === 0) return undefined

  const uuid =
    'uuid' in msg && typeof msg.uuid === 'string'
      ? (msg.uuid as UUID)
      : undefined

  return {
    content: Array.isArray(content) ? normalizeImageBlocks(content) : content,
    uuid,
  }
}

export function normalizeImageBlocks(
  blocks: Array<ContentBlockParam>,
): Array<ContentBlockParam> {
  if (!blocks.some(isMalformedBase64Image)) return blocks

  return blocks.map(block => {
    if (!isMalformedBase64Image(block)) return block
    const src = block.source as unknown as Record<string, unknown>
    const mediaType =
      typeof src.mediaType === 'string' && src.mediaType
        ? src.mediaType
        : detectImageFormatFromBase64(block.source.data)
    return {
      ...block,
      source: {
        type: 'base64' as const,
        media_type: mediaType as Base64ImageSource['media_type'],
        data: block.source.data,
      },
    }
  })
}

function isMalformedBase64Image(
  block: ContentBlockParam,
): block is ImageBlockParam & { source: Base64ImageSource } {
  if (block.type !== 'image' || block.source?.type !== 'base64') return false
  return !(block.source as unknown as Record<string, unknown>).media_type
}
