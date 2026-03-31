

import * as fs from 'fs/promises'
import * as path from 'path'
import { logForDebugging } from '../debug.js'
import type { EnvironmentKind } from '../teleport/environments.js'
import type { TurnStartTime } from './types.js'

export function logDebug(message: string): void {
  logForDebugging(`[file-persistence] ${message}`)
}

export function getEnvironmentKind(): EnvironmentKind | null {
  const kind = process.env.CLAUDE_CODE_NEXT_ENVIRONMENT_KIND
  if (kind === 'byoc' || kind === 'anthropic_cloud') {
    return kind
  }
  return null
}

function hasParentPath(
  entry: object,
): entry is { parentPath: string; name: string } {
  return 'parentPath' in entry && typeof entry.parentPath === 'string'
}

function hasPath(entry: object): entry is { path: string; name: string } {
  return 'path' in entry && typeof entry.path === 'string'
}

function getEntryParentPath(entry: object, fallback: string): string {
  if (hasParentPath(entry)) {
    return entry.parentPath
  }
  if (hasPath(entry)) {
    return entry.path
  }
  return fallback
}

export async function findModifiedFiles(
  turnStartTime: TurnStartTime,
  outputsDir: string,
): Promise<string[]> {
  
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(outputsDir, {
      withFileTypes: true,
      recursive: true,
    })
  } catch {
    
    return []
  }

  
  const filePaths: string[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isFile()) {
      
      const parentPath = getEntryParentPath(entry, outputsDir)
      filePaths.push(path.join(parentPath, entry.name))
    }
  }

  if (filePaths.length === 0) {
    logDebug('No files found in outputs directory')
    return []
  }

  
  const statResults = await Promise.all(
    filePaths.map(async filePath => {
      try {
        const stat = await fs.lstat(filePath)
        
        if (stat.isSymbolicLink()) {
          return null
        }
        return { filePath, mtimeMs: stat.mtimeMs }
      } catch {
        
        return null
      }
    }),
  )

  
  const modifiedFiles: string[] = []
  for (const result of statResults) {
    if (result && result.mtimeMs >= turnStartTime) {
      modifiedFiles.push(result.filePath)
    }
  }

  logDebug(
    `Found ${modifiedFiles.length} modified files since turn start (scanned ${filePaths.length} total)`,
  )

  return modifiedFiles
}
