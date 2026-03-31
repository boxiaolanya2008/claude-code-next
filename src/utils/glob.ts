import { basename, dirname, isAbsolute, join, sep } from 'path'
import type { ToolPermissionContext } from '../Tool.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { getGlobExclusionsForPluginCache } from './plugins/orphanedPluginFilter.js'
import { ripGrep } from './ripgrep.js'

export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
    
    
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  
  const staticPrefix = pattern.slice(0, match.index)

  
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
    
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  
  
  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  
  
  
  if (getPlatform() === 'windows' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  toolPermissionContext: ToolPermissionContext,
): Promise<{ files: string[]; truncated: boolean }> {
  let searchDir = cwd
  let searchPattern = filePattern

  
  
  if (isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) {
      searchDir = baseDir
      searchPattern = relativePattern
    }
  }

  const ignorePatterns = normalizePatternsToPath(
    getFileReadIgnorePatterns(toolPermissionContext),
    searchDir,
  )

  
  
  
  
  
  
  
  const noIgnore = isEnvTruthy(process.env.CLAUDE_CODE_NEXT_GLOB_NO_IGNORE || 'true')
  const hidden = isEnvTruthy(process.env.CLAUDE_CODE_NEXT_GLOB_HIDDEN || 'true')
  const args = [
    '--files',
    '--glob',
    searchPattern,
    '--sort=modified',
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden ? ['--hidden'] : []),
  ]

  
  for (const pattern of ignorePatterns) {
    args.push('--glob', `!${pattern}`)
  }

  
  for (const exclusion of await getGlobExclusionsForPluginCache(searchDir)) {
    args.push('--glob', exclusion)
  }

  const allPaths = await ripGrep(args, searchDir, abortSignal)

  
  const absolutePaths = allPaths.map(p =>
    isAbsolute(p) ? p : join(searchDir, p),
  )

  const truncated = absolutePaths.length > offset + limit
  const files = absolutePaths.slice(offset, offset + limit)

  return { files, truncated }
}
