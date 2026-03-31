

import { basename, join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { logForDebugging } from '../debug.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { isENOENT, toError } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { getProcessCommand } from '../genericProcessUtils.js'
import { logError } from '../log.js'
import {
  jsonParse,
  jsonStringify,
  writeFileSync_DEPRECATED,
} from '../slowOperations.js'

export function isPidBasedLockingEnabled(): boolean {
  const envVar = process.env.ENABLE_PID_BASED_VERSION_LOCKING
  
  if (isEnvTruthy(envVar)) {
    return true
  }
  if (isEnvDefinedFalsy(envVar)) {
    return false
  }
  
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_pid_based_version_locking',
    false,
  )
}

export type VersionLockContent = {
  pid: number
  version: string
  execPath: string
  acquiredAt: number 
}

export type LockInfo = {
  version: string
  pid: number
  isProcessRunning: boolean
  execPath: string
  acquiredAt: Date
  lockFilePath: string
}

const FALLBACK_STALE_MS = 2 * 60 * 60 * 1000

export function isProcessRunning(pid: number): boolean {
  
  
  if (pid <= 1) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isClaudeProcess(pid: number, expectedExecPath: string): boolean {
  if (!isProcessRunning(pid)) {
    return false
  }

  
  
  if (pid === process.pid) {
    return true
  }

  try {
    const command = getProcessCommand(pid)
    if (!command) {
      
      
      return true
    }

    
    const normalizedCommand = command.toLowerCase()
    const normalizedExecPath = expectedExecPath.toLowerCase()

    return (
      normalizedCommand.includes('claude') ||
      normalizedCommand.includes(normalizedExecPath)
    )
  } catch {
    
    return true
  }
}

export function readLockContent(
  lockFilePath: string,
): VersionLockContent | null {
  const fs = getFsImplementation()

  try {
    const content = fs.readFileSync(lockFilePath, { encoding: 'utf8' })
    if (!content || content.trim() === '') {
      return null
    }

    const parsed = jsonParse(content) as VersionLockContent

    
    if (typeof parsed.pid !== 'number' || !parsed.version || !parsed.execPath) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function isLockActive(lockFilePath: string): boolean {
  const content = readLockContent(lockFilePath)

  if (!content) {
    return false
  }

  const { pid, execPath } = content

  
  if (!isProcessRunning(pid)) {
    return false
  }

  
  
  if (!isClaudeProcess(pid, execPath)) {
    logForDebugging(
      `Lock PID ${pid} is running but does not appear to be Claude - treating as stale`,
    )
    return false
  }

  
  
  
  const fs = getFsImplementation()
  try {
    const stats = fs.statSync(lockFilePath)
    const age = Date.now() - stats.mtimeMs
    if (age > FALLBACK_STALE_MS) {
      
      if (!isProcessRunning(pid)) {
        return false
      }
    }
  } catch {
    
  }

  return true
}

function writeLockFile(
  lockFilePath: string,
  content: VersionLockContent,
): void {
  const fs = getFsImplementation()
  const tempPath = `${lockFilePath}.tmp.${process.pid}.${Date.now()}`

  try {
    writeFileSync_DEPRECATED(tempPath, jsonStringify(content, null, 2), {
      encoding: 'utf8',
      flush: true,
    })
    fs.renameSync(tempPath, lockFilePath)
  } catch (error) {
    
    try {
      fs.unlinkSync(tempPath)
    } catch {
      
    }
    throw error
  }
}

export async function tryAcquireLock(
  versionPath: string,
  lockFilePath: string,
): Promise<(() => void) | null> {
  const fs = getFsImplementation()
  const versionName = basename(versionPath)

  
  
  
  if (isLockActive(lockFilePath)) {
    const existingContent = readLockContent(lockFilePath)
    logForDebugging(
      `Cannot acquire lock for ${versionName} - held by PID ${existingContent?.pid}`,
    )
    return null
  }

  
  const lockContent: VersionLockContent = {
    pid: process.pid,
    version: versionName,
    execPath: process.execPath,
    acquiredAt: Date.now(),
  }

  try {
    writeLockFile(lockFilePath, lockContent)

    
    const verifyContent = readLockContent(lockFilePath)
    if (verifyContent?.pid !== process.pid) {
      
      return null
    }

    logForDebugging(`Acquired PID lock for ${versionName} (PID ${process.pid})`)

    
    return () => {
      try {
        
        const currentContent = readLockContent(lockFilePath)
        if (currentContent?.pid === process.pid) {
          fs.unlinkSync(lockFilePath)
          logForDebugging(`Released PID lock for ${versionName}`)
        }
      } catch (error) {
        logForDebugging(`Failed to release lock for ${versionName}: ${error}`)
      }
    }
  } catch (error) {
    logForDebugging(`Failed to acquire lock for ${versionName}: ${error}`)
    return null
  }
}

export async function acquireProcessLifetimeLock(
  versionPath: string,
  lockFilePath: string,
): Promise<boolean> {
  const release = await tryAcquireLock(versionPath, lockFilePath)

  if (!release) {
    return false
  }

  
  const cleanup = () => {
    try {
      release()
    } catch {
      
    }
  }

  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  
  return true
}

export async function withLock(
  versionPath: string,
  lockFilePath: string,
  callback: () => void | Promise<void>,
): Promise<boolean> {
  const release = await tryAcquireLock(versionPath, lockFilePath)

  if (!release) {
    return false
  }

  try {
    await callback()
    return true
  } finally {
    release()
  }
}

export function getAllLockInfo(locksDir: string): LockInfo[] {
  const fs = getFsImplementation()
  const lockInfos: LockInfo[] = []

  try {
    const lockFiles = fs
      .readdirStringSync(locksDir)
      .filter((f: string) => f.endsWith('.lock'))

    for (const lockFile of lockFiles) {
      const lockFilePath = join(locksDir, lockFile)
      const content = readLockContent(lockFilePath)

      if (content) {
        lockInfos.push({
          version: content.version,
          pid: content.pid,
          isProcessRunning: isProcessRunning(content.pid),
          execPath: content.execPath,
          acquiredAt: new Date(content.acquiredAt),
          lockFilePath,
        })
      }
    }
  } catch (error) {
    if (isENOENT(error)) {
      return lockInfos
    }
    logError(toError(error))
  }

  return lockInfos
}

export function cleanupStaleLocks(locksDir: string): number {
  const fs = getFsImplementation()
  let cleanedCount = 0

  try {
    const lockEntries = fs
      .readdirStringSync(locksDir)
      .filter((f: string) => f.endsWith('.lock'))

    for (const lockEntry of lockEntries) {
      const lockFilePath = join(locksDir, lockEntry)

      try {
        const stats = fs.lstatSync(lockFilePath)

        if (stats.isDirectory()) {
          
          
          fs.rmSync(lockFilePath, { recursive: true, force: true })
          cleanedCount++
          logForDebugging(`Cleaned up legacy directory lock: ${lockEntry}`)
        } else if (!isLockActive(lockFilePath)) {
          
          fs.unlinkSync(lockFilePath)
          cleanedCount++
          logForDebugging(`Cleaned up stale lock: ${lockEntry}`)
        }
      } catch {
        
      }
    }
  } catch (error) {
    if (isENOENT(error)) {
      return 0
    }
    logError(toError(error))
  }

  return cleanedCount
}
