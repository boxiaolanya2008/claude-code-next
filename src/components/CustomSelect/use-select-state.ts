import { useCallback, useState } from 'react'
import type { OptionWithDescription } from './select.js'
import { useSelectNavigation } from './use-select-navigation.js'

export type UseSelectStateProps<T> = {
  /**
   * Number of items to display.
   *
   * @default 5
   */
  visibleOptionCount?: number

  

  options: OptionWithDescription<T>[]

  

  defaultValue?: T

  

  onChange?: (value: T) => void

  /**
   * Callback for canceling the select.
   */
  onCancel?: () => void

  /**
   * Callback for focusing an option.
   */
  onFocus?: (value: T) => void

  /**
   * Value to focus
   */
  focusValue?: T
}

export type SelectState<T> = {
  /**
   * Value of the currently focused option.
   */
  focusedValue: T | undefined

  

  focusedIndex: number

  

  visibleFromIndex: number

  

  visibleToIndex: number

  

  value: T | undefined

  

  options: OptionWithDescription<T>[]

  

  visibleOptions: Array<OptionWithDescription<T> & { index: number }>

  

  isInInput: boolean

  

  focusNextOption: () => void

  /**
   * Focus previous option and scroll the list up, if needed.
   */
  focusPreviousOption: () => void

  /**
   * Focus next page and scroll the list down by a page.
   */
  focusNextPage: () => void

  /**
   * Focus previous page and scroll the list up by a page.
   */
  focusPreviousPage: () => void

  /**
   * Focus a specific option by value.
   */
  focusOption: (value: T | undefined) => void

  /**
   * Select currently focused option.
   */
  selectFocusedOption: () => void

  /**
   * Callback for selecting an option.
   */
  onChange?: (value: T) => void

  /**
   * Callback for canceling the select.
   */
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
