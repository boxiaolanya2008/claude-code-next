import { randomUUID } from 'crypto'
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import {
  createHistoryAuthCtx,
  fetchLatestEvents,
  fetchOlderEvents,
  type HistoryAuthCtx,
  type HistoryPage,
} from '../assistant/sessionHistory.js'
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js'
import type { RemoteSessionConfig } from '../remote/RemoteSessionManager.js'
import { convertSDKMessage } from '../remote/sdkMessageAdapter.js'
import type { Message, SystemInformationalMessage } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'

type Props = {
  
  config: RemoteSessionConfig | undefined
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  scrollRef: RefObject<ScrollBoxHandle | null>
  

  onPrepend?: (indexDelta: number, heightDelta: number) => void
}

type Result = {
  
  maybeLoadOlder: (handle: ScrollBoxHandle) => void
}

const PREFETCH_THRESHOLD_ROWS = 40

const MAX_FILL_PAGES = 10

const SENTINEL_LOADING = 'loading older messages…'
const SENTINEL_LOADING_FAILED =
  'failed to load older messages — scroll up to retry'
const SENTINEL_START = 'start of session'

function pageToMessages(page: HistoryPage): Message[] {
  const out: Message[] = []
  for (const ev of page.events) {
    const c = convertSDKMessage(ev, {
      convertUserTextMessages: true,
      convertToolResults: true,
    })
    if (c.type === 'message') out.push(c.message)
  }
  return out
}

export function useAssistantHistory({
  config,
  setMessages,
  scrollRef,
  onPrepend,
}: Props): Result {
  const enabled = config?.viewerOnly === true

  
  
  const cursorRef = useRef<string | null | undefined>(undefined)
  const ctxRef = useRef<HistoryAuthCtx | null>(null)
  const inflightRef = useRef(false)

  
  
  
  const anchorRef = useRef<{ beforeHeight: number; count: number } | null>(null)

  
  
  
  
  const fillBudgetRef = useRef(0)

  
  
  const sentinelUuidRef = useRef(randomUUID())

  function mkSentinel(text: string): SystemInformationalMessage {
    return {
      type: 'system',
      subtype: 'informational',
      content: text,
      isMeta: false,
      timestamp: new Date().toISOString(),
      uuid: sentinelUuidRef.current,
      level: 'info',
    }
  }

  

  const prepend = useCallback(
    (page: HistoryPage, isInitial: boolean) => {
      const msgs = pageToMessages(page)
      cursorRef.current = page.hasMore ? page.firstId : null

      if (!isInitial) {
        const s = scrollRef.current
        anchorRef.current = s
          ? { beforeHeight: s.getFreshScrollHeight(), count: msgs.length }
          : null
      }

      const sentinel = page.hasMore ? null : mkSentinel(SENTINEL_START)
      setMessages(prev => {
        
        const base =
          prev[0]?.uuid === sentinelUuidRef.current ? prev.slice(1) : prev
        return sentinel ? [sentinel, ...msgs, ...base] : [...msgs, ...base]
      })

      logForDebugging(
        `[useAssistantHistory] ${isInitial ? 'initial' : 'older'} page: ${msgs.length} msgs (raw ${page.events.length}), hasMore=${page.hasMore}`,
      )
    },
    
    [setMessages],
  )

  
  useEffect(() => {
    if (!enabled || !config) return
    let cancelled = false
    void (async () => {
      const ctx = await createHistoryAuthCtx(config.sessionId).catch(() => null)
      if (!ctx || cancelled) return
      ctxRef.current = ctx
      const page = await fetchLatestEvents(ctx)
      if (cancelled || !page) return
      fillBudgetRef.current = MAX_FILL_PAGES
      prepend(page, true)
    })()
    return () => {
      cancelled = true
    }
    
    
  }, [enabled])

  const loadOlder = useCallback(async () => {
    if (!enabled || inflightRef.current) return
    const cursor = cursorRef.current
    const ctx = ctxRef.current
    if (!cursor || !ctx) return 
    inflightRef.current = true
    
    setMessages(prev => {
      const base =
        prev[0]?.uuid === sentinelUuidRef.current ? prev.slice(1) : prev
      return [mkSentinel(SENTINEL_LOADING), ...base]
    })
    try {
      const page = await fetchOlderEvents(ctx, cursor)
      if (!page) {
        
        
        setMessages(prev => {
          const base =
            prev[0]?.uuid === sentinelUuidRef.current ? prev.slice(1) : prev
          return [mkSentinel(SENTINEL_LOADING_FAILED), ...base]
        })
        return
      }
      prepend(page, false)
    } finally {
      inflightRef.current = false
    }
    
  }, [enabled, prepend, setMessages])

  
  
  
  
  
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null) return
    anchorRef.current = null
    const s = scrollRef.current
    if (!s || s.isSticky()) return 
    const delta = s.getFreshScrollHeight() - anchor.beforeHeight
    if (delta > 0) s.scrollBy(delta)
    onPrepend?.(anchor.count, delta)
  })

  
  
  
  
  
  
  
  
  useEffect(() => {
    if (
      fillBudgetRef.current <= 0 ||
      !cursorRef.current ||
      inflightRef.current
    ) {
      return
    }
    const s = scrollRef.current
    if (!s) return
    const contentH = s.getFreshScrollHeight()
    const viewH = s.getViewportHeight()
    logForDebugging(
      `[useAssistantHistory] fill-check: content=${contentH} viewport=${viewH} budget=${fillBudgetRef.current}`,
    )
    if (contentH <= viewH) {
      fillBudgetRef.current--
      void loadOlder()
    } else {
      fillBudgetRef.current = 0
    }
  })

  
  const maybeLoadOlder = useCallback(
    (handle: ScrollBoxHandle) => {
      if (handle.getScrollTop() < PREFETCH_THRESHOLD_ROWS) void loadOlder()
    },
    [loadOlder],
  )

  return { maybeLoadOlder }
}
