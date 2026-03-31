import { homedir } from 'os'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'path'
import { getCwd } from './cwd.js'
import { getFsImplementation } from './fsOperations.js'
import { getPlatform } from './platform.js'
import { posixPathToWindowsPath } from './windowsPaths.js'

export function expandPath(path: string, baseDir?: string): string {
  
  const actualBaseDir = baseDir ?? getCwd() ?? getFsImplementation().cwd()

  
  if (typeof path !== 'string') {
    throw new TypeError(`Path must be a string, received ${typeof path}`)
  }

  if (typeof actualBaseDir !== 'string') {
    throw new TypeError(
      `Base directory must be a string, received ${typeof actualBaseDir}`,
    )
  }

  
  if (path.includes('\0') || actualBaseDir.includes('\0')) {
    throw new Error('Path contains null bytes')
  }

  
  const trimmedPath = path.trim()
  if (!trimmedPath) {
    return normalize(actualBaseDir).normalize('NFC')
  }

  
  if (trimmedPath === '~') {
    return homedir().normalize('NFC')
  }

  if (trimmedPath.startsWith('~/')) {
    return join(homedir(), trimmedPath.slice(2)).normalize('NFC')
  }

  
  let processedPath = trimmedPath
  if (getPlatform() === 'windows' && trimmedPath.match(/^\/[a-z]:/i)) {
    try {
      processedPath = posixPathToWindowsPath(trimmedPath)
    } catch {
      
      processedPath = trimmedPath
    }
  }

  
  if (isAbsolute(processedPath)) {
    return normalize(processedPath).normalize('NFC')
  }

  
  return resolve(actualBaseDir, processedPath).normalize('NFC')
}

export function toRelativePath(absolutePath: string): string {
  const relativePath = relative(getCwd(), absolutePath)
  
  return relativePath.startsWith('..') ? absolutePath : relativePath
}

export function getDirectoryForPath(path: string): string {
  const absolutePath = expandPath(path)
  
  if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
    return dirname(absolutePath)
  }
  try {
    const stats = getFsImplementation().statSync(absolutePath)
    if (stats.isDirectory()) {
      return absolutePath
    }
  } catch {
    
  }
  
  return dirname(absolutePath)
}

export function containsPathTraversal(path: string): boolean {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)
}

export { sanitizePath } from './sessionStoragePortable.js'

export function normalizePathForConfigKey(path: string): string {
  
  const normalized = normalize(path)
  
  
  return normalized.replace(/\\/g, '/')
}
