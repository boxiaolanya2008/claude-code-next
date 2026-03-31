import { readdir } from 'fs/promises'
import { join } from 'path'
import { coerce as semverCoerce } from 'semver'
import { getSessionId } from '../bootstrap/state.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { pathExists } from './file.js'
import { gte as semverGte } from './semver.js'

const MIN_DESKTOP_VERSION = '1.1.2396'

function isDevMode(): boolean {
  if ((process.env.NODE_ENV as string) === 'development') {
    return true
  }

  
  const pathsToCheck = [process.argv[1] || '', process.execPath || '']
  const buildDirs = [
    '/build-ant/',
    '/build-ant-native/',
    '/build-external/',
    '/build-external-native/',
  ]

  return pathsToCheck.some(p => buildDirs.some(dir => p.includes(dir)))
}

function buildDesktopDeepLink(sessionId: string): string {
  const protocol = isDevMode() ? 'claude-dev' : 'claude'
  const url = new URL(`${protocol}://resume`)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('cwd', getCwd())
  return url.toString()
}

async function isDesktopInstalled(): Promise<boolean> {
  
  if (isDevMode()) {
    return true
  }

  const platform = process.platform

  if (platform === 'darwin') {
    
    return pathExists('/Applications/Claude.app')
  } else if (platform === 'linux') {
    
    
    const { code, stdout } = await execFileNoThrow('xdg-mime', [
      'query',
      'default',
      'x-scheme-handler/claude',
    ])
    return code === 0 && stdout.trim().length > 0
  } else if (platform === 'win32') {
    
    const { code } = await execFileNoThrow('reg', [
      'query',
      'HKEY_CLASSES_ROOT\\claude',
      '/ve',
    ])
    return code === 0
  }

  return false
}

async function getDesktopVersion(): Promise<string | null> {
  const platform = process.platform

  if (platform === 'darwin') {
    const { code, stdout } = await execFileNoThrow('defaults', [
      'read',
      '/Applications/Claude.app/Contents/Info.plist',
      'CFBundleShortVersionString',
    ])
    if (code !== 0) {
      return null
    }
    const version = stdout.trim()
    return version.length > 0 ? version : null
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (!localAppData) {
      return null
    }
    const installDir = join(localAppData, 'AnthropicClaude')
    try {
      const entries = await readdir(installDir)
      const versions = entries
        .filter(e => e.startsWith('app-'))
        .map(e => e.slice(4))
        .filter(v => semverCoerce(v) !== null)
        .sort((a, b) => {
          const ca = semverCoerce(a)!
          const cb = semverCoerce(b)!
          return ca.compare(cb)
        })
      return versions.length > 0 ? versions[versions.length - 1]! : null
    } catch {
      return null
    }
  }

  return null
}

export type DesktopInstallStatus =
  | { status: 'not-installed' }
  | { status: 'version-too-old'; version: string }
  | { status: 'ready'; version: string }

export async function getDesktopInstallStatus(): Promise<DesktopInstallStatus> {
  const installed = await isDesktopInstalled()
  if (!installed) {
    return { status: 'not-installed' }
  }

  let version: string | null
  try {
    version = await getDesktopVersion()
  } catch {
    
    return { status: 'ready', version: 'unknown' }
  }

  if (!version) {
    
    return { status: 'ready', version: 'unknown' }
  }

  const coerced = semverCoerce(version)
  if (!coerced || !semverGte(coerced.version, MIN_DESKTOP_VERSION)) {
    return { status: 'version-too-old', version }
  }

  return { status: 'ready', version }
}

async function openDeepLink(deepLinkUrl: string): Promise<boolean> {
  const platform = process.platform
  logForDebugging(`Opening deep link: ${deepLinkUrl}`)

  if (platform === 'darwin') {
    if (isDevMode()) {
      
      
      
      const { code } = await execFileNoThrow('osascript', [
        '-e',
        `tell application "Electron" to open location "${deepLinkUrl}"`,
      ])
      return code === 0
    }
    const { code } = await execFileNoThrow('open', [deepLinkUrl])
    return code === 0
  } else if (platform === 'linux') {
    const { code } = await execFileNoThrow('xdg-open', [deepLinkUrl])
    return code === 0
  } else if (platform === 'win32') {
    
    const { code } = await execFileNoThrow('cmd', [
      '/c',
      'start',
      '',
      deepLinkUrl,
    ])
    return code === 0
  }

  return false
}

export async function openCurrentSessionInDesktop(): Promise<{
  success: boolean
  error?: string
  deepLinkUrl?: string
}> {
  const sessionId = getSessionId()

  
  const installed = await isDesktopInstalled()
  if (!installed) {
    return {
      success: false,
      error:
        'Claude Desktop is not installed. Install it from https://claude.ai/download',
    }
  }

  
  const deepLinkUrl = buildDesktopDeepLink(sessionId)
  const opened = await openDeepLink(deepLinkUrl)

  if (!opened) {
    return {
      success: false,
      error: 'Failed to open Claude Desktop. Please try opening it manually.',
      deepLinkUrl,
    }
  }

  return { success: true, deepLinkUrl }
}
