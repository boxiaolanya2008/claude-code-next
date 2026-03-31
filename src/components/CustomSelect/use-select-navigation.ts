import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { isDeepStrictEqual } from 'util'
import OptionMap from './option-map.js'
import type { OptionWithDescription } from './select.js'

type State<T> = {
  

  optionMap: OptionMap<T>

  

  visibleOptionCount: number

  

  focusedValue: T | undefined

  

  visibleFromIndex: number

  

  visibleToIndex: number
}

type Action<T> =
  | FocusNextOptionAction
  | FocusPreviousOptionAction
  | FocusNextPageAction
  | FocusPreviousPageAction
  | SetFocusAction<T>
  | ResetAction<T>

type SetFocusAction<T> = {
  type: 'set-focus'
  value: T
}

type FocusNextOptionAction = {
  type: 'focus-next-option'
}

type FocusPreviousOptionAction = {
  type: 'focus-previous-option'
}

type FocusNextPageAction = {
  type: 'focus-next-page'
}

type FocusPreviousPageAction = {
  type: 'focus-previous-page'
}

type ResetAction<T> = {
  type: 'reset'
  state: State<T>
}

const reducer = <T>(state: State<T>, action: Action<T>): State<T> => {
  switch (action.type) {
    case 'focus-next-option': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      
      const next = item.next || state.optionMap.first

      if (!next) {
        return state
      }

      
      if (!item.next && next === state.optionMap.first) {
        return {
          ...state,
          focusedValue: next.value,
          visibleFromIndex: 0,
          visibleToIndex: state.visibleOptionCount,
        }
      }

      const needsToScroll = next.index >= state.visibleToIndex

      if (!needsToScroll) {
        return {
          ...state,
          focusedValue: next.value,
        }
      }

      const nextVisibleToIndex = Math.min(
        state.optionMap.size,
        state.visibleToIndex + 1,
      )

      const nextVisibleFromIndex = nextVisibleToIndex - state.visibleOptionCount

      return {
        ...state,
        focusedValue: next.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

    case 'focus-previous-option': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      
      const previous = item.previous || state.optionMap.last

      if (!previous) {
        return state
      }

      
      if (!item.previous && previous === state.optionMap.last) {
        const nextVisibleToIndex = state.optionMap.size
        const nextVisibleFromIndex = Math.max(
          0,
          nextVisibleToIndex - state.visibleOptionCount,
        )
        return {
          ...state,
          focusedValue: previous.value,
          visibleFromIndex: nextVisibleFromIndex,
          visibleToIndex: nextVisibleToIndex,
        }
      }

      const needsToScroll = previous.index <= state.visibleFromIndex

      if (!needsToScroll) {
        return {
          ...state,
          focusedValue: previous.value,
        }
      }

      const nextVisibleFromIndex = Math.max(0, state.visibleFromIndex - 1)

      const nextVisibleToIndex = nextVisibleFromIndex + state.visibleOptionCount

      return {
        ...state,
        focusedValue: previous.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

    case 'focus-next-page': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      
      const targetIndex = Math.min(
        state.optionMap.size - 1,
        item.index + state.visibleOptionCount,
      )

      
      let targetItem = state.optionMap.first
      while (targetItem && targetItem.index < targetIndex) {
        if (targetItem.next) {
          targetItem = targetItem.next
        } else {
          break
        }
      }

      if (!targetItem) {
        return state
      }

      
      const nextVisibleToIndex = Math.min(
        state.optionMap.size,
        targetItem.index + 1,
      )
      const nextVisibleFromIndex = Math.max(
        0,
        nextVisibleToIndex - state.visibleOptionCount,
      )

      return {
        ...state,
        focusedValue: targetItem.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

    case 'focus-previous-page': {
      if (state.focusedValue === undefined) {
        return state
      }

      const item = state.optionMap.get(state.focusedValue)

      if (!item) {
        return state
      }

      
      const targetIndex = Math.max(0, item.index - state.visibleOptionCount)

      
      let targetItem = state.optionMap.first
      while (targetItem && targetItem.index < targetIndex) {
        if (targetItem.next) {
          targetItem = targetItem.next
        } else {
          break
        }
      }

      if (!targetItem) {
        return state
      }

      
      const nextVisibleFromIndex = Math.max(0, targetItem.index)
      const nextVisibleToIndex = Math.min(
        state.optionMap.size,
        nextVisibleFromIndex + state.visibleOptionCount,
      )

      return {
        ...state,
        focusedValue: targetItem.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }

    case 'reset': {
      return action.state
    }

    case 'set-focus': {
      
      if (state.focusedValue === action.value) {
        return state
      }

      const item = state.optionMap.get(action.value)
      if (!item) {
        return state
      }

      
      if (
        item.index >= state.visibleFromIndex &&
        item.index < state.visibleToIndex
      ) {
        
        return {
          ...state,
          focusedValue: action.value,
        }
      }

      
      
      let nextVisibleFromIndex: number
      let nextVisibleToIndex: number

      if (item.index < state.visibleFromIndex) {
        
        nextVisibleFromIndex = item.index
        nextVisibleToIndex = Math.min(
          state.optionMap.size,
          nextVisibleFromIndex + state.visibleOptionCount,
        )
      } else {
        
        nextVisibleToIndex = Math.min(state.optionMap.size, item.index + 1)
        nextVisibleFromIndex = Math.max(
          0,
          nextVisibleToIndex - state.visibleOptionCount,
        )
      }

      return {
        ...state,
        focusedValue: action.value,
        visibleFromIndex: nextVisibleFromIndex,
        visibleToIndex: nextVisibleToIndex,
      }
    }
  }
}

export type UseSelectNavigationProps<T> = {
  

  visibleOptionCount?: number

  

  options: OptionWithDescription<T>[]

  

  initialFocusValue?: T

  

  onFocus?: (value: T) => void

  

  focusValue?: T
}

export type SelectNavigation<T> = {
  

  focusedValue: T | undefined

  

  focusedIndex: number

  

  visibleFromIndex: number

  

  visibleToIndex: number

  

  options: OptionWithDescription<T>[]

  

  visibleOptions: Array<OptionWithDescription<T> & { index: number }>

  

  isInInput: boolean

  

  focusNextOption: () => void

  

  focusPreviousOption: () => void

  

  focusNextPage: () => void

  

  focusPreviousPage: () => void

  

  focusOption: (value: T | undefined) => void
}

const createDefaultState = <T>({
  visibleOptionCount: customVisibleOptionCount,
  options,
  initialFocusValue,
  currentViewport,
}: Pick<UseSelectNavigationProps<T>, 'visibleOptionCount' | 'options'> & {
  initialFocusValue?: T
  currentViewport?: { visibleFromIndex: number; visibleToIndex: number }
}): State<T> => {
  const visibleOptionCount =
    typeof customVisibleOptionCount === 'number'
      ? Math.min(customVisibleOptionCount, options.length)
      : options.length

  const optionMap = new OptionMap<T>(options)
  const focusedItem =
    initialFocusValue !== undefined && optionMap.get(initialFocusValue)
  const focusedValue = focusedItem ? initialFocusValue : optionMap.first?.value

  let visibleFromIndex = 0
  let visibleToIndex = visibleOptionCount

  
  if (focusedItem) {
    const focusedIndex = focusedItem.index

    if (currentViewport) {
      
      if (
        focusedIndex >= currentViewport.visibleFromIndex &&
        focusedIndex < currentViewport.visibleToIndex
      ) {
        
        visibleFromIndex = currentViewport.visibleFromIndex
        visibleToIndex = Math.min(
          optionMap.size,
          currentViewport.visibleToIndex,
        )
      } else {
        
        
        if (focusedIndex < currentViewport.visibleFromIndex) {
          
          visibleFromIndex = focusedIndex
          visibleToIndex = Math.min(
            optionMap.size,
            visibleFromIndex + visibleOptionCount,
          )
        } else {
          
          visibleToIndex = Math.min(optionMap.size, focusedIndex + 1)
          visibleFromIndex = Math.max(0, visibleToIndex - visibleOptionCount)
        }
      }
    } else if (focusedIndex >= visibleOptionCount) {
      
      
      visibleToIndex = Math.min(optionMap.size, focusedIndex + 1)
      visibleFromIndex = Math.max(0, visibleToIndex - visibleOptionCount)
    }

    
    visibleFromIndex = Math.max(
      0,
      Math.min(visibleFromIndex, optionMap.size - 1),
    )
    visibleToIndex = Math.min(
      optionMap.size,
      Math.max(visibleOptionCount, visibleToIndex),
    )
  }

  return {
    optionMap,
    visibleOptionCount,
    focusedValue,
    visibleFromIndex,
    visibleToIndex,
  }
}

export function useSelectNavigation<T>({
  visibleOptionCount = 5,
  options,
  initialFocusValue,
  onFocus,
  focusValue,
}: UseSelectNavigationProps<T>): SelectNavigation<T> {
  const [state, dispatch] = useReducer(
    reducer<T>,
    {
      visibleOptionCount,
      options,
      initialFocusValue: focusValue || initialFocusValue,
    } as Parameters<typeof createDefaultState<T>>[0],
    createDefaultState<T>,
  )

  
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus

  const [lastOptions, setLastOptions] = useState(options)

  if (options !== lastOptions && !isDeepStrictEqual(options, lastOptions)) {
    dispatch({
      type: 'reset',
      state: createDefaultState({
        visibleOptionCount,
        options,
        initialFocusValue:
          focusValue ?? state.focusedValue ?? initialFocusValue,
        currentViewport: {
          visibleFromIndex: state.visibleFromIndex,
          visibleToIndex: state.visibleToIndex,
        },
      }),
    })

    setLastOptions(options)
  }

  const focusNextOption = useCallback(() => {
    dispatch({
      type: 'focus-next-option',
    })
  }, [])

  const focusPreviousOption = useCallback(() => {
    dispatch({
      type: 'focus-previous-option',
    })
  }, [])

  const focusNextPage = useCallback(() => {
    dispatch({
      type: 'focus-next-page',
    })
  }, [])

  const focusPreviousPage = useCallback(() => {
    dispatch({
      type: 'focus-previous-page',
    })
  }, [])

  const focusOption = useCallback((value: T | undefined) => {
    if (value !== undefined) {
      dispatch({
        type: 'set-focus',
        value,
      })
    }
  }, [])

  const visibleOptions = useMemo(() => {
    return options
      .map((option, index) => ({
        ...option,
        index,
      }))
      .slice(state.visibleFromIndex, state.visibleToIndex)
  }, [options, state.visibleFromIndex, state.visibleToIndex])

  
  
  
  
  const validatedFocusedValue = useMemo(() => {
    if (state.focusedValue === undefined) {
      return undefined
    }
    const exists = options.some(opt => opt.value === state.focusedValue)
    if (exists) {
      return state.focusedValue
    }
    
    return options[0]?.value
  }, [state.focusedValue, options])

  const isInInput = useMemo(() => {
    const focusedOption = options.find(
      opt => opt.value === validatedFocusedValue,
    )
    return focusedOption?.type === 'input'
  }, [validatedFocusedValue, options])

  
  
  
  useEffect(() => {
    if (validatedFocusedValue !== undefined) {
      onFocusRef.current?.(validatedFocusedValue)
    }
  }, [validatedFocusedValue])

  
  useEffect(() => {
    if (focusValue !== undefined) {
      dispatch({
        type: 'set-focus',
        value: focusValue,
      })
    }
  }, [focusValue])

  
  const focusedIndex = useMemo(() => {
    if (validatedFocusedValue === undefined) {
      return 0
    }
    const index = options.findIndex(opt => opt.value === validatedFocusedValue)
    return index >= 0 ? index + 1 : 0
  }, [validatedFocusedValue, options])

  return {
    focusedValue: validatedFocusedValue,
    focusedIndex,
    visibleFromIndex: state.visibleFromIndex,
    visibleToIndex: state.visibleToIndex,
    visibleOptions,
    isInInput: isInInput ?? false,
    focusNextOption,
    focusPreviousOption,
    focusNextPage,
    focusPreviousPage,
    focusOption,
    options,
  }
}
