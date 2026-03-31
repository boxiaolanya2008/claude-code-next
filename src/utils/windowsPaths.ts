import memoize from 'lodash-es/memoize.js'
import * as path from 'path'
import * as pathWin32 from 'path/win32'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { execSync_DEPRECATED } from './execSyncWrapper.js'
import { memoizeWithLRU } from './memoize.js'
import { getPlatform } from './platform.js'

function checkPathExists(path: string): boolean {
  try {
    execSync_DEPRECATED(`dir "${path}"`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function findExecutable(executable: string): string | null {
  
  if (executable === 'git') {
    const defaultLocations = [
      
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      
      
    ]

    for (const location of defaultLocations) {
      if (checkPathExists(location)) {
        return location
      }
    }
  }

  
  try {
    const result = execSync_DEPRECATED(`where.exe ${executable}`, {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim()

    
    
    const paths = result.split('\r\n').filter(Boolean)
    const cwd = getCwd().toLowerCase()

    for (const candidatePath of paths) {
      
      const normalizedPath = path.resolve(candidatePath).toLowerCase()
      const pathDir = path.dirname(normalizedPath).toLowerCase()

      
      if (pathDir === cwd || normalizedPath.startsWith(cwd + path.sep)) {
        logForDebugging(
          `Skipping potentially malicious executable in current directory: ${candidatePath}`,
        )
        continue
      }

      
      return candidatePath
    }

    return null
  } catch {
    return null
  }
}

export function setShellIfWindows(): void {
  if (getPlatform() === 'windows') {
    const gitBashPath = findGitBashPath()
    process.env.SHELL = gitBashPath
    logForDebugging(`Using bash path: "${gitBashPath}"`)
  }
}

export const findGitBashPath = memoize((): string => {
  if (process.env.CLAUDE_CODE_NEXT_GIT_BASH_PATH) {
    if (checkPathExists(process.env.CLAUDE_CODE_NEXT_GIT_BASH_PATH)) {
      return process.env.CLAUDE_CODE_NEXT_GIT_BASH_PATH
    }
    
    console.error(
      `Claude Code Next was unable to find CLAUDE_CODE_NEXT_GIT_BASH_PATH path "${process.env.CLAUDE_CODE_NEXT_GIT_BASH_PATH}"`,
    )
    
    process.exit(1)
  }

  const gitPath = findExecutable('git')
  if (gitPath) {
    const bashPath = pathWin32.join(gitPath, '..', '..', 'bin', 'bash.exe')
    if (checkPathExists(bashPath)) {
      return bashPath
    }
  }

  
  console.error(
    'Claude Code Next on Windows requires git-bash (https://git-scm.com/downloads/win). If installed but not in PATH, set environment variable pointing to your bash.exe, similar to: CLAUDE_CODE_NEXT_GIT_BASH_PATH=C:\\Program Files\\Git\\bin\\bash.exe',
  )
  
  process.exit(1)
})

export const windowsPathToPosixPath = memoizeWithLRU(
  (windowsPath: string): string => {
    
    if (windowsPath.startsWith('\\\\')) {
      return windowsPath.replace(/\\/g, '/')
    }
    
    const match = windowsPath.match(/^([A-Za-z]):[/\\]/)
    if (match) {
      const driveLetter = match[1]!.toLowerCase()
      return '/' + driveLetter + windowsPath.slice(2).replace(/\\/g, '/')
    }
    
    return windowsPath.replace(/\\/g, '/')
  },
  (p: string) => p,
  500,
)

export const posixPathToWindowsPath = memoizeWithLRU(
  (posixPath: string): string => {
    
    if (posixPath.startsWith('
      return posixPath.replace(/\//g, '\\')
    }
    const cygdriveMatch = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/)
    if (cygdriveMatch) {
      const driveLetter = cygdriveMatch[1]!.toUpperCase()
      const rest = posixPath.slice(('/cygdrive/' + cygdriveMatch[1]).length)
      return driveLetter + ':' + (rest || '\\').replace(/\//g, '\\')
    }
    const driveMatch = posixPath.match(/^\/([A-Za-z])(\/|$)/)
    if (driveMatch) {
      const driveLetter = driveMatch[1]!.toUpperCase()
      const rest = posixPath.slice(2)
      return driveLetter + ':' + (rest || '\\').replace(/\//g, '\\')
    }
    return posixPath.replace(/\//g, '\\')
  },
  (p: string) => p,
  500,
)
