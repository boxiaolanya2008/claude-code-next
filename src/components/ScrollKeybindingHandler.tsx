import React, { type RefObject, useEffect, useRef } from 'react';
import { useNotifications } from '../context/notifications.js';
import { useCopyOnSelect, useSelectionBgColor } from '../hooks/useCopyOnSelect.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import { useSelection } from '../ink/hooks/use-selection.js';
import type { FocusMove, SelectionState } from '../ink/selection.js';
import { isXtermJs } from '../ink/terminal.js';
import { getClipboardPath } from '../ink/termio/osc.js';

import { type Key, useInput } from '../ink.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { logForDebugging } from '../utils/debug.js';
type Props = {
  scrollRef: RefObject<ScrollBoxHandle | null>;
  isActive: boolean;
  

  onScroll?: (sticky: boolean, handle: ScrollBoxHandle) => void;
  

  isModal?: boolean;
};

const WHEEL_ACCEL_WINDOW_MS = 40;
const WHEEL_ACCEL_STEP = 0.3;
const WHEEL_ACCEL_MAX = 6;

const WHEEL_BOUNCE_GAP_MAX_MS = 200; 

const WHEEL_MODE_STEP = 15;
const WHEEL_MODE_CAP = 15;

const WHEEL_MODE_RAMP = 3;

const WHEEL_MODE_IDLE_DISENGAGE_MS = 1500;

const WHEEL_DECAY_HALFLIFE_MS = 150;
const WHEEL_DECAY_STEP = 5;

const WHEEL_BURST_MS = 5;

const WHEEL_DECAY_GAP_MS = 80;
const WHEEL_DECAY_CAP_SLOW = 3; 
const WHEEL_DECAY_CAP_FAST = 6; 

const WHEEL_DECAY_IDLE_MS = 500;

export function shouldClearSelectionOnKey(key: Key): boolean {
  if (key.wheelUp || key.wheelDown) return false;
  const isNav = key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.home || key.end || key.pageUp || key.pageDown;
  if (isNav && (key.shift || key.meta || key.super)) return false;
  return true;
}

export function selectionFocusMoveForKey(key: Key): FocusMove | null {
  if (!key.shift || key.meta) return null;
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.home) return 'lineStart';
  if (key.end) return 'lineEnd';
  return null;
}
export type WheelAccelState = {
  time: number;
  mult: number;
  dir: 0 | 1 | -1;
  xtermJs: boolean;
  

  frac: number;
  

  base: number;
  

  pendingFlip: boolean;
  

  wheelMode: boolean;
  

  burstCount: number;
};

export function computeWheelStep(state: WheelAccelState, dir: 1 | -1, now: number): number {
  if (!state.xtermJs) {
    
    
    
    
    if (state.wheelMode && now - state.time > WHEEL_MODE_IDLE_DISENGAGE_MS) {
      state.wheelMode = false;
      state.burstCount = 0;
      state.mult = state.base;
    }

    
    
    
    if (state.pendingFlip) {
      state.pendingFlip = false;
      if (dir !== state.dir || now - state.time > WHEEL_BOUNCE_GAP_MAX_MS) {
        
        
        state.dir = dir;
        state.time = now;
        state.mult = state.base;
        return Math.floor(state.mult);
      }
      
      
      
      
      state.wheelMode = true;
    }
    const gap = now - state.time;
    if (dir !== state.dir && state.dir !== 0) {
      
      
      
      
      
      state.pendingFlip = true;
      state.time = now;
      return 0;
    }
    state.dir = dir;
    state.time = now;

    
    if (state.wheelMode) {
      if (gap < WHEEL_BURST_MS) {
        
        
        
        
        
        
        
        if (++state.burstCount >= 5) {
          state.wheelMode = false;
          state.burstCount = 0;
          state.mult = state.base;
        } else {
          return 1;
        }
      } else {
        state.burstCount = 0;
      }
    }
    
    if (state.wheelMode) {
      
      
      
      
      const m = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS);
      const cap = Math.max(WHEEL_MODE_CAP, state.base * 2);
      const next = 1 + (state.mult - 1) * m + WHEEL_MODE_STEP * m;
      state.mult = Math.min(cap, next, state.mult + WHEEL_MODE_RAMP);
      return Math.floor(state.mult);
    }

    
    
    
    
    if (gap > WHEEL_ACCEL_WINDOW_MS) {
      state.mult = state.base;
    } else {
      const cap = Math.max(WHEEL_ACCEL_MAX, state.base * 2);
      state.mult = Math.min(cap, state.mult + WHEEL_ACCEL_STEP);
    }
    return Math.floor(state.mult);
  }

  
  
  
  
  const gap = now - state.time;
  const sameDir = dir === state.dir;
  state.time = now;
  state.dir = dir;
  
  
  
  
  
  if (sameDir && gap < WHEEL_BURST_MS) return 1;
  if (!sameDir || gap > WHEEL_DECAY_IDLE_MS) {
    
    
    
    state.mult = 2;
    state.frac = 0;
  } else {
    const m = Math.pow(0.5, gap / WHEEL_DECAY_HALFLIFE_MS);
    const cap = gap >= WHEEL_DECAY_GAP_MS ? WHEEL_DECAY_CAP_SLOW : WHEEL_DECAY_CAP_FAST;
    state.mult = Math.min(cap, 1 + (state.mult - 1) * m + WHEEL_DECAY_STEP * m);
  }
  const total = state.mult + state.frac;
  const rows = Math.floor(total);
  state.frac = total - rows;
  return rows;
}

export function readScrollSpeedBase(): number {
  const raw = process.env.CLAUDE_CODE_NEXT_SCROLL_SPEED;
  if (!raw) return 1;
  const n = parseFloat(raw);
  return Number.isNaN(n) || n <= 0 ? 1 : Math.min(n, 20);
}

export function initWheelAccel(xtermJs = false, base = 1): WheelAccelState {
  return {
    time: 0,
    mult: base,
    dir: 0,
    xtermJs,
    frac: 0,
    base,
    pendingFlip: false,
    wheelMode: false,
    burstCount: 0
  };
}

function initAndLogWheelAccel(): WheelAccelState {
  const xtermJs = isXtermJs();
  const base = readScrollSpeedBase();
  logForDebugging(`wheel accel: ${xtermJs ? 'decay (xterm.js)' : 'window (native)'} · base=${base} · TERM_PROGRAM=${process.env.TERM_PROGRAM ?? 'unset'}`);
  return initWheelAccel(xtermJs, base);
}

const AUTOSCROLL_LINES = 2;
const AUTOSCROLL_INTERVAL_MS = 50;

const AUTOSCROLL_MAX_TICKS = 200; 

export function ScrollKeybindingHandler({
  scrollRef,
  isActive,
  onScroll,
  isModal = false
}: Props): React.ReactNode {
  const selection = useSelection();
  const {
    addNotification
  } = useNotifications();
  
  
  
  const wheelAccel = useRef<WheelAccelState | null>(null);
  function showCopiedToast(text: string): void {
    
    
    
    const path = getClipboardPath();
    const n = text.length;
    let msg: string;
    switch (path) {
      case 'native':
        msg = `copied ${n} chars to clipboard`;
        break;
      case 'tmux-buffer':
        msg = `copied ${n} chars to tmux buffer · paste with prefix + ]`;
        break;
      case 'osc52':
        msg = `sent ${n} chars via OSC 52 · check terminal clipboard settings if paste fails`;
        break;
    }
    addNotification({
      key: 'selection-copied',
      text: msg,
      color: 'suggestion',
      priority: 'immediate',
      timeoutMs: path === 'native' ? 2000 : 4000
    });
  }
  function copyAndToast(): void {
    const text_0 = selection.copySelection();
    if (text_0) showCopiedToast(text_0);
  }

  
  
  
  
  
  
  
  
  
  function translateSelectionForJump(s: ScrollBoxHandle, delta: number): void {
    const sel = selection.getState();
    if (!sel?.anchor || !sel.focus) return;
    const top = s.getViewportTop();
    const bottom = top + s.getViewportHeight() - 1;
    
    
    
    
    if (sel.anchor.row < top || sel.anchor.row > bottom) return;
    
    
    
    
    if (sel.focus.row < top || sel.focus.row > bottom) return;
    const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
    const cur = s.getScrollTop() + s.getPendingDelta();
    
    
    
    const actual = Math.max(0, Math.min(max, cur + delta)) - cur;
    if (actual === 0) return;
    if (actual > 0) {
      
      
      selection.captureScrolledRows(top, top + actual - 1, 'above');
      selection.shiftSelection(-actual, top, bottom);
    } else {
      
      const a = -actual;
      selection.captureScrolledRows(bottom - a + 1, bottom, 'below');
      selection.shiftSelection(a, top, bottom);
    }
  }
  useKeybindings({
    'scroll:pageUp': () => {
      const s_0 = scrollRef.current;
      if (!s_0) return;
      const d = -Math.max(1, Math.floor(s_0.getViewportHeight() / 2));
      translateSelectionForJump(s_0, d);
      const sticky = jumpBy(s_0, d);
      onScroll?.(sticky, s_0);
    },
    'scroll:pageDown': () => {
      const s_1 = scrollRef.current;
      if (!s_1) return;
      const d_0 = Math.max(1, Math.floor(s_1.getViewportHeight() / 2));
      translateSelectionForJump(s_1, d_0);
      const sticky_0 = jumpBy(s_1, d_0);
      onScroll?.(sticky_0, s_1);
    },
    'scroll:lineUp': () => {
      
      
      
      selection.clearSelection();
      const s_2 = scrollRef.current;
      
      
      
      
      if (!s_2 || s_2.getScrollHeight() <= s_2.getViewportHeight()) return false;
      wheelAccel.current ??= initAndLogWheelAccel();
      scrollUp(s_2, computeWheelStep(wheelAccel.current, -1, performance.now()));
      onScroll?.(false, s_2);
    },
    'scroll:lineDown': () => {
      selection.clearSelection();
      const s_3 = scrollRef.current;
      if (!s_3 || s_3.getScrollHeight() <= s_3.getViewportHeight()) return false;
      wheelAccel.current ??= initAndLogWheelAccel();
      const step = computeWheelStep(wheelAccel.current, 1, performance.now());
      const reachedBottom = scrollDown(s_3, step);
      onScroll?.(reachedBottom, s_3);
    },
    'scroll:top': () => {
      const s_4 = scrollRef.current;
      if (!s_4) return;
      translateSelectionForJump(s_4, -(s_4.getScrollTop() + s_4.getPendingDelta()));
      s_4.scrollTo(0);
      onScroll?.(false, s_4);
    },
    'scroll:bottom': () => {
      const s_5 = scrollRef.current;
      if (!s_5) return;
      const max_0 = Math.max(0, s_5.getScrollHeight() - s_5.getViewportHeight());
      translateSelectionForJump(s_5, max_0 - (s_5.getScrollTop() + s_5.getPendingDelta()));
      
      
      
      
      
      s_5.scrollTo(max_0);
      s_5.scrollToBottom();
      onScroll?.(true, s_5);
    },
    'selection:copy': copyAndToast
  }, {
    context: 'Scroll',
    isActive
  });

  
  
  
  
  useKeybindings({
    'scroll:halfPageUp': () => {
      const s_6 = scrollRef.current;
      if (!s_6) return;
      const d_1 = -Math.max(1, Math.floor(s_6.getViewportHeight() / 2));
      translateSelectionForJump(s_6, d_1);
      const sticky_1 = jumpBy(s_6, d_1);
      onScroll?.(sticky_1, s_6);
    },
    'scroll:halfPageDown': () => {
      const s_7 = scrollRef.current;
      if (!s_7) return;
      const d_2 = Math.max(1, Math.floor(s_7.getViewportHeight() / 2));
      translateSelectionForJump(s_7, d_2);
      const sticky_2 = jumpBy(s_7, d_2);
      onScroll?.(sticky_2, s_7);
    },
    'scroll:fullPageUp': () => {
      const s_8 = scrollRef.current;
      if (!s_8) return;
      const d_3 = -Math.max(1, s_8.getViewportHeight());
      translateSelectionForJump(s_8, d_3);
      const sticky_3 = jumpBy(s_8, d_3);
      onScroll?.(sticky_3, s_8);
    },
    'scroll:fullPageDown': () => {
      const s_9 = scrollRef.current;
      if (!s_9) return;
      const d_4 = Math.max(1, s_9.getViewportHeight());
      translateSelectionForJump(s_9, d_4);
      const sticky_4 = jumpBy(s_9, d_4);
      onScroll?.(sticky_4, s_9);
    }
  }, {
    context: 'Scroll',
    isActive
  });

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  useInput((input, key, event) => {
    const s_10 = scrollRef.current;
    if (!s_10) return;
    const sticky_5 = applyModalPagerAction(s_10, modalPagerAction(input, key), d_5 => translateSelectionForJump(s_10, d_5));
    if (sticky_5 === null) return;
    onScroll?.(sticky_5, s_10);
    event.stopImmediatePropagation();
  }, {
    isActive: isActive && isModal
  });

  
  
  
  
  
  
  
  
  
  
  
  useInput((input_0, key_0, event_0) => {
    if (!selection.hasSelection()) return;
    if (key_0.escape) {
      selection.clearSelection();
      event_0.stopImmediatePropagation();
      return;
    }
    if (key_0.ctrl && !key_0.shift && !key_0.meta && input_0 === 'c') {
      copyAndToast();
      event_0.stopImmediatePropagation();
      return;
    }
    const move = selectionFocusMoveForKey(key_0);
    if (move) {
      selection.moveFocus(move);
      event_0.stopImmediatePropagation();
      return;
    }
    if (shouldClearSelectionOnKey(key_0)) {
      selection.clearSelection();
    }
  }, {
    isActive
  });
  useDragToScroll(scrollRef, selection, isActive, onScroll);
  useCopyOnSelect(selection, isActive, showCopiedToast);
  useSelectionBgColor(selection);
  return null;
}

function useDragToScroll(scrollRef: RefObject<ScrollBoxHandle | null>, selection: ReturnType<typeof useSelection>, isActive: boolean, onScroll: Props['onScroll']): void {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const dirRef = useRef<-1 | 0 | 1>(0); 
  
  const lastScrolledDirRef = useRef<-1 | 0 | 1>(0);
  const ticksRef = useRef(0);
  
  
  
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;
  useEffect(() => {
    if (!isActive) return;
    function stop(): void {
      dirRef.current = 0;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    function tick(): void {
      const sel = selection.getState();
      const s = scrollRef.current;
      const dir = dirRef.current;
      
      
      
      
      if (!sel?.isDragging || !sel.focus || !s || dir === 0 || ++ticksRef.current > AUTOSCROLL_MAX_TICKS) {
        stop();
        return;
      }
      
      
      
      
      
      
      
      if (s.getPendingDelta() !== 0) return;
      const top = s.getViewportTop();
      const bottom = top + s.getViewportHeight() - 1;
      
      
      
      
      if (dir < 0) {
        if (s.getScrollTop() <= 0) {
          stop();
          return;
        }
        
        
        
        const actual = Math.min(AUTOSCROLL_LINES, s.getScrollTop());
        
        
        
        selection.captureScrolledRows(bottom - actual + 1, bottom, 'below');
        selection.shiftAnchor(actual, 0, bottom);
        s.scrollBy(-AUTOSCROLL_LINES);
      } else {
        const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
        if (s.getScrollTop() >= max) {
          stop();
          return;
        }
        
        
        
        const actual_0 = Math.min(AUTOSCROLL_LINES, max - s.getScrollTop());
        
        selection.captureScrolledRows(top, top + actual_0 - 1, 'above');
        selection.shiftAnchor(-actual_0, top, bottom);
        s.scrollBy(AUTOSCROLL_LINES);
      }
      onScrollRef.current?.(false, s);
    }
    function start(dir_0: -1 | 1): void {
      
      
      
      
      lastScrolledDirRef.current = dir_0;
      if (dirRef.current === dir_0) return; 
      stop();
      dirRef.current = dir_0;
      ticksRef.current = 0;
      tick();
      
      
      
      if (dirRef.current === dir_0) {
        timerRef.current = setInterval(tick, AUTOSCROLL_INTERVAL_MS);
      }
    }

    
    
    
    
    
    
    
    function check(): void {
      const s_0 = scrollRef.current;
      if (!s_0) {
        stop();
        return;
      }
      const top_0 = s_0.getViewportTop();
      const bottom_0 = top_0 + s_0.getViewportHeight() - 1;
      const sel_0 = selection.getState();
      
      
      
      
      
      
      
      
      
      
      
      
      if (!sel_0?.isDragging || sel_0.scrolledOffAbove.length === 0 && sel_0.scrolledOffBelow.length === 0) {
        lastScrolledDirRef.current = 0;
      }
      const dir_1 = dragScrollDirection(sel_0, top_0, bottom_0, lastScrolledDirRef.current);
      if (dir_1 === 0) {
        
        
        
        
        
        if (lastScrolledDirRef.current !== 0 && sel_0?.focus) {
          const want = sel_0.focus.row < top_0 ? -1 : sel_0.focus.row > bottom_0 ? 1 : 0;
          if (want !== 0 && want !== lastScrolledDirRef.current) {
            sel_0.scrolledOffAbove = [];
            sel_0.scrolledOffBelow = [];
            sel_0.scrolledOffAboveSW = [];
            sel_0.scrolledOffBelowSW = [];
            lastScrolledDirRef.current = 0;
          }
        }
        stop();
      } else start(dir_1);
    }
    const unsubscribe = selection.subscribe(check);
    return () => {
      unsubscribe();
      stop();
      lastScrolledDirRef.current = 0;
    };
  }, [isActive, scrollRef, selection]);
}

export function dragScrollDirection(sel: SelectionState | null, top: number, bottom: number, alreadyScrollingDir: -1 | 0 | 1 = 0): -1 | 0 | 1 {
  if (!sel?.isDragging || !sel.anchor || !sel.focus) return 0;
  const row = sel.focus.row;
  const want: -1 | 0 | 1 = row < top ? -1 : row > bottom ? 1 : 0;
  if (alreadyScrollingDir !== 0) {
    
    
    
    return want === alreadyScrollingDir ? want : 0;
  }
  
  
  
  if (sel.anchor.row < top || sel.anchor.row > bottom) return 0;
  return want;
}

export function jumpBy(s: ScrollBoxHandle, delta: number): boolean {
  const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
  const target = s.getScrollTop() + s.getPendingDelta() + delta;
  if (target >= max) {
    
    
    
    s.scrollTo(max);
    s.scrollToBottom();
    return true;
  }
  s.scrollTo(Math.max(0, target));
  return false;
}

function scrollDown(s: ScrollBoxHandle, amount: number): boolean {
  const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
  
  
  
  
  const effectiveTop = s.getScrollTop() + s.getPendingDelta();
  if (effectiveTop + amount >= max) {
    s.scrollToBottom();
    return true;
  }
  s.scrollBy(amount);
  return false;
}

export function scrollUp(s: ScrollBoxHandle, amount: number): void {
  
  
  const effectiveTop = s.getScrollTop() + s.getPendingDelta();
  if (effectiveTop - amount <= 0) {
    s.scrollTo(0);
    return;
  }
  s.scrollBy(-amount);
}
export type ModalPagerAction = 'lineUp' | 'lineDown' | 'halfPageUp' | 'halfPageDown' | 'fullPageUp' | 'fullPageDown' | 'top' | 'bottom';

export function modalPagerAction(input: string, key: Pick<Key, 'ctrl' | 'meta' | 'shift' | 'upArrow' | 'downArrow' | 'home' | 'end'>): ModalPagerAction | null {
  if (key.meta) return null;
  
  
  
  
  if (!key.ctrl && !key.shift) {
    if (key.upArrow) return 'lineUp';
    if (key.downArrow) return 'lineDown';
    if (key.home) return 'top';
    if (key.end) return 'bottom';
  }
  if (key.ctrl) {
    if (key.shift) return null;
    switch (input) {
      case 'u':
        return 'halfPageUp';
      case 'd':
        return 'halfPageDown';
      case 'b':
        return 'fullPageUp';
      case 'f':
        return 'fullPageDown';
      
      
      
      case 'n':
        return 'lineDown';
      case 'p':
        return 'lineUp';
      default:
        return null;
    }
  }
  
  const c = input[0];
  if (!c || input !== c.repeat(input.length)) return null;
  
  
  if (c === 'G' || c === 'g' && key.shift) return 'bottom';
  if (key.shift) return null;
  switch (c) {
    case 'g':
      return 'top';
    
    
    
    case 'j':
      return 'lineDown';
    case 'k':
      return 'lineUp';
    
    
    case ' ':
      return 'fullPageDown';
    case 'b':
      return 'fullPageUp';
    default:
      return null;
  }
}

export function applyModalPagerAction(s: ScrollBoxHandle, act: ModalPagerAction | null, onBeforeJump: (delta: number) => void): boolean | null {
  switch (act) {
    case null:
      return null;
    case 'lineUp':
    case 'lineDown':
      {
        const d = act === 'lineDown' ? 1 : -1;
        onBeforeJump(d);
        return jumpBy(s, d);
      }
    case 'halfPageUp':
    case 'halfPageDown':
      {
        const half = Math.max(1, Math.floor(s.getViewportHeight() / 2));
        const d = act === 'halfPageDown' ? half : -half;
        onBeforeJump(d);
        return jumpBy(s, d);
      }
    case 'fullPageUp':
    case 'fullPageDown':
      {
        const page = Math.max(1, s.getViewportHeight());
        const d = act === 'fullPageDown' ? page : -page;
        onBeforeJump(d);
        return jumpBy(s, d);
      }
    case 'top':
      onBeforeJump(-(s.getScrollTop() + s.getPendingDelta()));
      s.scrollTo(0);
      return false;
    case 'bottom':
      {
        const max = Math.max(0, s.getScrollHeight() - s.getViewportHeight());
        onBeforeJump(max - (s.getScrollTop() + s.getPendingDelta()));
        
        
        s.scrollTo(max);
        s.scrollToBottom();
        return true;
      }
  }
}
