import { type FileHandle, open } from 'fs/promises'
import { isENOENT } from './errors.js'

export const CHUNK_SIZE = 8 * 1024
export const MAX_SCAN_BYTES = 10 * 1024 * 1024
const NL = 0x0a

export type EditContext = {
  
  content: string
  
  lineOffset: number
  
  truncated: boolean
}

export async function readEditContext(
  path: string,
  needle: string,
  contextLines = 3,
): Promise<EditContext | null> {
  const handle = await openForScan(path)
  if (handle === null) return null
  try {
    return await scanForContext(handle, needle, contextLines)
  } finally {
    await handle.close()
  }
}

export async function openForScan(path: string): Promise<FileHandle | null> {
  try {
    return await open(path, 'r')
  } catch (e) {
    if (isENOENT(e)) return null
    throw e
  }
}

export async function scanForContext(
  handle: FileHandle,
  needle: string,
  contextLines: number,
): Promise<EditContext> {
  if (needle === '') return { content: '', lineOffset: 1, truncated: false }
  const needleLF = Buffer.from(needle, 'utf8')
  
  
  let nlCount = 0
  for (let i = 0; i < needleLF.length; i++) if (needleLF[i] === NL) nlCount++
  let needleCRLF: Buffer | undefined
  const overlap = needleLF.length + nlCount - 1

  const buf = Buffer.allocUnsafe(CHUNK_SIZE + overlap)
  let pos = 0
  let linesBeforePos = 0
  let prevTail = 0

  while (pos < MAX_SCAN_BYTES) {
    const { bytesRead } = await handle.read(buf, prevTail, CHUNK_SIZE, pos)
    if (bytesRead === 0) break
    const viewLen = prevTail + bytesRead

    let matchAt = indexOfWithin(buf, needleLF, viewLen)
    let matchLen = needleLF.length
    if (matchAt === -1 && nlCount > 0) {
      needleCRLF ??= Buffer.from(needle.replaceAll('\n', '\r\n'), 'utf8')
      matchAt = indexOfWithin(buf, needleCRLF, viewLen)
      matchLen = needleCRLF.length
    }
    if (matchAt !== -1) {
      const absMatch = pos - prevTail + matchAt
      return await sliceContext(
        handle,
        buf,
        absMatch,
        matchLen,
        contextLines,
        linesBeforePos + countNewlines(buf, 0, matchAt),
      )
    }
    pos += bytesRead
    
    
    
    const nextTail = Math.min(overlap, viewLen)
    linesBeforePos += countNewlines(buf, 0, viewLen - nextTail)
    prevTail = nextTail
    buf.copyWithin(0, viewLen - prevTail, viewLen)
  }

  return { content: '', lineOffset: 1, truncated: pos >= MAX_SCAN_BYTES }
}

export async function readCapped(handle: FileHandle): Promise<string | null> {
  let buf = Buffer.allocUnsafe(CHUNK_SIZE)
  let total = 0
  for (;;) {
    if (total === buf.length) {
      const grown = Buffer.allocUnsafe(
        Math.min(buf.length * 2, MAX_SCAN_BYTES + CHUNK_SIZE),
      )
      buf.copy(grown, 0, 0, total)
      buf = grown
    }
    const { bytesRead } = await handle.read(
      buf,
      total,
      buf.length - total,
      total,
    )
    if (bytesRead === 0) break
    total += bytesRead
    if (total > MAX_SCAN_BYTES) return null
  }
  return normalizeCRLF(buf, total)
}

function indexOfWithin(buf: Buffer, needle: Buffer, end: number): number {
  const at = buf.indexOf(needle)
  return at === -1 || at + needle.length > end ? -1 : at
}

function countNewlines(buf: Buffer, start: number, end: number): number {
  let n = 0
  for (let i = start; i < end; i++) if (buf[i] === NL) n++
  return n
}

function normalizeCRLF(buf: Buffer, len: number): string {
  const s = buf.toString('utf8', 0, len)
  return s.includes('\r') ? s.replaceAll('\r\n', '\n') : s
}

async function sliceContext(
  handle: FileHandle,
  scratch: Buffer,
  matchStart: number,
  matchLen: number,
  contextLines: number,
  linesBeforeMatch: number,
): Promise<EditContext> {
  
  const backChunk = Math.min(matchStart, CHUNK_SIZE)
  const { bytesRead: backRead } = await handle.read(
    scratch,
    0,
    backChunk,
    matchStart - backChunk,
  )
  let ctxStart = matchStart
  let nlSeen = 0
  for (let i = backRead - 1; i >= 0 && nlSeen <= contextLines; i--) {
    if (scratch[i] === NL) {
      nlSeen++
      if (nlSeen > contextLines) break
    }
    ctxStart--
  }
  
  const walkedBack = matchStart - ctxStart
  const lineOffset =
    linesBeforeMatch -
    countNewlines(scratch, backRead - walkedBack, backRead) +
    1

  
  const matchEnd = matchStart + matchLen
  const { bytesRead: fwdRead } = await handle.read(
    scratch,
    0,
    CHUNK_SIZE,
    matchEnd,
  )
  let ctxEnd = matchEnd
  nlSeen = 0
  for (let i = 0; i < fwdRead; i++) {
    ctxEnd++
    if (scratch[i] === NL) {
      nlSeen++
      if (nlSeen >= contextLines + 1) break
    }
  }

  
  const len = ctxEnd - ctxStart
  const out = len <= scratch.length ? scratch : Buffer.allocUnsafe(len)
  const { bytesRead: outRead } = await handle.read(out, 0, len, ctxStart)

  return { content: normalizeCRLF(out, outRead), lineOffset, truncated: false }
}
