import {
  CellWidth,
  cellAtIndex,
  type Screen,
  type StylePool,
  setCellStyleId,
} from './screen.js'

export function applySearchHighlight(
  screen: Screen,
  query: string,
  stylePool: StylePool,
): boolean {
  if (!query) return false
  const lq = query.toLowerCase()
  const qlen = lq.length
  const w = screen.width
  const noSelect = screen.noSelect
  const height = screen.height

  let applied = false
  for (let row = 0; row < height; row++) {
    const rowOff = row * w
    
    
    
    
    
    
    
    
    
    
    
    
    let text = ''
    const colOf: number[] = []
    const codeUnitToCell: number[] = []
    for (let col = 0; col < w; col++) {
      const idx = rowOff + col
      const cell = cellAtIndex(screen, idx)
      if (
        cell.width === CellWidth.SpacerTail ||
        cell.width === CellWidth.SpacerHead ||
        noSelect[idx] === 1
      ) {
        continue
      }
      const lc = cell.char.toLowerCase()
      const cellIdx = colOf.length
      for (let i = 0; i < lc.length; i++) {
        codeUnitToCell.push(cellIdx)
      }
      text += lc
      colOf.push(col)
    }

    let pos = text.indexOf(lq)
    while (pos >= 0) {
      applied = true
      const startCi = codeUnitToCell[pos]!
      const endCi = codeUnitToCell[pos + qlen - 1]!
      for (let ci = startCi; ci <= endCi; ci++) {
        const col = colOf[ci]!
        const cell = cellAtIndex(screen, rowOff + col)
        setCellStyleId(screen, col, row, stylePool.withInverse(cell.styleId))
      }
      
      
      pos = text.indexOf(lq, pos + qlen)
    }
  }

  return applied
}
