import { type DOMElement, useAnimationFrame, useTerminalFocus } from '../ink.js'

const BLINK_INTERVAL_MS = 600

export function useBlink(
  enabled: boolean,
  intervalMs: number = BLINK_INTERVAL_MS,
): [ref: (element: DOMElement | null) => void, isVisible: boolean] {
  const focused = useTerminalFocus()
  const [ref, time] = useAnimationFrame(enabled && focused ? intervalMs : null)

  if (!enabled || !focused) return [ref, true]

  
  const isVisible = Math.floor(time / intervalMs) % 2 === 0
  return [ref, isVisible]
}
