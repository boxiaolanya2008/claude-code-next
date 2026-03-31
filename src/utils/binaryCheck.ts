import { logForDebugging } from './debug.js'
import { which } from './which.js'

const binaryCache = new Map<string, boolean>()

export async function isBinaryInstalled(command: string): Promise<boolean> {
  
  if (!command || !command.trim()) {
    logForDebugging('[binaryCheck] Empty command provided, returning false')
    return false
  }

  
  const trimmedCommand = command.trim()

  
  const cached = binaryCache.get(trimmedCommand)
  if (cached !== undefined) {
    logForDebugging(
      `[binaryCheck] Cache hit for '${trimmedCommand}': ${cached}`,
    )
    return cached
  }

  let exists = false
  if (await which(trimmedCommand).catch(() => null)) {
    exists = true
  }

  
  binaryCache.set(trimmedCommand, exists)

  logForDebugging(
    `[binaryCheck] Binary '${trimmedCommand}' ${exists ? 'found' : 'not found'}`,
  )

  return exists
}

export function clearBinaryCache(): void {
  binaryCache.clear()
}
