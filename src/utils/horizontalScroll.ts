export type HorizontalScrollWindow = {
  startIndex: number
  endIndex: number
  showLeftArrow: boolean
  showRightArrow: boolean
}

export function calculateHorizontalScrollWindow(
  itemWidths: number[],
  availableWidth: number,
  arrowWidth: number,
  selectedIdx: number,
  firstItemHasSeparator = true,
): HorizontalScrollWindow {
  const totalItems = itemWidths.length

  if (totalItems === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      showLeftArrow: false,
      showRightArrow: false,
    }
  }

  
  const clampedSelected = Math.max(0, Math.min(selectedIdx, totalItems - 1))

  
  const totalWidth = itemWidths.reduce((sum, w) => sum + w, 0)
  if (totalWidth <= availableWidth) {
    return {
      startIndex: 0,
      endIndex: totalItems,
      showLeftArrow: false,
      showRightArrow: false,
    }
  }

  
  const cumulativeWidths: number[] = [0]
  for (let i = 0; i < totalItems; i++) {
    cumulativeWidths.push(cumulativeWidths[i]! + itemWidths[i]!)
  }

  
  function rangeWidth(start: number, end: number): number {
    const baseWidth = cumulativeWidths[end]! - cumulativeWidths[start]!
    
    
    if (firstItemHasSeparator && start > 0) {
      return baseWidth - 1
    }
    return baseWidth
  }

  
  function getEffectiveWidth(start: number, end: number): number {
    let width = availableWidth
    if (start > 0) width -= arrowWidth 
    if (end < totalItems) width -= arrowWidth 
    return width
  }

  
  
  let startIndex = 0
  let endIndex = 1

  
  while (
    endIndex < totalItems &&
    rangeWidth(startIndex, endIndex + 1) <=
      getEffectiveWidth(startIndex, endIndex + 1)
  ) {
    endIndex++
  }

  
  if (clampedSelected >= startIndex && clampedSelected < endIndex) {
    return {
      startIndex,
      endIndex,
      showLeftArrow: startIndex > 0,
      showRightArrow: endIndex < totalItems,
    }
  }

  
  if (clampedSelected >= endIndex) {
    
    endIndex = clampedSelected + 1
    startIndex = clampedSelected

    
    while (
      startIndex > 0 &&
      rangeWidth(startIndex - 1, endIndex) <=
        getEffectiveWidth(startIndex - 1, endIndex)
    ) {
      startIndex--
    }
  } else {
    
    startIndex = clampedSelected
    endIndex = clampedSelected + 1

    
    while (
      endIndex < totalItems &&
      rangeWidth(startIndex, endIndex + 1) <=
        getEffectiveWidth(startIndex, endIndex + 1)
    ) {
      endIndex++
    }
  }

  return {
    startIndex,
    endIndex,
    showLeftArrow: startIndex > 0,
    showRightArrow: endIndex < totalItems,
  }
}
