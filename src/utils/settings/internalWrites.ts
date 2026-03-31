

const timestamps = new Map<string, number>()

export function markInternalWrite(path: string): void {
  timestamps.set(path, Date.now())
}

/**
 * True if `path` was marked within `windowMs`. Consumes the mark on match —
 * the watcher fires once per write, so a matched mark shouldn't suppress
 * the next (real, external) change to the same file.
 */
export function consumeInternalWrite(path: string, windowMs: number): boolean {
  const ts = timestamps.get(path)
  if (ts !== undefined && Date.now() - ts < windowMs) {
    timestamps.delete(path)
    return true
  }
  return false
}

export function clearInternalWrites(): void {
  timestamps.clear()
}
