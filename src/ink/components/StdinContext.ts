import { createContext } from 'react'
import { EventEmitter } from '../events/emitter.js'
import type { TerminalQuerier } from '../terminal-querier.js'

export type Props = {
  /**
   * Stdin stream passed to `render()` in `options.stdin` or `process.stdin` by default. Useful if your app needs to handle user input.
   */
  readonly stdin: NodeJS.ReadStream

  

  readonly setRawMode: (value: boolean) => void

  /**
   * A boolean flag determining if the current `stdin` supports `setRawMode`. A component using `setRawMode` might want to use `isRawModeSupported` to nicely fall back in environments where raw mode is not supported.
   */
  readonly isRawModeSupported: boolean

  readonly internal_exitOnCtrlC: boolean

  readonly internal_eventEmitter: EventEmitter

  

  readonly internal_querier: TerminalQuerier | null
}

/**
 * `StdinContext` is a React context, which exposes input stream.
 */

const StdinContext = createContext<Props>({
  stdin: process.stdin,

  internal_eventEmitter: new EventEmitter(),
  setRawMode() {},
  isRawModeSupported: false,

  internal_exitOnCtrlC: true,
  internal_querier: null,
})

StdinContext.displayName = 'InternalStdinContext'

export default StdinContext
