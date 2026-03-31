

import { dirname, isAbsolute, join, normalize, relative, sep } from 'path'
import { ripGrep } from '../ripgrep.js'
import { getPluginsDirectory } from './pluginDirectories.js'

const ORPHANED_AT_FILENAME = '.orphaned_at'

let cachedExclusions: string[] | null = null

export async function getGlobExclusionsForPluginCache(
  searchPath?: string,
): Promise<string[]> {
  const cachePath = normalize(join(getPluginsDirectory(), 'cache'))

  if (searchPath && !pathsOverlap(searchPath, cachePath)) {
    return []
  }

  if (cachedExclusions !== null) {
    return cachedExclusions
  }

  try {
    // Find all .orphaned_at files within the plugin cache directory.
    
    
    
    
    
    const markers = await ripGrep(
      [
        '--files',
        '--hidden',
        '--no-ignore',
        '--max-depth',
        '4',
        '--glob',
        ORPHANED_AT_FILENAME,
      ],
      cachePath,
      new AbortController().signal,
    )

    cachedExclusions = markers.map(markerPath => {
      // ripgrep may return absolute or relative — normalize to relative.
      const versionDir = dirname(markerPath)
      const rel = isAbsolute(versionDir)
        ? relative(cachePath, versionDir)
        : versionDir
      
      const posixRelative = rel.replace(/\\/g, '/')
      return `!**/${posixRelative}/**`
    })
    return cachedExclusions
  } catch {
    // Best-effort — don't break core search tools if ripgrep fails here
    cachedExclusions = []
    return cachedExclusions
  }
}

export function clearPluginCacheExclusions(): void {
  cachedExclusions = null
}

/**
 * One path is a prefix of the other. Special-cases root (normalize('/') + sep
 * = '
 * drive letters and CLAUDE_CODE_PLUGIN_CACHE_DIR may disagree with resolved.
 */
function pathsOverlap(a: string, b: string): boolean {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  return (
    na === nb ||
    na === sep ||
    nb === sep ||
    na.startsWith(nb + sep) ||
    nb.startsWith(na + sep)
  )
}

function normalizeForCompare(p: string): string {
  const n = normalize(p)
  return process.platform === 'win32' ? n.toLowerCase() : n
}
