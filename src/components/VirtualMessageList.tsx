import { c as _c } from "react/compiler-runtime";
import type { RefObject } from 'react';
import * as React from 'react';
import { useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { useVirtualScroll } from '../hooks/useVirtualScroll.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import type { DOMElement } from '../ink/dom.js';
import type { MatchPosition } from '../ink/render-to-screen.js';
import { Box } from '../ink.js';
import type { RenderableMessage } from '../types/message.js';
import { TextHoverColorContext } from './design-system/ThemedText.js';
import { ScrollChromeContext } from './FullscreenLayout.js';

const HEADROOM = 3;
import { logForDebugging } from '../utils/debug.js';
import { sleep } from '../utils/sleep.js';
import { renderableSearchText } from '../utils/transcriptSearch.js';
import { isNavigableMessage, type MessageActionsNav, type MessageActionsState, type NavigableMessage, stripSystemReminders, toolCallOf } from './messageActions.js';

const fallbackLowerCache = new WeakMap<RenderableMessage, string>();
function defaultExtractSearchText(msg: RenderableMessage): string {
  const cached = fallbackLowerCache.get(msg);
  if (cached !== undefined) return cached;
  const lowered = renderableSearchText(msg);
  fallbackLowerCache.set(msg, lowered);
  return lowered;
}
export type StickyPrompt = {
  text: string;
  scrollTo: () => void;
}

| 'clicked';

const STICKY_TEXT_CAP = 500;

export type JumpHandle = {
  jumpToIndex: (i: number) => void;
  setSearchQuery: (q: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  

  setAnchor: () => void;
  

  warmSearchIndex: () => Promise<number>;
  

  disarmSearch: () => void;
};
type Props = {
  messages: RenderableMessage[];
  scrollRef: RefObject<ScrollBoxHandle | null>;
  

  columns: number;
  itemKey: (msg: RenderableMessage) => string;
  renderItem: (msg: RenderableMessage, index: number) => React.ReactNode;
  
  onItemClick?: (msg: RenderableMessage) => void;
  

  isItemClickable?: (msg: RenderableMessage) => boolean;
  
  isItemExpanded?: (msg: RenderableMessage) => boolean;
  

  extractSearchText?: (msg: RenderableMessage) => string;
  

  trackStickyPrompt?: boolean;
  selectedIndex?: number;
  
  cursorNavRef?: React.Ref<MessageActionsNav>;
  setCursor?: (c: MessageActionsState | null) => void;
  jumpRef?: RefObject<JumpHandle | null>;
  

  onSearchMatchesChange?: (count: number, current: number) => void;
  

  scanElement?: (el: DOMElement) => MatchPosition[];
  

  setPositions?: (state: {
    positions: MatchPosition[];
    rowOffset: number;
    currentIdx: number;
  } | null) => void;
};

const promptTextCache = new WeakMap<RenderableMessage, string | null>();
function stickyPromptText(msg: RenderableMessage): string | null {
  
  
  
  
  
  const cached = promptTextCache.get(msg);
  if (cached !== undefined) return cached;
  const result = computeStickyPromptText(msg);
  promptTextCache.set(msg, result);
  return result;
}
function computeStickyPromptText(msg: RenderableMessage): string | null {
  let raw: string | null = null;
  if (msg.type === 'user') {
    if (msg.isMeta || msg.isVisibleInTranscriptOnly) return null;
    const block = msg.message.content[0];
    if (block?.type !== 'text') return null;
    raw = block.text;
  } else if (msg.type === 'attachment' && msg.attachment.type === 'queued_command' && msg.attachment.commandMode !== 'task-notification' && !msg.attachment.isMeta) {
    const p = msg.attachment.prompt;
    raw = typeof p === 'string' ? p : p.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n');
  }
  if (raw === null) return null;
  const t = stripSystemReminders(raw);
  if (t.startsWith('<') || t === '') return null;
  return t;
}

type VirtualItemProps = {
  itemKey: string;
  msg: RenderableMessage;
  idx: number;
  measureRef: (key: string) => (el: DOMElement | null) => void;
  expanded: boolean | undefined;
  hovered: boolean;
  clickable: boolean;
  onClickK: (msg: RenderableMessage, cellIsBlank: boolean) => void;
  onEnterK: (k: string) => void;
  onLeaveK: (k: string) => void;
  renderItem: (msg: RenderableMessage, idx: number) => React.ReactNode;
};

function VirtualItem(t0) {
  const $ = _c(30);
  const {
    itemKey: k,
    msg,
    idx,
    measureRef,
    expanded,
    hovered,
    clickable,
    onClickK,
    onEnterK,
    onLeaveK,
    renderItem
  } = t0;
  let t1;
  if ($[0] !== k || $[1] !== measureRef) {
    t1 = measureRef(k);
    $[0] = k;
    $[1] = measureRef;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const t2 = expanded ? "userMessageBackgroundHover" : undefined;
  const t3 = expanded ? 1 : undefined;
  let t4;
  if ($[3] !== clickable || $[4] !== msg || $[5] !== onClickK) {
    t4 = clickable ? e => onClickK(msg, e.cellIsBlank) : undefined;
    $[3] = clickable;
    $[4] = msg;
    $[5] = onClickK;
    $[6] = t4;
  } else {
    t4 = $[6];
  }
  let t5;
  if ($[7] !== clickable || $[8] !== k || $[9] !== onEnterK) {
    t5 = clickable ? () => onEnterK(k) : undefined;
    $[7] = clickable;
    $[8] = k;
    $[9] = onEnterK;
    $[10] = t5;
  } else {
    t5 = $[10];
  }
  let t6;
  if ($[11] !== clickable || $[12] !== k || $[13] !== onLeaveK) {
    t6 = clickable ? () => onLeaveK(k) : undefined;
    $[11] = clickable;
    $[12] = k;
    $[13] = onLeaveK;
    $[14] = t6;
  } else {
    t6 = $[14];
  }
  const t7 = hovered && !expanded ? "text" : undefined;
  let t8;
  if ($[15] !== idx || $[16] !== msg || $[17] !== renderItem) {
    t8 = renderItem(msg, idx);
    $[15] = idx;
    $[16] = msg;
    $[17] = renderItem;
    $[18] = t8;
  } else {
    t8 = $[18];
  }
  let t9;
  if ($[19] !== t7 || $[20] !== t8) {
    t9 = <TextHoverColorContext.Provider value={t7}>{t8}</TextHoverColorContext.Provider>;
    $[19] = t7;
    $[20] = t8;
    $[21] = t9;
  } else {
    t9 = $[21];
  }
  let t10;
  if ($[22] !== t1 || $[23] !== t2 || $[24] !== t3 || $[25] !== t4 || $[26] !== t5 || $[27] !== t6 || $[28] !== t9) {
    t10 = <Box ref={t1} flexDirection="column" backgroundColor={t2} paddingBottom={t3} onClick={t4} onMouseEnter={t5} onMouseLeave={t6}>{t9}</Box>;
    $[22] = t1;
    $[23] = t2;
    $[24] = t3;
    $[25] = t4;
    $[26] = t5;
    $[27] = t6;
    $[28] = t9;
    $[29] = t10;
  } else {
    t10 = $[29];
  }
  return t10;
}
export function VirtualMessageList({
  messages,
  scrollRef,
  columns,
  itemKey,
  renderItem,
  onItemClick,
  isItemClickable,
  isItemExpanded,
  extractSearchText = defaultExtractSearchText,
  trackStickyPrompt,
  selectedIndex,
  cursorNavRef,
  setCursor,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions
}: Props): React.ReactNode {
  
  
  
  
  const keysRef = useRef<string[]>([]);
  const prevMessagesRef = useRef<typeof messages>(messages);
  const prevItemKeyRef = useRef(itemKey);
  if (prevItemKeyRef.current !== itemKey || messages.length < keysRef.current.length || messages[0] !== prevMessagesRef.current[0]) {
    keysRef.current = messages.map(m => itemKey(m));
  } else {
    for (let i = keysRef.current.length; i < messages.length; i++) {
      keysRef.current.push(itemKey(messages[i]!));
    }
  }
  prevMessagesRef.current = messages;
  prevItemKeyRef.current = itemKey;
  const keys = keysRef.current;
  const {
    range,
    topSpacer,
    bottomSpacer,
    measureRef,
    spacerRef,
    offsets,
    getItemTop,
    getItemElement,
    getItemHeight,
    scrollToIndex
  } = useVirtualScroll(scrollRef, keys, columns);
  const [start, end] = range;

  
  const isVisible = useCallback((i: number) => {
    const h = getItemHeight(i);
    if (h === 0) return false;
    return isNavigableMessage(messages[i]!);
  }, [getItemHeight, messages]);
  useImperativeHandle(cursorNavRef, (): MessageActionsNav => {
    const select = (m: NavigableMessage) => setCursor?.({
      uuid: m.uuid,
      msgType: m.type,
      expanded: false,
      toolName: toolCallOf(m)?.name
    });
    const selIdx = selectedIndex ?? -1;
    const scan = (from: number, dir: 1 | -1, pred: (i: number) => boolean = isVisible) => {
      for (let i = from; i >= 0 && i < messages.length; i += dir) {
        if (pred(i)) {
          select(messages[i]!);
          return true;
        }
      }
      return false;
    };
    const isUser = (i: number) => isVisible(i) && messages[i]!.type === 'user';
    return {
      
      enterCursor: () => scan(messages.length - 1, -1, isUser),
      navigatePrev: () => scan(selIdx - 1, -1),
      navigateNext: () => {
        if (scan(selIdx + 1, 1)) return;
        
        
        scrollRef.current?.scrollToBottom();
        setCursor?.(null);
      },
      
      navigatePrevUser: () => scan(selIdx - 1, -1, isUser),
      navigateNextUser: () => scan(selIdx + 1, 1, isUser),
      navigateTop: () => scan(0, 1),
      navigateBottom: () => scan(messages.length - 1, -1),
      getSelected: () => selIdx >= 0 ? messages[selIdx] ?? null : null
    };
  }, [messages, selectedIndex, setCursor, isVisible]);
  
  
  
  const jumpState = useRef({
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex
  });
  jumpState.current = {
    offsets,
    start,
    getItemElement,
    getItemTop,
    messages,
    scrollToIndex
  };

  
  
  
  
  useEffect(() => {
    if (selectedIndex === undefined) return;
    const s = jumpState.current;
    const el = s.getItemElement(selectedIndex);
    if (el) {
      scrollRef.current?.scrollToElement(el, 1);
    } else {
      s.scrollToIndex(selectedIndex);
    }
  }, [selectedIndex, scrollRef]);

  
  
  
  
  const scanRequestRef = useRef<{
    idx: number;
    wantLast: boolean;
    tries: number;
  } | null>(null);
  
  
  
  const elementPositions = useRef<{
    msgIdx: number;
    positions: MatchPosition[];
  }>({
    msgIdx: -1,
    positions: []
  });
  
  const startPtrRef = useRef(-1);
  
  const phantomBurstRef = useRef(0);
  
  
  
  
  const pendingStepRef = useRef<1 | -1 | 0>(0);
  
  
  const stepRef = useRef<(d: 1 | -1) => void>(() => {});
  const highlightRef = useRef<(ord: number) => void>(() => {});
  const searchState = useRef({
    matches: [] as number[],
    
    ptr: 0,
    screenOrd: 0,
    
    
    
    
    
    prefixSum: [] as number[]
  });
  
  
  const searchAnchor = useRef(-1);
  const indexWarmed = useRef(false);

  
  
  
  
  
  
  function targetFor(i: number): number {
    const top = jumpState.current.getItemTop(i);
    return Math.max(0, top - HEADROOM);
  }

  
  
  
  
  function highlight(ord: number): void {
    const s = scrollRef.current;
    const {
      msgIdx,
      positions
    } = elementPositions.current;
    if (!s || positions.length === 0 || msgIdx < 0) {
      setPositions?.(null);
      return;
    }
    const idx = Math.max(0, Math.min(ord, positions.length - 1));
    const p = positions[idx]!;
    const top = jumpState.current.getItemTop(msgIdx);
    
    
    
    
    
    
    const vpTop = s.getViewportTop();
    let lo = top - s.getScrollTop();
    const vp = s.getViewportHeight();
    let screenRow = vpTop + lo + p.row;
    
    
    if (screenRow < vpTop || screenRow >= vpTop + vp) {
      s.scrollTo(Math.max(0, top + p.row - HEADROOM));
      lo = top - s.getScrollTop();
      screenRow = vpTop + lo + p.row;
    }
    setPositions?.({
      positions,
      rowOffset: vpTop + lo,
      currentIdx: idx
    });
    
    
    
    
    const st = searchState.current;
    const total = st.prefixSum.at(-1) ?? 0;
    const current = (st.prefixSum[st.ptr] ?? 0) + idx + 1;
    onSearchMatchesChange?.(total, current);
    logForDebugging(`highlight(i=${msgIdx}, ord=${idx}/${positions.length}): ` + `pos={row:${p.row},col:${p.col}} lo=${lo} screenRow=${screenRow} ` + `badge=${current}/${total}`);
  }
  highlightRef.current = highlight;

  
  
  
  
  
  
  
  
  const [seekGen, setSeekGen] = useState(0);
  const bumpSeek = useCallback(() => setSeekGen(g => g + 1), []);
  useEffect(() => {
    const req = scanRequestRef.current;
    if (!req) return;
    const {
      idx,
      wantLast,
      tries
    } = req;
    const s = scrollRef.current;
    if (!s) return;
    const {
      getItemElement,
      getItemTop,
      scrollToIndex
    } = jumpState.current;
    const el = getItemElement(idx);
    const h = el?.yogaNode?.getComputedHeight() ?? 0;
    if (!el || h === 0) {
      
      
      
      if (tries > 1) {
        scanRequestRef.current = null;
        logForDebugging(`seek(i=${idx}): no mount after scrollToIndex, skip`);
        stepRef.current(wantLast ? -1 : 1);
        return;
      }
      scanRequestRef.current = {
        idx,
        wantLast,
        tries: tries + 1
      };
      scrollToIndex(idx);
      bumpSeek();
      return;
    }
    scanRequestRef.current = null;
    
    
    
    s.scrollTo(Math.max(0, getItemTop(idx) - HEADROOM));
    const positions = scanElement?.(el) ?? [];
    elementPositions.current = {
      msgIdx: idx,
      positions
    };
    logForDebugging(`seek(i=${idx} t=${tries}): ${positions.length} positions`);
    if (positions.length === 0) {
      
      if (++phantomBurstRef.current > 20) {
        phantomBurstRef.current = 0;
        return;
      }
      stepRef.current(wantLast ? -1 : 1);
      return;
    }
    phantomBurstRef.current = 0;
    const ord = wantLast ? positions.length - 1 : 0;
    searchState.current.screenOrd = ord;
    startPtrRef.current = -1;
    highlightRef.current(ord);
    const pending = pendingStepRef.current;
    if (pending) {
      pendingStepRef.current = 0;
      stepRef.current(pending);
    }
    
  }, [seekGen]);

  
  
  function jump(i: number, wantLast: boolean): void {
    const s = scrollRef.current;
    if (!s) return;
    const js = jumpState.current;
    const {
      getItemElement,
      scrollToIndex
    } = js;
    
    
    if (i < 0 || i >= js.messages.length) return;
    
    
    setPositions?.(null);
    elementPositions.current = {
      msgIdx: -1,
      positions: []
    };
    scanRequestRef.current = {
      idx: i,
      wantLast,
      tries: 0
    };
    const el = getItemElement(i);
    const h = el?.yogaNode?.getComputedHeight() ?? 0;
    
    
    
    
    if (el && h > 0) {
      s.scrollTo(targetFor(i));
    } else {
      scrollToIndex(i);
    }
    bumpSeek();
  }

  
  
  
  
  function step(delta: 1 | -1): void {
    const st = searchState.current;
    const {
      matches,
      prefixSum
    } = st;
    const total = prefixSum.at(-1) ?? 0;
    if (matches.length === 0) return;

    
    
    if (scanRequestRef.current) {
      pendingStepRef.current = delta;
      return;
    }
    if (startPtrRef.current < 0) startPtrRef.current = st.ptr;
    const {
      positions
    } = elementPositions.current;
    const newOrd = st.screenOrd + delta;
    if (newOrd >= 0 && newOrd < positions.length) {
      st.screenOrd = newOrd;
      highlight(newOrd); 
      startPtrRef.current = -1;
      return;
    }

    
    const ptr = (st.ptr + delta + matches.length) % matches.length;
    if (ptr === startPtrRef.current) {
      setPositions?.(null);
      startPtrRef.current = -1;
      logForDebugging(`step: wraparound at ptr=${ptr}, all ${matches.length} msgs phantoms`);
      return;
    }
    st.ptr = ptr;
    st.screenOrd = 0; 
    jump(matches[ptr]!, delta < 0);
    
    
    
    
    const placeholder = delta < 0 ? prefixSum[ptr + 1] ?? total : prefixSum[ptr]! + 1;
    onSearchMatchesChange?.(total, placeholder);
  }
  stepRef.current = step;
  useImperativeHandle(jumpRef, () => ({
    
    jumpToIndex: (i: number) => {
      const s = scrollRef.current;
      if (s) s.scrollTo(targetFor(i));
    },
    setSearchQuery: (q: string) => {
      
      scanRequestRef.current = null;
      elementPositions.current = {
        msgIdx: -1,
        positions: []
      };
      startPtrRef.current = -1;
      setPositions?.(null);
      const lq = q.toLowerCase();
      
      
      const matches: number[] = [];
      
      
      
      
      const prefixSum: number[] = [0];
      if (lq) {
        const msgs = jumpState.current.messages;
        for (let i = 0; i < msgs.length; i++) {
          const text = extractSearchText(msgs[i]!);
          let pos = text.indexOf(lq);
          let cnt = 0;
          while (pos >= 0) {
            cnt++;
            pos = text.indexOf(lq, pos + lq.length);
          }
          if (cnt > 0) {
            matches.push(i);
            prefixSum.push(prefixSum.at(-1)! + cnt);
          }
        }
      }
      const total = prefixSum.at(-1)!;
      
      let ptr = 0;
      const s = scrollRef.current;
      const {
        offsets,
        start,
        getItemTop
      } = jumpState.current;
      const firstTop = getItemTop(start);
      const origin = firstTop >= 0 ? firstTop - offsets[start]! : 0;
      if (matches.length > 0 && s) {
        const curTop = searchAnchor.current >= 0 ? searchAnchor.current : s.getScrollTop();
        let best = Infinity;
        for (let k = 0; k < matches.length; k++) {
          const d = Math.abs(origin + offsets[matches[k]!]! - curTop);
          if (d <= best) {
            best = d;
            ptr = k;
          }
        }
        logForDebugging(`setSearchQuery('${q}'): ${matches.length} msgs · ptr=${ptr} ` + `msgIdx=${matches[ptr]} curTop=${curTop} origin=${origin}`);
      }
      searchState.current = {
        matches,
        ptr,
        screenOrd: 0,
        prefixSum
      };
      if (matches.length > 0) {
        
        
        
        
        jump(matches[ptr]!, true);
      } else if (searchAnchor.current >= 0 && s) {
        
        s.scrollTo(searchAnchor.current);
      }
      
      
      
      
      onSearchMatchesChange?.(total, matches.length > 0 ? prefixSum[ptr + 1] ?? total : 0);
    },
    nextMatch: () => step(1),
    prevMatch: () => step(-1),
    setAnchor: () => {
      const s = scrollRef.current;
      if (s) searchAnchor.current = s.getScrollTop();
    },
    disarmSearch: () => {
      
      setPositions?.(null);
      scanRequestRef.current = null;
      elementPositions.current = {
        msgIdx: -1,
        positions: []
      };
      startPtrRef.current = -1;
    },
    warmSearchIndex: async () => {
      if (indexWarmed.current) return 0;
      const msgs = jumpState.current.messages;
      const CHUNK = 500;
      let workMs = 0;
      const wallStart = performance.now();
      for (let i = 0; i < msgs.length; i += CHUNK) {
        await sleep(0);
        const t0 = performance.now();
        const end = Math.min(i + CHUNK, msgs.length);
        for (let j = i; j < end; j++) {
          extractSearchText(msgs[j]!);
        }
        workMs += performance.now() - t0;
      }
      const wallMs = Math.round(performance.now() - wallStart);
      logForDebugging(`warmSearchIndex: ${msgs.length} msgs · work=${Math.round(workMs)}ms wall=${wallMs}ms chunks=${Math.ceil(msgs.length / CHUNK)}`);
      indexWarmed.current = true;
      return Math.round(workMs);
    }
  }),
  
  
  
  [scrollRef]);

  
  
  
  
  
  
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  
  
  
  
  
  
  
  
  
  const handlersRef = useRef({
    onItemClick,
    setHoveredKey
  });
  handlersRef.current = {
    onItemClick,
    setHoveredKey
  };
  const onClickK = useCallback((msg: RenderableMessage, cellIsBlank: boolean) => {
    const h = handlersRef.current;
    if (!cellIsBlank && h.onItemClick) h.onItemClick(msg);
  }, []);
  const onEnterK = useCallback((k: string) => {
    handlersRef.current.setHoveredKey(k);
  }, []);
  const onLeaveK = useCallback((k: string) => {
    handlersRef.current.setHoveredKey(prev => prev === k ? null : prev);
  }, []);
  return <>
      <Box ref={spacerRef} height={topSpacer} flexShrink={0} />
      {messages.slice(start, end).map((msg, i) => {
      const idx = start + i;
      const k = keys[idx]!;
      const clickable = !!onItemClick && (isItemClickable?.(msg) ?? true);
      const hovered = clickable && hoveredKey === k;
      const expanded = isItemExpanded?.(msg);
      return <VirtualItem key={k} itemKey={k} msg={msg} idx={idx} measureRef={measureRef} expanded={expanded} hovered={hovered} clickable={clickable} onClickK={onClickK} onEnterK={onEnterK} onLeaveK={onLeaveK} renderItem={renderItem} />;
    })}
      {bottomSpacer > 0 && <Box height={bottomSpacer} flexShrink={0} />}
      {trackStickyPrompt && <StickyTracker messages={messages} start={start} end={end} offsets={offsets} getItemTop={getItemTop} getItemElement={getItemElement} scrollRef={scrollRef} />}
    </>;
}
const NOOP_UNSUB = () => {};

function StickyTracker({
  messages,
  start,
  end,
  offsets,
  getItemTop,
  getItemElement,
  scrollRef
}: {
  messages: RenderableMessage[];
  start: number;
  end: number;
  offsets: ArrayLike<number>;
  getItemTop: (index: number) => number;
  getItemElement: (index: number) => DOMElement | null;
  scrollRef: RefObject<ScrollBoxHandle | null>;
}): null {
  const {
    setStickyPrompt
  } = useContext(ScrollChromeContext);
  
  
  
  
  const subscribe = useCallback((listener: () => void) => scrollRef.current?.subscribe(listener) ?? NOOP_UNSUB, [scrollRef]);
  useSyncExternalStore(subscribe, () => {
    const s = scrollRef.current;
    if (!s) return NaN;
    const t = s.getScrollTop() + s.getPendingDelta();
    return s.isSticky() ? -1 - t : t;
  });

  
  const isSticky = scrollRef.current?.isSticky() ?? true;
  const target = Math.max(0, (scrollRef.current?.getScrollTop() ?? 0) + (scrollRef.current?.getPendingDelta() ?? 0));

  
  
  
  
  
  
  let firstVisible = start;
  let firstVisibleTop = -1;
  for (let i = end - 1; i >= start; i--) {
    const top = getItemTop(i);
    if (top >= 0) {
      if (top < target) break;
      firstVisibleTop = top;
    }
    firstVisible = i;
  }
  let idx = -1;
  let text: string | null = null;
  if (firstVisible > 0 && !isSticky) {
    for (let i = firstVisible - 1; i >= 0; i--) {
      const t = stickyPromptText(messages[i]!);
      if (t === null) continue;
      
      
      
      
      
      
      const top = getItemTop(i);
      if (top >= 0 && top + 1 >= target) continue;
      idx = i;
      text = t;
      break;
    }
  }
  const baseOffset = firstVisibleTop >= 0 ? firstVisibleTop - offsets[firstVisible]! : 0;
  const estimate = idx >= 0 ? Math.max(0, baseOffset + offsets[idx]!) : -1;

  
  
  
  
  
  
  
  const pending = useRef({
    idx: -1,
    tries: 0
  });
  
  
  
  
  
  
  
  type Suppress = 'none' | 'armed' | 'force';
  const suppress = useRef<Suppress>('none');
  
  
  
  
  
  const lastIdx = useRef(-1);

  
  
  
  
  
  
  useEffect(() => {
    
    if (pending.current.idx >= 0) return;
    if (suppress.current === 'armed') {
      suppress.current = 'force';
      return;
    }
    const force = suppress.current === 'force';
    suppress.current = 'none';
    if (!force && lastIdx.current === idx) return;
    lastIdx.current = idx;
    if (text === null) {
      setStickyPrompt(null);
      return;
    }
    
    
    
    
    const trimmed = text.trimStart();
    const paraEnd = trimmed.search(/\n\s*\n/);
    const collapsed = (paraEnd >= 0 ? trimmed.slice(0, paraEnd) : trimmed).slice(0, STICKY_TEXT_CAP).replace(/\s+/g, ' ').trim();
    if (collapsed === '') {
      setStickyPrompt(null);
      return;
    }
    const capturedIdx = idx;
    const capturedEstimate = estimate;
    setStickyPrompt({
      text: collapsed,
      scrollTo: () => {
        
        
        setStickyPrompt('clicked');
        suppress.current = 'armed';
        
        
        
        
        
        const el = getItemElement(capturedIdx);
        if (el) {
          scrollRef.current?.scrollToElement(el, 1);
        } else {
          
          
          
          scrollRef.current?.scrollTo(capturedEstimate);
          pending.current = {
            idx: capturedIdx,
            tries: 0
          };
        }
      }
    });
    
    
    
    
  });

  
  
  
  
  useEffect(() => {
    if (pending.current.idx < 0) return;
    const el = getItemElement(pending.current.idx);
    if (el) {
      scrollRef.current?.scrollToElement(el, 1);
      pending.current = {
        idx: -1,
        tries: 0
      };
    } else if (++pending.current.tries > 5) {
      pending.current = {
        idx: -1,
        tries: 0
      };
    }
  });
  return null;
}
