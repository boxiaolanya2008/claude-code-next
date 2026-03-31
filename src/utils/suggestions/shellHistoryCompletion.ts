import { getHistory } from '../../history.js'
import { logForDebugging } from '../debug.js'

export type ShellHistoryMatch = {
  
  fullCommand: string
  
  suffix: string
}

let shellHistoryCache: string[] | null = null
let shellHistoryCacheTimestamp = 0
const CACHE_TTL_MS = 60000 

async function getShellHistoryCommands(): Promise<string[]> {
  const now = Date.now()

  
  if (shellHistoryCache && now - shellHistoryCacheTimestamp < CACHE_TTL_MS) {
    return shellHistoryCache
  }

  const commands: string[] = []
  const seen = new Set<string>()

  try {
    
    for await (const entry of getHistory()) {
      if (entry.display && entry.display.startsWith('!')) {
        
        const command = entry.display.slice(1).trim()
        if (command && !seen.has(command)) {
          seen.add(command)
          commands.push(command)
        }
      }
      
      if (commands.length >= 50) {
        break
      }
    }
  } catch (error) {
    logForDebugging(`Failed to read shell history: ${error}`)
  }

  shellHistoryCache = commands
  shellHistoryCacheTimestamp = now
  return commands
}

export function clearShellHistoryCache(): void {
  shellHistoryCache = null
  shellHistoryCacheTimestamp = 0
}

export function prependToShellHistoryCache(command: string): void {
  if (!shellHistoryCache) {
    return
  }
  const idx = shellHistoryCache.indexOf(command)
  if (idx !== -1) {
    shellHistoryCache.splice(idx, 1)
  }
  shellHistoryCache.unshift(command)
}

export async function getShellHistoryCompletion(
  input: string,
): Promise<ShellHistoryMatch | null> {
  
  if (!input || input.length < 2) {
    return null
  }

  
  const trimmedInput = input.trim()
  if (!trimmedInput) {
    return null
  }

  const commands = await getShellHistoryCommands()

  
  
  for (const command of commands) {
    if (command.startsWith(input) && command !== input) {
      return {
        fullCommand: command,
        suffix: command.slice(input.length),
      }
    }
  }

  return null
}
