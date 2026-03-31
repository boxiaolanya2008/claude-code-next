import * as fs from 'fs'
import {
  mkdir as mkdirPromise,
  open,
  readdir as readdirPromise,
  readFile as readFilePromise,
  rename as renamePromise,
  rmdir as rmdirPromise,
  rm as rmPromise,
  stat as statPromise,
  unlink as unlinkPromise,
} from 'fs/promises'
import { homedir } from 'os'
import * as nodePath from 'path'
import { getErrnoCode } from './errors.js'
import { slowLogging } from './slowOperations.js'

export type FsOperations = {
  // File access and information operations
  
  cwd(): string
  
  existsSync(path: string): boolean
  
  stat(path: string): Promise<fs.Stats>
  
  readdir(path: string): Promise<fs.Dirent[]>
  
  unlink(path: string): Promise<void>
  
  rmdir(path: string): Promise<void>
  
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>
  
  mkdir(path: string, options?: { mode?: number }): Promise<void>
  
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>
  
  rename(oldPath: string, newPath: string): Promise<void>
  
  statSync(path: string): fs.Stats
  
  lstatSync(path: string): fs.Stats

  
  
  readFileSync(
    path: string,
    options: {
      encoding: BufferEncoding
    },
  ): string
  
  readFileBytesSync(path: string): Buffer
  
  readSync(
    path: string,
    options: {
      length: number
    },
  ): {
    buffer: Buffer
    bytesRead: number
  }
  /** Appends string to file */
  appendFileSync(path: string, data: string, options?: { mode?: number }): void
  /** Copies file from source to destination */
  copyFileSync(src: string, dest: string): void
  /** Deletes file */
  unlinkSync(path: string): void
  /** Renames/moves file */
  renameSync(oldPath: string, newPath: string): void
  /** Creates hard link */
  linkSync(target: string, path: string): void
  /** Creates symbolic link */
  symlinkSync(
    target: string,
    path: string,
    type?: 'dir' | 'file' | 'junction',
  ): void
  /** Reads symbolic link */
  readlinkSync(path: string): string
  
  realpathSync(path: string): string

  
  
  mkdirSync(
    path: string,
    options?: {
      mode?: number
    },
  ): void
  /** Lists directory contents with file type information */
  readdirSync(path: string): fs.Dirent[]
  
  readdirStringSync(path: string): string[]
  
  isDirEmptySync(path: string): boolean
  
  rmdirSync(path: string): void
  /** Removes files and directories (with recursive option) */
  rmSync(
    path: string,
    options?: {
      recursive?: boolean
      force?: boolean
    },
  ): void
  /** Create a writable stream for writing data to a file. */
  createWriteStream(path: string): fs.WriteStream
  

  readFileBytes(path: string, maxBytes?: number): Promise<Buffer>
}

/**
 * Safely resolves a file path, handling symlinks and errors gracefully.
 *
 * Error handling strategy:
 * - If the file doesn't exist, returns the original path (allows for file creation)
 * - If symlink resolution fails (broken symlink, permission denied, circular links),
 *   returns the original path and marks it as not a symlink
 * - This ensures operations can continue with the original path rather than failing
 *
 * @param fs The filesystem implementation to use
 * @param filePath The path to resolve
 * @returns Object containing the resolved path and whether it was a symlink
 */
export function safeResolvePath(
  fs: FsOperations,
  filePath: string,
): { resolvedPath: string; isSymlink: boolean; isCanonical: boolean } {
  // Block UNC paths before any filesystem access to prevent network
  
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) {
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }

  try {
    // Check for special file types (FIFOs, sockets, devices) before calling realpathSync.
    
    
    
    const stats = fs.lstatSync(filePath)
    if (
      stats.isFIFO() ||
      stats.isSocket() ||
      stats.isCharacterDevice() ||
      stats.isBlockDevice()
    ) {
      return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
    }

    const resolvedPath = fs.realpathSync(filePath)
    return {
      resolvedPath,
      isSymlink: resolvedPath !== filePath,
      // realpathSync returned: resolvedPath is canonical (all symlinks in
      // all path components resolved). Callers can skip further symlink
      
      isCanonical: true,
    }
  } catch (_error) {
    // If lstat/realpath fails for any reason (ENOENT, broken symlink,
    // EACCES, ELOOP, etc.), return the original path to allow operations
    
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }
}

/**
 * Check if a file path is a duplicate and should be skipped.
 * Resolves symlinks to detect duplicates pointing to the same file.
 * If not a duplicate, adds the resolved path to loadedPaths.
 *
 * @returns true if the file should be skipped (is duplicate)
 */
export function isDuplicatePath(
  fs: FsOperations,
  filePath: string,
  loadedPaths: Set<string>,
): boolean {
  const { resolvedPath } = safeResolvePath(fs, filePath)
  if (loadedPaths.has(resolvedPath)) {
    return true
  }
  loadedPaths.add(resolvedPath)
  return false
}

/**
 * Resolve the deepest existing ancestor of a path via realpathSync, walking
 * up until it succeeds. Detects dangling symlinks (link entry exists, target
 * doesn't) via lstat and resolves them via readlink.
 *
 * Use when the input path may not exist (new file writes) and you need to
 * know where the write would ACTUALLY land after the OS follows symlinks.
 *
 * Returns the resolved absolute path with non-existent tail segments
 * rejoined, or undefined if no symlink was found in any existing ancestor
 * (the path's existing ancestors all resolve to themselves).
 *
 * Handles: live parent symlinks, dangling file symlinks, dangling parent
 * symlinks. Same core algorithm as teamMemPaths.ts:realpathDeepestExisting.
 */
export function resolveDeepestExistingAncestorSync(
  fs: FsOperations,
  absolutePath: string,
): string | undefined {
  let dir = absolutePath
  const segments: string[] = []
  
  
  
  while (dir !== nodePath.dirname(dir)) {
    let st: fs.Stats
    try {
      st = fs.lstatSync(dir)
    } catch {
      // lstat failed: truly non-existent. Walk up.
      segments.unshift(nodePath.basename(dir))
      dir = nodePath.dirname(dir)
      continue
    }
    if (st.isSymbolicLink()) {
      // Found a symlink (live or dangling). Try realpath first (resolves
      
      try {
        const resolved = fs.realpathSync(dir)
        return segments.length === 0
          ? resolved
          : nodePath.join(resolved, ...segments)
      } catch {
        // Dangling: realpath failed but lstat saw the link entry.
        const target = fs.readlinkSync(dir)
        const absTarget = nodePath.isAbsolute(target)
          ? target
          : nodePath.resolve(nodePath.dirname(dir), target)
        return segments.length === 0
          ? absTarget
          : nodePath.join(absTarget, ...segments)
      }
    }
    // Existing non-symlink component. One realpath call resolves any
    
    try {
      const resolved = fs.realpathSync(dir)
      if (resolved !== dir) {
        return segments.length === 0
          ? resolved
          : nodePath.join(resolved, ...segments)
      }
    } catch {
      // realpath can still fail (e.g. EACCES in ancestors). Return
      
      
    }
    return undefined
  }
  return undefined
}

/**
 * Gets all paths that should be checked for permissions.
 * This includes the original path, all intermediate symlink targets in the chain,
 * and the final resolved path.
 *
 * For example, if test.txt -> /etc/passwd -> /private/etc/passwd:
 * - test.txt (original path)
 * - /etc/passwd (intermediate symlink target)
 * - /private/etc/passwd (final resolved path)
 *
 * This is important for security: a deny rule for /etc/passwd should block
 * access even if the file is actually at /private/etc/passwd (as on macOS).
 *
 * @param path - The path to check (will be converted to absolute)
 * @returns An array of absolute paths to check permissions for
 */
export function getPathsForPermissionCheck(inputPath: string): string[] {
  // Expand tilde notation defensively - tools should do this in getPath(),
  // but we normalize here as defense in depth for permission checking
  let path = inputPath
  if (path === '~') {
    path = homedir().normalize('NFC')
  } else if (path.startsWith('~/')) {
    path = nodePath.join(homedir().normalize('NFC'), path.slice(2))
  }

  const pathSet = new Set<string>()
  const fsImpl = getFsImplementation()

  
  pathSet.add(path)

  
  
  if (path.startsWith('//') || path.startsWith('\\\\')) {
    return Array.from(pathSet)
  }

  // Follow the symlink chain, collecting ALL intermediate targets
  
  
  try {
    let currentPath = path
    const visited = new Set<string>()
    const maxDepth = 40 

    for (let depth = 0; depth < maxDepth; depth++) {
      // Prevent infinite loops from circular symlinks
      if (visited.has(currentPath)) {
        break
      }
      visited.add(currentPath)

      if (!fsImpl.existsSync(currentPath)) {
        // Path doesn't exist (new file case). existsSync follows symlinks,
        // so this is also reached for DANGLING symlinks (link entry exists,
        // target doesn't). Resolve symlinks in the path and its ancestors
        
        // `./data -> /etc/cron.d/` (live parent symlink) or
        
        
        if (currentPath === path) {
          const resolved = resolveDeepestExistingAncestorSync(fsImpl, path)
          if (resolved !== undefined) {
            pathSet.add(resolved)
          }
        }
        break
      }

      const stats = fsImpl.lstatSync(currentPath)

      
      if (
        stats.isFIFO() ||
        stats.isSocket() ||
        stats.isCharacterDevice() ||
        stats.isBlockDevice()
      ) {
        break
      }

      if (!stats.isSymbolicLink()) {
        break
      }

      // Get the immediate symlink target
      const target = fsImpl.readlinkSync(currentPath)

      
      const absoluteTarget = nodePath.isAbsolute(target)
        ? target
        : nodePath.resolve(nodePath.dirname(currentPath), target)

      
      pathSet.add(absoluteTarget)
      currentPath = absoluteTarget
    }
  } catch {
    // If anything fails during chain traversal, continue with what we have
  }

  // Also add the final resolved path using realpathSync for completeness
  
  const { resolvedPath, isSymlink } = safeResolvePath(fsImpl, path)
  if (isSymlink && resolvedPath !== path) {
    pathSet.add(resolvedPath)
  }

  return Array.from(pathSet)
}

export const NodeFsOperations: FsOperations = {
  cwd() {
    return process.cwd()
  },

  existsSync(fsPath) {
    using _ = slowLogging`fs.existsSync(${fsPath})`
    return fs.existsSync(fsPath)
  },

  async stat(fsPath) {
    return statPromise(fsPath)
  },

  async readdir(fsPath) {
    return readdirPromise(fsPath, { withFileTypes: true })
  },

  async unlink(fsPath) {
    return unlinkPromise(fsPath)
  },

  async rmdir(fsPath) {
    return rmdirPromise(fsPath)
  },

  async rm(fsPath, options) {
    return rmPromise(fsPath, options)
  },

  async mkdir(dirPath, options) {
    try {
      await mkdirPromise(dirPath, { recursive: true, ...options })
    } catch (e) {
      // Bun/Windows: recursive:true throws EEXIST on directories with the
      
      
      
      
      if (getErrnoCode(e) !== 'EEXIST') throw e
    }
  },

  async readFile(fsPath, options) {
    return readFilePromise(fsPath, { encoding: options.encoding })
  },

  async rename(oldPath, newPath) {
    return renamePromise(oldPath, newPath)
  },

  statSync(fsPath) {
    using _ = slowLogging`fs.statSync(${fsPath})`
    return fs.statSync(fsPath)
  },

  lstatSync(fsPath) {
    using _ = slowLogging`fs.lstatSync(${fsPath})`
    return fs.lstatSync(fsPath)
  },

  readFileSync(fsPath, options) {
    using _ = slowLogging`fs.readFileSync(${fsPath})`
    return fs.readFileSync(fsPath, { encoding: options.encoding })
  },

  readFileBytesSync(fsPath) {
    using _ = slowLogging`fs.readFileBytesSync(${fsPath})`
    return fs.readFileSync(fsPath)
  },

  readSync(fsPath, options) {
    using _ = slowLogging`fs.readSync(${fsPath}, ${options.length} bytes)`
    let fd: number | undefined = undefined
    try {
      fd = fs.openSync(fsPath, 'r')
      const buffer = Buffer.alloc(options.length)
      const bytesRead = fs.readSync(fd, buffer, 0, options.length, 0)
      return { buffer, bytesRead }
    } finally {
      if (fd) fs.closeSync(fd)
    }
  },

  appendFileSync(path, data, options) {
    using _ = slowLogging`fs.appendFileSync(${path}, ${data.length} chars)`
    
    
    if (options?.mode !== undefined) {
      try {
        const fd = fs.openSync(path, 'ax', options.mode)
        try {
          fs.appendFileSync(fd, data)
        } finally {
          fs.closeSync(fd)
        }
        return
      } catch (e) {
        if (getErrnoCode(e) !== 'EEXIST') throw e
        
      }
    }
    fs.appendFileSync(path, data)
  },

  copyFileSync(src, dest) {
    using _ = slowLogging`fs.copyFileSync(${src} → ${dest})`
    fs.copyFileSync(src, dest)
  },

  unlinkSync(path: string) {
    using _ = slowLogging`fs.unlinkSync(${path})`
    fs.unlinkSync(path)
  },

  renameSync(oldPath: string, newPath: string) {
    using _ = slowLogging`fs.renameSync(${oldPath} → ${newPath})`
    fs.renameSync(oldPath, newPath)
  },

  linkSync(target: string, path: string) {
    using _ = slowLogging`fs.linkSync(${target} → ${path})`
    fs.linkSync(target, path)
  },

  symlinkSync(
    target: string,
    path: string,
    type?: 'dir' | 'file' | 'junction',
  ) {
    using _ = slowLogging`fs.symlinkSync(${target} → ${path})`
    fs.symlinkSync(target, path, type)
  },

  readlinkSync(path: string) {
    using _ = slowLogging`fs.readlinkSync(${path})`
    return fs.readlinkSync(path)
  },

  realpathSync(path: string) {
    using _ = slowLogging`fs.realpathSync(${path})`
    return fs.realpathSync(path).normalize('NFC')
  },

  mkdirSync(dirPath, options) {
    using _ = slowLogging`fs.mkdirSync(${dirPath})`
    const mkdirOptions: { recursive: boolean; mode?: number } = {
      recursive: true,
    }
    if (options?.mode !== undefined) {
      mkdirOptions.mode = options.mode
    }
    try {
      fs.mkdirSync(dirPath, mkdirOptions)
    } catch (e) {
      // Bun/Windows: recursive:true throws EEXIST on directories with the
      
      
      
      
      if (getErrnoCode(e) !== 'EEXIST') throw e
    }
  },

  readdirSync(dirPath) {
    using _ = slowLogging`fs.readdirSync(${dirPath})`
    return fs.readdirSync(dirPath, { withFileTypes: true })
  },

  readdirStringSync(dirPath) {
    using _ = slowLogging`fs.readdirStringSync(${dirPath})`
    return fs.readdirSync(dirPath)
  },

  isDirEmptySync(dirPath) {
    using _ = slowLogging`fs.isDirEmptySync(${dirPath})`
    const files = this.readdirSync(dirPath)
    return files.length === 0
  },

  rmdirSync(dirPath) {
    using _ = slowLogging`fs.rmdirSync(${dirPath})`
    fs.rmdirSync(dirPath)
  },

  rmSync(path, options) {
    using _ = slowLogging`fs.rmSync(${path})`
    fs.rmSync(path, options)
  },

  createWriteStream(path: string) {
    return fs.createWriteStream(path)
  },

  async readFileBytes(fsPath: string, maxBytes?: number) {
    if (maxBytes === undefined) {
      return readFilePromise(fsPath)
    }
    const handle = await open(fsPath, 'r')
    try {
      const { size } = await handle.stat()
      const readSize = Math.min(size, maxBytes)
      const buffer = Buffer.allocUnsafe(readSize)
      let offset = 0
      while (offset < readSize) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          readSize - offset,
          offset,
        )
        if (bytesRead === 0) break
        offset += bytesRead
      }
      return offset < readSize ? buffer.subarray(0, offset) : buffer
    } finally {
      await handle.close()
    }
  },
}

// The currently active filesystem implementation
let activeFs: FsOperations = NodeFsOperations

export function setFsImplementation(implementation: FsOperations): void {
  activeFs = implementation
}

/**
 * Gets the currently active filesystem implementation
 * @returns The currently active filesystem implementation
 */
export function getFsImplementation(): FsOperations {
  return activeFs
}

/**
 * Resets the filesystem implementation to the default Node.js implementation.
 * Note: This function does not automatically update cwd.
 */
export function setOriginalFsImplementation(): void {
  activeFs = NodeFsOperations
}

export type ReadFileRangeResult = {
  content: string
  bytesRead: number
  bytesTotal: number
}

/**
 * Read up to `maxBytes` from a file starting at `offset`.
 * Returns a flat string from Buffer — no sliced string references to a
 * larger parent. Returns null if the file is smaller than the offset.
 */
export async function readFileRange(
  path: string,
  offset: number,
  maxBytes: number,
): Promise<ReadFileRangeResult | null> {
  await using fh = await open(path, 'r')
  const size = (await fh.stat()).size
  if (size <= offset) {
    return null
  }
  const bytesToRead = Math.min(size - offset, maxBytes)
  const buffer = Buffer.allocUnsafe(bytesToRead)

  let totalRead = 0
  while (totalRead < bytesToRead) {
    const { bytesRead } = await fh.read(
      buffer,
      totalRead,
      bytesToRead - totalRead,
      offset + totalRead,
    )
    if (bytesRead === 0) {
      break
    }
    totalRead += bytesRead
  }

  return {
    content: buffer.toString('utf8', 0, totalRead),
    bytesRead: totalRead,
    bytesTotal: size,
  }
}

/**
 * Read the last `maxBytes` of a file.
 * Returns the whole file if it's smaller than maxBytes.
 */
export async function tailFile(
  path: string,
  maxBytes: number,
): Promise<ReadFileRangeResult> {
  await using fh = await open(path, 'r')
  const size = (await fh.stat()).size
  if (size === 0) {
    return { content: '', bytesRead: 0, bytesTotal: 0 }
  }
  const offset = Math.max(0, size - maxBytes)
  const bytesToRead = size - offset
  const buffer = Buffer.allocUnsafe(bytesToRead)

  let totalRead = 0
  while (totalRead < bytesToRead) {
    const { bytesRead } = await fh.read(
      buffer,
      totalRead,
      bytesToRead - totalRead,
      offset + totalRead,
    )
    if (bytesRead === 0) {
      break
    }
    totalRead += bytesRead
  }

  return {
    content: buffer.toString('utf8', 0, totalRead),
    bytesRead: totalRead,
    bytesTotal: size,
  }
}

/**
 * Async generator that yields lines from a file in reverse order.
 * Reads the file backwards in chunks to avoid loading the entire file into memory.
 * @param path - The path to the file to read
 * @returns An async generator that yields lines in reverse order
 */
export async function* readLinesReverse(
  path: string,
): AsyncGenerator<string, void, undefined> {
  const CHUNK_SIZE = 1024 * 4
  const fileHandle = await open(path, 'r')
  try {
    const stats = await fileHandle.stat()
    let position = stats.size
    
    
    
    // which for history.jsonl means JSON.parse throws and the entry is dropped.
    let remainder = Buffer.alloc(0)
    const buffer = Buffer.alloc(CHUNK_SIZE)

    while (position > 0) {
      const currentChunkSize = Math.min(CHUNK_SIZE, position)
      position -= currentChunkSize

      await fileHandle.read(buffer, 0, currentChunkSize, position)
      const combined = Buffer.concat([
        buffer.subarray(0, currentChunkSize),
        remainder,
      ])

      const firstNewline = combined.indexOf(0x0a)
      if (firstNewline === -1) {
        remainder = combined
        continue
      }

      remainder = Buffer.from(combined.subarray(0, firstNewline))
      const lines = combined.toString('utf8', firstNewline + 1).split('\n')

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!
        if (line) {
          yield line
        }
      }
    }

    if (remainder.length > 0) {
      yield remainder.toString('utf8')
    }
  } finally {
    await fileHandle.close()
  }
}
