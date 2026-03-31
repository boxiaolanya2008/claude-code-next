import { c as _c } from "react/compiler-runtime";
import { createContext, type RefObject, useContext } from 'react';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';

type ModalCtx = {
  rows: number;
  columns: number;
  scrollRef: RefObject<ScrollBoxHandle | null> | null;
};
export const ModalContext = createContext<ModalCtx | null>(null);
export function useIsInsideModal() {
  return useContext(ModalContext) !== null;
}

export function useModalOrTerminalSize(fallback) {
  const $ = _c(3);
  const ctx = useContext(ModalContext);
  let t0;
  if ($[0] !== ctx || $[1] !== fallback) {
    t0 = ctx ? {
      rows: ctx.rows,
      columns: ctx.columns
    } : fallback;
    $[0] = ctx;
    $[1] = fallback;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  return t0;
}
export function useModalScrollRef() {
  return useContext(ModalContext)?.scrollRef ?? null;
}
