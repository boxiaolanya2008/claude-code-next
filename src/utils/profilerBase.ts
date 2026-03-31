

import type { performance as PerformanceType } from 'perf_hooks'
import { formatFileSize } from './format.js'

let performance: typeof PerformanceType | null = null

export function getPerformance(): typeof PerformanceType {
  if (!performance) {
    
    performance = require('perf_hooks').performance
  }
  return performance!
}

export function formatMs(ms: number): string {
  return ms.toFixed(3)
}

export function formatTimelineLine(
  totalMs: number,
  deltaMs: number,
  name: string,
  memory: NodeJS.MemoryUsage | undefined,
  totalPad: number,
  deltaPad: number,
  extra = '',
): string {
  const memInfo = memory
    ? ` | RSS: ${formatFileSize(memory.rss)}, Heap: ${formatFileSize(memory.heapUsed)}`
    : ''
  return `[+${formatMs(totalMs).padStart(totalPad)}ms] (+${formatMs(deltaMs).padStart(deltaPad)}ms) ${name}${extra}${memInfo}`
}
