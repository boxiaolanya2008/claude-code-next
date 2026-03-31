

import { execFileSync } from 'child_process'

export interface IDEPathConverter {
  

  toLocalPath(idePath: string): string

  

  toIDEPath(localPath: string): string
}

export class WindowsToWSLConverter implements IDEPathConverter {
  constructor(private wslDistroName: string | undefined) {}

  toLocalPath(windowsPath: string): string {
    if (!windowsPath) return windowsPath

    
    if (this.wslDistroName) {
      const wslUncMatch = windowsPath.match(
        /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/,
      )
      if (wslUncMatch && wslUncMatch[1] !== this.wslDistroName) {
        
        return windowsPath
      }
    }

    try {
      
      const result = execFileSync('wslpath', ['-u', windowsPath], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'], 
      }).trim()

      return result
    } catch {
      
      return windowsPath
        .replace(/\\/g, '/') 
        .replace(/^([A-Z]):/i, (_, letter) => `/mnt/${letter.toLowerCase()}`)
    }
  }

  toIDEPath(wslPath: string): string {
    if (!wslPath) return wslPath

    try {
      
      const result = execFileSync('wslpath', ['-w', wslPath], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'], 
      }).trim()

      return result
    } catch {
      
      return wslPath
    }
  }
}

export function checkWSLDistroMatch(
  windowsPath: string,
  wslDistroName: string,
): boolean {
  const wslUncMatch = windowsPath.match(
    /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(.*)$/,
  )
  if (wslUncMatch) {
    return wslUncMatch[1] === wslDistroName
  }
  return true 
}
