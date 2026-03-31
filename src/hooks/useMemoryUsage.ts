import { useState } from 'react'
import { useInterval } from 'usehooks-ts'

export type MemoryUsageStatus = 'normal' | 'high' | 'critical'

export type MemoryUsageInfo = {
  heapUsed: number
  status: MemoryUsageStatus
}

const HIGH_MEMORY_THRESHOLD = 1.5 * 1024 * 1024 * 1024 
const CRITICAL_MEMORY_THRESHOLD = 2.5 * 1024 * 1024 * 1024 

export function useMemoryUsage(): MemoryUsageInfo | null {
  const [memoryUsage, setMemoryUsage] = useState<MemoryUsageInfo | null>(null)

  useInterval(() => {
    const heapUsed = process.memoryUsage().heapUsed
    const status: MemoryUsageStatus =
      heapUsed >= CRITICAL_MEMORY_THRESHOLD
        ? 'critical'
        : heapUsed >= HIGH_MEMORY_THRESHOLD
          ? 'high'
          : 'normal'
    setMemoryUsage(prev => {
      
      
      
      if (status === 'normal') return prev === null ? prev : null
      return { heapUsed, status }
    })
  }, 10_000)

  return memoryUsage
}
