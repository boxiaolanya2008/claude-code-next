

const timestamps = new Map<string, number>()

export function markInternalWrite(path: string): void {
  timestamps.set(path, Date.now())
}

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
