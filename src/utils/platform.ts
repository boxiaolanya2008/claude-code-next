import { readdir, readFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { release as osRelease } from 'os'
import { getFsImplementation } from './fsOperations.js'
import { logError } from './log.js'

export type Platform = 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown'

export const SUPPORTED_PLATFORMS: Platform[] = ['macos', 'wsl']

export const getPlatform = memoize((): Platform => {
  try {
    if (process.platform === 'darwin') {
      return 'macos'
    }

    if (process.platform === 'win32') {
      return 'windows'
    }

    if (process.platform === 'linux') {
      
      try {
        const procVersion = getFsImplementation().readFileSync(
          '/proc/version',
          { encoding: 'utf8' },
        )
        if (
          procVersion.toLowerCase().includes('microsoft') ||
          procVersion.toLowerCase().includes('wsl')
        ) {
          return 'wsl'
        }
      } catch (error) {
        
        logError(error)
      }

      
      return 'linux'
    }

    
    return 'unknown'
  } catch (error) {
    logError(error)
    return 'unknown'
  }
})

export const getWslVersion = memoize((): string | undefined => {
  
  if (process.platform !== 'linux') {
    return undefined
  }
  try {
    const procVersion = getFsImplementation().readFileSync('/proc/version', {
      encoding: 'utf8',
    })

    
    const wslVersionMatch = procVersion.match(/WSL(\d+)/i)
    if (wslVersionMatch && wslVersionMatch[1]) {
      return wslVersionMatch[1]
    }

    
    
    if (procVersion.toLowerCase().includes('microsoft')) {
      return '1'
    }

    
    return undefined
  } catch (error) {
    logError(error)
    return undefined
  }
})

export type LinuxDistroInfo = {
  linuxDistroId?: string
  linuxDistroVersion?: string
  linuxKernel?: string
}

export const getLinuxDistroInfo = memoize(
  async (): Promise<LinuxDistroInfo | undefined> => {
    if (process.platform !== 'linux') {
      return undefined
    }

    const result: LinuxDistroInfo = {
      linuxKernel: osRelease(),
    }

    try {
      const content = await readFile('/etc/os-release', 'utf8')
      for (const line of content.split('\n')) {
        const match = line.match(/^(ID|VERSION_ID)=(.*)$/)
        if (match && match[1] && match[2]) {
          const value = match[2].replace(/^"|"$/g, '')
          if (match[1] === 'ID') {
            result.linuxDistroId = value
          } else {
            result.linuxDistroVersion = value
          }
        }
      }
    } catch {
      
    }

    return result
  },
)

const VCS_MARKERS: Array<[string, string]> = [
  ['.git', 'git'],
  ['.hg', 'mercurial'],
  ['.svn', 'svn'],
  ['.p4config', 'perforce'],
  ['$tf', 'tfs'],
  ['.tfvc', 'tfs'],
  ['.jj', 'jujutsu'],
  ['.sl', 'sapling'],
]

export async function detectVcs(dir?: string): Promise<string[]> {
  const detected = new Set<string>()

  
  if (process.env.P4PORT) {
    detected.add('perforce')
  }

  try {
    const targetDir = dir ?? getFsImplementation().cwd()
    const entries = new Set(await readdir(targetDir))
    for (const [marker, vcs] of VCS_MARKERS) {
      if (entries.has(marker)) {
        detected.add(vcs)
      }
    }
  } catch {
    
  }

  return [...detected]
}
