import { realpath, stat } from 'fs/promises'
import { getPlatform } from '../platform.js'
import { which } from '../which.js'

async function probePath(p: string): Promise<string | null> {
  try {
    return (await stat(p)).isFile() ? p : null
  } catch {
    return null
  }
}

export async function findPowerShell(): Promise<string | null> {
  const pwshPath = await which('pwsh')
  if (pwshPath) {
    
    
    
    
    if (getPlatform() === 'linux') {
      const resolved = await realpath(pwshPath).catch(() => pwshPath)
      if (pwshPath.startsWith('/snap/') || resolved.startsWith('/snap/')) {
        const direct =
          (await probePath('/opt/microsoft/powershell/7/pwsh')) ??
          (await probePath('/usr/bin/pwsh'))
        if (direct) {
          const directResolved = await realpath(direct).catch(() => direct)
          if (
            !direct.startsWith('/snap/') &&
            !directResolved.startsWith('/snap/')
          ) {
            return direct
          }
        }
      }
    }
    return pwshPath
  }

  const powershellPath = await which('powershell')
  if (powershellPath) {
    return powershellPath
  }

  return null
}

let cachedPowerShellPath: Promise<string | null> | null = null

export function getCachedPowerShellPath(): Promise<string | null> {
  if (!cachedPowerShellPath) {
    cachedPowerShellPath = findPowerShell()
  }
  return cachedPowerShellPath
}

export type PowerShellEdition = 'core' | 'desktop'

export async function getPowerShellEdition(): Promise<PowerShellEdition | null> {
  const p = await getCachedPowerShellPath()
  if (!p) return null
  
  
  
  
  const base = p
    .split(/[/\\]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '')
  return base === 'pwsh' ? 'core' : 'desktop'
}

export function resetPowerShellCache(): void {
  cachedPowerShellPath = null
}
