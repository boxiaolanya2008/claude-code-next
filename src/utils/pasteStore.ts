import { createHash } from 'crypto'
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { isENOENT } from './errors.js'

const PASTE_STORE_DIR = 'paste-cache'

function getPasteStoreDir(): string {
  return join(getClaudeConfigHomeDir(), PASTE_STORE_DIR)
}

export function hashPastedText(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function getPastePath(hash: string): string {
  return join(getPasteStoreDir(), `${hash}.txt`)
}

export async function storePastedText(
  hash: string,
  content: string,
): Promise<void> {
  try {
    const dir = getPasteStoreDir()
    await mkdir(dir, { recursive: true })

    const pastePath = getPastePath(hash)

    
    await writeFile(pastePath, content, { encoding: 'utf8', mode: 0o600 })
    logForDebugging(`Stored paste ${hash} to ${pastePath}`)
  } catch (error) {
    logForDebugging(`Failed to store paste: ${error}`)
  }
}

export async function retrievePastedText(hash: string): Promise<string | null> {
  try {
    const pastePath = getPastePath(hash)
    return await readFile(pastePath, { encoding: 'utf8' })
  } catch (error) {
    
    if (!isENOENT(error)) {
      logForDebugging(`Failed to retrieve paste ${hash}: ${error}`)
    }
    return null
  }
}

export async function cleanupOldPastes(cutoffDate: Date): Promise<void> {
  const pasteDir = getPasteStoreDir()

  let files
  try {
    files = await readdir(pasteDir)
  } catch {
    
    return
  }

  const cutoffTime = cutoffDate.getTime()
  for (const file of files) {
    if (!file.endsWith('.txt')) {
      continue
    }

    const filePath = join(pasteDir, file)
    try {
      const stats = await stat(filePath)
      if (stats.mtimeMs < cutoffTime) {
        await unlink(filePath)
        logForDebugging(`Cleaned up old paste: ${filePath}`)
      }
    } catch {
      
    }
  }
}
