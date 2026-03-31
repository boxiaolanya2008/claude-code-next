import { openSync } from 'fs'
import { ReadStream } from 'tty'
import type { RenderOptions } from '../ink.js'
import { isEnvTruthy } from './envUtils.js'
import { logError } from './log.js'

let cachedStdinOverride: ReadStream | undefined | null = null

function getStdinOverride(): ReadStream | undefined {
  
  if (cachedStdinOverride !== null) {
    return cachedStdinOverride
  }

  
  if (process.stdin.isTTY) {
    cachedStdinOverride = undefined
    return undefined
  }

  
  if (isEnvTruthy(process.env.CI)) {
    cachedStdinOverride = undefined
    return undefined
  }

  
  if (process.argv.includes('mcp')) {
    cachedStdinOverride = undefined
    return undefined
  }

  
  if (process.platform === 'win32') {
    cachedStdinOverride = undefined
    return undefined
  }

  
  try {
    const ttyFd = openSync('/dev/tty', 'r')
    const ttyStream = new ReadStream(ttyFd)
    
    
    
    ttyStream.isTTY = true
    cachedStdinOverride = ttyStream
    return cachedStdinOverride
  } catch (err) {
    logError(err as Error)
    cachedStdinOverride = undefined
    return undefined
  }
}

export function getBaseRenderOptions(
  exitOnCtrlC: boolean = false,
): RenderOptions {
  const stdin = getStdinOverride()
  const options: RenderOptions = { exitOnCtrlC }
  if (stdin) {
    options.stdin = stdin
  }
  return options
}
