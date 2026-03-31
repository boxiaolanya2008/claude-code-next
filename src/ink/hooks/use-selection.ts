import { useContext, useMemo, useSyncExternalStore } from 'react'
import StdinContext from '../components/StdinContext.js'
import instances from '../instances.js'
import {
  type FocusMove,
  type SelectionState,
  shiftAnchor,
} from '../selection.js'

export function useSelection(): {
  copySelection: () => string
  
  copySelectionNoClear: () => string
  clearSelection: () => void
  hasSelection: () => boolean
  
  getState: () => SelectionState | null
  
  subscribe: (cb: () => void) => () => void
  /** Shift the anchor row by dRow, clamped to [minRow, maxRow]. */
  shiftAnchor: (dRow: number, minRow: number, maxRow: number) => void
  /** Shift anchor AND focus by dRow (keyboard scroll: whole selection
   *  tracks content). Clamped points get col reset to the full-width edge
   *  since their content was captured by captureScrolledRows. Reads
   *  screen.width from the ink instance for the col-reset boundary. */
  shiftSelection: (dRow: number, minRow: number, maxRow: number) => void
  /** Keyboard selection extension (shift+arrow): move focus, anchor fixed.
   *  Left/right wrap across rows; up/down clamp at viewport edges. */
  moveFocus: (move: FocusMove) => void
  /** Capture text from rows about to scroll out of the viewport (call
   *  BEFORE scrollBy so the screen buffer still has the outgoing rows). */
  captureScrolledRows: (
    firstRow: number,
    lastRow: number,
    side: 'above' | 'below',
  ) => void
  /** Set the selection highlight bg color (theme-piping; solid bg
   *  replaces the old SGR-7 inverse so syntax highlighting stays readable
   *  under selection). Call once on mount + whenever theme changes. */
  setSelectionBgColor: (color: string) => void
} {
  // Look up the Ink instance via stdout — same pattern as instances map.
  
  
  
  useContext(StdinContext) 
  const ink = instances.get(process.stdout)
  
  
  return useMemo(() => {
    if (!ink) {
      return {
        copySelection: () => '',
        copySelectionNoClear: () => '',
        clearSelection: () => {},
        hasSelection: () => false,
        getState: () => null,
        subscribe: () => () => {},
        shiftAnchor: () => {},
        shiftSelection: () => {},
        moveFocus: () => {},
        captureScrolledRows: () => {},
        setSelectionBgColor: () => {},
      }
    }
    return {
      copySelection: () => ink.copySelection(),
      copySelectionNoClear: () => ink.copySelectionNoClear(),
      clearSelection: () => ink.clearTextSelection(),
      hasSelection: () => ink.hasTextSelection(),
      getState: () => ink.selection,
      subscribe: (cb: () => void) => ink.subscribeToSelectionChange(cb),
      shiftAnchor: (dRow: number, minRow: number, maxRow: number) =>
        shiftAnchor(ink.selection, dRow, minRow, maxRow),
      shiftSelection: (dRow, minRow, maxRow) =>
        ink.shiftSelectionForScroll(dRow, minRow, maxRow),
      moveFocus: (move: FocusMove) => ink.moveSelectionFocus(move),
      captureScrolledRows: (firstRow, lastRow, side) =>
        ink.captureScrolledRows(firstRow, lastRow, side),
      setSelectionBgColor: (color: string) => ink.setSelectionBgColor(color),
    }
  }, [ink])
}

const NO_SUBSCRIBE = () => () => {}
const ALWAYS_FALSE = () => false

export function useHasSelection(): boolean {
  useContext(StdinContext)
  const ink = instances.get(process.stdout)
  return useSyncExternalStore(
    ink ? ink.subscribeToSelectionChange : NO_SUBSCRIBE,
    ink ? ink.hasTextSelection : ALWAYS_FALSE,
  )
}
