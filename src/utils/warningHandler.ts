import { posix, win32 } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { getPlatform } from './platform.js'

export const MAX_WARNING_KEYS = 1000
const warningCounts = new Map<string, number>()

function isRunningFromBuildDirectory(): boolean {
  let invokedPath = process.argv[1] || ''
  let execPath = process.execPath || process.argv[0] || ''

  
  if (getPlatform() === 'windows') {
    invokedPath = invokedPath.split(win32.sep).join(posix.sep)
    execPath = execPath.split(win32.sep).join(posix.sep)
  }

  const pathsToCheck = [invokedPath, execPath]
  const buildDirs = [
    '/build-ant/',
    '/build-external/',
    '/build-external-native/',
    '/build-ant-native/',
  ]

  return pathsToCheck.some(path => buildDirs.some(dir => path.includes(dir)))
}

const INTERNAL_WARNINGS = [
  /MaxListenersExceededWarning.*AbortSignal/,
  /MaxListenersExceededWarning.*EventTarget/,
]

function isInternalWarning(warning: Error): boolean {
  const warningStr = `${warning.name}: ${warning.message}`
  return INTERNAL_WARNINGS.some(pattern => pattern.test(warningStr))
}

let warningHandler: ((warning: Error) => void) | null = null

export function resetWarningHandler(): void {
  if (warningHandler) {
    process.removeListener('warning', warningHandler)
  }
  warningHandler = null
  warningCounts.clear()
}

export function initializeWarningHandler(): void {
  
  const currentListeners = process.listeners('warning')
  if (warningHandler && currentListeners.includes(warningHandler)) {
    return
  }

  
  
  
  
  const isDevelopment =
    process.env.NODE_ENV === 'development' || isRunningFromBuildDirectory()
  if (!isDevelopment) {
    process.removeAllListeners('warning')
  }

  
  warningHandler = (warning: Error) => {
    try {
      const warningKey = `${warning.name}: ${warning.message.slice(0, 50)}`
      const count = warningCounts.get(warningKey) || 0

      
      
      
      if (
        warningCounts.has(warningKey) ||
        warningCounts.size < MAX_WARNING_KEYS
      ) {
        warningCounts.set(warningKey, count + 1)
      }

      const isInternal = isInternalWarning(warning)

      
      
      logEvent('tengu_node_warning', {
        is_internal: isInternal ? 1 : 0,
        occurrence_count: count + 1,
        classname:
          warning.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(process.env.USER_TYPE === 'ant' && {
          message:
            warning.message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      })

      
      if (isEnvTruthy(process.env.CLAUDE_DEBUG)) {
        const prefix = isInternal ? '[Internal Warning]' : '[Warning]'
        logForDebugging(`${prefix} ${warning.toString()}`, { level: 'warn' })
      }
      
    } catch {
      
    }
  }

  
  process.on('warning', warningHandler)
}
