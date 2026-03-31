import { feature } from "../utils/bundle-mock.ts"
import type { WriteFileOptions } from 'fs'
import {
  closeSync,
  writeFileSync as fsWriteFileSync,
  fsyncSync,
  openSync,
} from 'fs'

import lodashCloneDeep from 'lodash-es/cloneDeep.js'
import { addSlowOperation } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'

type WriteFileOptionsWithFlush =
  | WriteFileOptions
  | (WriteFileOptions & { flush?: boolean })

const SLOW_OPERATION_THRESHOLD_MS = (() => {
  const envValue = process.env.CLAUDE_CODE_NEXT_SLOW_OPERATION_THRESHOLD_MS
  if (envValue !== undefined) {
    const parsed = Number(envValue)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed
    }
  }
  if (process.env.NODE_ENV === 'development') {
    return 20
  }
  if (process.env.USER_TYPE === 'ant') {
    return 300
  }
  return Infinity
})()

export { SLOW_OPERATION_THRESHOLD_MS }

let isLogging = false

export function callerFrame(stack: string | undefined): string {
  if (!stack) return ''
  for (const line of stack.split('\n')) {
    if (line.includes('slowOperations')) continue
    const m = line.match(/([^/\\]+?):(\d+):\d+\)?$/)
    if (m) return ` @ ${m[1]}:${m[2]}`
  }
  return ''
}

function buildDescription(args: IArguments): string {
  const strings = args[0] as TemplateStringsArray
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i + 1 < args.length) {
      const v = args[i + 1]
      if (Array.isArray(v)) {
        result += `Array[${(v as unknown[]).length}]`
      } else if (v !== null && typeof v === 'object') {
        result += `Object{${Object.keys(v as Record<string, unknown>).length} keys}`
      } else if (typeof v === 'string') {
        result += v.length > 80 ? `${v.slice(0, 80)}…` : v
      } else {
        result += String(v)
      }
    }
  }
  return result
}

class AntSlowLogger {
  startTime: number
  args: IArguments
  err: Error

  constructor(args: IArguments) {
    this.startTime = performance.now()
    this.args = args
    
    
    this.err = new Error()
  }

  [Symbol.dispose](): void {
    const duration = performance.now() - this.startTime
    if (duration > SLOW_OPERATION_THRESHOLD_MS && !isLogging) {
      isLogging = true
      try {
        const description =
          buildDescription(this.args) + callerFrame(this.err.stack)
        logForDebugging(
          `[SLOW OPERATION DETECTED] ${description} (${duration.toFixed(1)}ms)`,
        )
        addSlowOperation(description, duration)
      } finally {
        isLogging = false
      }
    }
  }
}

const NOOP_LOGGER: Disposable = { [Symbol.dispose]() {} }

function slowLoggingAnt(
  _strings: TemplateStringsArray,
  ..._values: unknown[]
): AntSlowLogger {
  
  return new AntSlowLogger(arguments)
}

function slowLoggingExternal(): Disposable {
  return NOOP_LOGGER
}

export const slowLogging: {
  (strings: TemplateStringsArray, ...values: unknown[]): Disposable
} = feature('SLOW_OPERATION_LOGGING') ? slowLoggingAnt : slowLoggingExternal

export function jsonStringify(
  value: unknown,
  replacer?: (this: unknown, key: string, value: unknown) => unknown,
  space?: string | number,
): string
export function jsonStringify(
  value: unknown,
  replacer?: (number | string)[] | null,
  space?: string | number,
): string
export function jsonStringify(
  value: unknown,
  replacer?:
    | ((this: unknown, key: string, value: unknown) => unknown)
    | (number | string)[]
    | null,
  space?: string | number,
): string {
  using _ = slowLogging`JSON.stringify(${value})`
  return JSON.stringify(
    value,
    replacer as Parameters<typeof JSON.stringify>[1],
    space,
  )
}

export const jsonParse: typeof JSON.parse = (text, reviver) => {
  using _ = slowLogging`JSON.parse(${text})`
  
  
  return typeof reviver === 'undefined'
    ? JSON.parse(text)
    : JSON.parse(text, reviver)
}

export function clone<T>(value: T, options?: StructuredSerializeOptions): T {
  using _ = slowLogging`structuredClone(${value})`
  return structuredClone(value, options)
}

export function cloneDeep<T>(value: T): T {
  using _ = slowLogging`cloneDeep(${value})`
  return lodashCloneDeep(value)
}

export function writeFileSync_DEPRECATED(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  options?: WriteFileOptionsWithFlush,
): void {
  using _ = slowLogging`fs.writeFileSync(${filePath}, ${data})`

  
  const needsFlush =
    options !== null &&
    typeof options === 'object' &&
    'flush' in options &&
    options.flush === true

  if (needsFlush) {
    
    const encoding =
      typeof options === 'object' && 'encoding' in options
        ? options.encoding
        : undefined
    const mode =
      typeof options === 'object' && 'mode' in options
        ? options.mode
        : undefined
    let fd: number | undefined
    try {
      fd = openSync(filePath, 'w', mode)
      fsWriteFileSync(fd, data, { encoding: encoding ?? undefined })
      fsyncSync(fd)
    } finally {
      if (fd !== undefined) {
        closeSync(fd)
      }
    }
  } else {
    
    fsWriteFileSync(filePath, data, options as WriteFileOptions)
  }
}
