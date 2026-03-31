import type { DOMElement } from './dom.js'
import type { Rectangle } from './layout/geometry.js'

export type CachedLayout = {
  x: number
  y: number
  width: number
  height: number
  top?: number
}

export const nodeCache = new WeakMap<DOMElement, CachedLayout>()

export const pendingClears = new WeakMap<DOMElement, Rectangle[]>()

let absoluteNodeRemoved = false

export function addPendingClear(
  parent: DOMElement,
  rect: Rectangle,
  isAbsolute: boolean,
): void {
  const existing = pendingClears.get(parent)
  if (existing) {
    existing.push(rect)
  } else {
    pendingClears.set(parent, [rect])
  }
  if (isAbsolute) {
    absoluteNodeRemoved = true
  }
}

export function consumeAbsoluteRemovedFlag(): boolean {
  const had = absoluteNodeRemoved
  absoluteNodeRemoved = false
  return had
}
