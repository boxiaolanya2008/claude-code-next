import { useCallback, useState } from 'react'
import { isDeepStrictEqual } from 'util'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import type { InputEvent } from '../../ink/events/input-event.js'

import { useInput } from '../../ink.js'
import {
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
} from '../../utils/stringUtils.js'
import type { OptionWithDescription } from './select.js'
import { useSelectNavigation } from './use-select-navigation.js'

export type UseMultiSelectStateProps<T> = {
  

  isDisabled?: boolean

  

  visibleOptionCount?: number

  

  options: OptionWithDescription<T>[]

  

  defaultValue?: T[]

  

  onChange?: (values: T[]) => void

  

  onCancel: () => void

  

  onFocus?: (value: T) => void

  

  focusValue?: T

  

  submitButtonText?: string

  

  onSubmit?: (values: T[]) => void

  

  onDownFromLastItem?: () => void

  

  onUpFromFirstItem?: () => void

  

  initialFocusLast?: boolean

  

  hideIndexes?: boolean
}

export type MultiSelectState<T> = {
  

  focusedValue: T | undefined

  

  visibleFromIndex: number

  

  visibleToIndex: number

  

  options: OptionWithDescription<T>[]

  

  visibleOptions: Array<OptionWithDescription<T> & { index: number }>

  

  isInInput: boolean

  

  selectedValues: T[]

  

  inputValues: Map<T, string>

  

  isSubmitFocused: boolean

  

  updateInputValue: (value: T, inputValue: string) => void

  

  onCancel: () => void
}

export function useMultiSelectState<T>({
  isDisabled = false,
  visibleOptionCount = 5,
  options,
  defaultValue = [],
  onChange,
  onCancel,
  onFocus,
  focusValue,
  submitButtonText,
  onSubmit,
  onDownFromLastItem,
  onUpFromFirstItem,
  initialFocusLast,
  hideIndexes = false,
}: UseMultiSelectStateProps<T>): MultiSelectState<T> {
  const [selectedValues, setSelectedValues] = useState<T[]>(defaultValue)
  const [isSubmitFocused, setIsSubmitFocused] = useState(false)

  
  
  
  
  const [lastOptions, setLastOptions] = useState(options)
  if (options !== lastOptions && !isDeepStrictEqual(options, lastOptions)) {
    setSelectedValues(defaultValue)
    setLastOptions(options)
  }

  
  const [inputValues, setInputValues] = useState<Map<T, string>>(() => {
    const initialMap = new Map<T, string>()
    options.forEach(option => {
      if (option.type === 'input' && option.initialValue) {
        initialMap.set(option.value, option.initialValue)
      }
    })
    return initialMap
  })

  const updateSelectedValues = useCallback(
    (values: T[] | ((prev: T[]) => T[])) => {
      const newValues =
        typeof values === 'function' ? values(selectedValues) : values
      setSelectedValues(newValues)
      onChange?.(newValues)
    },
    [selectedValues, onChange],
  )

  const navigation = useSelectNavigation<T>({
    visibleOptionCount,
    options,
    initialFocusValue: initialFocusLast
      ? options[options.length - 1]?.value
      : undefined,
    onFocus,
    focusValue,
  })

  
  
  useRegisterOverlay('multi-select')

  const updateInputValue = useCallback(
    (value: T, inputValue: string) => {
      setInputValues(prev => {
        const next = new Map(prev)
        next.set(value, inputValue)
        return next
      })

      
      const option = options.find(opt => opt.value === value)
      if (option && option.type === 'input') {
        option.onChange(inputValue)
      }

      
      updateSelectedValues(prev => {
        if (inputValue) {
          if (!prev.includes(value)) {
            return [...prev, value]
          }
          return prev
        } else {
          return prev.filter(v => v !== value)
        }
      })
    },
    [options, updateSelectedValues],
  )

  
  useInput(
    (input, key, event: InputEvent) => {
      const normalizedInput = normalizeFullWidthDigits(input)
      const focusedOption = options.find(
        opt => opt.value === navigation.focusedValue,
      )
      const isInInput = focusedOption?.type === 'input'

      
      if (isInInput) {
        const isAllowedKey =
          key.upArrow ||
          key.downArrow ||
          key.escape ||
          key.tab ||
          key.return ||
          (key.ctrl && (input === 'n' || input === 'p' || key.return))
        if (!isAllowedKey) return
      }

      const lastOptionValue = options[options.length - 1]?.value

      
      if (key.tab && !key.shift) {
        if (
          submitButtonText &&
          onSubmit &&
          navigation.focusedValue === lastOptionValue &&
          !isSubmitFocused
        ) {
          setIsSubmitFocused(true)
        } else if (!isSubmitFocused) {
          navigation.focusNextOption()
        }
        return
      }

      
      if (key.tab && key.shift) {
        if (submitButtonText && onSubmit && isSubmitFocused) {
          setIsSubmitFocused(false)
          navigation.focusOption(lastOptionValue)
        } else {
          navigation.focusPreviousOption()
        }
        return
      }

      
      if (
        key.downArrow ||
        (key.ctrl && input === 'n') ||
        (!key.ctrl && !key.shift && input === 'j')
      ) {
        if (isSubmitFocused && onDownFromLastItem) {
          onDownFromLastItem()
        } else if (
          submitButtonText &&
          onSubmit &&
          navigation.focusedValue === lastOptionValue &&
          !isSubmitFocused
        ) {
          setIsSubmitFocused(true)
        } else if (
          !submitButtonText &&
          onDownFromLastItem &&
          navigation.focusedValue === lastOptionValue
        ) {
          
          onDownFromLastItem()
        } else if (!isSubmitFocused) {
          navigation.focusNextOption()
        }
        return
      }

      
      if (
        key.upArrow ||
        (key.ctrl && input === 'p') ||
        (!key.ctrl && !key.shift && input === 'k')
      ) {
        if (submitButtonText && onSubmit && isSubmitFocused) {
          setIsSubmitFocused(false)
          navigation.focusOption(lastOptionValue)
        } else if (
          onUpFromFirstItem &&
          navigation.focusedValue === options[0]?.value
        ) {
          onUpFromFirstItem()
        } else {
          navigation.focusPreviousOption()
        }
        return
      }

      
      if (key.pageDown) {
        navigation.focusNextPage()
        return
      }

      if (key.pageUp) {
        navigation.focusPreviousPage()
        return
      }

      
      if (key.return || normalizeFullWidthSpace(input) === ' ') {
        
        if (key.ctrl && key.return && isInInput && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        
        if (isSubmitFocused && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        
        if (key.return && !submitButtonText && onSubmit) {
          onSubmit(selectedValues)
          return
        }

        
        if (navigation.focusedValue !== undefined) {
          const newValues = selectedValues.includes(navigation.focusedValue)
            ? selectedValues.filter(v => v !== navigation.focusedValue)
            : [...selectedValues, navigation.focusedValue]
          updateSelectedValues(newValues)
        }
        return
      }

      
      if (!hideIndexes && /^[0-9]+$/.test(normalizedInput)) {
        const index = parseInt(normalizedInput) - 1
        if (index >= 0 && index < options.length) {
          const value = options[index]!.value
          const newValues = selectedValues.includes(value)
            ? selectedValues.filter(v => v !== value)
            : [...selectedValues, value]
          updateSelectedValues(newValues)
        }
        return
      }

      
      if (key.escape) {
        onCancel()
        event.stopImmediatePropagation()
      }
    },
    { isActive: !isDisabled },
  )

  return {
    ...navigation,
    selectedValues,
    inputValues,
    isSubmitFocused,
    updateInputValue,
    onCancel,
  }
}
