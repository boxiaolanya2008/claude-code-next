import { useCallback, useMemo, useState } from 'react'
import useApp from '../ink/hooks/use-app.js'
import type { KeybindingContextName } from '../keybindings/types.js'
import { useDoublePress } from './useDoublePress.js'

export type ExitState = {
  pending: boolean
  keyName: 'Ctrl-C' | 'Ctrl-D' | null
}

type KeybindingOptions = {
  context?: KeybindingContextName
  isActive?: boolean
}

type UseKeybindingsHook = (
  handlers: Record<string, () => void>,
  options?: KeybindingOptions,
) => void

export function useExitOnCtrlCD(
  useKeybindingsHook: UseKeybindingsHook,
  onInterrupt?: () => boolean,
  onExit?: () => void,
  isActive = true,
): ExitState {
  const { exit } = useApp()
  const [exitState, setExitState] = useState<ExitState>({
    pending: false,
    keyName: null,
  })

  const exitFn = useMemo(() => onExit ?? exit, [onExit, exit])

  
  const handleCtrlCDoublePress = useDoublePress(
    pending => setExitState({ pending, keyName: 'Ctrl-C' }),
    exitFn,
  )

  
  const handleCtrlDDoublePress = useDoublePress(
    pending => setExitState({ pending, keyName: 'Ctrl-D' }),
    exitFn,
  )

  
  
  const handleInterrupt = useCallback(() => {
    if (onInterrupt?.()) return 
    handleCtrlCDoublePress()
  }, [handleCtrlCDoublePress, onInterrupt])

  
  
  const handleExit = useCallback(() => {
    handleCtrlDDoublePress()
  }, [handleCtrlDDoublePress])

  const handlers = useMemo(
    () => ({
      'app:interrupt': handleInterrupt,
      'app:exit': handleExit,
    }),
    [handleInterrupt, handleExit],
  )

  useKeybindingsHook(handlers, { context: 'Global', isActive })

  return exitState
}
