

import { basename } from 'path'
import { getProjectRoot } from '../bootstrap/state.js'
import { getBranch } from '../utils/git.js'

const GLOBAL_KEYTERMS: readonly string[] = [
  
  
  
  'MCP',
  'symlink',
  'grep',
  'regex',
  'localhost',
  'codebase',
  'TypeScript',
  'JSON',
  'OAuth',
  'webhook',
  'gRPC',
  'dotfiles',
  'subagent',
  'worktree',
]

export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_./\s]+/)
    .map(w => w.trim())
    .filter(w => w.length > 2 && w.length <= 20)
}

function fileNameWords(filePath: string): string[] {
  const stem = basename(filePath).replace(/\.[^.]+$/, '')
  return splitIdentifier(stem)
}

// ─── Public API ─────────────────────────────────────────────────────

const MAX_KEYTERMS = 50

export async function getVoiceKeyterms(
  recentFiles?: ReadonlySet<string>,
): Promise<string[]> {
  const terms = new Set<string>(GLOBAL_KEYTERMS)

  
  
  
  try {
    const projectRoot = getProjectRoot()
    if (projectRoot) {
      const name = basename(projectRoot)
      if (name.length > 2 && name.length <= 50) {
        terms.add(name)
      }
    }
  } catch {
    // getProjectRoot() may throw if not initialised yet — ignore
  }

  // Git branch words (e.g. "feat/voice-keyterms" → "feat", "voice", "keyterms")
  try {
    const branch = await getBranch()
    if (branch) {
      for (const word of splitIdentifier(branch)) {
        terms.add(word)
      }
    }
  } catch {
    // getBranch() may fail if not in a git repo — ignore
  }

  // Recent file names — only scan enough to fill remaining slots
  if (recentFiles) {
    for (const filePath of recentFiles) {
      if (terms.size >= MAX_KEYTERMS) break
      for (const word of fileNameWords(filePath)) {
        terms.add(word)
      }
    }
  }

  return [...terms].slice(0, MAX_KEYTERMS)
}
