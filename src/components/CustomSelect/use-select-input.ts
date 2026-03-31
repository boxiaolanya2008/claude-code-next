import { useMemo } from 'react'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import type { InputEvent } from '../../ink/events/input-event.js'
import { useInput } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import {
  normalizeFullWidthDigits,
  normalizeFullWidthSpace,
} from '../../utils/stringUtils.js'
import type { OptionWithDescription } from './select.js'
import type { SelectState } from './use-select-state.js'

export type UseSelectProps<T> = {
  /**
   * When disabled, user input is ignored.
   *
   * @default false
   */
  isDisabled?: boolean

  

  readonly disableSelection?: boolean | 'numeric'

  

  state: SelectState<T>

  

  options: OptionWithDescription<T>[]

  

  isMultiSelect?: boolean

  

  onUpFromFirstItem?: () => void

  /**
   * Callback when user presses down from the last item.
   * If provided, navigation will not wrap to the first item.
   */
  onDownFromLastItem?: () => void

  /**
   * Callback when input mode should be toggled for an option.
   * Called when Tab is pressed (to enter or exit input mode).
   */
  onInputModeToggle?: (value: T) => void

  /**
   * Current input values for input-type options.
   * Used to determine if number key should submit an empty input option.
   */
  inputValues?: Map<T, string>

  

  imagesSelected?: boolean

  

  onEnterImageSelection?: () => boolean
}

export const useSelectInput = <T>({
  isDisabled = false,
  disableSelection = false,
  state,
  options,
  isMultiSelect = false,
  onUpFromFirstItem,
  onDownFromLastItem,
  onInputModeToggle,
  inputValues,
  imagesSelected = false,
  onEnterImageSelection,
}: UseSelectProps<T>) => {
  // Automatically register as an overlay when onCancel is provided.
  
  useRegisterOverlay('select', !!state.onCancel)

  
  const isInInput = useMemo(() => {
    const focusedOption = options.find(opt => opt.value === state.focusedValue)
    return focusedOption?.type === 'input'
  }, [options, state.focusedValue])

  
  
  
  const keybindingHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {}

    if (!isInInput) {
      handlers['select:next'] = () => {
        if (onDownFromLastItem) {
          const lastOption = options[options.length - 1]
          if (lastOption && state.focusedValue === lastOption.value) {
            onDownFromLastItem()
            return
          }
        }
        state.focusNextOption()
      }
      handlers['select:previous'] = () => {
        if (onUpFromFirstItem && state.visibleFromIndex === 0) {
          const firstOption = options[0]
          if (firstOption && state.focusedValue === firstOption.value) {
            onUpFromFirstItem()
            return
          }
        }
        state.focusPreviousOption()
      }
      handlers['select:accept'] = () => {
        if (disableSelection === true) return
        if (state.focusedValue === undefined) return

        const focusedOption = options.find(
          opt => opt.value === state.focusedValue,
        )
        if (focusedOption?.disabled === true) return

        state.selectFocusedOption?.()
        state.onChange?.(state.focusedValue)
      }
    }

    if (state.onCancel) {
      handlers['select:cancel'] = () => {
        state.onCancel!()
      }
    }

    return handlers
  }, [
    options,
    state,
    onDownFromLastItem,
    onUpFromFirstItem,
    isInInput,
    disableSelection,
  ])

  useKeybindings(keybindingHandlers, {
    context: 'Select',
    isActive: !isDisabled,
  })

  
  // and arrow key navigation when in input mode
  useInput(
    (input, key, event: InputEvent) => {
      const normalizedInput = normalizeFullWidthDigits(input)
      const focusedOption = options.find(
        opt => opt.value === state.focusedValue,
      )
      const currentIsInInput = focusedOption?.type === 'input'

      
      if (key.tab && onInputModeToggle && state.focusedValue !== undefined) {
        onInputModeToggle(state.focusedValue)
        return
      }

      if (currentIsInInput) {
        // When in image selection mode, suppress all input handling so
        
        if (imagesSelected) return

        // DOWN arrow enters image selection mode if images exist
        if (key.downArrow && onEnterImageSelection?.()) {
          event.stopImmediatePropagation()
          return
        }

        // Arrow keys still navigate the select even while in input mode
        if (key.downArrow || (key.ctrl && input === 'n')) {
          if (onDownFromLastItem) {
            const lastOption = options[options.length - 1]
            if (lastOption && state.focusedValue === lastOption.value) {
              onDownFromLastItem()
              event.stopImmediatePropagation()
              return
            }
          }
          state.focusNextOption()
          event.stopImmediatePropagation()
          return
        }
        if (key.upArrow || (key.ctrl && input === 'p')) {
          if (onUpFromFirstItem && state.visibleFromIndex === 0) {
            const firstOption = options[0]
            if (firstOption && state.focusedValue === firstOption.value) {
              onUpFromFirstItem()
              event.stopImmediatePropagation()
              return
            }
          }
          state.focusPreviousOption()
          event.stopImmediatePropagation()
          return
        }

        // All other keys (including digits) pass through to TextInput.
        
        
        
        return
      }

      if (key.pageDown) {
        state.focusNextPage()
      }

      if (key.pageUp) {
        state.focusPreviousPage()
      }

      if (disableSelection !== true) {
        // Space for multi-select toggle
        if (
          isMultiSelect &&
          normalizeFullWidthSpace(input) === ' ' &&
          state.focusedValue !== undefined
        ) {
          const isFocusedOptionDisabled = focusedOption?.disabled === true
          if (!isFocusedOptionDisabled) {
            state.selectFocusedOption?.()
            state.onChange?.(state.focusedValue)
          }
        }

        if (
          disableSelection !== 'numeric' &&
          /^[0-9]+$/.test(normalizedInput)
        ) {
          const index = parseInt(normalizedInput) - 1
          if (index >= 0 && index < state.options.length) {
            const selectedOption = state.options[index]!
            if (selectedOption.disabled === true) {
              return
            }
            if (selectedOption.type === 'input') {
              const currentValue = inputValues?.get(selectedOption.value) ?? ''
              if (currentValue.trim()) {
                // Pre-filled input: auto-submit (user can Tab to edit instead)
                state.onChange?.(selectedOption.value)
                return
              }
              if (selectedOption.allowEmptySubmitToCancel) {
                state.onChange?.(selectedOption.value)
                return
              }
              state.focusOption(selectedOption.value)
              return
            }
            state.onChange?.(selectedOption.value)
            return
          }
        }
      }
    },
    { isActive: !isDisabled },
  )
}
