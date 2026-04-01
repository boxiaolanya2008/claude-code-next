// Mock lockfile module

export function lock(
  file: string,
  options?: any,
): Promise<() => Promise<void>> {
  return Promise.resolve(() => Promise.resolve())
}

export function lockSync(file: string, options?: any): () => void {
  return () => {}
}

export function unlock(file: string, options?: any): Promise<void> {
  return Promise.resolve()
}

export function check(file: string, options?: any): Promise<boolean> {
  return Promise.resolve(false)
}
