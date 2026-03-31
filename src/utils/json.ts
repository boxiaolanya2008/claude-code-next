import { open, readFile, stat } from 'fs/promises'
import {
  applyEdits,
  modify,
  parse as parseJsonc,
} from 'jsonc-parser/lib/esm/main.js'
import { stripBOM } from './jsonRead.js'
import { logError } from './log.js'
import { memoizeWithLRU } from './memoize.js'
import { jsonStringify } from './slowOperations.js'

type CachedParse = { ok: true; value: unknown } | { ok: false }

const PARSE_CACHE_MAX_KEY_BYTES = 8 * 1024

function parseJSONUncached(json: string, shouldLogError: boolean): CachedParse {
  try {
    return { ok: true, value: JSON.parse(stripBOM(json)) }
  } catch (e) {
    if (shouldLogError) {
      logError(e)
    }
    return { ok: false }
  }
}

const parseJSONCached = memoizeWithLRU(parseJSONUncached, json => json, 50)

export const safeParseJSON = Object.assign(
  function safeParseJSON(
    json: string | null | undefined,
    shouldLogError: boolean = true,
  ): unknown {
    if (!json) return null
    const result =
      json.length > PARSE_CACHE_MAX_KEY_BYTES
        ? parseJSONUncached(json, shouldLogError)
        : parseJSONCached(json, shouldLogError)
    return result.ok ? result.value : null
  },
  { cache: parseJSONCached.cache },
)

export function safeParseJSONC(json: string | null | undefined): unknown {
  if (!json) {
    return null
  }
  try {
    
    return parseJsonc(stripBOM(json))
  } catch (e) {
    logError(e)
    return null
  }
}

type BunJSONLParseChunk = (
  data: string | Buffer,
  offset?: number,
) => { values: unknown[]; error: null | Error; read: number; done: boolean }

const bunJSONLParse: BunJSONLParseChunk | false = (() => {
  if (typeof Bun === 'undefined') return false
  const b = Bun as Record<string, unknown>
  const jsonl = b.JSONL as Record<string, unknown> | undefined
  if (!jsonl?.parseChunk) return false
  return jsonl.parseChunk as BunJSONLParseChunk
})()

function parseJSONLBun<T>(data: string | Buffer): T[] {
  const parse = bunJSONLParse as BunJSONLParseChunk
  const len = data.length
  const result = parse(data)
  if (!result.error || result.done || result.read >= len) {
    return result.values as T[]
  }
  
  let values = result.values as T[]
  let offset = result.read
  while (offset < len) {
    const newlineIndex =
      typeof data === 'string'
        ? data.indexOf('\n', offset)
        : data.indexOf(0x0a, offset)
    if (newlineIndex === -1) break
    offset = newlineIndex + 1
    const next = parse(data, offset)
    if (next.values.length > 0) {
      values = values.concat(next.values as T[])
    }
    if (!next.error || next.done || next.read >= len) break
    offset = next.read
  }
  return values
}

function parseJSONLBuffer<T>(buf: Buffer): T[] {
  const bufLen = buf.length
  let start = 0

  
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    start = 3
  }

  const results: T[] = []
  while (start < bufLen) {
    let end = buf.indexOf(0x0a, start)
    if (end === -1) end = bufLen

    const line = buf.toString('utf8', start, end).trim()
    start = end + 1
    if (!line) continue
    try {
      results.push(JSON.parse(line) as T)
    } catch {
      
    }
  }
  return results
}

function parseJSONLString<T>(data: string): T[] {
  const stripped = stripBOM(data)
  const len = stripped.length
  let start = 0

  const results: T[] = []
  while (start < len) {
    let end = stripped.indexOf('\n', start)
    if (end === -1) end = len

    const line = stripped.substring(start, end).trim()
    start = end + 1
    if (!line) continue
    try {
      results.push(JSON.parse(line) as T)
    } catch {
      
    }
  }
  return results
}

export function parseJSONL<T>(data: string | Buffer): T[] {
  if (bunJSONLParse) {
    return parseJSONLBun<T>(data)
  }
  if (typeof data === 'string') {
    return parseJSONLString<T>(data)
  }
  return parseJSONLBuffer<T>(data)
}

const MAX_JSONL_READ_BYTES = 100 * 1024 * 1024

export async function readJSONLFile<T>(filePath: string): Promise<T[]> {
  const { size } = await stat(filePath)
  if (size <= MAX_JSONL_READ_BYTES) {
    return parseJSONL<T>(await readFile(filePath))
  }
  await using fd = await open(filePath, 'r')
  const buf = Buffer.allocUnsafe(MAX_JSONL_READ_BYTES)
  let totalRead = 0
  const fileOffset = size - MAX_JSONL_READ_BYTES
  while (totalRead < MAX_JSONL_READ_BYTES) {
    const { bytesRead } = await fd.read(
      buf,
      totalRead,
      MAX_JSONL_READ_BYTES - totalRead,
      fileOffset + totalRead,
    )
    if (bytesRead === 0) break
    totalRead += bytesRead
  }
  
  const newlineIndex = buf.indexOf(0x0a)
  if (newlineIndex !== -1 && newlineIndex < totalRead - 1) {
    return parseJSONL<T>(buf.subarray(newlineIndex + 1, totalRead))
  }
  return parseJSONL<T>(buf.subarray(0, totalRead))
}

export function addItemToJSONCArray(content: string, newItem: unknown): string {
  try {
    
    if (!content || content.trim() === '') {
      return jsonStringify([newItem], null, 4)
    }

    
    const cleanContent = stripBOM(content)

    
    const parsedContent = parseJsonc(cleanContent)

    
    if (Array.isArray(parsedContent)) {
      
      const arrayLength = parsedContent.length

      
      const isEmpty = arrayLength === 0

      
      const insertPath = isEmpty ? [0] : [arrayLength]

      
      const edits = modify(cleanContent, insertPath, newItem, {
        formattingOptions: { insertSpaces: true, tabSize: 4 },
        isArrayInsertion: true,
      })

      
      if (!edits || edits.length === 0) {
        const copy = [...parsedContent, newItem]
        return jsonStringify(copy, null, 4)
      }

      
      return applyEdits(cleanContent, edits)
    }
    
    else {
      
      return jsonStringify([newItem], null, 4)
    }
  } catch (e) {
    
    logError(e)
    return jsonStringify([newItem], null, 4)
  }
}
