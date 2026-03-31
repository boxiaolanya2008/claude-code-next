import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import ignore from 'ignore'
import memoize from 'lodash-es/memoize.js'
import { homedir, tmpdir } from 'os'
import { join, normalize, posix, sep } from 'path'
import { hasAutoMemPathOverride, isAutoMemPath } from 'src/memdir/paths.js'
import { isAgentMemoryPath } from 'src/tools/AgentTool/agentMemory.js'
import {
  CLAUDE_FOLDER_PERMISSION_PATTERN,
  FILE_EDIT_TOOL_NAME,
  GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN,
} from 'src/tools/FileEditTool/constants.js'
import type { z } from 'zod/v4'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import { checkStatsigFeatureGate_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import type { AnyObject, Tool, ToolPermissionContext } from '../../Tool.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { getCwd } from '../cwd.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  getFsImplementation,
  getPathsForPermissionCheck,
} from '../fsOperations.js'
import {
  containsPathTraversal,
  expandPath,
  getDirectoryForPath,
  sanitizePath,
} from '../path.js'
import { getPlanSlug, getPlansDirectory } from '../plans.js'
import { getPlatform } from '../platform.js'
import { getProjectDir } from '../sessionStorage.js'
import { SETTING_SOURCES } from '../settings/constants.js'
import {
  getSettingsFilePathForSource,
  getSettingsRootPathForSource,
} from '../settings/settings.js'
import { containsVulnerableUncPath } from '../shell/readOnlyCommandValidation.js'
import { getToolResultsDir } from '../toolResultStorage.js'
import { windowsPathToPosixPath } from '../windowsPaths.js'
import type {
  PermissionDecision,
  PermissionResult,
} from './PermissionResult.js'
import type { PermissionRule, PermissionRuleSource } from './PermissionRule.js'
import { createReadRuleSuggestion } from './PermissionUpdate.js'
import type { PermissionUpdate } from './PermissionUpdateSchema.js'
import { getRuleByContentsForToolName } from './permissions.js'

declare const MACRO: { VERSION: string }

export const DANGEROUS_FILES = [
  '.gitconfig',
  '.gitmodules',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.zprofile',
  '.profile',
  '.ripgreprc',
  '.mcp.json',
  '.claude.json',
] as const

export const DANGEROUS_DIRECTORIES = [
  '.git',
  '.vscode',
  '.idea',
  '.claude',
] as const

export function normalizeCaseForComparison(path: string): string {
  return path.toLowerCase()
}

export function getClaudeSkillScope(
  filePath: string,
): { skillName: string; pattern: string } | null {
  const absolutePath = expandPath(filePath)
  const absolutePathLower = normalizeCaseForComparison(absolutePath)

  const bases = [
    {
      dir: expandPath(join(getOriginalCwd(), '.claude', 'skills')),
      prefix: '/.claude/skills/',
    },
    {
      dir: expandPath(join(homedir(), '.claude', 'skills')),
      prefix: '~/.claude/skills/',
    },
  ]

  for (const { dir, prefix } of bases) {
    const dirLower = normalizeCaseForComparison(dir)
    
    for (const s of [sep, '/']) {
      if (absolutePathLower.startsWith(dirLower + s.toLowerCase())) {
        
        
        const rest = absolutePath.slice(dir.length + s.length)
        const slash = rest.indexOf('/')
        const bslash = sep === '\\' ? rest.indexOf('\\') : -1
        const cut =
          slash === -1
            ? bslash
            : bslash === -1
              ? slash
              : Math.min(slash, bslash)
        
        
        if (cut <= 0) return null
        const skillName = rest.slice(0, cut)
        
        
        
        
        if (!skillName || skillName === '.' || skillName.includes('..')) {
          return null
        }
        
        
        
        
        
        if (/[*?[\]]/.test(skillName)) return null
        return { skillName, pattern: prefix + skillName + '/**' }
      }
    }
  }

  return null
}

const DIR_SEP = posix.sep

export function relativePath(from: string, to: string): string {
  if (getPlatform() === 'windows') {
    
    const posixFrom = windowsPathToPosixPath(from)
    const posixTo = windowsPathToPosixPath(to)
    return posix.relative(posixFrom, posixTo)
  }
  
  return posix.relative(from, to)
}

export function toPosixPath(path: string): string {
  if (getPlatform() === 'windows') {
    return windowsPathToPosixPath(path)
  }
  return path
}

function getSettingsPaths(): string[] {
  return SETTING_SOURCES.map(source =>
    getSettingsFilePathForSource(source),
  ).filter(path => path !== undefined)
}

export function isClaudeSettingsPath(filePath: string): boolean {
  
  
  const expandedPath = expandPath(filePath)

  
  
  const normalizedPath = normalizeCaseForComparison(expandedPath)

  
  if (
    normalizedPath.endsWith(`${sep}.claude${sep}settings.json`) ||
    normalizedPath.endsWith(`${sep}.claude${sep}settings.local.json`)
  ) {
    
    return true
  }
  
  
  return getSettingsPaths().some(
    settingsPath => normalizeCaseForComparison(settingsPath) === normalizedPath,
  )
}

function isClaudeConfigFilePath(filePath: string): boolean {
  if (isClaudeSettingsPath(filePath)) {
    return true
  }

  
  
  
  const commandsDir = join(getOriginalCwd(), '.claude', 'commands')
  const agentsDir = join(getOriginalCwd(), '.claude', 'agents')
  const skillsDir = join(getOriginalCwd(), '.claude', 'skills')

  return (
    pathInWorkingPath(filePath, commandsDir) ||
    pathInWorkingPath(filePath, agentsDir) ||
    pathInWorkingPath(filePath, skillsDir)
  )
}

function isSessionPlanFile(absolutePath: string): boolean {
  
  
  
  const expectedPrefix = join(getPlansDirectory(), getPlanSlug())
  
  const normalizedPath = normalize(absolutePath)
  return (
    normalizedPath.startsWith(expectedPrefix) && normalizedPath.endsWith('.md')
  )
}

export function getSessionMemoryDir(): string {
  return join(getProjectDir(getCwd()), getSessionId(), 'session-memory') + sep
}

export function getSessionMemoryPath(): string {
  return join(getSessionMemoryDir(), 'summary.md')
}

function isSessionMemoryPath(absolutePath: string): boolean {
  
  const normalizedPath = normalize(absolutePath)
  return normalizedPath.startsWith(getSessionMemoryDir())
}

function isProjectDirPath(absolutePath: string): boolean {
  const projectDir = getProjectDir(getCwd())
  
  const normalizedPath = normalize(absolutePath)
  return (
    normalizedPath === projectDir || normalizedPath.startsWith(projectDir + sep)
  )
}

export function isScratchpadEnabled(): boolean {
  return checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_scratch')
}

export function getClaudeTempDirName(): string {
  if (getPlatform() === 'windows') {
    return 'claude'
  }
  
  
  const uid = process.getuid?.() ?? 0
  return `claude-${uid}`
}

export const getClaudeTempDir = memoize(function getClaudeTempDir(): string {
  const baseTmpDir =
    process.env.CLAUDE_CODE_NEXT_TMPDIR ||
    (getPlatform() === 'windows' ? tmpdir() : '/tmp')

  
  
  const fs = getFsImplementation()
  let resolvedBaseTmpDir = baseTmpDir
  try {
    resolvedBaseTmpDir = fs.realpathSync(baseTmpDir)
  } catch {
    
  }

  return join(resolvedBaseTmpDir, getClaudeTempDirName()) + sep
})

export const getBundledSkillsRoot = memoize(
  function getBundledSkillsRoot(): string {
    const nonce = randomBytes(16).toString('hex')
    return join(getClaudeTempDir(), 'bundled-skills', MACRO.VERSION, nonce)
  },
)

export function getProjectTempDir(): string {
  return join(getClaudeTempDir(), sanitizePath(getOriginalCwd())) + sep
}

export function getScratchpadDir(): string {
  return join(getProjectTempDir(), getSessionId(), 'scratchpad')
}

export async function ensureScratchpadDir(): Promise<string> {
  if (!isScratchpadEnabled()) {
    throw new Error('Scratchpad directory feature is not enabled')
  }

  const fs = getFsImplementation()
  const scratchpadDir = getScratchpadDir()

  
  
  await fs.mkdir(scratchpadDir, { mode: 0o700 })

  return scratchpadDir
}

function isScratchpadPath(absolutePath: string): boolean {
  if (!isScratchpadEnabled()) {
    return false
  }
  const scratchpadDir = getScratchpadDir()
  
  
  
  
  const normalizedPath = normalize(absolutePath)
  return (
    normalizedPath === scratchpadDir ||
    normalizedPath.startsWith(scratchpadDir + sep)
  )
}

function isDangerousFilePathToAutoEdit(path: string): boolean {
  const absolutePath = expandPath(path)
  const pathSegments = absolutePath.split(sep)
  const fileName = pathSegments.at(-1)

  
  
  if (path.startsWith('\\\\') || path.startsWith('//')) {
    return true
  }

  
  for (let i = 0; i < pathSegments.length; i++) {
    const segment = pathSegments[i]!
    const normalizedSegment = normalizeCaseForComparison(segment)

    for (const dir of DANGEROUS_DIRECTORIES) {
      if (normalizedSegment !== normalizeCaseForComparison(dir)) {
        continue
      }

      
      
      
      
      if (dir === '.claude') {
        const nextSegment = pathSegments[i + 1]
        if (
          nextSegment &&
          normalizeCaseForComparison(nextSegment) === 'worktrees'
        ) {
          break 
        }
      }

      return true
    }
  }

  
  if (fileName) {
    const normalizedFileName = normalizeCaseForComparison(fileName)
    if (
      (DANGEROUS_FILES as readonly string[]).some(
        dangerousFile =>
          normalizeCaseForComparison(dangerousFile) === normalizedFileName,
      )
    ) {
      return true
    }
  }

  return false
}

function hasSuspiciousWindowsPathPattern(path: string): boolean {
  
  
  
  
  
  
  
  
  if (getPlatform() === 'windows' || getPlatform() === 'wsl') {
    const colonIndex = path.indexOf(':', 2)
    if (colonIndex !== -1) {
      return true
    }
  }

  
  
  
  if (/~\d/.test(path)) {
    return true
  }

  
  
  if (
    path.startsWith('\\\\?\\') ||
    path.startsWith('\\\\.\\') ||
    path.startsWith('//?/') ||
    path.startsWith('//./')
  ) {
    return true
  }

  
  
  
  if (/[.\s]+$/.test(path)) {
    return true
  }

  
  
  
  if (/\.(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(path)) {
    return true
  }

  
  
  
  
  
  if (/(^|\/|\\)\.{3,}(\/|\\|$)/.test(path)) {
    return true
  }

  
  
  
  if (containsVulnerableUncPath(path)) {
    return true
  }

  return false
}

export function checkPathSafetyForAutoEdit(
  path: string,
  precomputedPathsToCheck?: readonly string[],
):
  | { safe: true }
  | { safe: false; message: string; classifierApprovable: boolean } {
  
  const pathsToCheck =
    precomputedPathsToCheck ?? getPathsForPermissionCheck(path)

  
  for (const pathToCheck of pathsToCheck) {
    if (hasSuspiciousWindowsPathPattern(pathToCheck)) {
      return {
        safe: false,
        message: `Claude requested permissions to write to ${path}, which contains a suspicious Windows path pattern that requires manual approval.`,
        classifierApprovable: false,
      }
    }
  }

  
  for (const pathToCheck of pathsToCheck) {
    if (isClaudeConfigFilePath(pathToCheck)) {
      return {
        safe: false,
        message: `Claude requested permissions to write to ${path}, but you haven't granted it yet.`,
        classifierApprovable: true,
      }
    }
  }

  
  for (const pathToCheck of pathsToCheck) {
    if (isDangerousFilePathToAutoEdit(pathToCheck)) {
      return {
        safe: false,
        message: `Claude requested permissions to edit ${path} which is a sensitive file.`,
        classifierApprovable: true,
      }
    }
  }

  
  return { safe: true }
}

export function allWorkingDirectories(
  context: ToolPermissionContext,
): Set<string> {
  return new Set([
    getOriginalCwd(),
    ...context.additionalWorkingDirectories.keys(),
  ])
}

export const getResolvedWorkingDirPaths = memoize(getPathsForPermissionCheck)

export function pathInAllowedWorkingPath(
  path: string,
  toolPermissionContext: ToolPermissionContext,
  precomputedPathsToCheck?: readonly string[],
): boolean {
  
  const pathsToCheck =
    precomputedPathsToCheck ?? getPathsForPermissionCheck(path)

  
  
  
  
  const workingPaths = Array.from(
    allWorkingDirectories(toolPermissionContext),
  ).flatMap(wp => getResolvedWorkingDirPaths(wp))

  
  
  return pathsToCheck.every(pathToCheck =>
    workingPaths.some(workingPath =>
      pathInWorkingPath(pathToCheck, workingPath),
    ),
  )
}

export function pathInWorkingPath(path: string, workingPath: string): boolean {
  const absolutePath = expandPath(path)
  const absoluteWorkingPath = expandPath(workingPath)

  
  
  
  const normalizedPath = absolutePath
    .replace(/^\/private\/var\
    .replace(/^\/private\/tmp(\/|$)/, '/tmp$1')
  const normalizedWorkingPath = absoluteWorkingPath
    .replace(/^\/private\/var\
    .replace(/^\/private\/tmp(\/|$)/, '/tmp$1')

  
  
  const caseNormalizedPath = normalizeCaseForComparison(normalizedPath)
  const caseNormalizedWorkingPath = normalizeCaseForComparison(
    normalizedWorkingPath,
  )

  
  const relative = relativePath(caseNormalizedWorkingPath, caseNormalizedPath)

  
  if (relative === '') {
    return true
  }

  if (containsPathTraversal(relative)) {
    return false
  }

  
  return !posix.isAbsolute(relative)
}

function rootPathForSource(source: PermissionRuleSource): string {
  switch (source) {
    case 'cliArg':
    case 'command':
    case 'session':
      return expandPath(getOriginalCwd())
    case 'userSettings':
    case 'policySettings':
    case 'projectSettings':
    case 'localSettings':
    case 'flagSettings':
      return getSettingsRootPathForSource(source)
  }
}

function prependDirSep(path: string): string {
  return posix.join(DIR_SEP, path)
}

function normalizePatternToPath({
  patternRoot,
  pattern,
  rootPath,
}: {
  patternRoot: string
  pattern: string
  rootPath: string
}): string | null {
  
  const fullPattern = posix.join(patternRoot, pattern)
  if (patternRoot === rootPath) {
    
    return prependDirSep(pattern)
  } else if (fullPattern.startsWith(`${rootPath}${DIR_SEP}`)) {
    
    const relativePart = fullPattern.slice(rootPath.length)
    return prependDirSep(relativePart)
  } else {
    
    const relativePath = posix.relative(rootPath, patternRoot)
    if (
      !relativePath ||
      relativePath.startsWith(`..${DIR_SEP}`) ||
      relativePath === '..'
    ) {
      
      return null
    } else {
      const relativePattern = posix.join(relativePath, pattern)
      return prependDirSep(relativePattern)
    }
  }
}

export function normalizePatternsToPath(
  patternsByRoot: Map<string | null, string[]>,
  root: string,
): string[] {
  
  const result = new Set(patternsByRoot.get(null) ?? [])

  for (const [patternRoot, patterns] of patternsByRoot.entries()) {
    if (patternRoot === null) {
      
      continue
    }

    
    for (const pattern of patterns) {
      const normalizedPattern = normalizePatternToPath({
        patternRoot,
        pattern,
        rootPath: root,
      })
      if (normalizedPattern) {
        result.add(normalizedPattern)
      }
    }
  }
  return Array.from(result)
}

export function getFileReadIgnorePatterns(
  toolPermissionContext: ToolPermissionContext,
): Map<string | null, string[]> {
  const patternsByRoot = getPatternsByRoot(
    toolPermissionContext,
    'read',
    'deny',
  )
  const result = new Map<string | null, string[]>()
  for (const [patternRoot, patternMap] of patternsByRoot.entries()) {
    result.set(patternRoot, Array.from(patternMap.keys()))
  }

  return result
}

function patternWithRoot(
  pattern: string,
  source: PermissionRuleSource,
): {
  relativePattern: string
  root: string | null
} {
  if (pattern.startsWith(`${DIR_SEP}${DIR_SEP}`)) {
    
    const patternWithoutDoubleSlash = pattern.slice(1)

    
    
    
    if (
      getPlatform() === 'windows' &&
      patternWithoutDoubleSlash.match(/^\/[a-z]\
    ) {
      
      
      const driveLetter = patternWithoutDoubleSlash[1]?.toUpperCase() ?? 'C'
      
      const pathAfterDrive = patternWithoutDoubleSlash.slice(2)

      
      const driveRoot = `${driveLetter}:\\`
      const relativeFromDrive = pathAfterDrive.startsWith('/')
        ? pathAfterDrive.slice(1)
        : pathAfterDrive

      return {
        relativePattern: relativeFromDrive,
        root: driveRoot,
      }
    }

    return {
      relativePattern: patternWithoutDoubleSlash,
      root: DIR_SEP,
    }
  } else if (pattern.startsWith(`~${DIR_SEP}`)) {
    
    return {
      relativePattern: pattern.slice(1),
      root: homedir().normalize('NFC'),
    }
  } else if (pattern.startsWith(DIR_SEP)) {
    
    return {
      relativePattern: pattern,
      root: rootPathForSource(source),
    }
  }
  
  
  
  let normalizedPattern = pattern
  if (pattern.startsWith(`.${DIR_SEP}`)) {
    normalizedPattern = pattern.slice(2)
  }
  return {
    relativePattern: normalizedPattern,
    root: null,
  }
}

function getPatternsByRoot(
  toolPermissionContext: ToolPermissionContext,
  toolType: 'edit' | 'read',
  behavior: 'allow' | 'deny' | 'ask',
): Map<string | null, Map<string, PermissionRule>> {
  const toolName = (() => {
    switch (toolType) {
      case 'edit':
        
        return FILE_EDIT_TOOL_NAME
      case 'read':
        
        return FILE_READ_TOOL_NAME
    }
  })()

  const rules = getRuleByContentsForToolName(
    toolPermissionContext,
    toolName,
    behavior,
  )
  
  const patternsByRoot = new Map<string | null, Map<string, PermissionRule>>()
  for (const [pattern, rule] of rules.entries()) {
    const { relativePattern, root } = patternWithRoot(pattern, rule.source)
    let patternsForRoot = patternsByRoot.get(root)
    if (patternsForRoot === undefined) {
      patternsForRoot = new Map<string, PermissionRule>()
      patternsByRoot.set(root, patternsForRoot)
    }
    
    patternsForRoot.set(relativePattern, rule)
  }
  return patternsByRoot
}

export function matchingRuleForInput(
  path: string,
  toolPermissionContext: ToolPermissionContext,
  toolType: 'edit' | 'read',
  behavior: 'allow' | 'deny' | 'ask',
): PermissionRule | null {
  let fileAbsolutePath = expandPath(path)

  
  if (getPlatform() === 'windows' && fileAbsolutePath.includes('\\')) {
    fileAbsolutePath = windowsPathToPosixPath(fileAbsolutePath)
  }

  const patternsByRoot = getPatternsByRoot(
    toolPermissionContext,
    toolType,
    behavior,
  )

  
  for (const [root, patternMap] of patternsByRoot.entries()) {
    
    const patterns = Array.from(patternMap.keys()).map(pattern => {
      let adjustedPattern = pattern

      
      
      if (adjustedPattern.endsWith('

