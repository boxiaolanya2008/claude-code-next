import { feature } from "../utils/bundle-mock.ts"
import chalk from 'chalk'
import { spawnSync } from 'child_process'
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  utimes,
} from 'fs/promises'
import ignore from 'ignore'
import { basename, dirname, join } from 'path'
import { saveCurrentProjectConfig } from './config.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { errorMessage, getErrnoCode } from './errors.js'
import { execFileNoThrow, execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { parseGitConfigValue } from './git/gitConfigParser.js'
import {
  getCommonDir,
  readWorktreeHeadSha,
  resolveGitDir,
  resolveRef,
} from './git/gitFilesystem.js'
import {
  findCanonicalGitRoot,
  findGitRoot,
  getBranch,
  getDefaultBranch,
  gitExe,
} from './git.js'
import {
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
  hasWorktreeCreateHook,
} from './hooks.js'
import { containsPathTraversal } from './path.js'
import { getPlatform } from './platform.js'
import {
  getInitialSettings,
  getRelativeSettingsFilePathForSource,
} from './settings/settings.js'
import { sleep } from './sleep.js'
import { isInITerm2 } from './swarm/backends/detection.js'

const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/
const MAX_WORKTREE_SLUG_LENGTH = 64

export function validateWorktreeSlug(slug: string): void {
  if (slug.length > MAX_WORKTREE_SLUG_LENGTH) {
    throw new Error(
      `Invalid worktree name: must be ${MAX_WORKTREE_SLUG_LENGTH} characters or fewer (got ${slug.length})`,
    )
  }
  
  
  
  for (const segment of slug.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new Error(
        `Invalid worktree name "${slug}": must not contain "." or ".." path segments`,
      )
    }
    if (!VALID_WORKTREE_SLUG_SEGMENT.test(segment)) {
      throw new Error(
        `Invalid worktree name "${slug}": each "/"-separated segment must be non-empty and contain only letters, digits, dots, underscores, and dashes`,
      )
    }
  }
}

async function mkdirRecursive(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

async function symlinkDirectories(
  repoRootPath: string,
  worktreePath: string,
  dirsToSymlink: string[],
): Promise<void> {
  for (const dir of dirsToSymlink) {
    
    if (containsPathTraversal(dir)) {
      logForDebugging(
        `Skipping symlink for "${dir}": path traversal detected`,
        { level: 'warn' },
      )
      continue
    }

    const sourcePath = join(repoRootPath, dir)
    const destPath = join(worktreePath, dir)

    try {
      await symlink(sourcePath, destPath, 'dir')
      logForDebugging(
        `Symlinked ${dir} from main repository to worktree to avoid disk bloat`,
      )
    } catch (error) {
      const code = getErrnoCode(error)
      
      
      if (code !== 'ENOENT' && code !== 'EEXIST') {
        
        logForDebugging(
          `Failed to symlink ${dir} (${code ?? 'unknown'}): ${errorMessage(error)}`,
          { level: 'warn' },
        )
      }
    }
  }
}

export type WorktreeSession = {
  originalCwd: string
  worktreePath: string
  worktreeName: string
  worktreeBranch?: string
  originalBranch?: string
  originalHeadCommit?: string
  sessionId: string
  tmuxSessionName?: string
  hookBased?: boolean
  
  creationDurationMs?: number
  
  usedSparsePaths?: boolean
}

let currentWorktreeSession: WorktreeSession | null = null

export function getCurrentWorktreeSession(): WorktreeSession | null {
  return currentWorktreeSession
}

export function restoreWorktreeSession(session: WorktreeSession | null): void {
  currentWorktreeSession = session
}

export function generateTmuxSessionName(
  repoPath: string,
  branch: string,
): string {
  const repoName = basename(repoPath)
  const combined = `${repoName}_${branch}`
  return combined.replace(/[/.]/g, '_')
}

type WorktreeCreateResult =
  | {
      worktreePath: string
      worktreeBranch: string
      headCommit: string
      existed: true
    }
  | {
      worktreePath: string
      worktreeBranch: string
      headCommit: string
      baseBranch: string
      existed: false
    }

const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
}

function worktreesDir(repoRoot: string): string {
  return join(repoRoot, '.claude', 'worktrees')
}

function flattenSlug(slug: string): string {
  return slug.replaceAll('/', '+')
}

export function worktreeBranchName(slug: string): string {
  return `worktree-${flattenSlug(slug)}`
}

function worktreePathFor(repoRoot: string, slug: string): string {
  return join(worktreesDir(repoRoot), flattenSlug(slug))
}

async function getOrCreateWorktree(
  repoRoot: string,
  slug: string,
  options?: { prNumber?: number },
): Promise<WorktreeCreateResult> {
  const worktreePath = worktreePathFor(repoRoot, slug)
  const worktreeBranch = worktreeBranchName(slug)

  
  
  
  
  const existingHead = await readWorktreeHeadSha(worktreePath)
  if (existingHead) {
    return {
      worktreePath,
      worktreeBranch,
      headCommit: existingHead,
      existed: true,
    }
  }

  
  await mkdir(worktreesDir(repoRoot), { recursive: true })

  const fetchEnv = { ...process.env, ...GIT_NO_PROMPT_ENV }

  let baseBranch: string
  let baseSha: string | null = null
  if (options?.prNumber) {
    const { code: prFetchCode, stderr: prFetchStderr } =
      await execFileNoThrowWithCwd(
        gitExe(),
        ['fetch', 'origin', `pull/${options.prNumber}/head`],
        { cwd: repoRoot, stdin: 'ignore', env: fetchEnv },
      )
    if (prFetchCode !== 0) {
      throw new Error(
        `Failed to fetch PR #${options.prNumber}: ${prFetchStderr.trim() || 'PR may not exist or the repository may not have a remote named "origin"'}`,
      )
    }
    baseBranch = 'FETCH_HEAD'
  } else {
    
    
    
    
    
    
    const [defaultBranch, gitDir] = await Promise.all([
      getDefaultBranch(),
      resolveGitDir(repoRoot),
    ])
    const originRef = `origin/${defaultBranch}`
    const originSha = gitDir
      ? await resolveRef(gitDir, `refs/remotes/origin/${defaultBranch}`)
      : null
    if (originSha) {
      baseBranch = originRef
      baseSha = originSha
    } else {
      const { code: fetchCode } = await execFileNoThrowWithCwd(
        gitExe(),
        ['fetch', 'origin', defaultBranch],
        { cwd: repoRoot, stdin: 'ignore', env: fetchEnv },
      )
      baseBranch = fetchCode === 0 ? originRef : 'HEAD'
    }
  }

  
  
  if (!baseSha) {
    const { stdout, code: shaCode } = await execFileNoThrowWithCwd(
      gitExe(),
      ['rev-parse', baseBranch],
      { cwd: repoRoot },
    )
    if (shaCode !== 0) {
      throw new Error(
        `Failed to resolve base branch "${baseBranch}": git rev-parse failed`,
      )
    }
    baseSha = stdout.trim()
  }

  const sparsePaths = getInitialSettings().worktree?.sparsePaths
  const addArgs = ['worktree', 'add']
  if (sparsePaths?.length) {
    addArgs.push('--no-checkout')
  }
  
  
  addArgs.push('-B', worktreeBranch, worktreePath, baseBranch)

  const { code: createCode, stderr: createStderr } =
    await execFileNoThrowWithCwd(gitExe(), addArgs, { cwd: repoRoot })
  if (createCode !== 0) {
    throw new Error(`Failed to create worktree: ${createStderr}`)
  }

  if (sparsePaths?.length) {
    
    
    
    
    const tearDown = async (msg: string): Promise<never> => {
      await execFileNoThrowWithCwd(
        gitExe(),
        ['worktree', 'remove', '--force', worktreePath],
        { cwd: repoRoot },
      )
      throw new Error(msg)
    }
    const { code: sparseCode, stderr: sparseErr } =
      await execFileNoThrowWithCwd(
        gitExe(),
        ['sparse-checkout', 'set', '--cone', '--', ...sparsePaths],
        { cwd: worktreePath },
      )
    if (sparseCode !== 0) {
      await tearDown(`Failed to configure sparse-checkout: ${sparseErr}`)
    }
    const { code: coCode, stderr: coErr } = await execFileNoThrowWithCwd(
      gitExe(),
      ['checkout', 'HEAD'],
      { cwd: worktreePath },
    )
    if (coCode !== 0) {
      await tearDown(`Failed to checkout sparse worktree: ${coErr}`)
    }
  }

  return {
    worktreePath,
    worktreeBranch,
    headCommit: baseSha,
    baseBranch,
    existed: false,
  }
}

export async function copyWorktreeIncludeFiles(
  repoRoot: string,
  worktreePath: string,
): Promise<string[]> {
  let includeContent: string
  try {
    includeContent = await readFile(join(repoRoot, '.worktreeinclude'), 'utf-8')
  } catch {
    return []
  }

  const patterns = includeContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
  if (patterns.length === 0) {
    return []
  }

  
  
  
  const gitignored = await execFileNoThrowWithCwd(
    gitExe(),
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'],
    { cwd: repoRoot },
  )
  if (gitignored.code !== 0 || !gitignored.stdout.trim()) {
    return []
  }

  const entries = gitignored.stdout.trim().split('\n').filter(Boolean)
  const matcher = ignore().add(includeContent)

  
  
  const collapsedDirs = entries.filter(e => e.endsWith('/'))
  const files = entries.filter(e => !e.endsWith('/') && matcher.ignores(e))

  
  
  
  
  
  
  
  
  
  const dirsToExpand = collapsedDirs.filter(dir => {
    if (
      patterns.some(p => {
        const normalized = p.startsWith('/') ? p.slice(1) : p
        
        if (normalized.startsWith(dir)) return true
        
        
        const globIdx = normalized.search(/[*?[]/)
        if (globIdx > 0) {
          const literalPrefix = normalized.slice(0, globIdx)
          if (dir.startsWith(literalPrefix)) return true
        }
        return false
      })
    )
      return true
    if (matcher.ignores(dir.slice(0, -1))) return true
    return false
  })
  if (dirsToExpand.length > 0) {
    const expanded = await execFileNoThrowWithCwd(
      gitExe(),
      [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--',
        ...dirsToExpand,
      ],
      { cwd: repoRoot },
    )
    if (expanded.code === 0 && expanded.stdout.trim()) {
      for (const f of expanded.stdout.trim().split('\n').filter(Boolean)) {
        if (matcher.ignores(f)) {
          files.push(f)
        }
      }
    }
  }
  const copied: string[] = []

  for (const relativePath of files) {
    const srcPath = join(repoRoot, relativePath)
    const destPath = join(worktreePath, relativePath)
    try {
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
      copied.push(relativePath)
    } catch (e: unknown) {
      logForDebugging(
        `Failed to copy ${relativePath} to worktree: ${(e as Error).message}`,
        { level: 'warn' },
      )
    }
  }

  if (copied.length > 0) {
    logForDebugging(
      `Copied ${copied.length} files from .worktreeinclude: ${copied.join(', ')}`,
    )
  }

  return copied
}

async function performPostCreationSetup(
  repoRoot: string,
  worktreePath: string,
): Promise<void> {
  
  
  const localSettingsRelativePath =
    getRelativeSettingsFilePathForSource('localSettings')
  const sourceSettingsLocal = join(repoRoot, localSettingsRelativePath)
  try {
    const destSettingsLocal = join(worktreePath, localSettingsRelativePath)
    await mkdirRecursive(dirname(destSettingsLocal))
    await copyFile(sourceSettingsLocal, destSettingsLocal)
    logForDebugging(
      `Copied settings.local.json to worktree: ${destSettingsLocal}`,
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      logForDebugging(
        `Failed to copy settings.local.json: ${(e as Error).message}`,
        { level: 'warn' },
      )
    }
  }

  
  
  const huskyPath = join(repoRoot, '.husky')
  const gitHooksPath = join(repoRoot, '.git', 'hooks')
  let hooksPath: string | null = null
  for (const candidatePath of [huskyPath, gitHooksPath]) {
    try {
      const s = await stat(candidatePath)
      if (s.isDirectory()) {
        hooksPath = candidatePath
        break
      }
    } catch {
      
    }
  }
  if (hooksPath) {
    
    
    
    const gitDir = await resolveGitDir(repoRoot)
    const configDir = gitDir ? ((await getCommonDir(gitDir)) ?? gitDir) : null
    const existing = configDir
      ? await parseGitConfigValue(configDir, 'core', null, 'hooksPath')
      : null
    if (existing !== hooksPath) {
      const { code: configCode, stderr: configError } =
        await execFileNoThrowWithCwd(
          gitExe(),
          ['config', 'core.hooksPath', hooksPath],
          { cwd: worktreePath },
        )
      if (configCode === 0) {
        logForDebugging(
          `Configured worktree to use hooks from main repository: ${hooksPath}`,
        )
      } else {
        logForDebugging(`Failed to configure hooks path: ${configError}`, {
          level: 'error',
        })
      }
    }
  }

  
  const settings = getInitialSettings()
  const dirsToSymlink = settings.worktree?.symlinkDirectories ?? []
  if (dirsToSymlink.length > 0) {
    await symlinkDirectories(repoRoot, worktreePath, dirsToSymlink)
  }

  
  await copyWorktreeIncludeFiles(repoRoot, worktreePath)

  
  
  
  
  
  
  
  
  
  
  
  
  
  if (feature('COMMIT_ATTRIBUTION')) {
    const worktreeHooksDir =
      hooksPath === huskyPath ? join(worktreePath, '.husky') : undefined
    void import('./postCommitAttribution.js')
      .then(m =>
        m
          .installPrepareCommitMsgHook(worktreePath, worktreeHooksDir)
          .catch(error => {
            logForDebugging(
              `Failed to install attribution hook in worktree: ${error}`,
            )
          }),
      )
      .catch(error => {
        
        
        
        
        logForDebugging(`Failed to load postCommitAttribution module: ${error}`)
      })
  }
}

export function parsePRReference(input: string): number | null {
  
  
  
  const urlMatch = input.match(
    /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)\/?(?:[?#].*)?$/i,
  )
  if (urlMatch?.[1]) {
    return parseInt(urlMatch[1], 10)
  }

  
  const hashMatch = input.match(/^#(\d+)$/)
  if (hashMatch?.[1]) {
    return parseInt(hashMatch[1], 10)
  }

  return null
}

export async function isTmuxAvailable(): Promise<boolean> {
  const { code } = await execFileNoThrow('tmux', ['-V'])
  return code === 0
}

export function getTmuxInstallInstructions(): string {
  const platform = getPlatform()
  switch (platform) {
    case 'macos':
      return 'Install tmux with: brew install tmux'
    case 'linux':
    case 'wsl':
      return 'Install tmux with: sudo apt install tmux (Debian/Ubuntu) or sudo dnf install tmux (Fedora/RHEL)'
    case 'windows':
      return 'tmux is not natively available on Windows. Consider using WSL or Cygwin.'
    default:
      return 'Install tmux using your system package manager.'
  }
}

export async function createTmuxSessionForWorktree(
  sessionName: string,
  worktreePath: string,
): Promise<{ created: boolean; error?: string }> {
  const { code, stderr } = await execFileNoThrow('tmux', [
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    worktreePath,
  ])

  if (code !== 0) {
    return { created: false, error: stderr }
  }

  return { created: true }
}

export async function killTmuxSession(sessionName: string): Promise<boolean> {
  const { code } = await execFileNoThrow('tmux', [
    'kill-session',
    '-t',
    sessionName,
  ])
  return code === 0
}

export async function createWorktreeForSession(
  sessionId: string,
  slug: string,
  tmuxSessionName?: string,
  options?: { prNumber?: number },
): Promise<WorktreeSession> {
  
  
  validateWorktreeSlug(slug)

  const originalCwd = getCwd()

  
  if (hasWorktreeCreateHook()) {
    const hookResult = await executeWorktreeCreateHook(slug)
    logForDebugging(
      `Created hook-based worktree at: ${hookResult.worktreePath}`,
    )

    currentWorktreeSession = {
      originalCwd,
      worktreePath: hookResult.worktreePath,
      worktreeName: slug,
      sessionId,
      tmuxSessionName,
      hookBased: true,
    }
  } else {
    
    const gitRoot = findGitRoot(getCwd())
    if (!gitRoot) {
      throw new Error(
        'Cannot create a worktree: not in a git repository and no WorktreeCreate hooks are configured. ' +
          'Configure WorktreeCreate/WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.',
      )
    }

    const originalBranch = await getBranch()

    const createStart = Date.now()
    const { worktreePath, worktreeBranch, headCommit, existed } =
      await getOrCreateWorktree(gitRoot, slug, options)

    let creationDurationMs: number | undefined
    if (existed) {
      logForDebugging(`Resuming existing worktree at: ${worktreePath}`)
    } else {
      logForDebugging(
        `Created worktree at: ${worktreePath} on branch: ${worktreeBranch}`,
      )
      await performPostCreationSetup(gitRoot, worktreePath)
      creationDurationMs = Date.now() - createStart
    }

    currentWorktreeSession = {
      originalCwd,
      worktreePath,
      worktreeName: slug,
      worktreeBranch,
      originalBranch,
      originalHeadCommit: headCommit,
      sessionId,
      tmuxSessionName,
      creationDurationMs,
      usedSparsePaths:
        (getInitialSettings().worktree?.sparsePaths?.length ?? 0) > 0,
    }
  }

  
  saveCurrentProjectConfig(current => ({
    ...current,
    activeWorktreeSession: currentWorktreeSession ?? undefined,
  }))

  return currentWorktreeSession
}

export async function keepWorktree(): Promise<void> {
  if (!currentWorktreeSession) {
    return
  }

  try {
    const { worktreePath, originalCwd, worktreeBranch } = currentWorktreeSession

    
    process.chdir(originalCwd)

    
    currentWorktreeSession = null

    
    saveCurrentProjectConfig(current => ({
      ...current,
      activeWorktreeSession: undefined,
    }))

    logForDebugging(
      `Linked worktree preserved at: ${worktreePath}${worktreeBranch ? ` on branch: ${worktreeBranch}` : ''}`,
    )
    logForDebugging(
      `You can continue working there by running: cd ${worktreePath}`,
    )
  } catch (error) {
    logForDebugging(`Error keeping worktree: ${error}`, {
      level: 'error',
    })
  }
}

export async function cleanupWorktree(): Promise<void> {
  if (!currentWorktreeSession) {
    return
  }

  try {
    const { worktreePath, originalCwd, worktreeBranch, hookBased } =
      currentWorktreeSession

    
    process.chdir(originalCwd)

    if (hookBased) {
      
      const hookRan = await executeWorktreeRemoveHook(worktreePath)
      if (hookRan) {
        logForDebugging(`Removed hook-based worktree at: ${worktreePath}`)
      } else {
        logForDebugging(
          `No WorktreeRemove hook configured, hook-based worktree left at: ${worktreePath}`,
          { level: 'warn' },
        )
      }
    } else {
      
      
      
      
      const { code: removeCode, stderr: removeError } =
        await execFileNoThrowWithCwd(
          gitExe(),
          ['worktree', 'remove', '--force', worktreePath],
          { cwd: originalCwd },
        )

      if (removeCode !== 0) {
        logForDebugging(`Failed to remove linked worktree: ${removeError}`, {
          level: 'error',
        })
      } else {
        logForDebugging(`Removed linked worktree at: ${worktreePath}`)
      }
    }

    
    currentWorktreeSession = null

    
    saveCurrentProjectConfig(current => ({
      ...current,
      activeWorktreeSession: undefined,
    }))

    
    if (!hookBased && worktreeBranch) {
      
      await sleep(100)

      const { code: deleteBranchCode, stderr: deleteBranchError } =
        await execFileNoThrowWithCwd(
          gitExe(),
          ['branch', '-D', worktreeBranch],
          { cwd: originalCwd },
        )

      if (deleteBranchCode !== 0) {
        logForDebugging(
          `Could not delete worktree branch: ${deleteBranchError}`,
          { level: 'error' },
        )
      } else {
        logForDebugging(`Deleted worktree branch: ${worktreeBranch}`)
      }
    }

    logForDebugging('Linked worktree cleaned up completely')
  } catch (error) {
    logForDebugging(`Error cleaning up worktree: ${error}`, {
      level: 'error',
    })
  }
}

export async function createAgentWorktree(slug: string): Promise<{
  worktreePath: string
  worktreeBranch?: string
  headCommit?: string
  gitRoot?: string
  hookBased?: boolean
}> {
  validateWorktreeSlug(slug)

  
  if (hasWorktreeCreateHook()) {
    const hookResult = await executeWorktreeCreateHook(slug)
    logForDebugging(
      `Created hook-based agent worktree at: ${hookResult.worktreePath}`,
    )

    return { worktreePath: hookResult.worktreePath, hookBased: true }
  }

  
  
  
  
  
  const gitRoot = findCanonicalGitRoot(getCwd())
  if (!gitRoot) {
    throw new Error(
      'Cannot create agent worktree: not in a git repository and no WorktreeCreate hooks are configured. ' +
        'Configure WorktreeCreate/WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.',
    )
  }

  const { worktreePath, worktreeBranch, headCommit, existed } =
    await getOrCreateWorktree(gitRoot, slug)

  if (!existed) {
    logForDebugging(
      `Created agent worktree at: ${worktreePath} on branch: ${worktreeBranch}`,
    )
    await performPostCreationSetup(gitRoot, worktreePath)
  } else {
    
    
    
    const now = new Date()
    await utimes(worktreePath, now, now)
    logForDebugging(`Resuming existing agent worktree at: ${worktreePath}`)
  }

  return { worktreePath, worktreeBranch, headCommit, gitRoot }
}

export async function removeAgentWorktree(
  worktreePath: string,
  worktreeBranch?: string,
  gitRoot?: string,
  hookBased?: boolean,
): Promise<boolean> {
  if (hookBased) {
    const hookRan = await executeWorktreeRemoveHook(worktreePath)
    if (hookRan) {
      logForDebugging(`Removed hook-based agent worktree at: ${worktreePath}`)
    } else {
      logForDebugging(
        `No WorktreeRemove hook configured, hook-based agent worktree left at: ${worktreePath}`,
        { level: 'warn' },
      )
    }
    return hookRan
  }

  if (!gitRoot) {
    logForDebugging('Cannot remove agent worktree: no git root provided', {
      level: 'error',
    })
    return false
  }

  
  const { code: removeCode, stderr: removeError } =
    await execFileNoThrowWithCwd(
      gitExe(),
      ['worktree', 'remove', '--force', worktreePath],
      { cwd: gitRoot },
    )

  if (removeCode !== 0) {
    logForDebugging(`Failed to remove agent worktree: ${removeError}`, {
      level: 'error',
    })
    return false
  }
  logForDebugging(`Removed agent worktree at: ${worktreePath}`)

  if (!worktreeBranch) {
    return true
  }

  
  const { code: deleteBranchCode, stderr: deleteBranchError } =
    await execFileNoThrowWithCwd(gitExe(), ['branch', '-D', worktreeBranch], {
      cwd: gitRoot,
    })

  if (deleteBranchCode !== 0) {
    logForDebugging(
      `Could not delete agent worktree branch: ${deleteBranchError}`,
      { level: 'error' },
    )
  }
  return true
}

const EPHEMERAL_WORKTREE_PATTERNS = [
  /^agent-a[0-9a-f]{7}$/,
  /^wf_[0-9a-f]{8}-[0-9a-f]{3}-\d+$/,
  
  
  /^wf-\d+$/,
  
  /^bridge-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/,
  
  
  /^job-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/,
]

export async function cleanupStaleAgentWorktrees(
  cutoffDate: Date,
): Promise<number> {
  const gitRoot = findCanonicalGitRoot(getCwd())
  if (!gitRoot) {
    return 0
  }

  const dir = worktreesDir(gitRoot)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return 0
  }

  const cutoffMs = cutoffDate.getTime()
  const currentPath = currentWorktreeSession?.worktreePath
  let removed = 0

  for (const slug of entries) {
    if (!EPHEMERAL_WORKTREE_PATTERNS.some(p => p.test(slug))) {
      continue
    }

    const worktreePath = join(dir, slug)
    if (currentPath === worktreePath) {
      continue
    }

    let mtimeMs: number
    try {
      mtimeMs = (await stat(worktreePath)).mtimeMs
    } catch {
      continue
    }
    if (mtimeMs >= cutoffMs) {
      continue
    }

    
    
    
    const [status, unpushed] = await Promise.all([
      execFileNoThrowWithCwd(
        gitExe(),
        ['--no-optional-locks', 'status', '--porcelain', '-uno'],
        { cwd: worktreePath },
      ),
      execFileNoThrowWithCwd(
        gitExe(),
        ['rev-list', '--max-count=1', 'HEAD', '--not', '--remotes'],
        { cwd: worktreePath },
      ),
    ])
    if (status.code !== 0 || status.stdout.trim().length > 0) {
      continue
    }
    if (unpushed.code !== 0 || unpushed.stdout.trim().length > 0) {
      continue
    }

    if (
      await removeAgentWorktree(worktreePath, worktreeBranchName(slug), gitRoot)
    ) {
      removed++
    }
  }

  if (removed > 0) {
    await execFileNoThrowWithCwd(gitExe(), ['worktree', 'prune'], {
      cwd: gitRoot,
    })
    logForDebugging(
      `cleanupStaleAgentWorktrees: removed ${removed} stale worktree(s)`,
    )
  }
  return removed
}

export async function hasWorktreeChanges(
  worktreePath: string,
  headCommit: string,
): Promise<boolean> {
  const { code: statusCode, stdout: statusOutput } =
    await execFileNoThrowWithCwd(gitExe(), ['status', '--porcelain'], {
      cwd: worktreePath,
    })
  if (statusCode !== 0) {
    return true
  }
  if (statusOutput.trim().length > 0) {
    return true
  }

  const { code: revListCode, stdout: revListOutput } =
    await execFileNoThrowWithCwd(
      gitExe(),
      ['rev-list', '--count', `${headCommit}..HEAD`],
      { cwd: worktreePath },
    )
  if (revListCode !== 0) {
    return true
  }
  if (parseInt(revListOutput.trim(), 10) > 0) {
    return true
  }

  return false
}

export async function execIntoTmuxWorktree(args: string[]): Promise<{
  handled: boolean
  error?: string
}> {
  
  if (process.platform === 'win32') {
    return {
      handled: false,
      error: 'Error: --tmux is not supported on Windows',
    }
  }

  
  const tmuxCheck = spawnSync('tmux', ['-V'], { encoding: 'utf-8' })
  if (tmuxCheck.status !== 0) {
    const installHint =
      process.platform === 'darwin'
        ? 'Install tmux with: brew install tmux'
        : 'Install tmux with: sudo apt install tmux'
    return {
      handled: false,
      error: `Error: tmux is not installed. ${installHint}`,
    }
  }

  
  let worktreeName: string | undefined
  let forceClassicTmux = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '-w' || arg === '--worktree') {
      
      const next = args[i + 1]
      if (next && !next.startsWith('-')) {
        worktreeName = next
      }
    } else if (arg.startsWith('--worktree=')) {
      worktreeName = arg.slice('--worktree='.length)
    } else if (arg === '--tmux=classic') {
      forceClassicTmux = true
    }
  }

  
  let prNumber: number | null = null
  if (worktreeName) {
    prNumber = parsePRReference(worktreeName)
    if (prNumber !== null) {
      worktreeName = `pr-${prNumber}`
    }
  }

  
  if (!worktreeName) {
    const adjectives = ['swift', 'bright', 'calm', 'keen', 'bold']
    const nouns = ['fox', 'owl', 'elm', 'oak', 'ray']
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
    const noun = nouns[Math.floor(Math.random() * nouns.length)]
    const suffix = Math.random().toString(36).slice(2, 6)
    worktreeName = `${adj}-${noun}-${suffix}`
  }

  
  
  
  try {
    validateWorktreeSlug(worktreeName)
  } catch (e) {
    return {
      handled: false,
      error: `Error: ${(e as Error).message}`,
    }
  }

  
  
  
  let worktreeDir: string
  let repoName: string
  if (hasWorktreeCreateHook()) {
    try {
      const hookResult = await executeWorktreeCreateHook(worktreeName)
      worktreeDir = hookResult.worktreePath
    } catch (error) {
      return {
        handled: false,
        error: `Error: ${errorMessage(error)}`,
      }
    }
    repoName = basename(findCanonicalGitRoot(getCwd()) ?? getCwd())
    
    console.log(`Using worktree via hook: ${worktreeDir}`)
  } else {
    
    const repoRoot = findCanonicalGitRoot(getCwd())
    if (!repoRoot) {
      return {
        handled: false,
        error: 'Error: --worktree requires a git repository',
      }
    }

    repoName = basename(repoRoot)
    worktreeDir = worktreePathFor(repoRoot, worktreeName)

    
    try {
      const result = await getOrCreateWorktree(
        repoRoot,
        worktreeName,
        prNumber !== null ? { prNumber } : undefined,
      )
      if (!result.existed) {
        
        console.log(
          `Created worktree: ${worktreeDir} (based on ${result.baseBranch})`,
        )
        await performPostCreationSetup(repoRoot, worktreeDir)
      }
    } catch (error) {
      return {
        handled: false,
        error: `Error: ${errorMessage(error)}`,
      }
    }
  }

  
  const tmuxSessionName =
    `${repoName}_${worktreeBranchName(worktreeName)}`.replace(/[/.]/g, '_')

  
  const newArgs: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '--tmux' || arg === '--tmux=classic') continue
    if (arg === '-w' || arg === '--worktree') {
      
      const next = args[i + 1]
      if (next && !next.startsWith('-')) {
        i++ 
      }
      continue
    }
    if (arg.startsWith('--worktree=')) continue
    newArgs.push(arg)
  }

  
  let tmuxPrefix = 'C-b' 
  const prefixResult = spawnSync('tmux', ['show-options', '-g', 'prefix'], {
    encoding: 'utf-8',
  })
  if (prefixResult.status === 0 && prefixResult.stdout) {
    const match = prefixResult.stdout.match(/prefix\s+(\S+)/)
    if (match?.[1]) {
      tmuxPrefix = match[1]
    }
  }

  
  
  const claudeBindings = [
    'C-b',
    'C-c',
    'C-d',
    'C-t',
    'C-o',
    'C-r',
    'C-s',
    'C-g',
    'C-e',
  ]
  const prefixConflicts = claudeBindings.includes(tmuxPrefix)

  
  const tmuxEnv = {
    ...process.env,
    CLAUDE_CODE_NEXT_TMUX_SESSION: tmuxSessionName,
    CLAUDE_CODE_NEXT_TMUX_PREFIX: tmuxPrefix,
    CLAUDE_CODE_NEXT_TMUX_PREFIX_CONFLICTS: prefixConflicts ? '1' : '',
  }

  
  const hasSessionResult = spawnSync(
    'tmux',
    ['has-session', '-t', tmuxSessionName],
    { encoding: 'utf-8' },
  )
  const sessionExists = hasSessionResult.status === 0

  
  const isAlreadyInTmux = Boolean(process.env.TMUX)

  
  
  
  
  const useControlMode = isInITerm2() && !forceClassicTmux && !isAlreadyInTmux
  const tmuxGlobalArgs = useControlMode ? ['-CC'] : []

  
  if (useControlMode && !sessionExists) {
    const y = chalk.yellow
    
    console.log(
      `\n${y('╭─ iTerm2 Tip ────────────────────────────────────────────────────────╮')}\n` +
        `${y('│')} To open as a tab instead of a new window:                           ${y('│')}\n` +
        `${y('│')} iTerm2 > Settings > General > tmux > "Tabs in attaching window"     ${y('│')}\n` +
        `${y('╰─────────────────────────────────────────────────────────────────────╯')}\n`,
    )
  }

  
  const isAnt = process.env.USER_TYPE === 'ant'
  const isClaudeCliInternal = repoName === 'claude-cli-internal'
  const shouldSetupDevPanes = isAnt && isClaudeCliInternal && !sessionExists

  if (shouldSetupDevPanes) {
    
    spawnSync(
      'tmux',
      [
        'new-session',
        '-d', 
        '-s',
        tmuxSessionName,
        '-c',
        worktreeDir,
        '--',
        process.execPath,
        ...newArgs,
      ],
      { cwd: worktreeDir, env: tmuxEnv },
    )

    
    spawnSync(
      'tmux',
      ['split-window', '-h', '-t', tmuxSessionName, '-c', worktreeDir],
      { cwd: worktreeDir },
    )
    spawnSync(
      'tmux',
      ['send-keys', '-t', tmuxSessionName, 'bun run watch', 'Enter'],
      { cwd: worktreeDir },
    )

    
    spawnSync(
      'tmux',
      ['split-window', '-v', '-t', tmuxSessionName, '-c', worktreeDir],
      { cwd: worktreeDir },
    )
    spawnSync('tmux', ['send-keys', '-t', tmuxSessionName, 'bun run start'], {
      cwd: worktreeDir,
    })

    
    spawnSync('tmux', ['select-pane', '-t', `${tmuxSessionName}:0.0`], {
      cwd: worktreeDir,
    })

    
    if (isAlreadyInTmux) {
      
      spawnSync('tmux', ['switch-client', '-t', tmuxSessionName], {
        stdio: 'inherit',
      })
    } else {
      
      spawnSync(
        'tmux',
        [...tmuxGlobalArgs, 'attach-session', '-t', tmuxSessionName],
        {
          stdio: 'inherit',
          cwd: worktreeDir,
        },
      )
    }
  } else {
    
    if (isAlreadyInTmux) {
      
      
      if (sessionExists) {
        
        spawnSync('tmux', ['switch-client', '-t', tmuxSessionName], {
          stdio: 'inherit',
        })
      } else {
        
        spawnSync(
          'tmux',
          [
            'new-session',
            '-d', 
            '-s',
            tmuxSessionName,
            '-c',
            worktreeDir,
            '--',
            process.execPath,
            ...newArgs,
          ],
          { cwd: worktreeDir, env: tmuxEnv },
        )

        
        spawnSync('tmux', ['switch-client', '-t', tmuxSessionName], {
          stdio: 'inherit',
        })
      }
    } else {
      
      const tmuxArgs = [
        ...tmuxGlobalArgs,
        'new-session',
        '-A', 
        '-s',
        tmuxSessionName,
        '-c',
        worktreeDir,
        '--', 
        process.execPath,
        ...newArgs,
      ]

      spawnSync('tmux', tmuxArgs, {
        stdio: 'inherit',
        cwd: worktreeDir,
        env: tmuxEnv,
      })
    }
  }

  return { handled: true }
}
