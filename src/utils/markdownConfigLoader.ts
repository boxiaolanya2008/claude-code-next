import { feature } from "../utils/bundle-mock.ts"
import { statSync } from 'fs'
import { lstat, readdir, readFile, realpath, stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { homedir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getProjectRoot } from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { isFsInaccessible } from './errors.js'
import { normalizePathForComparison } from './file.js'
import type { FrontmatterData } from './frontmatterParser.js'
import { parseFrontmatter } from './frontmatterParser.js'
import { findCanonicalGitRoot, findGitRoot } from './git.js'
import { parseToolListFromCLI } from './permissions/permissionSetup.js'
import { ripGrep } from './ripgrep.js'
import {
  isSettingSourceEnabled,
  type SettingSource,
} from './settings/constants.js'
import { getManagedFilePath } from './settings/managedPath.js'
import { isRestrictedToPluginOnly } from './settings/pluginOnlyPolicy.js'

export const CLAUDE_CONFIG_DIRECTORIES = [
  'commands',
  'agents',
  'output-styles',
  'skills',
  'workflows',
  ...(feature('TEMPLATES') ? (['templates'] as const) : []),
] as const

export type ClaudeConfigDirectory = (typeof CLAUDE_CONFIG_DIRECTORIES)[number]

export type MarkdownFile = {
  filePath: string
  baseDir: string
  frontmatter: FrontmatterData
  content: string
  source: SettingSource
}

export function extractDescriptionFromMarkdown(
  content: string,
  defaultDescription: string = 'Custom item',
): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      
      const headerMatch = trimmed.match(/^#+\s+(.+)$/)
      const text = headerMatch?.[1] ?? trimmed

      
      return text.length > 100 ? text.substring(0, 97) + '...' : text
    }
  }
  return defaultDescription
}

function parseToolListString(toolsValue: unknown): string[] | null {
  
  if (toolsValue === undefined || toolsValue === null) {
    return null
  }

  
  if (!toolsValue) {
    return []
  }

  let toolsArray: string[] = []
  if (typeof toolsValue === 'string') {
    toolsArray = [toolsValue]
  } else if (Array.isArray(toolsValue)) {
    toolsArray = toolsValue.filter(
      (item): item is string => typeof item === 'string',
    )
  }

  if (toolsArray.length === 0) {
    return []
  }

  const parsedTools = parseToolListFromCLI(toolsArray)
  if (parsedTools.includes('*')) {
    return ['*']
  }
  return parsedTools
}

export function parseAgentToolsFromFrontmatter(
  toolsValue: unknown,
): string[] | undefined {
  const parsed = parseToolListString(toolsValue)
  if (parsed === null) {
    
    return toolsValue === undefined ? undefined : []
  }
  
  if (parsed.includes('*')) {
    return undefined
  }
  return parsed
}

export function parseSlashCommandToolsFromFrontmatter(
  toolsValue: unknown,
): string[] {
  const parsed = parseToolListString(toolsValue)
  if (parsed === null) {
    return []
  }
  return parsed
}

async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    const stats = await lstat(filePath, { bigint: true })
    
    
    
    if (stats.dev === 0n && stats.ino === 0n) {
      return null
    }
    return `${stats.dev}:${stats.ino}`
  } catch {
    return null
  }
}

function resolveStopBoundary(cwd: string): string | null {
  const cwdGitRoot = findGitRoot(cwd)
  const sessionGitRoot = findGitRoot(getProjectRoot())
  if (!cwdGitRoot || !sessionGitRoot) {
    return cwdGitRoot
  }
  
  
  const cwdCanonical = findCanonicalGitRoot(cwd)
  if (
    cwdCanonical &&
    normalizePathForComparison(cwdCanonical) ===
      normalizePathForComparison(sessionGitRoot)
  ) {
    
    return cwdGitRoot
  }
  
  const nCwdGitRoot = normalizePathForComparison(cwdGitRoot)
  const nSessionRoot = normalizePathForComparison(sessionGitRoot)
  if (
    nCwdGitRoot !== nSessionRoot &&
    nCwdGitRoot.startsWith(nSessionRoot + sep)
  ) {
    
    return sessionGitRoot
  }
  
  return cwdGitRoot
}

export function getProjectDirsUpToHome(
  subdir: ClaudeConfigDirectory,
  cwd: string,
): string[] {
  const home = resolve(homedir()).normalize('NFC')
  const gitRoot = resolveStopBoundary(cwd)
  let current = resolve(cwd)
  const dirs: string[] = []

  
  while (true) {
    
    
    if (
      normalizePathForComparison(current) === normalizePathForComparison(home)
    ) {
      break
    }

    const claudeSubdir = join(current, '.claude', subdir)
    
    
    
    
    
    
    try {
      statSync(claudeSubdir)
      dirs.push(claudeSubdir)
    } catch (e: unknown) {
      if (!isFsInaccessible(e)) throw e
    }

    
    
    if (
      gitRoot &&
      normalizePathForComparison(current) ===
        normalizePathForComparison(gitRoot)
    ) {
      break
    }

    
    const parent = dirname(current)

    
    if (parent === current) {
      break
    }

    current = parent
  }

  return dirs
}

export const loadMarkdownFilesForSubdir = memoize(
  async function (
    subdir: ClaudeConfigDirectory,
    cwd: string,
  ): Promise<MarkdownFile[]> {
    const searchStartTime = Date.now()
    const userDir = join(getClaudeConfigHomeDir(), subdir)
    const managedDir = join(getManagedFilePath(), '.claude', subdir)
    const projectDirs = getProjectDirsUpToHome(subdir, cwd)

    
    
    
    
    
    
    
    
    
    
    
    
    
    const gitRoot = findGitRoot(cwd)
    const canonicalRoot = findCanonicalGitRoot(cwd)
    if (gitRoot && canonicalRoot && canonicalRoot !== gitRoot) {
      const worktreeSubdir = normalizePathForComparison(
        join(gitRoot, '.claude', subdir),
      )
      const worktreeHasSubdir = projectDirs.some(
        dir => normalizePathForComparison(dir) === worktreeSubdir,
      )
      if (!worktreeHasSubdir) {
        const mainClaudeSubdir = join(canonicalRoot, '.claude', subdir)
        if (!projectDirs.includes(mainClaudeSubdir)) {
          projectDirs.push(mainClaudeSubdir)
        }
      }
    }

    const [managedFiles, userFiles, projectFilesNested] = await Promise.all([
      
      loadMarkdownFiles(managedDir).then(_ =>
        _.map(file => ({
          ...file,
          baseDir: managedDir,
          source: 'policySettings' as const,
        })),
      ),
      
      isSettingSourceEnabled('userSettings') &&
      !(subdir === 'agents' && isRestrictedToPluginOnly('agents'))
        ? loadMarkdownFiles(userDir).then(_ =>
            _.map(file => ({
              ...file,
              baseDir: userDir,
              source: 'userSettings' as const,
            })),
          )
        : Promise.resolve([]),
      
      isSettingSourceEnabled('projectSettings') &&
      !(subdir === 'agents' && isRestrictedToPluginOnly('agents'))
        ? Promise.all(
            projectDirs.map(projectDir =>
              loadMarkdownFiles(projectDir).then(_ =>
                _.map(file => ({
                  ...file,
                  baseDir: projectDir,
                  source: 'projectSettings' as const,
                })),
              ),
            ),
          )
        : Promise.resolve([]),
    ])

    
    const projectFiles = projectFilesNested.flat()

    
    const allFiles = [...managedFiles, ...userFiles, ...projectFiles]

    
    
    
    
    const fileIdentities = await Promise.all(
      allFiles.map(file => getFileIdentity(file.filePath)),
    )

    const seenFileIds = new Map<string, SettingSource>()
    const deduplicatedFiles: MarkdownFile[] = []

    for (const [i, file] of allFiles.entries()) {
      const fileId = fileIdentities[i] ?? null
      if (fileId === null) {
        
        deduplicatedFiles.push(file)
        continue
      }
      const existingSource = seenFileIds.get(fileId)
      if (existingSource !== undefined) {
        logForDebugging(
          `Skipping duplicate file '${file.filePath}' from ${file.source} (same inode already loaded from ${existingSource})`,
        )
        continue
      }
      seenFileIds.set(fileId, file.source)
      deduplicatedFiles.push(file)
    }

    const duplicatesRemoved = allFiles.length - deduplicatedFiles.length
    if (duplicatesRemoved > 0) {
      logForDebugging(
        `Deduplicated ${duplicatesRemoved} files in ${subdir} (same inode via symlinks or hard links)`,
      )
    }

    logEvent(`tengu_dir_search`, {
      durationMs: Date.now() - searchStartTime,
      managedFilesFound: managedFiles.length,
      userFilesFound: userFiles.length,
      projectFilesFound: projectFiles.length,
      projectDirsSearched: projectDirs.length,
      subdir:
        subdir as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    return deduplicatedFiles
  },
  
  (subdir: ClaudeConfigDirectory, cwd: string) => `${subdir}:${cwd}`,
)

async function findMarkdownFilesNative(
  dir: string,
  signal: AbortSignal,
): Promise<string[]> {
  const files: string[] = []
  const visitedDirs = new Set<string>()

  async function walk(currentDir: string): Promise<void> {
    if (signal.aborted) {
      return
    }

    
    
    
    
    try {
      const stats = await stat(currentDir, { bigint: true })
      if (stats.isDirectory()) {
        const dirKey =
          stats.dev !== undefined && stats.ino !== undefined
            ? `${stats.dev}:${stats.ino}` 
            : await realpath(currentDir) 

        if (visitedDirs.has(dirKey)) {
          logForDebugging(
            `Skipping already visited directory (circular symlink): ${currentDir}`,
          )
          return
        }
        visitedDirs.add(dirKey)
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logForDebugging(`Failed to stat directory ${currentDir}: ${errorMessage}`)
      return
    }

    try {
      const entries = await readdir(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        if (signal.aborted) {
          break
        }

        const fullPath = join(currentDir, entry.name)

        try {
          
          if (entry.isSymbolicLink()) {
            try {
              const stats = await stat(fullPath) 
              if (stats.isDirectory()) {
                await walk(fullPath)
              } else if (stats.isFile() && entry.name.endsWith('.md')) {
                files.push(fullPath)
              }
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error)
              logForDebugging(
                `Failed to follow symlink ${fullPath}: ${errorMessage}`,
              )
            }
          } else if (entry.isDirectory()) {
            await walk(fullPath)
          } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(fullPath)
          }
        } catch (error) {
          
          const errorMessage =
            error instanceof Error ? error.message : String(error)
          logForDebugging(`Failed to access ${fullPath}: ${errorMessage}`)
        }
      }
    } catch (error) {
      
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      logForDebugging(`Failed to read directory ${currentDir}: ${errorMessage}`)
    }
  }

  await walk(dir)
  return files
}

async function loadMarkdownFiles(dir: string): Promise<
  {
    filePath: string
    frontmatter: FrontmatterData
    content: string
  }[]
> {
  
  
  
  
  
  const useNative = isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_NATIVE_FILE_SEARCH)
  const signal = AbortSignal.timeout(3000)
  let files: string[]
  try {
    files = useNative
      ? await findMarkdownFilesNative(dir, signal)
      : await ripGrep(
          ['--files', '--hidden', '--follow', '--no-ignore', '--glob', '*.md'],
          dir,
          signal,
        )
  } catch (e: unknown) {
    
    
    
    if (isFsInaccessible(e)) return []
    throw e
  }

  const results = await Promise.all(
    files.map(async filePath => {
      try {
        const rawContent = await readFile(filePath, { encoding: 'utf-8' })
        const { frontmatter, content } = parseFrontmatter(rawContent, filePath)

        return {
          filePath,
          frontmatter,
          content,
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        logForDebugging(
          `Failed to read/parse markdown file:  ${filePath}: ${errorMessage}`,
        )
        return null
      }
    }),
  )

  return results.filter(_ => _ !== null)
}
