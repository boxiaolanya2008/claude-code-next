

import { logForDebugging } from './debug.js'
import { getFsImplementation, safeResolvePath } from './fsOperations.js'

export type LineEndingType = 'CRLF' | 'LF'

export function detectEncodingForResolvedPath(
  resolvedPath: string,
): BufferEncoding {
  const { buffer, bytesRead } = getFsImplementation().readSync(resolvedPath, {
    length: 4096,
  })

  
  
  if (bytesRead === 0) {
    return 'utf8'
  }

  if (bytesRead >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le'
  }

  if (
    bytesRead >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return 'utf8'
  }

  
  
  return 'utf8'
}

export function detectLineEndingsForString(content: string): LineEndingType {
  let crlfCount = 0
  let lfCount = 0

  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      if (i > 0 && content[i - 1] === '\r') {
        crlfCount++
      } else {
        lfCount++
      }
    }
  }

  return crlfCount > lfCount ? 'CRLF' : 'LF'
}

export function readFileSyncWithMetadata(filePath: string): {
  content: string
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  const fs = getFsImplementation()
  const { resolvedPath, isSymlink } = safeResolvePath(fs, filePath)

  if (isSymlink) {
    logForDebugging(`Reading through symlink: ${filePath} -> ${resolvedPath}`)
  }

  const encoding = detectEncodingForResolvedPath(resolvedPath)
  const raw = fs.readFileSync(resolvedPath, { encoding })
  
  
  
  const lineEndings = detectLineEndingsForString(raw.slice(0, 4096))
  return {
    content: raw.replaceAll('\r\n', '\n'),
    encoding,
    lineEndings,
  }
}

export function readFileSync(filePath: string): string {
  return readFileSyncWithMetadata(filePath).content
}
