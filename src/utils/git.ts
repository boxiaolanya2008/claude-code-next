import { createHash } from 'crypto'
import { readFileSync, realpathSync, statSync } from 'fs'
import { open, readFile, realpath, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { basename, dirname, join, resolve, sep } from 'path'
import { hasBinaryExtension, isBinaryContent } from '../constants/files.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  getCachedBranch,
  getCachedDefaultBranch,
  getCachedHead,
  getCachedRemoteUrl,
  getWorktreeCountFromFs,
  isShallowClone as isShallowCloneFs,
  resolveGitDir,
} from './git/gitFilesystem.js'
import { logError } from './log.js'
import { memoizeWithLRU } from './memoize.js'
import { whichSync } from './which.js'

const GIT_ROOT_NOT_FOUND = Symbol('git-root-not-found')

const findGitRootImpl = memoizeWithLRU(
  (startPath: string): string | typeof GIT_ROOT_NOT_FOUND => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'find_git_root_started')

    let current = resolve(startPath)
    const root = current.substring(0, current.indexOf(sep) + 1) || sep
    let statCount = 0

    while (current !== root) {
      try {
        const gitPath = join(current, '.git')
        statCount++
        const stat = statSync(gitPath)
        
        if (stat.isDirectory() || stat.isFile()) {
          logForDiagnosticsNoPII('info', 'find_git_root_completed', {
            duration_ms: Date.now() - startTime,
            stat_count: statCount,
            found: true,
          })
          return current.normalize('NFC')
        }
      } catch {
        
      }
      const parent = dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }

    
    try {
      const gitPath = join(root, '.git')
      statCount++
      const stat = statSync(gitPath)
      if (stat.isDirectory() || stat.isFile()) {
        logForDiagnosticsNoPII('info', 'find_git_root_completed', {
          duration_ms: Date.now() - startTime,
          stat_count: statCount,
          found: true,
        })
        return root.normalize('NFC')
      }
    } catch {
      
    }

    logForDiagnosticsNoPII('info', 'find_git_root_completed', {
      duration_ms: Date.now() - startTime,
      stat_count: statCount,
      found: false,
    })
    return GIT_ROOT_NOT_FOUND
  },
  path => path,
  50,
)

export const findGitRoot = createFindGitRoot()

function createFindGitRoot(): {
  (startPath: string): string | null
  cache: typeof findGitRootImpl.cache
} {
  function wrapper(startPath: string): string | null {
    const result = findGitRootImpl(startPath)
    return result === GIT_ROOT_NOT_FOUND ? null : result
  }
  wrapper.cache = findGitRootImpl.cache
  return wrapper
}

const resolveCanonicalRoot = memoizeWithLRU(
  (gitRoot: string): string => {
    try {
      
      
      const gitContent = readFileSync(join(gitRoot, '.git'), 'utf-8').trim()
      if (!gitContent.startsWith('gitdir:')) {
        return gitRoot
      }
      const worktreeGitDir = resolve(
        gitRoot,
        gitContent.slice('gitdir:'.length).trim(),
      )
      
      
      const commonDir = resolve(
        worktreeGitDir,
        readFileSync(join(worktreeGitDir, 'commondir'), 'utf-8').trim(),
      )
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      if (resolve(dirname(worktreeGitDir)) !== join(commonDir, 'worktrees')) {
        return gitRoot
      }
      
      
      
      
      
      
      const backlink = realpathSync(
        readFileSync(join(worktreeGitDir, 'gitdir'), 'utf-8').trim(),
      )
      if (backlink !== join(realpathSync(gitRoot), '.git')) {
        return gitRoot
      }
      
      
      if (basename(commonDir) !== '.git') {
        return commonDir.normalize('NFC')
      }
      return dirname(commonDir).normalize('NFC')
    } catch {
      return gitRoot
    }
  },
  root => root,
  50,
)

export const findCanonicalGitRoot = createFindCanonicalGitRoot()

function createFindCanonicalGitRoot(): {
  (startPath: string): string | null
  cache: typeof resolveCanonicalRoot.cache
} {
  function wrapper(startPath: string): string | null {
    const root = findGitRoot(startPath)
    if (!root) {
      return null
    }
    return resolveCanonicalRoot(root)
  }
  wrapper.cache = resolveCanonicalRoot.cache
  return wrapper
}

export const gitExe = memoize((): string => {
  
  
  return whichSync('git') || 'git'
})

export const getIsGit = memoize(async (): Promise<boolean> => {
  const startTime = Date.now()
  logForDiagnosticsNoPII('info', 'is_git_check_started')

  const isGit = findGitRoot(getCwd()) !== null

  logForDiagnosticsNoPII('info', 'is_git_check_completed', {
    duration_ms: Date.now() - startTime,
    is_git: isGit,
  })
  return isGit
})

export function getGitDir(cwd: string): Promise<string | null> {
  return resolveGitDir(cwd)
}

export async function isAtGitRoot(): Promise<boolean> {
  const cwd = getCwd()
  const gitRoot = findGitRoot(cwd)
  if (!gitRoot) {
    return false
  }
  
  try {
    const [resolvedCwd, resolvedGitRoot] = await Promise.all([
      realpath(cwd),
      realpath(gitRoot),
    ])
    return resolvedCwd === resolvedGitRoot
  } catch {
    return cwd === gitRoot
  }
}

export const dirIsInGitRepo = async (cwd: string): Promise<boolean> => {
  return findGitRoot(cwd) !== null
}

export const getHead = async (): Promise<string> => {
  return getCachedHead()
}

export const getBranch = async (): Promise<string> => {
  return getCachedBranch()
}

export const getDefaultBranch = async (): Promise<string> => {
  return getCachedDefaultBranch()
}

export const getRemoteUrl = async (): Promise<string | null> => {
  return getCachedRemoteUrl()
}

export function normalizeGitRemoteUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  
  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase()
  }

  
  const urlMatch = trimmed.match(
    /^(?:https?|ssh):\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/,
  )
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    const host = urlMatch[1]
    const path = urlMatch[2]

    
    
    
    
    
    if (isLocalHost(host) && path.startsWith('git/')) {
      const proxyPath = path.slice(4) 
      const segments = proxyPath.split('/')
      
      if (segments.length >= 3 && segments[0]!.includes('.')) {
        return proxyPath.toLowerCase()
      }
      
      return `github.com/${proxyPath}`.toLowerCase()
    }

    return `${host}/${path}`.toLowerCase()
  }

  return null
}

export async function getRepoRemoteHash(): Promise<string | null> {
  const remoteUrl = await getRemoteUrl()
  if (!remoteUrl) return null

  const normalized = normalizeGitRemoteUrl(remoteUrl)
  if (!normalized) return null

  const hash = createHash('sha256').update(normalized).digest('hex')
  return hash.substring(0, 16)
}

export const getIsHeadOnRemote = async (): Promise<boolean> => {
  const { code } = await execFileNoThrow(gitExe(), ['rev-parse', '@{u}'], {
    preserveOutputOnError: false,
  })
  return code === 0
}

export const hasUnpushedCommits = async (): Promise<boolean> => {
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['rev-list', '--count', '@{u}..HEAD'],
    { preserveOutputOnError: false },
  )
  return code === 0 && parseInt(stdout.trim(), 10) > 0
}

export const getIsClean = async (options?: {
  ignoreUntracked?: boolean
}): Promise<boolean> => {
  const args = ['--no-optional-locks', 'status', '--porcelain']
  if (options?.ignoreUntracked) {
    args.push('-uno')
  }
  const { stdout } = await execFileNoThrow(gitExe(), args, {
    preserveOutputOnError: false,
  })
  return stdout.trim().length === 0
}

export const getChangedFiles = async (): Promise<string[]> => {
  const { stdout } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'status', '--porcelain'],
    {
      preserveOutputOnError: false,
    },
  )
  return stdout
    .trim()
    .split('\n')
    .map(line => line.trim().split(' ', 2)[1]?.trim()) 
    .filter(line => typeof line === 'string') 
}

export type GitFileStatus = {
  tracked: string[]
  untracked: string[]
}

export const getFileStatus = async (): Promise<GitFileStatus> => {
  const { stdout } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'status', '--porcelain'],
    {
      preserveOutputOnError: false,
    },
  )

  const tracked: string[] = []
  const untracked: string[] = []

  stdout
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .forEach(line => {
      const status = line.substring(0, 2)
      const filename = line.substring(2).trim()

      if (status === '??') {
        untracked.push(filename)
      } else if (filename) {
        tracked.push(filename)
      }
    })

  return { tracked, untracked }
}

export const getWorktreeCount = async (): Promise<number> => {
  return getWorktreeCountFromFs()
}

export const stashToCleanState = async (message?: string): Promise<boolean> => {
  try {
    const stashMessage =
      message || `Claude Code Next auto-stash - ${new Date().toISOString()}`

    
    const { untracked } = await getFileStatus()

    
    
    if (untracked.length > 0) {
      const { code: addCode } = await execFileNoThrow(
        gitExe(),
        ['add', ...untracked],
        { preserveOutputOnError: false },
      )

      if (addCode !== 0) {
        return false
      }
    }

    
    const { code } = await execFileNoThrow(
      gitExe(),
      ['stash', 'push', '--message', stashMessage],
      { preserveOutputOnError: false },
    )
    return code === 0
  } catch (_) {
    return false
  }
}

export type GitRepoState = {
  commitHash: string
  branchName: string
  remoteUrl: string | null
  isHeadOnRemote: boolean
  isClean: boolean
  worktreeCount: number
}

export async function getGitState(): Promise<GitRepoState | null> {
  try {
    const [
      commitHash,
      branchName,
      remoteUrl,
      isHeadOnRemote,
      isClean,
      worktreeCount,
    ] = await Promise.all([
      getHead(),
      getBranch(),
      getRemoteUrl(),
      getIsHeadOnRemote(),
      getIsClean(),
      getWorktreeCount(),
    ])

    return {
      commitHash,
      branchName,
      remoteUrl,
      isHeadOnRemote,
      isClean,
      worktreeCount,
    }
  } catch (_) {
    
    return null
  }
}

export async function getGithubRepo(): Promise<string | null> {
  const { parseGitRemote } = await import('./detectRepository.js')
  const remoteUrl = await getRemoteUrl()
  if (!remoteUrl) {
    logForDebugging('Local GitHub repo: unknown')
    return null
  }
  
  
  const parsed = parseGitRemote(remoteUrl)
  if (parsed && parsed.host === 'github.com') {
    const result = `${parsed.owner}/${parsed.name}`
    logForDebugging(`Local GitHub repo: ${result}`)
    return result
  }
  logForDebugging('Local GitHub repo: unknown')
  return null
}

export type PreservedGitState = {
  
  remote_base_sha: string | null
  
  remote_base: string | null
  
  patch: string
  
  untracked_files: Array<{ path: string; content: string }>
  

  format_patch: string | null
  
  head_sha: string | null
  
  branch_name: string | null
}

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024 
const MAX_TOTAL_SIZE_BYTES = 5 * 1024 * 1024 * 1024 
const MAX_FILE_COUNT = 20000

const SNIFF_BUFFER_SIZE = 64 * 1024

export async function findRemoteBase(): Promise<string | null> {
  
  const { stdout: trackingBranch, code: trackingCode } = await execFileNoThrow(
    gitExe(),
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    { preserveOutputOnError: false },
  )

  if (trackingCode === 0 && trackingBranch.trim()) {
    return trackingBranch.trim()
  }

  
  const { stdout: remoteRefs, code: remoteCode } = await execFileNoThrow(
    gitExe(),
    ['remote', 'show', 'origin', '--', 'HEAD'],
    { preserveOutputOnError: false },
  )

  if (remoteCode === 0) {
    
    const match = remoteRefs.match(/HEAD branch: (\S+)/)
    if (match && match[1]) {
      return `origin/${match[1]}`
    }
  }

  
  const candidates = ['origin/main', 'origin/staging', 'origin/master']
  for (const candidate of candidates) {
    const { code } = await execFileNoThrow(
      gitExe(),
      ['rev-parse', '--verify', candidate],
      { preserveOutputOnError: false },
    )
    if (code === 0) {
      return candidate
    }
  }

  return null
}

function isShallowClone(): Promise<boolean> {
  return isShallowCloneFs()
}

async function captureUntrackedFiles(): Promise<
  Array<{ path: string; content: string }>
> {
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['ls-files', '--others', '--exclude-standard'],
    { preserveOutputOnError: false },
  )

  const trimmed = stdout.trim()
  if (code !== 0 || !trimmed) {
    return []
  }

  const files = trimmed.split('\n').filter(Boolean)
  const result: Array<{ path: string; content: string }> = []
  let totalSize = 0

  for (const filePath of files) {
    
    if (result.length >= MAX_FILE_COUNT) {
      logForDebugging(
        `Untracked file capture: reached max file count (${MAX_FILE_COUNT})`,
      )
      break
    }

    
    if (hasBinaryExtension(filePath)) {
      continue
    }

    try {
      const stats = await stat(filePath)
      const fileSize = stats.size

      
      if (fileSize > MAX_FILE_SIZE_BYTES) {
        logForDebugging(
          `Untracked file capture: skipping ${filePath} (exceeds ${MAX_FILE_SIZE_BYTES} bytes)`,
        )
        continue
      }

      
      if (totalSize + fileSize > MAX_TOTAL_SIZE_BYTES) {
        logForDebugging(
          `Untracked file capture: reached total size limit (${MAX_TOTAL_SIZE_BYTES} bytes)`,
        )
        break
      }

      
      if (fileSize === 0) {
        result.push({ path: filePath, content: '' })
        continue
      }

      
      
      
      
      
      const sniffSize = Math.min(SNIFF_BUFFER_SIZE, fileSize)
      const fd = await open(filePath, 'r')
      try {
        const sniffBuf = Buffer.alloc(sniffSize)
        const { bytesRead } = await fd.read(sniffBuf, 0, sniffSize, 0)
        const sniff = sniffBuf.subarray(0, bytesRead)

        if (isBinaryContent(sniff)) {
          continue
        }

        let content: string
        if (fileSize <= sniffSize) {
          
          content = sniff.toString('utf-8')
        } else {
          
          
          
          content = await readFile(filePath, 'utf-8')
        }

        result.push({ path: filePath, content })
        totalSize += fileSize
      } finally {
        await fd.close()
      }
    } catch (err) {
      
      logForDebugging(`Failed to read untracked file ${filePath}: ${err}`)
    }
  }

  return result
}

export async function preserveGitStateForIssue(): Promise<PreservedGitState | null> {
  try {
    const isGit = await getIsGit()
    if (!isGit) {
      return null
    }

    
    if (await isShallowClone()) {
      logForDebugging('Shallow clone detected, using HEAD-only mode for issue')
      const [{ stdout: patch }, untrackedFiles] = await Promise.all([
        execFileNoThrow(gitExe(), ['diff', 'HEAD']),
        captureUntrackedFiles(),
      ])
      return {
        remote_base_sha: null,
        remote_base: null,
        patch: patch || '',
        untracked_files: untrackedFiles,
        format_patch: null,
        head_sha: null,
        branch_name: null,
      }
    }

    
    const remoteBase = await findRemoteBase()

    if (!remoteBase) {
      
      logForDebugging('No remote found, using HEAD-only mode for issue')
      const [{ stdout: patch }, untrackedFiles] = await Promise.all([
        execFileNoThrow(gitExe(), ['diff', 'HEAD']),
        captureUntrackedFiles(),
      ])
      return {
        remote_base_sha: null,
        remote_base: null,
        patch: patch || '',
        untracked_files: untrackedFiles,
        format_patch: null,
        head_sha: null,
        branch_name: null,
      }
    }

    
    const { stdout: mergeBase, code: mergeBaseCode } = await execFileNoThrow(
      gitExe(),
      ['merge-base', 'HEAD', remoteBase],
      { preserveOutputOnError: false },
    )

    if (mergeBaseCode !== 0 || !mergeBase.trim()) {
      
      logForDebugging('Merge-base failed, using HEAD-only mode for issue')
      const [{ stdout: patch }, untrackedFiles] = await Promise.all([
        execFileNoThrow(gitExe(), ['diff', 'HEAD']),
        captureUntrackedFiles(),
      ])
      return {
        remote_base_sha: null,
        remote_base: null,
        patch: patch || '',
        untracked_files: untrackedFiles,
        format_patch: null,
        head_sha: null,
        branch_name: null,
      }
    }

    const remoteBaseSha = mergeBase.trim()

    
    
    const [
      { stdout: patch },
      untrackedFiles,
      { stdout: formatPatchOut, code: formatPatchCode },
      { stdout: headSha },
      { stdout: branchName },
    ] = await Promise.all([
      
      execFileNoThrow(gitExe(), ['diff', remoteBaseSha]),
      
      captureUntrackedFiles(),
      
      
      
      
      execFileNoThrow(gitExe(), [
        'format-patch',
        `${remoteBaseSha}..HEAD`,
        '--stdout',
      ]),
      
      execFileNoThrow(gitExe(), ['rev-parse', 'HEAD']),
      
      execFileNoThrow(gitExe(), ['rev-parse', '--abbrev-ref', 'HEAD']),
    ])

    let formatPatch: string | null = null
    if (formatPatchCode === 0 && formatPatchOut && formatPatchOut.trim()) {
      formatPatch = formatPatchOut
    }

    const trimmedBranch = branchName?.trim()
    return {
      remote_base_sha: remoteBaseSha,
      remote_base: remoteBase,
      patch: patch || '',
      untracked_files: untrackedFiles,
      format_patch: formatPatch,
      head_sha: headSha?.trim() || null,
      branch_name:
        trimmedBranch && trimmedBranch !== 'HEAD' ? trimmedBranch : null,
    }
  } catch (err) {
    logError(err)
    return null
  }
}

function isLocalHost(host: string): boolean {
  const hostWithoutPort = host.split(':')[0] ?? ''
  return (
    hostWithoutPort === 'localhost' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostWithoutPort)
  )
}

export function isCurrentDirectoryBareGitRepo(): boolean {
  const fs = getFsImplementation()
  const cwd = getCwd()

  const gitPath = join(cwd, '.git')
  try {
    const stats = fs.statSync(gitPath)
    if (stats.isFile()) {
      
      return false
    }
    if (stats.isDirectory()) {
      const gitHeadPath = join(gitPath, 'HEAD')
      try {
        
        
        
        if (fs.statSync(gitHeadPath).isFile()) {
          
          return false
        }
        
      } catch {
        
      }
    }
  } catch {
    
  }

  
  
  
  try {
    if (fs.statSync(join(cwd, 'HEAD')).isFile()) return true
  } catch {
    
  }
  try {
    if (fs.statSync(join(cwd, 'objects')).isDirectory()) return true
  } catch {
    
  }
  try {
    if (fs.statSync(join(cwd, 'refs')).isDirectory()) return true
  } catch {
    
  }
  return false
}

