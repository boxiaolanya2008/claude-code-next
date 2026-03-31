import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'

export const STDOUT_GUARD_MARKER = '[stdout-guard]'

let installed = false
let buffer = ''
let originalWrite: typeof process.stdout.write | null = null

function isJsonLine(line: string): boolean {
  
  
  if (line.length === 0) {
    return true
  }
  try {
    JSON.parse(line)
    return true
  } catch {
    return false
  }
}

export function installStreamJsonStdoutGuard(): void {
  if (installed) {
    return
  }
  installed = true

  originalWrite = process.stdout.write.bind(
    process.stdout,
  ) as typeof process.stdout.write

  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): boolean {
    const text =
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')

    buffer += text
    let newlineIdx: number
    let wrote = true
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx)
      buffer = buffer.slice(newlineIdx + 1)
      if (isJsonLine(line)) {
        wrote = originalWrite!(line + '\n')
      } else {
        process.stderr.write(`${STDOUT_GUARD_MARKER} ${line}\n`)
        logForDebugging(
          `streamJsonStdoutGuard diverted non-JSON stdout line: ${line.slice(0, 200)}`,
        )
      }
    }

    
    
    
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
    if (callback) {
      queueMicrotask(() => callback())
    }
    return wrote
  } as typeof process.stdout.write

  registerCleanup(async () => {
    
    
    if (buffer.length > 0) {
      if (originalWrite && isJsonLine(buffer)) {
        originalWrite(buffer + '\n')
      } else {
        process.stderr.write(`${STDOUT_GUARD_MARKER} ${buffer}\n`)
      }
      buffer = ''
    }
    if (originalWrite) {
      process.stdout.write = originalWrite
      originalWrite = null
    }
    installed = false
  })
}

export function _resetStreamJsonStdoutGuardForTesting(): void {
  if (originalWrite) {
    process.stdout.write = originalWrite
    originalWrite = null
  }
  buffer = ''
  installed = false
}
