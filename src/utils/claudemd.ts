

import { feature } from 'bun:bundle'
import ignore from 'ignore'
import memoize from 'lodash-es/memoize.js'
import { Lexer } from 'marked'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  sep,
} from 'path'
import picomatch from 'picomatch'
import { logEvent } from 'src/services/analytics/index.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  getOriginalCwd,
} from '../bootstrap/state.js'
import { truncateEntrypointContent } from '../memdir/memdir.js'
import { getAutoMemEntrypoint, isAutoMemoryEnabled } from '../memdir/paths.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getCurrentProjectConfig,
  getManagedClaudeRulesDir,
  getMemoryPath,
  getUserClaudeRulesDir,
} from './config.js'
import { logForDebugging } from './debug.js'
import { logForDiagnosticsNoPII } from './diagLogs.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getErrnoCode } from './errors.js'
import { normalizePathForComparison } from './file.js'
import { cacheKeys, type FileStateCache } from './fileStateCache.js'
import {
  parseFrontmatter,
  splitPathInFrontmatter,
} from './frontmatterParser.js'
import { getFsImplementation, safeResolvePath } from './fsOperations.js'
import { findCanonicalGitRoot, findGitRoot } from './git.js'
import {
  executeInstructionsLoadedHooks,
  hasInstructionsLoadedHook,
  type InstructionsLoadReason,
  type InstructionsMemoryType,
} from './hooks.js'
import type { MemoryType } from './memory/types.js'
import { expandPath } from './path.js'
import { pathInWorkingPath } from './permissions/filesystem.js'
import { isSettingSourceEnabled } from './settings/constants.js'
import { getInitialSettings } from './settings/settings.js'

const teamMemPaths = feature('TEAMMEM')
  ? (require('../memdir/teamMemPaths.js') as typeof import('../memdir/teamMemPaths.js'))
  : null

let hasLoggedInitialLoad = false

const MEMORY_INSTRUCTION_PROMPT =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'

export const MAX_MEMORY_CHARACTER_COUNT = 40000

const TEXT_FILE_EXTENSIONS = new Set([
  
  '.md',
  '.txt',
  '.text',
  
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  
  '.py',
  '.pyi',
  '.pyw',
  
  '.rb',
  '.erb',
  '.rake',
  
  '.go',
  
  '.rs',
  
  '.java',
  '.kt',
  '.kts',
  '.scala',
  
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.hxx',
  
  '.cs',
  
  '.swift',
  
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  
  '.sql',
  '.graphql',
  '.gql',
  
  '.proto',
  
  '.vue',
  '.svelte',
  '.astro',
  
  '.ejs',
  '.hbs',
  '.pug',
  '.jade',
  
  '.php',
  '.pl',
  '.pm',
  '.lua',
  '.r',
  '.R',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.clj',
  '.cljs',
  '.cljc',
  '.edn',
  '.hs',
  '.lhs',
  '.elm',
  '.ml',
  '.mli',
  '.f',
  '.f90',
  '.f95',
  '.for',
  
  '.cmake',
  '.make',
  '.makefile',
  '.gradle',
  '.sbt',
  
  '.rst',
  '.adoc',
  '.asciidoc',
  '.org',
  '.tex',
  '.latex',
  
  '.lock',
  
  '.log',
  '.diff',
  '.patch',
])

export type MemoryFileInfo = {
  path: string
  type: MemoryType
  content: string
  parent?: string 
  globs?: string[] 
  
  
  
  
  
  
  contentDiffersFromDisk?: boolean
  rawContent?: string
}

function pathInOriginalCwd(path: string): boolean {
  return pathInWorkingPath(path, getOriginalCwd())
}

function parseFrontmatterPaths(rawContent: string): {
  content: string
  paths?: string[]
} {
  const { frontmatter, content } = parseFrontmatter(rawContent)

  if (!frontmatter.paths) {
    return { content }
  }

  const patterns = splitPathInFrontmatter(frontmatter.paths)
    .map(pattern => {
      

export function stripHtmlComments(content: string): {
  content: string
  stripped: boolean
} {
  if (!content.includes('<!--')) {
    return { content, stripped: false }
  }
  
  return stripHtmlCommentsFromTokens(new Lexer({ gfm: false }).lex(content))
}

function stripHtmlCommentsFromTokens(tokens: ReturnType<Lexer['lex']>): {
  content: string
  stripped: boolean
} {
  let result = ''
  let stripped = false

  
  
  const commentSpan = /<!--[\s\S]*?-->/g

  for (const token of tokens) {
    if (token.type === 'html') {
      const trimmed = token.raw.trimStart()
      if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
        
        
        
        const residue = token.raw.replace(commentSpan, '')
        stripped = true
        if (residue.trim().length > 0) {
          
          result += residue
        }
        continue
      }
    }
    result += token.raw
  }

  return { content: result, stripped }
}

function parseMemoryFileContent(
  rawContent: string,
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
): { info: MemoryFileInfo | null; includePaths: string[] } {
  
  const ext = extname(filePath).toLowerCase()
  if (ext && !TEXT_FILE_EXTENSIONS.has(ext)) {
    logForDebugging(`Skipping non-text file in @include: ${filePath}`)
    return { info: null, includePaths: [] }
  }

  const { content: withoutFrontmatter, paths } =
    parseFrontmatterPaths(rawContent)

  
  
  
  const hasComment = withoutFrontmatter.includes('<!--')
  const tokens =
    hasComment || includeBasePath !== undefined
      ? new Lexer({ gfm: false }).lex(withoutFrontmatter)
      : undefined

  
  
  
  const strippedContent =
    hasComment && tokens
      ? stripHtmlCommentsFromTokens(tokens).content
      : withoutFrontmatter

  const includePaths =
    tokens && includeBasePath !== undefined
      ? extractIncludePathsFromTokens(tokens, includeBasePath)
      : []

  
  let finalContent = strippedContent
  if (type === 'AutoMem' || type === 'TeamMem') {
    finalContent = truncateEntrypointContent(strippedContent).content
  }

  
  const contentDiffersFromDisk = finalContent !== rawContent
  return {
    info: {
      path: filePath,
      type,
      content: finalContent,
      globs: paths,
      contentDiffersFromDisk,
      rawContent: contentDiffersFromDisk ? rawContent : undefined,
    },
    includePaths,
  }
}

function handleMemoryFileReadError(error: unknown, filePath: string): void {
  const code = getErrnoCode(error)
  
  if (code === 'ENOENT' || code === 'EISDIR') {
    return
  }
  
  if (code === 'EACCES') {
    
    logEvent('tengu_claude_md_permission_error', {
      is_access_error: 1,
      has_home_dir: filePath.includes(getClaudeConfigHomeDir()) ? 1 : 0,
    })
  }
}

async function safelyReadMemoryFileAsync(
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
): Promise<{ info: MemoryFileInfo | null; includePaths: string[] }> {
  try {
    const fs = getFsImplementation()
    const rawContent = await fs.readFile(filePath, { encoding: 'utf-8' })
    return parseMemoryFileContent(rawContent, filePath, type, includeBasePath)
  } catch (error) {
    handleMemoryFileReadError(error, filePath)
    return { info: null, includePaths: [] }
  }
}

type MarkdownToken = {
  type: string
  text?: string
  href?: string
  tokens?: MarkdownToken[]
  raw?: string
  items?: MarkdownToken[]
}

function extractIncludePathsFromTokens(
  tokens: ReturnType<Lexer['lex']>,
  basePath: string,
): string[] {
  const absolutePaths = new Set<string>()

  
  function extractPathsFromText(textContent: string) {
    const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
    let match
    while ((match = includeRegex.exec(textContent)) !== null) {
      let path = match[1]
      if (!path) continue

      
      const hashIndex = path.indexOf('#')
      if (hashIndex !== -1) {
        path = path.substring(0, hashIndex)
      }
      if (!path) continue

      
      path = path.replace(/\\ /g, ' ')

      
      if (path) {
        const isValidPath =
          path.startsWith('./') ||
          path.startsWith('~/') ||
          (path.startsWith('/') && path !== '/') ||
          (!path.startsWith('@') &&
            !path.match(/^[#%^&*()]+/) &&
            path.match(/^[a-zA-Z0-9._-]/))

        if (isValidPath) {
          const resolvedPath = expandPath(path, dirname(basePath))
          absolutePaths.add(resolvedPath)
        }
      }
    }
  }

  
  function processElements(elements: MarkdownToken[]) {
    for (const element of elements) {
      if (element.type === 'code' || element.type === 'codespan') {
        continue
      }

      
      
      
      if (element.type === 'html') {
        const raw = element.raw || ''
        const trimmed = raw.trimStart()
        if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
          const commentSpan = /<!--[\s\S]*?-->/g
          const residue = raw.replace(commentSpan, '')
          if (residue.trim().length > 0) {
            extractPathsFromText(residue)
          }
        }
        continue
      }

      
      if (element.type === 'text') {
        extractPathsFromText(element.text || '')
      }

      
      if (element.tokens) {
        processElements(element.tokens)
      }

      
      if (element.items) {
        processElements(element.items)
      }
    }
  }

  processElements(tokens as MarkdownToken[])
  return [...absolutePaths]
}

const MAX_INCLUDE_DEPTH = 5

function isClaudeMdExcluded(filePath: string, type: MemoryType): boolean {
  if (type !== 'User' && type !== 'Project' && type !== 'Local') {
    return false
  }

  const patterns = getInitialSettings().claudeMdExcludes
  if (!patterns || patterns.length === 0) {
    return false
  }

  const matchOpts = { dot: true }
  const normalizedPath = filePath.replaceAll('\\', '/')

  
  
  
  
  
  const expandedPatterns = resolveExcludePatterns(patterns).filter(
    p => p.length > 0,
  )
  if (expandedPatterns.length === 0) {
    return false
  }

  return picomatch.isMatch(normalizedPath, expandedPatterns, matchOpts)
}

function resolveExcludePatterns(patterns: string[]): string[] {
  const fs = getFsImplementation()
  const expanded: string[] = patterns.map(p => p.replaceAll('\\', '/'))

  for (const normalized of expanded) {
    
    
    if (!normalized.startsWith('/')) {
      continue
    }

    
    const globStart = normalized.search(/[*?{[]/)
    const staticPrefix =
      globStart === -1 ? normalized : normalized.slice(0, globStart)
    const dirToResolve = dirname(staticPrefix)

    try {
      
      const resolvedDir = fs.realpathSync(dirToResolve).replaceAll('\\', '/')
      if (resolvedDir !== dirToResolve) {
        const resolvedPattern =
          resolvedDir + normalized.slice(dirToResolve.length)
        expanded.push(resolvedPattern)
      }
    } catch {
      
    }
  }

  return expanded
}

export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
  depth: number = 0,
  parent?: string,
): Promise<MemoryFileInfo[]> {
  
  
  
  const normalizedPath = normalizePathForComparison(filePath)
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {
    return []
  }

  
  if (isClaudeMdExcluded(filePath, type)) {
    return []
  }

  
  const { resolvedPath, isSymlink } = safeResolvePath(
    getFsImplementation(),
    filePath,
  )

  processedPaths.add(normalizedPath)
  if (isSymlink) {
    processedPaths.add(normalizePathForComparison(resolvedPath))
  }

  const { info: memoryFile, includePaths: resolvedIncludePaths } =
    await safelyReadMemoryFileAsync(filePath, type, resolvedPath)
  if (!memoryFile || !memoryFile.content.trim()) {
    return []
  }

  
  if (parent) {
    memoryFile.parent = parent
  }

  const result: MemoryFileInfo[] = []

  
  result.push(memoryFile)

  for (const resolvedIncludePath of resolvedIncludePaths) {
    const isExternal = !pathInOriginalCwd(resolvedIncludePath)
    if (isExternal && !includeExternal) {
      continue
    }

    
    const includedFiles = await processMemoryFile(
      resolvedIncludePath,
      type,
      processedPaths,
      includeExternal,
      depth + 1,
      filePath, 
    )
    result.push(...includedFiles)
  }

  return result
}

export async function processMdRules({
  rulesDir,
  type,
  processedPaths,
  includeExternal,
  conditionalRule,
  visitedDirs = new Set(),
}: {
  rulesDir: string
  type: MemoryType
  processedPaths: Set<string>
  includeExternal: boolean
  conditionalRule: boolean
  visitedDirs?: Set<string>
}): Promise<MemoryFileInfo[]> {
  if (visitedDirs.has(rulesDir)) {
    return []
  }

  try {
    const fs = getFsImplementation()

    const { resolvedPath: resolvedRulesDir, isSymlink } = safeResolvePath(
      fs,
      rulesDir,
    )

    visitedDirs.add(rulesDir)
    if (isSymlink) {
      visitedDirs.add(resolvedRulesDir)
    }

    const result: MemoryFileInfo[] = []
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(resolvedRulesDir)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR') {
        return []
      }
      throw e
    }

    for (const entry of entries) {
      const entryPath = join(rulesDir, entry.name)
      const { resolvedPath: resolvedEntryPath, isSymlink } = safeResolvePath(
        fs,
        entryPath,
      )

      
      
      const stats = isSymlink ? await fs.stat(resolvedEntryPath) : null
      const isDirectory = stats ? stats.isDirectory() : entry.isDirectory()
      const isFile = stats ? stats.isFile() : entry.isFile()

      if (isDirectory) {
        result.push(
          ...(await processMdRules({
            rulesDir: resolvedEntryPath,
            type,
            processedPaths,
            includeExternal,
            conditionalRule,
            visitedDirs,
          })),
        )
      } else if (isFile && entry.name.endsWith('.md')) {
        const files = await processMemoryFile(
          resolvedEntryPath,
          type,
          processedPaths,
          includeExternal,
        )
        result.push(
          ...files.filter(f => (conditionalRule ? f.globs : !f.globs)),
        )
      }
    }

    return result
  } catch (error) {
    if (error instanceof Error && error.message.includes('EACCES')) {
      logEvent('tengu_claude_rules_md_permission_error', {
        is_access_error: 1,
        has_home_dir: rulesDir.includes(getClaudeConfigHomeDir()) ? 1 : 0,
      })
    }
    return []
  }
}

export const getMemoryFiles = memoize(
  async (forceIncludeExternal: boolean = false): Promise<MemoryFileInfo[]> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'memory_files_started')

    const result: MemoryFileInfo[] = []
    const processedPaths = new Set<string>()
    const config = getCurrentProjectConfig()
    const includeExternal =
      forceIncludeExternal ||
      config.hasClaudeMdExternalIncludesApproved ||
      false

    
    const managedClaudeMd = getMemoryPath('Managed')
    result.push(
      ...(await processMemoryFile(
        managedClaudeMd,
        'Managed',
        processedPaths,
        includeExternal,
      )),
    )
    
    const managedClaudeRulesDir = getManagedClaudeRulesDir()
    result.push(
      ...(await processMdRules({
        rulesDir: managedClaudeRulesDir,
        type: 'Managed',
        processedPaths,
        includeExternal,
        conditionalRule: false,
      })),
    )

    
    if (isSettingSourceEnabled('userSettings')) {
      const userClaudeMd = getMemoryPath('User')
      result.push(
        ...(await processMemoryFile(
          userClaudeMd,
          'User',
          processedPaths,
          true, 
        )),
      )
      
      const userClaudeRulesDir = getUserClaudeRulesDir()
      result.push(
        ...(await processMdRules({
          rulesDir: userClaudeRulesDir,
          type: 'User',
          processedPaths,
          includeExternal: true,
          conditionalRule: false,
        })),
      )
    }

    
    const dirs: string[] = []
    const originalCwd = getOriginalCwd()
    let currentDir = originalCwd

    while (currentDir !== parse(currentDir).root) {
      dirs.push(currentDir)
      currentDir = dirname(currentDir)
    }

    
    
    
    
    
    
    
    
    
    const gitRoot = findGitRoot(originalCwd)
    const canonicalRoot = findCanonicalGitRoot(originalCwd)
    const isNestedWorktree =
      gitRoot !== null &&
      canonicalRoot !== null &&
      normalizePathForComparison(gitRoot) !==
        normalizePathForComparison(canonicalRoot) &&
      pathInWorkingPath(gitRoot, canonicalRoot)

    
    for (const dir of dirs.reverse()) {
      
      
      const skipProject =
        isNestedWorktree &&
        pathInWorkingPath(dir, canonicalRoot) &&
        !pathInWorkingPath(dir, gitRoot)

      
      if (isSettingSourceEnabled('projectSettings') && !skipProject) {
        const projectPath = join(dir, 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            projectPath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        
        const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            dotClaudePath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        
        const rulesDir = join(dir, '.claude', 'rules')
        result.push(
          ...(await processMdRules({
            rulesDir,
            type: 'Project',
            processedPaths,
            includeExternal,
            conditionalRule: false,
          })),
        )
      }

      
      if (isSettingSourceEnabled('localSettings')) {
        const localPath = join(dir, 'CLAUDE.local.md')
        result.push(
          ...(await processMemoryFile(
            localPath,
            'Local',
            processedPaths,
            includeExternal,
          )),
        )
      }
    }

    
    
    
    
    if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_ADDITIONAL_DIRECTORIES_CLAUDE_MD)) {
      const additionalDirs = getAdditionalDirectoriesForClaudeMd()
      for (const dir of additionalDirs) {
        
        const projectPath = join(dir, 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            projectPath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        
        const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
        result.push(
          ...(await processMemoryFile(
            dotClaudePath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        
        const rulesDir = join(dir, '.claude', 'rules')
        result.push(
          ...(await processMdRules({
            rulesDir,
            type: 'Project',
            processedPaths,
            includeExternal,
            conditionalRule: false,
          })),
        )
      }
    }

    
    if (isAutoMemoryEnabled()) {
      const { info: memdirEntry } = await safelyReadMemoryFileAsync(
        getAutoMemEntrypoint(),
        'AutoMem',
      )
      if (memdirEntry) {
        const normalizedPath = normalizePathForComparison(memdirEntry.path)
        if (!processedPaths.has(normalizedPath)) {
          processedPaths.add(normalizedPath)
          result.push(memdirEntry)
        }
      }
    }

    
    if (feature('TEAMMEM') && teamMemPaths!.isTeamMemoryEnabled()) {
      const { info: teamMemEntry } = await safelyReadMemoryFileAsync(
        teamMemPaths!.getTeamMemEntrypoint(),
        'TeamMem',
      )
      if (teamMemEntry) {
        const normalizedPath = normalizePathForComparison(teamMemEntry.path)
        if (!processedPaths.has(normalizedPath)) {
          processedPaths.add(normalizedPath)
          result.push(teamMemEntry)
        }
      }
    }

    const totalContentLength = result.reduce(
      (sum, f) => sum + f.content.length,
      0,
    )

    logForDiagnosticsNoPII('info', 'memory_files_completed', {
      duration_ms: Date.now() - startTime,
      file_count: result.length,
      total_content_length: totalContentLength,
    })

    const typeCounts: Record<string, number> = {}
    for (const f of result) {
      typeCounts[f.type] = (typeCounts[f.type] ?? 0) + 1
    }

    if (!hasLoggedInitialLoad) {
      hasLoggedInitialLoad = true
      logEvent('tengu_claudemd__initial_load', {
        file_count: result.length,
        total_content_length: totalContentLength,
        user_count: typeCounts['User'] ?? 0,
        project_count: typeCounts['Project'] ?? 0,
        local_count: typeCounts['Local'] ?? 0,
        managed_count: typeCounts['Managed'] ?? 0,
        automem_count: typeCounts['AutoMem'] ?? 0,
        ...(feature('TEAMMEM')
          ? { teammem_count: typeCounts['TeamMem'] ?? 0 }
          : {}),
        duration_ms: Date.now() - startTime,
      })
    }

    
    
    
    
    
    
    
    
    
    
    
    
    if (!forceIncludeExternal) {
      const eagerLoadReason = consumeNextEagerLoadReason()
      if (eagerLoadReason !== undefined && hasInstructionsLoadedHook()) {
        for (const file of result) {
          if (!isInstructionsMemoryType(file.type)) continue
          const loadReason = file.parent ? 'include' : eagerLoadReason
          void executeInstructionsLoadedHooks(
            file.path,
            file.type,
            loadReason,
            {
              globs: file.globs,
              parentFilePath: file.parent,
            },
          )
        }
      }
    }

    return result
  },
)

function isInstructionsMemoryType(
  type: MemoryType,
): type is InstructionsMemoryType {
  return (
    type === 'User' ||
    type === 'Project' ||
    type === 'Local' ||
    type === 'Managed'
  )
}

let nextEagerLoadReason: InstructionsLoadReason = 'session_start'

let shouldFireHook = true

function consumeNextEagerLoadReason(): InstructionsLoadReason | undefined {
  if (!shouldFireHook) return undefined
  shouldFireHook = false
  const reason = nextEagerLoadReason
  nextEagerLoadReason = 'session_start'
  return reason
}

export function clearMemoryFileCaches(): void {
  
  getMemoryFiles.cache?.clear?.()
}

export function resetGetMemoryFilesCache(
  reason: InstructionsLoadReason = 'session_start',
): void {
  nextEagerLoadReason = reason
  shouldFireHook = true
  clearMemoryFileCaches()
}

export function getLargeMemoryFiles(files: MemoryFileInfo[]): MemoryFileInfo[] {
  return files.filter(f => f.content.length > MAX_MEMORY_CHARACTER_COUNT)
}

export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
): MemoryFileInfo[] {
  const skipMemoryIndex = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_moth_copse',
    false,
  )
  if (!skipMemoryIndex) return files
  return files.filter(f => f.type !== 'AutoMem' && f.type !== 'TeamMem')
}

export const getClaudeMds = (
  memoryFiles: MemoryFileInfo[],
  filter?: (type: MemoryType) => boolean,
): string => {
  const memories: string[] = []
  const skipProjectLevel = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_paper_halyard',
    false,
  )

  for (const file of memoryFiles) {
    if (filter && !filter(file.type)) continue
    if (skipProjectLevel && (file.type === 'Project' || file.type === 'Local'))
      continue
    if (file.content) {
      const description =
        file.type === 'Project'
          ? ' (project instructions, checked into the codebase)'
          : file.type === 'Local'
            ? " (user's private project instructions, not checked in)"
            : feature('TEAMMEM') && file.type === 'TeamMem'
              ? ' (shared team memory, synced across the organization)'
              : file.type === 'AutoMem'
                ? " (user's auto-memory, persists across conversations)"
                : " (user's private global instructions for all projects)"

      const content = file.content.trim()
      if (feature('TEAMMEM') && file.type === 'TeamMem') {
        memories.push(
          `Contents of ${file.path}${description}:\n\n<team-memory-content source="shared">\n${content}\n</team-memory-content>`,
        )
      } else {
        memories.push(`Contents of ${file.path}${description}:\n\n${content}`)
      }
    }
  }

  if (memories.length === 0) {
    return ''
  }

  return `${MEMORY_INSTRUCTION_PROMPT}\n\n${memories.join('\n\n')}`
}

export async function getManagedAndUserConditionalRules(
  targetPath: string,
  processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  const result: MemoryFileInfo[] = []

  
  const managedClaudeRulesDir = getManagedClaudeRulesDir()
  result.push(
    ...(await processConditionedMdRules(
      targetPath,
      managedClaudeRulesDir,
      'Managed',
      processedPaths,
      false,
    )),
  )

  if (isSettingSourceEnabled('userSettings')) {
    

export async function getMemoryFilesForNestedDirectory(
  dir: string,
  targetPath: string,
  processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  const result: MemoryFileInfo[] = []

  
  if (isSettingSourceEnabled('projectSettings')) {
    const projectPath = join(dir, 'CLAUDE.md')
    result.push(
      ...(await processMemoryFile(
        projectPath,
        'Project',
        processedPaths,
        false,
      )),
    )
    const dotClaudePath = join(dir, '.claude', 'CLAUDE.md')
    result.push(
      ...(await processMemoryFile(
        dotClaudePath,
        'Project',
        processedPaths,
        false,
      )),
    )
  }

  
  if (isSettingSourceEnabled('localSettings')) {
    const localPath = join(dir, 'CLAUDE.local.md')
    result.push(
      ...(await processMemoryFile(localPath, 'Local', processedPaths, false)),
    )
  }

  const rulesDir = join(dir, '.claude', 'rules')

  
  
  const unconditionalProcessedPaths = new Set(processedPaths)
  result.push(
    ...(await processMdRules({
      rulesDir,
      type: 'Project',
      processedPaths: unconditionalProcessedPaths,
      includeExternal: false,
      conditionalRule: false,
    })),
  )

  
  result.push(
    ...(await processConditionedMdRules(
      targetPath,
      rulesDir,
      'Project',
      processedPaths,
      false,
    )),
  )

  
  for (const path of unconditionalProcessedPaths) {
    processedPaths.add(path)
  }

  return result
}

export async function getConditionalRulesForCwdLevelDirectory(
  dir: string,
  targetPath: string,
  processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  const rulesDir = join(dir, '.claude', 'rules')
  return processConditionedMdRules(
    targetPath,
    rulesDir,
    'Project',
    processedPaths,
    false,
  )
}

export async function processConditionedMdRules(
  targetPath: string,
  rulesDir: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
): Promise<MemoryFileInfo[]> {
  const conditionedRuleMdFiles = await processMdRules({
    rulesDir,
    type,
    processedPaths,
    includeExternal,
    conditionalRule: true,
  })

  
  return conditionedRuleMdFiles.filter(file => {
    if (!file.globs || file.globs.length === 0) {
      return false
    }

    
    
    const baseDir =
      type === 'Project'
        ? dirname(dirname(rulesDir)) 
        : getOriginalCwd() 

    const relativePath = isAbsolute(targetPath)
      ? relative(baseDir, targetPath)
      : targetPath
    
    
    
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    ) {
      return false
    }
    return ignore().add(file.globs).ignores(relativePath)
  })
}

export type ExternalClaudeMdInclude = {
  path: string
  parent: string
}

export function getExternalClaudeMdIncludes(
  files: MemoryFileInfo[],
): ExternalClaudeMdInclude[] {
  const externals: ExternalClaudeMdInclude[] = []
  for (const file of files) {
    if (file.type !== 'User' && file.parent && !pathInOriginalCwd(file.path)) {
      externals.push({ path: file.path, parent: file.parent })
    }
  }
  return externals
}

export function hasExternalClaudeMdIncludes(files: MemoryFileInfo[]): boolean {
  return getExternalClaudeMdIncludes(files).length > 0
}

export async function shouldShowClaudeMdExternalIncludesWarning(): Promise<boolean> {
  const config = getCurrentProjectConfig()
  if (
    config.hasClaudeMdExternalIncludesApproved ||
    config.hasClaudeMdExternalIncludesWarningShown
  ) {
    return false
  }

  return hasExternalClaudeMdIncludes(await getMemoryFiles(true))
}

export function getAllMemoryFilePaths(
  files: MemoryFileInfo[],
  readFileState: FileStateCache,
): string[] {
  const paths = new Set<string>()
  for (const file of files) {
    if (file.content.trim().length > 0) {
      paths.add(file.path)
    }
  }

  
  for (const filePath of cacheKeys(readFileState)) {
    if (isMemoryFilePath(filePath)) {
      paths.add(filePath)
    }
  }

  return Array.from(paths)
}
