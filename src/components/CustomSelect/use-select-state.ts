import { useCallback, useState } from 'react'
import type { OptionWithDescription } from './select.js'
import { useSelectNavigation } from './use-select-navigation.js'

export type UseSelectStateProps<T> = {
  

  visibleOptionCount?: number

  

  options: OptionWithDescription<T>[]

  

  defaultValue?: T

  

  onChange?: (value: T) => void

  

  onCancel?: () => void

  

  onFocus?: (value: T) => void

  

  focusValue?: T
}

export type SelectState<T> = {
  

  focusedValue: T | undefined

  

  focusedIndex: number

  

  visibleFromIndex: number

  

  visibleToIndex: number

  

  value: T | undefined

  

  options: OptionWithDescription<T>[]

  

  visibleOptions: Array<OptionWithDescription<T> & { index: number }>

  

  isInInput: boolean

  

  focusNextOption: () => void

  

  focusPreviousOption: () => void

  

  focusNextPage: () => void

  

  focusPreviousPage: () => void

  

  focusOption: (value: T | undefined) => void

  

  selectFocusedOption: () => void

  

  onChange?: (value: T) => void

  

  onCancel?: () => void
}

export function useSelectState<T>({
  visibleOptionCount = 5,
  options,
  defaultValue,
  onChange,
  onCancel,
  onFocus,
  focusValue,
}: UseSelectStateProps<T>): SelectState<T> {
  const [value, setValue] = useState<T | undefined>(defaultValue)

  const navigation = useSelectNavigation<T>({
    visibleOptionCount,
    options,
    initialFocusValue: undefined,
    onFocus,
    focusValue,
  })

  const selectFocusedOption = useCallback(() => {
    setValue(navigation.focusedValue)
  }, [navigation.focusedValue])

  return {
    ...navigation,
    value,
    selectFocusedOption,
    onChange,
    onCancel,
  }
}
