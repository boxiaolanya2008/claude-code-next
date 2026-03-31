

export type Signal<Args extends unknown[] = []> = {
  /** Subscribe a listener. Returns an unsubscribe function. */
  subscribe: (listener: (...args: Args) => void) => () => void
  /** Call all subscribed listeners with the given arguments. */
  emit: (...args: Args) => void
  /** Remove all listeners. Useful in dispose/reset paths. */
  clear: () => void
}

export function createSignal<Args extends unknown[] = []>(): Signal<Args> {
  const listeners = new Set<(...args: Args) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(...args) {
      for (const listener of listeners) listener(...args)
    },
    clear() {
      listeners.clear()
    },
  }
}
