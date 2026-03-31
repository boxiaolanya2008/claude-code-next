

import { randomBytes } from 'crypto'
import {
  chmod,
  lstat,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { logForDebugging } from '../debug.js'
import { parseZipModes, unzipFile } from '../dxt/zip.js'
import { isEnvTruthy } from '../envUtils.js'
import { getFsImplementation } from '../fsOperations.js'
import { expandTilde } from '../permissions/pathValidation.js'
import type { MarketplaceSource } from './schemas.js'

export function isPluginZipCacheEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_NEXT_PLUGIN_USE_ZIP_CACHE)
}

export function getPluginZipCachePath(): string | undefined {
  if (!isPluginZipCacheEnabled()) {
    return undefined
  }
  const dir = process.env.CLAUDE_CODE_NEXT_PLUGIN_CACHE_DIR
  return dir ? expandTilde(dir) : undefined
}

export function getZipCacheKnownMarketplacesPath(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'known_marketplaces.json')
}

export function getZipCacheInstalledPluginsPath(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'installed_plugins.json')
}

export function getZipCacheMarketplacesDir(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'marketplaces')
}

export function getZipCachePluginsDir(): string {
  const cachePath = getPluginZipCachePath()
  if (!cachePath) {
    throw new Error('Plugin zip cache is not enabled')
  }
  return join(cachePath, 'plugins')
}

let sessionPluginCachePath: string | null = null
let sessionPluginCachePromise: Promise<string> | null = null

export async function getSessionPluginCachePath(): Promise<string> {
  if (sessionPluginCachePath) {
    return sessionPluginCachePath
  }
  if (!sessionPluginCachePromise) {
    sessionPluginCachePromise = (async () => {
      const suffix = randomBytes(8).toString('hex')
      const dir = join(tmpdir(), `claude-plugin-session-${suffix}`)
      await getFsImplementation().mkdir(dir)
      sessionPluginCachePath = dir
      logForDebugging(`Created session plugin cache at ${dir}`)
      return dir
    })()
  }
  return sessionPluginCachePromise
}

export async function cleanupSessionPluginCache(): Promise<void> {
  if (!sessionPluginCachePath) {
    return
  }
  try {
    await rm(sessionPluginCachePath, { recursive: true, force: true })
    logForDebugging(
      `Cleaned up session plugin cache at ${sessionPluginCachePath}`,
    )
  } catch (error) {
    logForDebugging(`Failed to clean up session plugin cache: ${error}`)
  } finally {
    sessionPluginCachePath = null
    sessionPluginCachePromise = null
  }
}

export function resetSessionPluginCache(): void {
  sessionPluginCachePath = null
  sessionPluginCachePromise = null
}

export async function atomicWriteToZipCache(
  targetPath: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = dirname(targetPath)
  await getFsImplementation().mkdir(dir)

  const tmpName = `.${basename(targetPath)}.tmp.${randomBytes(4).toString('hex')}`
  const tmpPath = join(dir, tmpName)

  try {
    if (typeof data === 'string') {
      await writeFile(tmpPath, data, { encoding: 'utf-8' })
    } else {
      await writeFile(tmpPath, data)
    }
    await rename(tmpPath, targetPath)
  } catch (error) {
    
    try {
      await rm(tmpPath, { force: true })
    } catch {
      
    }
    throw error
  }
}

type ZipEntry = [Uint8Array, { os: number; attrs: number }]

export async function createZipFromDirectory(
  sourceDir: string,
): Promise<Uint8Array> {
  const files: Record<string, ZipEntry> = {}
  const visited = new Set<string>()
  await collectFilesForZip(sourceDir, '', files, visited)

  const { zipSync } = await import('fflate')
  const zipData = zipSync(files, { level: 6 })
  logForDebugging(
    `Created ZIP from ${sourceDir}: ${Object.keys(files).length} files, ${zipData.length} bytes`,
  )
  return zipData
}

async function collectFilesForZip(
  baseDir: string,
  relativePath: string,
  files: Record<string, ZipEntry>,
  visited: Set<string>,
): Promise<void> {
  const currentDir = relativePath ? join(baseDir, relativePath) : baseDir
  let entries: string[]
  try {
    entries = await readdir(currentDir)
  } catch {
    return
  }

  
  
  
  
  
  
  
  
  
  try {
    const dirStat = await stat(currentDir, { bigint: true })
    
    
    
    
    if (dirStat.dev !== 0n || dirStat.ino !== 0n) {
      const key = `${dirStat.dev}:${dirStat.ino}`
      if (visited.has(key)) {
        logForDebugging(`Skipping symlink cycle at ${currentDir}`)
        return
      }
      visited.add(key)
    }
  } catch {
    return
  }

  for (const entry of entries) {
    
    if (entry === '.git') {
      continue
    }

    const fullPath = join(currentDir, entry)
    const relPath = relativePath ? `${relativePath}/${entry}` : entry

    let fileStat
    try {
      fileStat = await lstat(fullPath)
    } catch {
      continue
    }

    
    if (fileStat.isSymbolicLink()) {
      try {
        const targetStat = await stat(fullPath)
        if (targetStat.isDirectory()) {
          continue
        }
        
        fileStat = targetStat
      } catch {
        continue 
      }
    }

    if (fileStat.isDirectory()) {
      await collectFilesForZip(baseDir, relPath, files, visited)
    } else if (fileStat.isFile()) {
      try {
        const content = await readFile(fullPath)
        
        
        
        files[relPath] = [
          new Uint8Array(content),
          { os: 3, attrs: (fileStat.mode & 0xffff) << 16 },
        ]
      } catch (error) {
        logForDebugging(`Failed to read file for zip: ${relPath}: ${error}`)
      }
    }
  }
}

export async function extractZipToDirectory(
  zipPath: string,
  targetDir: string,
): Promise<void> {
  const zipBuf = await getFsImplementation().readFileBytes(zipPath)
  const files = await unzipFile(zipBuf)
  
  
  const modes = parseZipModes(zipBuf)

  await getFsImplementation().mkdir(targetDir)

  for (const [relPath, data] of Object.entries(files)) {
    
    if (relPath.endsWith('/')) {
      await getFsImplementation().mkdir(join(targetDir, relPath))
      continue
    }

    const fullPath = join(targetDir, relPath)
    await getFsImplementation().mkdir(dirname(fullPath))
    await writeFile(fullPath, data)
    const mode = modes[relPath]
    if (mode && mode & 0o111) {
      
      
      await chmod(fullPath, mode & 0o777).catch(() => {})
    }
  }

  logForDebugging(
    `Extracted ZIP to ${targetDir}: ${Object.keys(files).length} entries`,
  )
}

export async function convertDirectoryToZipInPlace(
  dirPath: string,
  zipPath: string,
): Promise<void> {
  const zipData = await createZipFromDirectory(dirPath)
  await atomicWriteToZipCache(zipPath, zipData)
  await rm(dirPath, { recursive: true, force: true })
}

export function getMarketplaceJsonRelativePath(
  marketplaceName: string,
): string {
  const sanitized = marketplaceName.replace(/[^a-zA-Z0-9\-_]/g, '-')
  return join('marketplaces', `${sanitized}.json`)
}

export function isMarketplaceSourceSupportedByZipCache(
  source: MarketplaceSource,
): boolean {
  return ['github', 'git', 'url', 'settings'].includes(source.source)
}
