import { useCallback, useEffect } from 'react'
import type { InputEvent } from '../ink/events/input-event.js'
import { type Key, useInput } from '../ink.js'
import { useOptionalKeybindingContext } from './KeybindingContext.js'
import type { KeybindingContextName } from './types.js'

type Options = {
  
  context?: KeybindingContextName
  
  isActive?: boolean
}

export function useKeybinding(
  action: string,
  handler: () => void | false | Promise<void>,
  options: Options = {},
): void {
  const { context = 'Global', isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  
  useEffect(() => {
    if (!keybindingContext || !isActive) return
    return keybindingContext.registerHandler({ action, context, handler })
  }, [action, context, handler, keybindingContext, isActive])

  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      
      if (!keybindingContext) return

      
      
      const contextsToCheck: KeybindingContextName[] = [
        ...keybindingContext.activeContexts,
        context,
        'Global',
      ]
      
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

      switch (result.type) {
        case 'match':
          
          keybindingContext.setPendingChord(null)
          if (result.action === action) {
            if (handler() !== false) {
              event.stopImmediatePropagation()
            }
          }
          break
        case 'chord_started':
          
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case 'chord_cancelled':
          
          keybindingContext.setPendingChord(null)
          break
        case 'unbound':
          
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case 'none':
          
          break
      }
    },
    [action, context, handler, keybindingContext],
  )

  useInput(handleInput, { isActive })
}

export function useKeybindings(
  
  
  
  
  
  
  
  handlers: Record<string, () => void | false | Promise<void>>,
  options: Options = {},
): void {
  const { context = 'Global', isActive = true } = options
  const keybindingContext = useOptionalKeybindingContext()

  
  useEffect(() => {
    if (!keybindingContext || !isActive) return

    const unregisterFns: Array<() => void> = []
    for (const [action, handler] of Object.entries(handlers)) {
      unregisterFns.push(
        keybindingContext.registerHandler({ action, context, handler }),
      )
    }

    return () => {
      for (const unregister of unregisterFns) {
        unregister()
      }
    }
  }, [context, handlers, keybindingContext, isActive])

  const handleInput = useCallback(
    (input: string, key: Key, event: InputEvent) => {
      
      if (!keybindingContext) return

      
      
      const contextsToCheck: KeybindingContextName[] = [
        ...keybindingContext.activeContexts,
        context,
        'Global',
      ]
      
      const uniqueContexts = [...new Set(contextsToCheck)]

      const result = keybindingContext.resolve(input, key, uniqueContexts)

      switch (result.type) {
        case 'match':
          
          keybindingContext.setPendingChord(null)
          if (result.action in handlers) {
            const handler = handlers[result.action]
            if (handler && handler() !== false) {
              event.stopImmediatePropagation()
            }
          }
          break
        case 'chord_started':
          
          keybindingContext.setPendingChord(result.pending)
          event.stopImmediatePropagation()
          break
        case 'chord_cancelled':
          
          keybindingContext.setPendingChord(null)
          break
        case 'unbound':
          
          keybindingContext.setPendingChord(null)
          event.stopImmediatePropagation()
          break
        case 'none':
          
          break
      }
    },
    [context, handlers, keybindingContext],
  )

  useInput(handleInput, { isActive })
}
