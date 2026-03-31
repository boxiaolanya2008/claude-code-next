import type { ToolUseContext } from '../../Tool.js'

import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { withResolvers } from '../withResolvers.js'
import { isLockHeldLocally, releaseComputerUseLock } from './computerUseLock.js'
import { unregisterEscHotkey } from './escHotkey.js'

const UNHIDE_TIMEOUT_MS = 5000

export async function cleanupComputerUseAfterTurn(
  ctx: Pick<
    ToolUseContext,
    'getAppState' | 'setAppState' | 'sendOSNotification'
  >,
): Promise<void> {
  const appState = ctx.getAppState()

  const hidden = appState.computerUseMcpState?.hiddenDuringTurn
  if (hidden && hidden.size > 0) {
    const { unhideComputerUseApps } = await import('./executor.js')
    const unhide = unhideComputerUseApps([...hidden]).catch(err =>
      logForDebugging(
        `[Computer Use MCP] auto-unhide failed: ${errorMessage(err)}`,
      ),
    )
    const timeout = withResolvers<void>()
    const timer = setTimeout(timeout.resolve, UNHIDE_TIMEOUT_MS)
    await Promise.race([unhide, timeout.promise]).finally(() =>
      clearTimeout(timer),
    )
    ctx.setAppState(prev =>
      prev.computerUseMcpState?.hiddenDuringTurn === undefined
        ? prev
        : {
            ...prev,
            computerUseMcpState: {
              ...prev.computerUseMcpState,
              hiddenDuringTurn: undefined,
            },
          },
    )
  }

  
  
  if (!isLockHeldLocally()) return

  
  
  
  
  try {
    unregisterEscHotkey()
  } catch (err) {
    logForDebugging(
      `[Computer Use MCP] unregisterEscHotkey failed: ${errorMessage(err)}`,
    )
  }

  if (await releaseComputerUseLock()) {
    ctx.sendOSNotification?.({
      message: 'Claude is done using your computer',
      notificationType: 'computer_use_exit',
    })
  }
}
