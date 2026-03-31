import {
  getClaudeAiBaseUrl,
  getRemoteSessionUrl,
} from '../constants/product.js'
import { stringWidth } from '../ink/stringWidth.js'
import { formatDuration, truncateToWidth } from '../utils/format.js'
import { getGraphemeSegmenter } from '../utils/intl.js'

export type StatusState =
  | 'idle'
  | 'attached'
  | 'titled'
  | 'reconnecting'
  | 'failed'

export const TOOL_DISPLAY_EXPIRY_MS = 30_000

export const SHIMMER_INTERVAL_MS = 150

export function timestamp(): string {
  const now = new Date()
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export { formatDuration, truncateToWidth as truncatePrompt }

export function abbreviateActivity(summary: string): string {
  return truncateToWidth(summary, 30)
}

export function buildBridgeConnectUrl(
  environmentId: string,
  ingressUrl?: string,
): string {
  const baseUrl = getClaudeAiBaseUrl(undefined, ingressUrl)
  return `${baseUrl}/code?bridge=${environmentId}`
}

export function buildBridgeSessionUrl(
  sessionId: string,
  environmentId: string,
  ingressUrl?: string,
): string {
  return `${getRemoteSessionUrl(sessionId, ingressUrl)}?bridge=${environmentId}`
}

export function computeGlimmerIndex(
  tick: number,
  messageWidth: number,
): number {
  const cycleLength = messageWidth + 20
  return messageWidth + 10 - (tick % cycleLength)
}

export function computeShimmerSegments(
  text: string,
  glimmerIndex: number,
): { before: string; shimmer: string; after: string } {
  const messageWidth = stringWidth(text)
  const shimmerStart = glimmerIndex - 1
  const shimmerEnd = glimmerIndex + 1

  
  if (shimmerStart >= messageWidth || shimmerEnd < 0) {
    return { before: text, shimmer: '', after: '' }
  }

  
  const clampedStart = Math.max(0, shimmerStart)
  let colPos = 0
  let before = ''
  let shimmer = ''
  let after = ''
  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    const segWidth = stringWidth(segment)
    if (colPos + segWidth <= clampedStart) {
      before += segment
    } else if (colPos > shimmerEnd) {
      after += segment
    } else {
      shimmer += segment
    }
    colPos += segWidth
  }

  return { before, shimmer, after }
}

export type BridgeStatusInfo = {
  label:
    | 'Remote Control failed'
    | 'Remote Control reconnecting'
    | 'Remote Control active'
    | 'Remote Control connecting\u2026'
  color: 'error' | 'warning' | 'success'
}

export function getBridgeStatus({
  error,
  connected,
  sessionActive,
  reconnecting,
}: {
  error: string | undefined
  connected: boolean
  sessionActive: boolean
  reconnecting: boolean
}): BridgeStatusInfo {
  if (error) return { label: 'Remote Control failed', color: 'error' }
  if (reconnecting)
    return { label: 'Remote Control reconnecting', color: 'warning' }
  if (sessionActive || connected)
    return { label: 'Remote Control active', color: 'success' }
  return { label: 'Remote Control connecting\u2026', color: 'warning' }
}

export function buildIdleFooterText(url: string): string {
  return `Code everywhere with the Claude app or ${url}`
}

export function buildActiveFooterText(url: string): string {
  return `Continue coding in the Claude app or ${url}`
}

export const FAILED_FOOTER_TEXT = 'Something went wrong, please try again'

export function wrapWithOsc8Link(text: string, url: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`
}
