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
  
  shiftAnchor: (dRow: number, minRow: number, maxRow: number) => void
  

  shiftSelection: (dRow: number, minRow: number, maxRow: number) => void
  

  moveFocus: (move: FocusMove) => void
  

  captureScrolledRows: (
    firstRow: number,
    lastRow: number,
    side: 'above' | 'below',
  ) => void
  

  setSelectionBgColor: (color: string) => void
} {
  
  
  
  
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
