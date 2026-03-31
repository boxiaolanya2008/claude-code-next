import { useContext, useEffect, useRef } from 'react'
import {
  CLEAR_TAB_STATUS,
  supportsTabStatus,
  tabStatus,
  wrapForMultiplexer,
} from '../termio/osc.js'
import type { Color } from '../termio/types.js'
import { TerminalWriteContext } from '../useTerminalNotification.js'

export type TabStatusKind = 'idle' | 'busy' | 'waiting'

const rgb = (r: number, g: number, b: number): Color => ({
  type: 'rgb',
  r,
  g,
  b,
})

const TAB_STATUS_PRESETS: Record<
  TabStatusKind,
  { indicator: Color; status: string; statusColor: Color }
> = {
  idle: {
    indicator: rgb(0, 215, 95),
    status: 'Idle',
    statusColor: rgb(136, 136, 136),
  },
  busy: {
    indicator: rgb(255, 149, 0),
    status: 'Working…',
    statusColor: rgb(255, 149, 0),
  },
  waiting: {
    indicator: rgb(95, 135, 255),
    status: 'Waiting',
    statusColor: rgb(95, 135, 255),
  },
}

export function useTabStatus(kind: TabStatusKind | null): void {
  const writeRaw = useContext(TerminalWriteContext)
  const prevKindRef = useRef<TabStatusKind | null>(null)

  useEffect(() => {
    
    
    if (kind === null) {
      if (prevKindRef.current !== null && writeRaw && supportsTabStatus()) {
        writeRaw(wrapForMultiplexer(CLEAR_TAB_STATUS))
      }
      prevKindRef.current = null
      return
    }

    prevKindRef.current = kind
    if (!writeRaw || !supportsTabStatus()) return
    writeRaw(wrapForMultiplexer(tabStatus(TAB_STATUS_PRESETS[kind])))
  }, [kind, writeRaw])
}
