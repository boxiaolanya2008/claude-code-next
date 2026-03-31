

import { unwatchFile, watchFile } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { waitForScrollIdle } from '../../bootstrap/state.js'
import { registerCleanup } from '../cleanupRegistry.js'
import { getCwd } from '../cwd.js'
import { findGitRoot } from '../git.js'
import { parseGitConfigValue } from './gitConfigParser.js'

const resolveGitDirCache = new Map<string, string | null>()

export function clearResolveGitDirCache(): void {
  resolveGitDirCache.clear()
}

export async function resolveGitDir(
  startPath?: string,
): Promise<string | null> {
  const cwd = resolve(startPath ?? getCwd())
  const cached = resolveGitDirCache.get(cwd)
  if (cached !== undefined) {
    return cached
  }

  const root = findGitRoot(cwd)
  if (!root) {
    resolveGitDirCache.set(cwd, null)
    return null
  }

  const gitPath = join(root, '.git')
  try {
    const st = await stat(gitPath)
    if (st.isFile()) {
      
      
      const content = (await readFile(gitPath, 'utf-8')).trim()
      if (content.startsWith('gitdir:')) {
        const rawDir = content.slice('gitdir:'.length).trim()
        const resolved = resolve(root, rawDir)
        resolveGitDirCache.set(cwd, resolved)
        return resolved
      }
    }
    
    resolveGitDirCache.set(cwd, gitPath)
    return gitPath
  } catch {
    resolveGitDirCache.set(cwd, null)
    return null
  }
}

export function isSafeRefName(name: string): boolean {
  if (!name || name.startsWith('-') || name.startsWith('/')) {
    return false
  }
  if (name.includes('..')) {
    return false
  }
  
  
  
  
  if (name.split('/').some(c => c === '.' || c === '')) {
    return false
  }
  
  
  
  if (!/^[a-zA-Z0-9/._+@-]+$/.test(name)) {
    return false
  }
  return true
}

export function isValidGitSha(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s) || /^[0-9a-f]{64}$/.test(s)
}

export async function readGitHead(
  gitDir: string,
): Promise<
  { type: 'branch'; name: string } | { type: 'detached'; sha: string } | null
> {
  try {
    const content = (await readFile(join(gitDir, 'HEAD'), 'utf-8')).trim()
    if (content.startsWith('ref:')) {
      const ref = content.slice('ref:'.length).trim()
      if (ref.startsWith('refs/heads/')) {
        const name = ref.slice('refs/heads/'.length)
        
        if (!isSafeRefName(name)) {
          return null
        }
        return { type: 'branch', name }
      }
      
      if (!isSafeRefName(ref)) {
        return null
      }
      const sha = await resolveRef(gitDir, ref)
      return sha ? { type: 'detached', sha } : { type: 'detached', sha: '' }
    }
    
    
    
    if (!isValidGitSha(content)) {
      return null
    }
    return { type: 'detached', sha: content }
  } catch {
    return null
  }
}

export async function resolveRef(
  gitDir: string,
  ref: string,
): Promise<string | null> {
  const result = await resolveRefInDir(gitDir, ref)
  if (result) {
    return result
  }

  
  const commonDir = await getCommonDir(gitDir)
  if (commonDir && commonDir !== gitDir) {
    return resolveRefInDir(commonDir, ref)
  }

  return null
}

async function resolveRefInDir(
  dir: string,
  ref: string,
): Promise<string | null> {
  
  try {
    const content = (await readFile(join(dir, ref), 'utf-8')).trim()
    if (content.startsWith('ref:')) {
      const target = content.slice('ref:'.length).trim()
      
      if (!isSafeRefName(target)) {
        return null
      }
      return resolveRef(dir, target)
    }
    
    
    if (!isValidGitSha(content)) {
      return null
    }
    return content
  } catch {
    
  }

  try {
    const packed = await readFile(join(dir, 'packed-refs'), 'utf-8')
    for (const line of packed.split('\n')) {
      if (line.startsWith('#') || line.startsWith('^')) {
        continue
      }
      const spaceIdx = line.indexOf(' ')
      if (spaceIdx === -1) {
        continue
      }
      if (line.slice(spaceIdx + 1) === ref) {
        const sha = line.slice(0, spaceIdx)
        return isValidGitSha(sha) ? sha : null
      }
    }
  } catch {
    
  }

  return null
}

export async function getCommonDir(gitDir: string): Promise<string | null> {
  try {
    const content = (await readFile(join(gitDir, 'commondir'), 'utf-8')).trim()
    return resolve(gitDir, content)
  } catch {
    return null
  }
}

export async function readRawSymref(
  gitDir: string,
  refPath: string,
  branchPrefix: string,
): Promise<string | null> {
  try {
    const content = (await readFile(join(gitDir, refPath), 'utf-8')).trim()
    if (content.startsWith('ref:')) {
      const target = content.slice('ref:'.length).trim()
      if (target.startsWith(branchPrefix)) {
        const name = target.slice(branchPrefix.length)
        
        if (!isSafeRefName(name)) {
          return null
        }
        return name
      }
    }
  } catch {
    
  }
  return null
}

type CacheEntry<T> = {
  value: T
  dirty: boolean
  compute: () => Promise<T>
}

const WATCH_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 10 : 1000

class GitFileWatcher {
  private gitDir: string | null = null
  private commonDir: string | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private watchedPaths: string[] = []
  private branchRefPath: string | null = null
  private cache = new Map<string, CacheEntry<unknown>>()

  async ensureStarted(): Promise<void> {
    if (this.initialized) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.start()
    return this.initPromise
  }

  private async start(): Promise<void> {
    this.gitDir = await resolveGitDir()
    this.initialized = true
    if (!this.gitDir) {
      return
    }

    
    
    
    this.commonDir = await getCommonDir(this.gitDir)

    
    this.watchPath(join(this.gitDir, 'HEAD'), () => {
      void this.onHeadChanged()
    })
    
    this.watchPath(join(this.commonDir ?? this.gitDir, 'config'), () => {
      this.invalidate()
    })

    
    await this.watchCurrentBranchRef()

    registerCleanup(async () => {
      this.stopWatching()
    })
  }

  private watchPath(path: string, callback: () => void): void {
    this.watchedPaths.push(path)
    watchFile(path, { interval: WATCH_INTERVAL_MS }, callback)
  }

  

  private async watchCurrentBranchRef(): Promise<void> {
    if (!this.gitDir) {
      return
    }

    const head = await readGitHead(this.gitDir)
    
    const refsDir = this.commonDir ?? this.gitDir
    const refPath =
      head?.type === 'branch' ? join(refsDir, 'refs', 'heads', head.name) : null

    
    if (refPath === this.branchRefPath) {
      return
    }

    
    
    if (this.branchRefPath) {
      unwatchFile(this.branchRefPath)
      this.watchedPaths = this.watchedPaths.filter(
        p => p !== this.branchRefPath,
      )
    }

    this.branchRefPath = refPath

    if (!refPath) {
      return
    }

    
    
    this.watchPath(refPath, () => {
      this.invalidate()
    })
  }

  private async onHeadChanged(): Promise<void> {
    
    
    
    
    
    this.invalidate()
    await waitForScrollIdle()
    await this.watchCurrentBranchRef()
  }

  private invalidate(): void {
    for (const entry of this.cache.values()) {
      entry.dirty = true
    }
  }

  private stopWatching(): void {
    for (const path of this.watchedPaths) {
      unwatchFile(path)
    }
    this.watchedPaths = []
    this.branchRefPath = null
  }

  

  async get<T>(key: string, compute: () => Promise<T>): Promise<T> {
    await this.ensureStarted()
    const existing = this.cache.get(key)
    if (existing && !existing.dirty) {
      return existing.value as T
    }
    
    
    
    if (existing) {
      existing.dirty = false
    }
    const value = await compute()
    
    const entry = this.cache.get(key)
    if (entry && !entry.dirty) {
      entry.value = value
    }
    if (!entry) {
      this.cache.set(key, { value, dirty: false, compute })
    }
    return value
  }

  
  reset(): void {
    this.stopWatching()
    this.cache.clear()
    this.initialized = false
    this.initPromise = null
    this.gitDir = null
    this.commonDir = null
  }
}

const gitWatcher = new GitFileWatcher()

async function computeBranch(): Promise<string> {
  const gitDir = await resolveGitDir()
  if (!gitDir) {
    return 'HEAD'
  }
  const head = await readGitHead(gitDir)
  if (!head) {
    return 'HEAD'
  }
  return head.type === 'branch' ? head.name : 'HEAD'
}

async function computeHead(): Promise<string> {
  const gitDir = await resolveGitDir()
  if (!gitDir) {
    return ''
  }
  const head = await readGitHead(gitDir)
  if (!head) {
    return ''
  }
  if (head.type === 'branch') {
    return (await resolveRef(gitDir, `refs/heads/${head.name}`)) ?? ''
  }
  return head.sha
}

async function computeRemoteUrl(): Promise<string | null> {
  const gitDir = await resolveGitDir()
  if (!gitDir) {
    return null
  }
  const url = await parseGitConfigValue(gitDir, 'remote', 'origin', 'url')
  if (url) {
    return url
  }
  
  const commonDir = await getCommonDir(gitDir)
  if (commonDir && commonDir !== gitDir) {
    return parseGitConfigValue(commonDir, 'remote', 'origin', 'url')
  }
  return null
}

async function computeDefaultBranch(): Promise<string> {
  const gitDir = await resolveGitDir()
  if (!gitDir) {
    return 'main'
  }
  
  const commonDir = (await getCommonDir(gitDir)) ?? gitDir
  const branchFromSymref = await readRawSymref(
    commonDir,
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/',
  )
  if (branchFromSymref) {
    return branchFromSymref
  }
  for (const candidate of ['main', 'master']) {
    const sha = await resolveRef(commonDir, `refs/remotes/origin/${candidate}`)
    if (sha) {
      return candidate
    }
  }
  return 'main'
}

export function getCachedBranch(): Promise<string> {
  return gitWatcher.get('branch', computeBranch)
}

export function getCachedHead(): Promise<string> {
  return gitWatcher.get('head', computeHead)
}

export function getCachedRemoteUrl(): Promise<string | null> {
  return gitWatcher.get('remoteUrl', computeRemoteUrl)
}

export function getCachedDefaultBranch(): Promise<string> {
  return gitWatcher.get('defaultBranch', computeDefaultBranch)
}

export function resetGitFileWatcher(): void {
  gitWatcher.reset()
}

export async function getHeadForDir(cwd: string): Promise<string | null> {
  const gitDir = await resolveGitDir(cwd)
  if (!gitDir) {
    return null
  }
  const head = await readGitHead(gitDir)
  if (!head) {
    return null
  }
  if (head.type === 'branch') {
    return resolveRef(gitDir, `refs/heads/${head.name}`)
  }
  return head.sha
}

export async function readWorktreeHeadSha(
  worktreePath: string,
): Promise<string | null> {
  let gitDir: string
  try {
    const ptr = (await readFile(join(worktreePath, '.git'), 'utf-8')).trim()
    if (!ptr.startsWith('gitdir:')) {
      return null
    }
    gitDir = resolve(worktreePath, ptr.slice('gitdir:'.length).trim())
  } catch {
    return null
  }
  const head = await readGitHead(gitDir)
  if (!head) {
    return null
  }
  if (head.type === 'branch') {
    return resolveRef(gitDir, `refs/heads/${head.name}`)
  }
  return head.sha
}

export async function getRemoteUrlForDir(cwd: string): Promise<string | null> {
  const gitDir = await resolveGitDir(cwd)
  if (!gitDir) {
    return null
  }
  const url = await parseGitConfigValue(gitDir, 'remote', 'origin', 'url')
  if (url) {
    return url
  }
  
  const commonDir = await getCommonDir(gitDir)
  if (commonDir && commonDir !== gitDir) {
    return parseGitConfigValue(commonDir, 'remote', 'origin', 'url')
  }
  return null
}

export async function isShallowClone(): Promise<boolean> {
  const gitDir = await resolveGitDir()
  if (!gitDir) {
    return false
  }
  const commonDir = (await getCommonDir(gitDir)) ?? gitDir
  try {
    await stat(join(commonDir, 'shallow'))
    return true
  } catch {
    return false
  }
}

export async function getWorktreeCountFromFs(): Promise<number> {
  try {
    const gitDir = await resolveGitDir()
    if (!gitDir) {
      return 0
    }
    const commonDir = (await getCommonDir(gitDir)) ?? gitDir
    const entries = await readdir(join(commonDir, 'worktrees'))
    return entries.length + 1
  } catch {
    
    return 1
  }
}
