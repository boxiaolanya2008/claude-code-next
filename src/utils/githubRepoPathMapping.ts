import { realpath } from 'fs/promises'
import { getOriginalCwd } from '../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { logForDebugging } from './debug.js'
import {
  detectCurrentRepository,
  parseGitHubRepository,
} from './detectRepository.js'
import { pathExists } from './file.js'
import { getRemoteUrlForDir } from './git/gitFilesystem.js'
import { findGitRoot } from './git.js'

export async function updateGithubRepoPathMapping(): Promise<void> {
  try {
    const repo = await detectCurrentRepository()
    if (!repo) {
      logForDebugging(
        'Not in a GitHub repository, skipping path mapping update',
      )
      return
    }

    
    
    const cwd = getOriginalCwd()
    const gitRoot = findGitRoot(cwd)
    const basePath = gitRoot ?? cwd

    
    let currentPath: string
    try {
      currentPath = (await realpath(basePath)).normalize('NFC')
    } catch {
      currentPath = basePath
    }

    
    const repoKey = repo.toLowerCase()

    const config = getGlobalConfig()
    const existingPaths = config.githubRepoPaths?.[repoKey] ?? []

    if (existingPaths[0] === currentPath) {
      
      logForDebugging(`Path ${currentPath} already tracked for repo ${repoKey}`)
      return
    }

    
    const withoutCurrent = existingPaths.filter(p => p !== currentPath)
    const updatedPaths = [currentPath, ...withoutCurrent]

    saveGlobalConfig(current => ({
      ...current,
      githubRepoPaths: {
        ...current.githubRepoPaths,
        [repoKey]: updatedPaths,
      },
    }))

    logForDebugging(`Added ${currentPath} to tracked paths for repo ${repoKey}`)
  } catch (error) {
    logForDebugging(`Error updating repo path mapping: ${error}`)
    
  }
}

export function getKnownPathsForRepo(repo: string): string[] {
  const config = getGlobalConfig()
  const repoKey = repo.toLowerCase()
  return config.githubRepoPaths?.[repoKey] ?? []
}

export async function filterExistingPaths(paths: string[]): Promise<string[]> {
  const results = await Promise.all(paths.map(pathExists))
  return paths.filter((_, i) => results[i])
}

export async function validateRepoAtPath(
  path: string,
  expectedRepo: string,
): Promise<boolean> {
  try {
    const remoteUrl = await getRemoteUrlForDir(path)
    if (!remoteUrl) {
      return false
    }

    const actualRepo = parseGitHubRepository(remoteUrl)
    if (!actualRepo) {
      return false
    }

    
    return actualRepo.toLowerCase() === expectedRepo.toLowerCase()
  } catch {
    return false
  }
}

export function removePathFromRepo(repo: string, pathToRemove: string): void {
  const config = getGlobalConfig()
  const repoKey = repo.toLowerCase()
  const existingPaths = config.githubRepoPaths?.[repoKey] ?? []

  const updatedPaths = existingPaths.filter(path => path !== pathToRemove)

  if (updatedPaths.length === existingPaths.length) {
    
    return
  }

  const updatedMapping = { ...config.githubRepoPaths }

  if (updatedPaths.length === 0) {
    
    delete updatedMapping[repoKey]
  } else {
    updatedMapping[repoKey] = updatedPaths
  }

  saveGlobalConfig(current => ({
    ...current,
    githubRepoPaths: updatedMapping,
  }))

  logForDebugging(
    `Removed ${pathToRemove} from tracked paths for repo ${repoKey}`,
  )
}
