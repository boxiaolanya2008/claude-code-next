

import { open, readFile, stat } from 'fs/promises'
import { homedir as osHomedir } from 'os'
import { join } from 'path'
import { isFsInaccessible } from './errors.js'
import { getLocalClaudePath } from './localInstaller.js'

export const CLAUDE_ALIAS_REGEX = /^\s*alias\s+claude\s*=/

type EnvLike = Record<string, string | undefined>

type ShellConfigOptions = {
  env?: EnvLike
  homedir?: string
}

export function getShellConfigPaths(
  options?: ShellConfigOptions,
): Record<string, string> {
  const home = options?.homedir ?? osHomedir()
  const env = options?.env ?? process.env
  const zshConfigDir = env.ZDOTDIR || home
  return {
    zsh: join(zshConfigDir, '.zshrc'),
    bash: join(home, '.bashrc'),
    fish: join(home, '.config/fish/config.fish'),
  }
}

export function filterClaudeAliases(lines: string[]): {
  filtered: string[]
  hadAlias: boolean
} {
  let hadAlias = false
  const filtered = lines.filter(line => {
    
    if (CLAUDE_ALIAS_REGEX.test(line)) {
      
      
      let match = line.match(/alias\s+claude\s*=\s*["']([^"']+)["']/)
      if (!match) {
        
        match = line.match(/alias\s+claude\s*=\s*([^#\n]+)/)
      }

      if (match && match[1]) {
        const target = match[1].trim()
        
        
        if (target === getLocalClaudePath()) {
          hadAlias = true
          return false 
        }
      }
      
    }
    return true
  })
  return { filtered, hadAlias }
}

export async function readFileLines(
  filePath: string,
): Promise<string[] | null> {
  try {
    const content = await readFile(filePath, { encoding: 'utf8' })
    return content.split('\n')
  } catch (e: unknown) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

export async function writeFileLines(
  filePath: string,
  lines: string[],
): Promise<void> {
  const fh = await open(filePath, 'w')
  try {
    await fh.writeFile(lines.join('\n'), { encoding: 'utf8' })
    await fh.datasync()
  } finally {
    await fh.close()
  }
}

export async function findClaudeAlias(
  options?: ShellConfigOptions,
): Promise<string | null> {
  const configs = getShellConfigPaths(options)

  for (const configPath of Object.values(configs)) {
    const lines = await readFileLines(configPath)
    if (!lines) continue

    for (const line of lines) {
      if (CLAUDE_ALIAS_REGEX.test(line)) {
        
        const match = line.match(/alias\s+claude=["']?([^"'\s]+)/)
        if (match && match[1]) {
          return match[1]
        }
      }
    }
  }

  return null
}

export async function findValidClaudeAlias(
  options?: ShellConfigOptions,
): Promise<string | null> {
  const aliasTarget = await findClaudeAlias(options)
  if (!aliasTarget) return null

  const home = options?.homedir ?? osHomedir()

  
  const expandedPath = aliasTarget.startsWith('~')
    ? aliasTarget.replace('~', home)
    : aliasTarget

  
  try {
    const stats = await stat(expandedPath)
    
    if (stats.isFile() || stats.isSymbolicLink()) {
      return aliasTarget
    }
  } catch {
    
  }

  return null
}
