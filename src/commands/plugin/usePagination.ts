import { useCallback, useMemo, useRef } from 'react'

const DEFAULT_MAX_VISIBLE = 5

type UsePaginationOptions = {
  totalItems: number
  maxVisible?: number
  selectedIndex?: number
}

type UsePaginationResult<T> = {
  
  currentPage: number
  totalPages: number
  startIndex: number
  endIndex: number
  needsPagination: boolean
  pageSize: number
  
  getVisibleItems: (items: T[]) => T[]
  
  toActualIndex: (visibleIndex: number) => number
  
  isOnCurrentPage: (actualIndex: number) => boolean
  
  goToPage: (page: number) => void
  nextPage: () => void
  prevPage: () => void
  
  handleSelectionChange: (
    newIndex: number,
    setSelectedIndex: (index: number) => void,
  ) => void
  
  handlePageNavigation: (
    direction: 'left' | 'right',
    setSelectedIndex: (index: number) => void,
  ) => boolean
  
  scrollPosition: {
    current: number
    total: number
    canScrollUp: boolean
    canScrollDown: boolean
  }
}

export function usePagination<T>({
  totalItems,
  maxVisible = DEFAULT_MAX_VISIBLE,
  selectedIndex = 0,
}: UsePaginationOptions): UsePaginationResult<T> {
  const needsPagination = totalItems > maxVisible

  
  const scrollOffsetRef = useRef(0)

  
  
  const scrollOffset = useMemo(() => {
    if (!needsPagination) return 0

    const prevOffset = scrollOffsetRef.current

    
    if (selectedIndex < prevOffset) {
      scrollOffsetRef.current = selectedIndex
      return selectedIndex
    }

    
    if (selectedIndex >= prevOffset + maxVisible) {
      const newOffset = selectedIndex - maxVisible + 1
      scrollOffsetRef.current = newOffset
      return newOffset
    }

    
    
    const maxOffset = Math.max(0, totalItems - maxVisible)
    const clampedOffset = Math.min(prevOffset, maxOffset)
    scrollOffsetRef.current = clampedOffset
    return clampedOffset
  }, [selectedIndex, maxVisible, needsPagination, totalItems])

  const startIndex = scrollOffset
  const endIndex = Math.min(scrollOffset + maxVisible, totalItems)

  const getVisibleItems = useCallback(
    (items: T[]): T[] => {
      if (!needsPagination) return items
      return items.slice(startIndex, endIndex)
    },
    [needsPagination, startIndex, endIndex],
  )

  const toActualIndex = useCallback(
    (visibleIndex: number): number => {
      return startIndex + visibleIndex
    },
    [startIndex],
  )

  const isOnCurrentPage = useCallback(
    (actualIndex: number): boolean => {
      return actualIndex >= startIndex && actualIndex < endIndex
    },
    [startIndex, endIndex],
  )

  
  const goToPage = useCallback((_page: number) => {
    
  }, [])

  const nextPage = useCallback(() => {
    
  }, [])

  const prevPage = useCallback(() => {
    
  }, [])

  
  
  const handleSelectionChange = useCallback(
    (newIndex: number, setSelectedIndex: (index: number) => void) => {
      const clampedIndex = Math.max(0, Math.min(newIndex, totalItems - 1))
      setSelectedIndex(clampedIndex)
    },
    [totalItems],
  )

  
  const handlePageNavigation = useCallback(
    (
      _direction: 'left' | 'right',
      _setSelectedIndex: (index: number) => void,
    ): boolean => {
      return false
    },
    [],
  )

  
  const totalPages = Math.max(1, Math.ceil(totalItems / maxVisible))
  const currentPage = Math.floor(scrollOffset / maxVisible)

  return {
    currentPage,
    totalPages,
    startIndex,
    endIndex,
    needsPagination,
    pageSize: maxVisible,
    getVisibleItems,
    toActualIndex,
    isOnCurrentPage,
    goToPage,
    nextPage,
    prevPage,
    handleSelectionChange,
    handlePageNavigation,
    scrollPosition: {
      current: selectedIndex + 1,
      total: totalItems,
      canScrollUp: scrollOffset > 0,
      canScrollDown: scrollOffset + maxVisible < totalItems,
    },
  }
}
