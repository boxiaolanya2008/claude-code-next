import { createHash, randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

export function generateTempFilePath(
  prefix: string = 'claude-prompt',
  extension: string = '.md',
  options?: { contentHash?: string },
): string {
  const id = options?.contentHash
    ? createHash('sha256')
        .update(options.contentHash)
        .digest('hex')
        .slice(0, 16)
    : randomUUID()
  return join(tmpdir(), `${prefix}-${id}${extension}`)
}
