import { useContext, useMemo } from 'react'
import StdinContext from '../components/StdinContext.js'
import type { DOMElement } from '../dom.js'
import instances from '../instances.js'
import type { MatchPosition } from '../render-to-screen.js'

export function useSearchHighlight(): {
  setQuery: (query: string) => void
  /** Paint an existing DOM subtree (from the MAIN tree) to a fresh
   *  Screen at its natural height, scan. Element-relative positions
   *  (row 0 = element top). Zero context duplication — the element
   *  IS the one built with all real providers. */
  scanElement: (el: DOMElement) => MatchPosition[]
  

  setPositions: (
    state: {
      positions: MatchPosition[]
      rowOffset: number
      currentIdx: number
    } | null,
  ) => void
} {
  useContext(StdinContext) 
  const ink = instances.get(process.stdout)
  return useMemo(() => {
    if (!ink) {
      return {
        setQuery: () => {},
        scanElement: () => [],
        setPositions: () => {},
      }
    }
    return {
      setQuery: (query: string) => ink.setSearchHighlight(query),
      scanElement: (el: DOMElement) => ink.scanElementSubtree(el),
      setPositions: state => ink.setSearchPositions(state),
    }
  }, [ink])
}
