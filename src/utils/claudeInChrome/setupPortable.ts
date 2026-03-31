import { readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { isFsInaccessible } from '../errors.js'

export const CHROME_EXTENSION_URL = 'https://claude.ai/chrome'

const PROD_EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'

const DEV_EXTENSION_ID = 'dihbgbndebgnbjfmelmegjepbnkhlgni'
const ANT_EXTENSION_ID = 'dngcpimnedloihjnnfngkgjoidhnaolf'

function getExtensionIds(): string[] {
  return process.env.USER_TYPE === 'ant'
    ? [PROD_EXTENSION_ID, DEV_EXTENSION_ID, ANT_EXTENSION_ID]
    : [PROD_EXTENSION_ID]
}

export type ChromiumBrowser =
  | 'chrome'
  | 'brave'
  | 'arc'
  | 'chromium'
  | 'edge'
  | 'vivaldi'
  | 'opera'

export type BrowserPath = {
  browser: ChromiumBrowser
  path: string
}

type Logger = (message: string) => void

const BROWSER_DETECTION_ORDER: ChromiumBrowser[] = [
  'chrome',
  'brave',
  'arc',
  'edge',
  'chromium',
  'vivaldi',
  'opera',
]

type BrowserDataConfig = {
  macos: string[]
  linux: string[]
  windows: { path: string[]; useRoaming?: boolean }
}

const CHROMIUM_BROWSERS: Record<ChromiumBrowser, BrowserDataConfig> = {
  chrome: {
    macos: ['Library', 'Application Support', 'Google', 'Chrome'],
    linux: ['.config', 'google-chrome'],
    windows: { path: ['Google', 'Chrome', 'User Data'] },
  },
  brave: {
    macos: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'],
    linux: ['.config', 'BraveSoftware', 'Brave-Browser'],
    windows: { path: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  },
  arc: {
    macos: ['Library', 'Application Support', 'Arc', 'User Data'],
    linux: [],
    windows: { path: ['Arc', 'User Data'] },
  },
  chromium: {
    macos: ['Library', 'Application Support', 'Chromium'],
    linux: ['.config', 'chromium'],
    windows: { path: ['Chromium', 'User Data'] },
  },
  edge: {
    macos: ['Library', 'Application Support', 'Microsoft Edge'],
    linux: ['.config', 'microsoft-edge'],
    windows: { path: ['Microsoft', 'Edge', 'User Data'] },
  },
  vivaldi: {
    macos: ['Library', 'Application Support', 'Vivaldi'],
    linux: ['.config', 'vivaldi'],
    windows: { path: ['Vivaldi', 'User Data'] },
  },
  opera: {
    macos: ['Library', 'Application Support', 'com.operasoftware.Opera'],
    linux: ['.config', 'opera'],
    windows: { path: ['Opera Software', 'Opera Stable'], useRoaming: true },
  },
}

export function getAllBrowserDataPathsPortable(): BrowserPath[] {
  const home = homedir()
  const paths: BrowserPath[] = []

  for (const browserId of BROWSER_DETECTION_ORDER) {
    const config = CHROMIUM_BROWSERS[browserId]
    let dataPath: string[] | undefined

    switch (process.platform) {
      case 'darwin':
        dataPath = config.macos
        break
      case 'linux':
        dataPath = config.linux
        break
      case 'win32': {
        if (config.windows.path.length > 0) {
          const appDataBase = config.windows.useRoaming
            ? join(home, 'AppData', 'Roaming')
            : join(home, 'AppData', 'Local')
          paths.push({
            browser: browserId,
            path: join(appDataBase, ...config.windows.path),
          })
        }
        continue
      }
    }

    if (dataPath && dataPath.length > 0) {
      paths.push({
        browser: browserId,
        path: join(home, ...dataPath),
      })
    }
  }

  return paths
}

export async function detectExtensionInstallationPortable(
  browserPaths: BrowserPath[],
  log?: Logger,
): Promise<{
  isInstalled: boolean
  browser: ChromiumBrowser | null
}> {
  if (browserPaths.length === 0) {
    log?.(`[Claude in Chrome] No browser paths to check`)
    return { isInstalled: false, browser: null }
  }

  const extensionIds = getExtensionIds()

  
  for (const { browser, path: browserBasePath } of browserPaths) {
    let browserProfileEntries = []

    try {
      browserProfileEntries = await readdir(browserBasePath, {
        withFileTypes: true,
      })
    } catch (e) {
      
      if (isFsInaccessible(e)) continue
      throw e
    }

    const profileDirs = browserProfileEntries
      .filter(entry => entry.isDirectory())
      .filter(
        entry => entry.name === 'Default' || entry.name.startsWith('Profile '),
      )
      .map(entry => entry.name)

    if (profileDirs.length > 0) {
      log?.(
        `[Claude in Chrome] Found ${browser} profiles: ${profileDirs.join(', ')}`,
      )
    }

    
    for (const profile of profileDirs) {
      for (const extensionId of extensionIds) {
        const extensionPath = join(
          browserBasePath,
          profile,
          'Extensions',
          extensionId,
        )

        try {
          await readdir(extensionPath)
          log?.(
            `[Claude in Chrome] Extension ${extensionId} found in ${browser} ${profile}`,
          )
          return { isInstalled: true, browser }
        } catch {
          
        }
      }
    }
  }

  log?.(`[Claude in Chrome] Extension not found in any browser`)
  return { isInstalled: false, browser: null }
}

export async function isChromeExtensionInstalledPortable(
  browserPaths: BrowserPath[],
  log?: Logger,
): Promise<boolean> {
  const result = await detectExtensionInstallationPortable(browserPaths, log)
  return result.isInstalled
}

export function isChromeExtensionInstalled(log?: Logger): Promise<boolean> {
  const browserPaths = getAllBrowserDataPathsPortable()
  return isChromeExtensionInstalledPortable(browserPaths, log)
}
