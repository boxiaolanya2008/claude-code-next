import { useEffect, useLayoutEffect } from 'react'
import { useEventCallback } from 'usehooks-ts'
import type { InputEvent, Key } from '../events/input-event.js'
import useStdin from './use-stdin.js'

type Handler = (input: string, key: Key, event: InputEvent) => void

type Options = {
  

  isActive?: boolean
}

const useInput = (inputHandler: Handler, options: Options = {}) => {
  const { setRawMode, internal_exitOnCtrlC, internal_eventEmitter } = useStdin()

  
  
  
  
  
  useLayoutEffect(() => {
    if (options.isActive === false) {
      return
    }

    setRawMode(true)

    return () => {
      setRawMode(false)
    }
  }, [options.isActive, setRawMode])

  
  
  
  
  
  
  
  const handleData = useEventCallback((event: InputEvent) => {
    if (options.isActive === false) {
      return
    }
    const { input, key } = event

    
    
    
    if (!(input === 'c' && key.ctrl) || !internal_exitOnCtrlC) {
      inputHandler(input, key, event)
    }
  })

  useEffect(() => {
    internal_eventEmitter?.on('input', handleData)

    return () => {
      internal_eventEmitter?.removeListener('input', handleData)
    }
  }, [internal_eventEmitter, handleData])
}

export default useInput
