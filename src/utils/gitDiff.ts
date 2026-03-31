import type { StructuredPatchHunk } from 'diff'
import { access, readFile } from 'fs/promises'
import { dirname, join, relative, sep } from 'path'
import { getCwd } from './cwd.js'
import { getCachedRepository } from './detectRepository.js'
import { execFileNoThrow, execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { isFileWithinReadSizeLimit } from './file.js'
import {
  findGitRoot,
  getDefaultBranch,
  getGitDir,
  getIsGit,
  gitExe,
} from './git.js'

export type GitDiffStats = {
  filesCount: number
  linesAdded: number
  linesRemoved: number
}

export type PerFileStats = {
  added: number
  removed: number
  isBinary: boolean
  isUntracked?: boolean
}

export type GitDiffResult = {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
  hunks: Map<string, StructuredPatchHunk[]>
}

const GIT_TIMEOUT_MS = 5000
const MAX_FILES = 50
const MAX_DIFF_SIZE_BYTES = 1_000_000 
const MAX_LINES_PER_FILE = 400 
const MAX_FILES_FOR_DETAILS = 500 

export async function fetchGitDiff(): Promise<GitDiffResult | null> {
  const isGit = await getIsGit()
  if (!isGit) return null

  
  
  if (await isInTransientGitState()) {
    return null
  }

  
  
  
  const { stdout: shortstatOut, code: shortstatCode } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'diff', 'HEAD', '--shortstat'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false },
  )

  if (shortstatCode === 0) {
    const quickStats = parseShortstat(shortstatOut)
    if (quickStats && quickStats.filesCount > MAX_FILES_FOR_DETAILS) {
      
      
      return {
        stats: quickStats,
        perFileStats: new Map(),
        hunks: new Map(),
      }
    }
  }

  
  const { stdout: numstatOut, code: numstatCode } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'diff', 'HEAD', '--numstat'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false },
  )

  if (numstatCode !== 0) return null

  const { stats, perFileStats } = parseGitNumstat(numstatOut)

  
  
  const remainingSlots = MAX_FILES - perFileStats.size
  if (remainingSlots > 0) {
    const untrackedStats = await fetchUntrackedFiles(remainingSlots)
    if (untrackedStats) {
      stats.filesCount += untrackedStats.size
      for (const [path, fileStats] of untrackedStats) {
        perFileStats.set(path, fileStats)
      }
    }
  }

  
  
  return { stats, perFileStats, hunks: new Map() }
}

export async function fetchGitDiffHunks(): Promise<
  Map<string, StructuredPatchHunk[]>
> {
  const isGit = await getIsGit()
  if (!isGit) return new Map()

  if (await isInTransientGitState()) {
    return new Map()
  }

  const { stdout: diffOut, code: diffCode } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'diff', 'HEAD'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false },
  )

  if (diffCode !== 0) {
    return new Map()
  }

  return parseGitDiff(diffOut)
}

export type NumstatResult = {
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

export function parseGitNumstat(stdout: string): NumstatResult {
  const lines = stdout.trim().split('\n').filter(Boolean)
  let added = 0
  let removed = 0
  let validFileCount = 0
  const perFileStats = new Map<string, PerFileStats>()

  for (const line of lines) {
    const parts = line.split('\t')
    
    if (parts.length < 3) continue

    validFileCount++
    const addStr = parts[0]
    const remStr = parts[1]
    const filePath = parts.slice(2).join('\t') 
    const isBinary = addStr === '-' || remStr === '-'
    const fileAdded = isBinary ? 0 : parseInt(addStr ?? '0', 10) || 0
    const fileRemoved = isBinary ? 0 : parseInt(remStr ?? '0', 10) || 0

    added += fileAdded
    removed += fileRemoved

    
    if (perFileStats.size < MAX_FILES) {
      perFileStats.set(filePath, {
        added: fileAdded,
        removed: fileRemoved,
        isBinary,
      })
    }
  }

  return {
    stats: {
      filesCount: validFileCount,
      linesAdded: added,
      linesRemoved: removed,
    },
    perFileStats,
  }
}

export function parseGitDiff(
  stdout: string,
): Map<string, StructuredPatchHunk[]> {
  const result = new Map<string, StructuredPatchHunk[]>()
  if (!stdout.trim()) return result

  
  const fileDiffs = stdout.split(/^diff --git /m).filter(Boolean)

  for (const fileDiff of fileDiffs) {
    
    if (result.size >= MAX_FILES) break

    
    if (fileDiff.length > MAX_DIFF_SIZE_BYTES) {
      continue
    }

    const lines = fileDiff.split('\n')

    
    const headerMatch = lines[0]?.match(/^a\/(.+?) b\/(.+)$/)
    if (!headerMatch) continue
    const filePath = headerMatch[2] ?? headerMatch[1] ?? ''

    
    const fileHunks: StructuredPatchHunk[] = []
    let currentHunk: StructuredPatchHunk | null = null
    let lineCount = 0

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i] ?? ''

      
      const hunkMatch = line.match(
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/,
      )
      if (hunkMatch) {
        if (currentHunk) {
          fileHunks.push(currentHunk)
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1] ?? '0', 10),
          oldLines: parseInt(hunkMatch[2] ?? '1', 10),
          newStart: parseInt(hunkMatch[3] ?? '0', 10),
          newLines: parseInt(hunkMatch[4] ?? '1', 10),
          lines: [],
        }
        continue
      }

      
      if (
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('Binary files')
      ) {
        continue
      }

      
      if (
        currentHunk &&
        (line.startsWith('+') ||
          line.startsWith('-') ||
          line.startsWith(' ') ||
          line === '')
      ) {
        
        if (lineCount >= MAX_LINES_PER_FILE) {
          continue
        }
        
        
        
        
        
        currentHunk.lines.push('' + line)
        lineCount++
      }
    }

    
    if (currentHunk) {
      fileHunks.push(currentHunk)
    }

    if (fileHunks.length > 0) {
      result.set(filePath, fileHunks)
    }
  }

  return result
}

async function isInTransientGitState(): Promise<boolean> {
  const gitDir = await getGitDir(getCwd())
  if (!gitDir) return false

  const transientFiles = [
    'MERGE_HEAD',
    'REBASE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
  ]

  const results = await Promise.all(
    transientFiles.map(file =>
      access(join(gitDir, file))
        .then(() => true)
        .catch(() => false),
    ),
  )
  return results.some(Boolean)
}

async function fetchUntrackedFiles(
  maxFiles: number,
): Promise<Map<string, PerFileStats> | null> {
  
  const { stdout, code } = await execFileNoThrow(
    gitExe(),
    ['--no-optional-locks', 'ls-files', '--others', '--exclude-standard'],
    { timeout: GIT_TIMEOUT_MS, preserveOutputOnError: false },
  )

  if (code !== 0 || !stdout.trim()) return null

  const untrackedPaths = stdout.trim().split('\n').filter(Boolean)
  if (untrackedPaths.length === 0) return null

  const perFileStats = new Map<string, PerFileStats>()

  
  for (const filePath of untrackedPaths.slice(0, maxFiles)) {
    perFileStats.set(filePath, {
      added: 0,
      removed: 0,
      isBinary: false,
      isUntracked: true,
    })
  }

  return perFileStats
}

export function parseShortstat(stdout: string): GitDiffStats | null {
  
  const match = stdout.match(
    /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/,
  )
  if (!match) return null
  return {
    filesCount: parseInt(match[1] ?? '0', 10),
    linesAdded: parseInt(match[2] ?? '0', 10),
    linesRemoved: parseInt(match[3] ?? '0', 10),
  }
}

const SINGLE_FILE_DIFF_TIMEOUT_MS = 3000

export type ToolUseDiff = {
  filename: string
  status: 'modified' | 'added'
  additions: number
  deletions: number
  changes: number
  patch: string
  
  repository: string | null
}

export async function fetchSingleFileGitDiff(
  absoluteFilePath: string,
): Promise<ToolUseDiff | null> {
  const gitRoot = findGitRoot(dirname(absoluteFilePath))
  if (!gitRoot) return null

  const gitPath = relative(gitRoot, absoluteFilePath).split(sep).join('/')
  const repository = getCachedRepository()

  
  const { code: lsFilesCode } = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'ls-files', '--error-unmatch', gitPath],
    { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
  )

  if (lsFilesCode === 0) {
    
    const diffRef = await getDiffRef(gitRoot)
    const { stdout, code } = await execFileNoThrowWithCwd(
      gitExe(),
      ['--no-optional-locks', 'diff', diffRef, '--', gitPath],
      { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
    )
    if (code !== 0) return null
    if (!stdout) return null
    return {
      ...parseRawDiffToToolUseDiff(gitPath, stdout, 'modified'),
      repository,
    }
  }

  
  const syntheticDiff = await generateSyntheticDiff(gitPath, absoluteFilePath)
  if (!syntheticDiff) return null
  return { ...syntheticDiff, repository }
}

function parseRawDiffToToolUseDiff(
  filename: string,
  rawDiff: string,
  status: 'modified' | 'added',
): Omit<ToolUseDiff, 'repository'> {
  const lines = rawDiff.split('\n')
  const patchLines: string[] = []
  let inHunks = false
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunks = true
    }
    if (inHunks) {
      patchLines.push(line)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }
  }

  return {
    filename,
    status,
    additions,
    deletions,
    changes: additions + deletions,
    patch: patchLines.join('\n'),
  }
}

async function getDiffRef(gitRoot: string): Promise<string> {
  const baseBranch =
    process.env.CLAUDE_CODE_NEXT_BASE_REF || (await getDefaultBranch())
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'merge-base', 'HEAD', baseBranch],
    { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
  )
  if (code === 0 && stdout.trim()) {
    return stdout.trim()
  }
  return 'HEAD'
}

async function generateSyntheticDiff(
  gitPath: string,
  absoluteFilePath: string,
): Promise<Omit<ToolUseDiff, 'repository'> | null> {
  try {
    if (!isFileWithinReadSizeLimit(absoluteFilePath, MAX_DIFF_SIZE_BYTES)) {
      return null
    }
    const content = await readFile(absoluteFilePath, 'utf-8')
    const lines = content.split('\n')
    
    if (lines.length > 0 && lines.at(-1) === '') {
      lines.pop()
    }
    const lineCount = lines.length
    const addedLines = lines.map(line => `+${line}`).join('\n')
    const patch = `@@ -0,0 +1,${lineCount} @@\n${addedLines}`
    return {
      filename: gitPath,
      status: 'added',
      additions: lineCount,
      deletions: 0,
      changes: lineCount,
      patch,
    }
  } catch {
    return null
  }
}
