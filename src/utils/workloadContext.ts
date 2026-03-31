

import { AsyncLocalStorage } from 'async_hooks'

export type Workload = 'cron'
export const WORKLOAD_CRON: Workload = 'cron'

const workloadStorage = new AsyncLocalStorage<{
  workload: string | undefined
}>()

export function getWorkload(): string | undefined {
  return workloadStorage.getStore()?.workload
}

export function runWithWorkload<T>(
  workload: string | undefined,
  fn: () => T,
): T {
  return workloadStorage.run({ workload }, fn)
}
