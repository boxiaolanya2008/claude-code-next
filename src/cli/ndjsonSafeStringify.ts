import { jsonStringify } from '../utils/slowOperations.js'

const JS_LINE_TERMINATORS = /\u2028|\u2029/g

function escapeJsLineTerminators(json: string): string {
  return json.replace(JS_LINE_TERMINATORS, c =>
    c === '\u2028' ? '\\u2028' : '\\u2029',
  )
}

export function ndjsonSafeStringify(value: unknown): string {
  return escapeJsLineTerminators(jsonStringify(value))
}
