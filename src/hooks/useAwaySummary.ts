import { feature } from "../utils/bundle-mock.ts"
import { useEffect, useRef } from 'react'
import {
  getTerminalFocusState,
  subscribeTerminalFocus,
} from '../ink/terminal-focus-state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { generateAwaySummary } from '../services/awaySummary.js'
import type { Message } from '../types/message.js'
import { createAwaySummaryMessage } from '../utils/messages.js'

const BLUR_DELAY_MS = 5 * 60_000

type SetMessages = (updater: (prev: Message[]) => Message[]) => void

function hasSummarySinceLastUserTurn(messages: readonly Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type === 'user' && !m.isMeta && !m.isCompactSummary) return false
    if (m.type === 'system' && m.subtype === 'away_summary') return true
  }
  return false
}

export function useAwaySummary(
  messages: readonly Message[],
  setMessages: SetMessages,
  isLoading: boolean,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const messagesRef = useRef(messages)
  const isLoadingRef = useRef(isLoading)
  const pendingRef = useRef(false)
  const generateRef = useRef<(() => Promise<void>) | null>(null)

  messagesRef.current = messages
  isLoadingRef.current = isLoading

  
  const gbEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_sedge_lantern',
    false,
  )

  useEffect(() => {
    if (!feature('AWAY_SUMMARY')) return
    if (!gbEnabled) return

    function clearTimer(): void {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    function abortInFlight(): void {
      abortRef.current?.abort()
      abortRef.current = null
    }

    async function generate(): Promise<void> {
      pendingRef.current = false
      if (hasSummarySinceLastUserTurn(messagesRef.current)) return
      abortInFlight()
      const controller = new AbortController()
      abortRef.current = controller
      const text = await generateAwaySummary(
        messagesRef.current,
        controller.signal,
      )
      if (controller.signal.aborted || text === null) return
      setMessages(prev => [...prev, createAwaySummaryMessage(text)])
    }

    function onBlurTimerFire(): void {
      timerRef.current = null
      if (isLoadingRef.current) {
        pendingRef.current = true
        return
      }
      void generate()
    }

    function onFocusChange(): void {
      const state = getTerminalFocusState()
      if (state === 'blurred') {
        clearTimer()
        timerRef.current = setTimeout(onBlurTimerFire, BLUR_DELAY_MS)
      } else if (state === 'focused') {
        clearTimer()
        abortInFlight()
        pendingRef.current = false
      }
      
    }

    const unsubscribe = subscribeTerminalFocus(onFocusChange)
    
    onFocusChange()
    generateRef.current = generate

    return () => {
      unsubscribe()
      clearTimer()
      abortInFlight()
      generateRef.current = null
    }
  }, [gbEnabled, setMessages])

  
  useEffect(() => {
    if (isLoading) return
    if (!pendingRef.current) return
    if (getTerminalFocusState() !== 'blurred') return
    void generateRef.current?.()
  }, [isLoading])
}
