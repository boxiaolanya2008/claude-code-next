

import { AsyncLocalStorage } from 'async_hooks'

export type Workload = 'cron'
export const WORKLOAD_CRON: Workload = 'cron'

const workloadStorage = new AsyncLocalStorage<{
  workload: string | undefined
}>()

export function getWorkload(): string | undefined {
  return workloadStorage.getStore()?.workload
}

/**
 * Wrap `fn` in a workload ALS context. ALWAYS establishes a new context
 * boundary, even when `workload` is undefined.
 *
 * The previous implementation short-circuited on `undefined` with
 * `return fn()` — but that's a pass-through, not a boundary. If the caller
 * is already inside a leaked cron context (REPL: queryGuard.end() →
 * _notify() → React subscriber → scheduled re-render captures ALS at
 * scheduling time → useQueueProcessor effect → executeQueuedInput → here),
 * a pass-through lets `getWorkload()` inside `fn` return the leaked tag.
 * Once leaked, it's sticky forever: every turn's end-notify re-propagates
 * the ambient context to the next turn's scheduling chain.
 *
 * Always calling `.run()` guarantees `getWorkload()` inside `fn` returns
 * exactly what the caller passed — including `undefined`.
 */
export function runWithWorkload<T>(
  workload: string | undefined,
  fn: () => T,
): T {
  return workloadStorage.run({ workload }, fn)
}
