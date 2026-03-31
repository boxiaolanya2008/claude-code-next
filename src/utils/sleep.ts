

export function sleep(
  ms: number,
  signal?: AbortSignal,
  opts?: { throwOnAbort?: boolean; abortError?: () => Error; unref?: boolean },
): Promise<void> {
  return new Promise((resolve, reject) => {
    
    
    
    if (signal?.aborted) {
      if (opts?.throwOnAbort || opts?.abortError) {
        void reject(opts.abortError?.() ?? new Error('aborted'))
      } else {
        void resolve()
      }
      return
    }
    const timer = setTimeout(
      (signal, onAbort, resolve) => {
        signal?.removeEventListener('abort', onAbort)
        void resolve()
      },
      ms,
      signal,
      onAbort,
      resolve,
    )
    function onAbort(): void {
      clearTimeout(timer)
      if (opts?.throwOnAbort || opts?.abortError) {
        void reject(opts.abortError?.() ?? new Error('aborted'))
      } else {
        void resolve()
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (opts?.unref) {
      timer.unref()
    }
  })
}

function rejectWithTimeout(reject: (e: Error) => void, message: string): void {
  reject(new Error(message))
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    
    timer = setTimeout(rejectWithTimeout, ms, reject, message)
    if (typeof timer === 'object') timer.unref?.()
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
