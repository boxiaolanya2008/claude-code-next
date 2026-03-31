

import { logForDebugging } from './debug.js'
import { createSignal } from './signal.js'

export type ClaudeCodeHintType = 'plugin'

export type ClaudeCodeHint = {
  
  v: number
  
  type: ClaudeCodeHintType
  

  value: string
  

  sourceCommand: string
}

const SUPPORTED_VERSIONS = new Set([1])

const SUPPORTED_TYPES = new Set<string>(['plugin'])

const HINT_TAG_RE = /^[ \t]*<claude-code-next-hint\s+([^>]*?)\s*\/>[ \t]*$/gm

const ATTR_RE = /(\w+)=(?:"([^"]*)"|([^\s/>]+))/g

export function extractClaudeCodeHints(
  output: string,
  command: string,
): { hints: ClaudeCodeHint[]; stripped: string } {
  
  if (!output.includes('<claude-code-next-hint')) {
    return { hints: [], stripped: output }
  }

  const sourceCommand = firstCommandToken(command)
  const hints: ClaudeCodeHint[] = []

  const stripped = output.replace(HINT_TAG_RE, rawLine => {
    const attrs = parseAttrs(rawLine)
    const v = Number(attrs.v)
    const type = attrs.type
    const value = attrs.value

    if (!SUPPORTED_VERSIONS.has(v)) {
      logForDebugging(
        `[claudeCodeHints] dropped hint with unsupported v=${attrs.v}`,
      )
      return ''
    }
    if (!type || !SUPPORTED_TYPES.has(type)) {
      logForDebugging(
        `[claudeCodeHints] dropped hint with unsupported type=${type}`,
      )
      return ''
    }
    if (!value) {
      logForDebugging('[claudeCodeHints] dropped hint with empty value')
      return ''
    }

    hints.push({ v, type: type as ClaudeCodeHintType, value, sourceCommand })
    return ''
  })

  
  
  
  const collapsed =
    hints.length > 0 || stripped !== output
      ? stripped.replace(/\n{3,}/g, '\n\n')
      : stripped

  return { hints, stripped: collapsed }
}

function parseAttrs(tagBody: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of tagBody.matchAll(ATTR_RE)) {
    attrs[m[1]!] = m[2] ?? m[3] ?? ''
  }
  return attrs
}

function firstCommandToken(command: string): string {
  const trimmed = command.trim()
  const spaceIdx = trimmed.search(/\s/)
  return spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
}

let pendingHint: ClaudeCodeHint | null = null
let shownThisSession = false
const pendingHintChanged = createSignal()
const notify = pendingHintChanged.emit

export function setPendingHint(hint: ClaudeCodeHint): void {
  if (shownThisSession) return
  pendingHint = hint
  notify()
}

export function clearPendingHint(): void {
  if (pendingHint !== null) {
    pendingHint = null
    notify()
  }
}

export function markShownThisSession(): void {
  shownThisSession = true
}

export const subscribeToPendingHint = pendingHintChanged.subscribe

export function getPendingHintSnapshot(): ClaudeCodeHint | null {
  return pendingHint
}

export function hasShownHintThisSession(): boolean {
  return shownThisSession
}

export function _resetClaudeCodeHintStore(): void {
  pendingHint = null
  shownThisSession = false
}

export const _test = {
  parseAttrs,
  firstCommandToken,
}
