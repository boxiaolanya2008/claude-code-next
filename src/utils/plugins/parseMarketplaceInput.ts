import { homedir } from 'os'
import { resolve } from 'path'
import { getErrnoCode } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import type { MarketplaceSource } from './schemas.js'

export async function parseMarketplaceInput(
  input: string,
): Promise<MarketplaceSource | { error: string } | null> {
  const trimmed = input.trim()
  const fs = getFsImplementation()

  
  
  
  const sshMatch = trimmed.match(
    /^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$/,
  )
  if (sshMatch?.[1]) {
    const url = sshMatch[1]
    const ref = sshMatch[3]
    return ref ? { source: 'git', url, ref } : { source: 'git', url }
  }

  // Handle URLs
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    // Extract fragment (ref) from URL if present
    const fragmentMatch = trimmed.match(/^([^#]+)(#(.+))?$/)
    const urlWithoutFragment = fragmentMatch?.[1] || trimmed
    const ref = fragmentMatch?.[3]

    
    
    
    
    // TF401019 "repo does not exist"). Without this check, an ADO URL falls
    
    
    // received string". (gh-31256 / CC-299)
    if (
      urlWithoutFragment.endsWith('.git') ||
      urlWithoutFragment.includes('/_git/')
    ) {
      return ref
        ? { source: 'git', url: urlWithoutFragment, ref }
        : { source: 'git', url: urlWithoutFragment }
    }
    // Parse URL to check hostname
    let url: URL
    try {
      url = new URL(urlWithoutFragment)
    } catch (_err) {
      // Not a valid URL for parsing, treat as generic URL
      // new URL() throws TypeError for invalid URLs
      return { source: 'url', url: urlWithoutFragment }
    }

    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const match = url.pathname.match(/^\/([^/]+\/[^/]+?)(\/|\.git|$)/)
      if (match?.[1]) {
        // User explicitly provided HTTPS URL - keep it as HTTPS via 'git' type
        // Add .git suffix if not present for proper git clone
        const gitUrl = urlWithoutFragment.endsWith('.git')
          ? urlWithoutFragment
          : `${urlWithoutFragment}.git`
        return ref
          ? { source: 'git', url: gitUrl, ref }
          : { source: 'git', url: gitUrl }
      }
    }
    return { source: 'url', url: urlWithoutFragment }
  }

  // Handle local paths
  // On Windows, also recognize backslash-relative (.\, ..\) and drive letter paths (C:\)
  // These are Windows-only because backslashes are valid filename chars on Unix
  const isWindows = process.platform === 'win32'
  const isWindowsPath =
    isWindows &&
    (trimmed.startsWith('.\\') ||
      trimmed.startsWith('..\\') ||
      /^[a-zA-Z]:[/\\]/.test(trimmed))
  if (
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    isWindowsPath
  ) {
    const resolvedPath = resolve(
      trimmed.startsWith('~') ? trimmed.replace(/^~/, homedir()) : trimmed,
    )

    // Stat the path to determine if it's a file or directory. Swallow all stat
    // errors (ENOENT, EACCES, EPERM, etc.) and return an error result instead
    // of throwing — matches the old existsSync behavior which never threw.
    let stats
    try {
      stats = await fs.stat(resolvedPath)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      return {
        error:
          code === 'ENOENT'
            ? `Path does not exist: ${resolvedPath}`
            : `Cannot access path: ${resolvedPath} (${code ?? e})`,
      }
    }

    if (stats.isFile()) {
      if (resolvedPath.endsWith('.json')) {
        return { source: 'file', path: resolvedPath }
      } else {
        return {
          error: `File path must point to a .json file (marketplace.json), but got: ${resolvedPath}`,
        }
      }
    } else if (stats.isDirectory()) {
      return { source: 'directory', path: resolvedPath }
    } else {
      return {
        error: `Path is neither a file nor a directory: ${resolvedPath}`,
      }
    }
  }

  // Handle GitHub shorthand (owner/repo, owner/repo#ref, or owner/repo@ref)
  // Accept both # and @ as ref separators — the display formatter uses @, so users
  // naturally type @ when copying from error messages or managed settings.
  if (trimmed.includes('/') && !trimmed.startsWith('@')) {
    if (trimmed.includes(':')) {
      return null
    }
    // Extract ref if present (either #ref or @ref)
    const fragmentMatch = trimmed.match(/^([^#@]+)(?:[#@](.+))?$/)
    const repo = fragmentMatch?.[1] || trimmed
    const ref = fragmentMatch?.[2]
    // Assume it's a GitHub repo
    return ref ? { source: 'github', repo, ref } : { source: 'github', repo }
  }

  // NPM packages not yet implemented
  // Returning null for unrecognized input

  return null
}
