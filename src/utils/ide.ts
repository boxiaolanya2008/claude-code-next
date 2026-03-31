import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import axios from 'axios'
import { execa } from 'execa'
import capitalize from 'lodash-es/capitalize.js'
import memoize from 'lodash-es/memoize.js'
import { createConnection } from 'net'
import * as os from 'os'
import { basename, join, sep as pathSeparator, resolve } from 'path'
import { logEvent } from 'src/services/analytics/index.js'
import { getIsScrollDraining, getOriginalCwd } from '../bootstrap/state.js'
import { callIdeRpc } from '../services/mcp/client.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import { getGlobalConfig, saveGlobalConfig } from './config.js'
import { env } from './env.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from './envUtils.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
  execSyncWithDefaults_DEPRECATED,
} from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import { getAncestorPidsAsync } from './genericProcessUtils.js'
import { isJetBrainsPluginInstalledCached } from './jetbrains.js'
import { logError } from './log.js'
import { getPlatform } from './platform.js'
import { lt } from './semver.js'

const ideOnboardingDialog =
  (): typeof import('src/components/IdeOnboardingDialog.js') =>
    require('src/components/IdeOnboardingDialog.js')

import { createAbortController } from './abortController.js'
import { logForDebugging } from './debug.js'
import { envDynamic } from './envDynamic.js'
import { errorMessage, isFsInaccessible } from './errors.js'

import {
  checkWSLDistroMatch,
  WindowsToWSLConverter,
} from './idePathConversion.js'
import { sleep } from './sleep.js'
import { jsonParse } from './slowOperations.js'

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function makeAncestorPidLookup(): () => Promise<Set<number>> {
  let promise: Promise<Set<number>> | null = null
  return () => {
    if (!promise) {
      promise = getAncestorPidsAsync(process.ppid, 10).then(
        pids => new Set(pids),
      )
    }
    return promise
  }
}

type LockfileJsonContent = {
  workspaceFolders?: string[]
  pid?: number
  ideName?: string
  transport?: 'ws' | 'sse'
  runningInWindows?: boolean
  authToken?: string
}

type IdeLockfileInfo = {
  workspaceFolders: string[]
  port: number
  pid?: number
  ideName?: string
  useWebSocket: boolean
  runningInWindows: boolean
  authToken?: string
}

export type DetectedIDEInfo = {
  name: string
  port: number
  workspaceFolders: string[]
  url: string
  isValid: boolean
  authToken?: string
  ideRunningInWindows?: boolean
}

export type IdeType =
  | 'cursor'
  | 'windsurf'
  | 'vscode'
  | 'pycharm'
  | 'intellij'
  | 'webstorm'
  | 'phpstorm'
  | 'rubymine'
  | 'clion'
  | 'goland'
  | 'rider'
  | 'datagrip'
  | 'appcode'
  | 'dataspell'
  | 'aqua'
  | 'gateway'
  | 'fleet'
  | 'androidstudio'

type IdeConfig = {
  ideKind: 'vscode' | 'jetbrains'
  displayName: string
  processKeywordsMac: string[]
  processKeywordsWindows: string[]
  processKeywordsLinux: string[]
}

const supportedIdeConfigs: Record<IdeType, IdeConfig> = {
  cursor: {
    ideKind: 'vscode',
    displayName: 'Cursor',
    processKeywordsMac: ['Cursor Helper', 'Cursor.app'],
    processKeywordsWindows: ['cursor.exe'],
    processKeywordsLinux: ['cursor'],
  },
  windsurf: {
    ideKind: 'vscode',
    displayName: 'Windsurf',
    processKeywordsMac: ['Windsurf Helper', 'Windsurf.app'],
    processKeywordsWindows: ['windsurf.exe'],
    processKeywordsLinux: ['windsurf'],
  },
  vscode: {
    ideKind: 'vscode',
    displayName: 'VS Code',
    processKeywordsMac: ['Visual Studio Code', 'Code Helper'],
    processKeywordsWindows: ['code.exe'],
    processKeywordsLinux: ['code'],
  },
  intellij: {
    ideKind: 'jetbrains',
    displayName: 'IntelliJ IDEA',
    processKeywordsMac: ['IntelliJ IDEA'],
    processKeywordsWindows: ['idea64.exe'],
    processKeywordsLinux: ['idea', 'intellij'],
  },
  pycharm: {
    ideKind: 'jetbrains',
    displayName: 'PyCharm',
    processKeywordsMac: ['PyCharm'],
    processKeywordsWindows: ['pycharm64.exe'],
    processKeywordsLinux: ['pycharm'],
  },
  webstorm: {
    ideKind: 'jetbrains',
    displayName: 'WebStorm',
    processKeywordsMac: ['WebStorm'],
    processKeywordsWindows: ['webstorm64.exe'],
    processKeywordsLinux: ['webstorm'],
  },
  phpstorm: {
    ideKind: 'jetbrains',
    displayName: 'PhpStorm',
    processKeywordsMac: ['PhpStorm'],
    processKeywordsWindows: ['phpstorm64.exe'],
    processKeywordsLinux: ['phpstorm'],
  },
  rubymine: {
    ideKind: 'jetbrains',
    displayName: 'RubyMine',
    processKeywordsMac: ['RubyMine'],
    processKeywordsWindows: ['rubymine64.exe'],
    processKeywordsLinux: ['rubymine'],
  },
  clion: {
    ideKind: 'jetbrains',
    displayName: 'CLion',
    processKeywordsMac: ['CLion'],
    processKeywordsWindows: ['clion64.exe'],
    processKeywordsLinux: ['clion'],
  },
  goland: {
    ideKind: 'jetbrains',
    displayName: 'GoLand',
    processKeywordsMac: ['GoLand'],
    processKeywordsWindows: ['goland64.exe'],
    processKeywordsLinux: ['goland'],
  },
  rider: {
    ideKind: 'jetbrains',
    displayName: 'Rider',
    processKeywordsMac: ['Rider'],
    processKeywordsWindows: ['rider64.exe'],
    processKeywordsLinux: ['rider'],
  },
  datagrip: {
    ideKind: 'jetbrains',
    displayName: 'DataGrip',
    processKeywordsMac: ['DataGrip'],
    processKeywordsWindows: ['datagrip64.exe'],
    processKeywordsLinux: ['datagrip'],
  },
  appcode: {
    ideKind: 'jetbrains',
    displayName: 'AppCode',
    processKeywordsMac: ['AppCode'],
    processKeywordsWindows: ['appcode.exe'],
    processKeywordsLinux: ['appcode'],
  },
  dataspell: {
    ideKind: 'jetbrains',
    displayName: 'DataSpell',
    processKeywordsMac: ['DataSpell'],
    processKeywordsWindows: ['dataspell64.exe'],
    processKeywordsLinux: ['dataspell'],
  },
  aqua: {
    ideKind: 'jetbrains',
    displayName: 'Aqua',
    processKeywordsMac: [], 
    processKeywordsWindows: ['aqua64.exe'],
    processKeywordsLinux: [],
  },
  gateway: {
    ideKind: 'jetbrains',
    displayName: 'Gateway',
    processKeywordsMac: [], 
    processKeywordsWindows: ['gateway64.exe'],
    processKeywordsLinux: [],
  },
  fleet: {
    ideKind: 'jetbrains',
    displayName: 'Fleet',
    processKeywordsMac: [], 
    processKeywordsWindows: ['fleet.exe'],
    processKeywordsLinux: [],
  },
  androidstudio: {
    ideKind: 'jetbrains',
    displayName: 'Android Studio',
    processKeywordsMac: ['Android Studio'],
    processKeywordsWindows: ['studio64.exe'],
    processKeywordsLinux: ['android-studio'],
  },
}

export function isVSCodeIde(ide: IdeType | null): boolean {
  if (!ide) return false
  const config = supportedIdeConfigs[ide]
  return config && config.ideKind === 'vscode'
}

export function isJetBrainsIde(ide: IdeType | null): boolean {
  if (!ide) return false
  const config = supportedIdeConfigs[ide]
  return config && config.ideKind === 'jetbrains'
}

export const isSupportedVSCodeTerminal = memoize(() => {
  return isVSCodeIde(env.terminal as IdeType)
})

export const isSupportedJetBrainsTerminal = memoize(() => {
  return isJetBrainsIde(envDynamic.terminal as IdeType)
})

export const isSupportedTerminal = memoize(() => {
  return (
    isSupportedVSCodeTerminal() ||
    isSupportedJetBrainsTerminal() ||
    Boolean(process.env.FORCE_CODE_TERMINAL)
  )
})

export function getTerminalIdeType(): IdeType | null {
  if (!isSupportedTerminal()) {
    return null
  }
  return env.terminal as IdeType
}

export async function getSortedIdeLockfiles(): Promise<string[]> {
  try {
    const ideLockFilePaths = await getIdeLockfilesPaths()

    
    const allLockfiles: Array<{ path: string; mtime: Date }>[] =
      await Promise.all(
        ideLockFilePaths.map(async ideLockFilePath => {
          try {
            const entries = await getFsImplementation().readdir(ideLockFilePath)
            const lockEntries = entries.filter(file =>
              file.name.endsWith('.lock'),
            )
            
            const stats = await Promise.all(
              lockEntries.map(async file => {
                const fullPath = join(ideLockFilePath, file.name)
                try {
                  const fileStat = await getFsImplementation().stat(fullPath)
                  return { path: fullPath, mtime: fileStat.mtime }
                } catch {
                  return null
                }
              }),
            )
            return stats.filter(s => s !== null)
          } catch (error) {
            
            
            if (!isFsInaccessible(error)) {
              logError(error)
            }
            return []
          }
        }),
      )

    
    return allLockfiles
      .flat()
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      .map(file => file.path)
  } catch (error) {
    logError(error as Error)
    return []
  }
}

async function readIdeLockfile(path: string): Promise<IdeLockfileInfo | null> {
  try {
    const content = await getFsImplementation().readFile(path, {
      encoding: 'utf-8',
    })

    let workspaceFolders: string[] = []
    let pid: number | undefined
    let ideName: string | undefined
    let useWebSocket = false
    let runningInWindows = false
    let authToken: string | undefined

    try {
      const parsedContent = jsonParse(content) as LockfileJsonContent
      if (parsedContent.workspaceFolders) {
        workspaceFolders = parsedContent.workspaceFolders
      }
      pid = parsedContent.pid
      ideName = parsedContent.ideName
      useWebSocket = parsedContent.transport === 'ws'
      runningInWindows = parsedContent.runningInWindows === true
      authToken = parsedContent.authToken
    } catch (_) {
      
      workspaceFolders = content.split('\n').map(line => line.trim())
    }

    
    const filename = path.split(pathSeparator).pop()
    if (!filename) return null

    const port = filename.replace('.lock', '')

    return {
      workspaceFolders,
      port: parseInt(port),
      pid,
      ideName,
      useWebSocket,
      runningInWindows,
      authToken,
    }
  } catch (error) {
    logError(error as Error)
    return null
  }
}

async function checkIdeConnection(
  host: string,
  port: number,
  timeout = 500,
): Promise<boolean> {
  try {
    return new Promise(resolve => {
      const socket = createConnection({
        host: host,
        port: port,
        timeout: timeout,
      })

      socket.on('connect', () => {
        socket.destroy()
        void resolve(true)
      })

      socket.on('error', () => {
        void resolve(false)
      })

      socket.on('timeout', () => {
        socket.destroy()
        void resolve(false)
      })
    })
  } catch (_) {
    
    return false
  }
}

const getWindowsUserProfile = memoize(async (): Promise<string | undefined> => {
  if (process.env.USERPROFILE) return process.env.USERPROFILE
  const { stdout, code } = await execFileNoThrow('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$env:USERPROFILE',
  ])
  if (code === 0 && stdout.trim()) return stdout.trim()
  logForDebugging(
    'Unable to get Windows USERPROFILE via PowerShell - IDE detection may be incomplete',
  )
  return undefined
})

export async function getIdeLockfilesPaths(): Promise<string[]> {
  const paths: string[] = [join(getClaudeConfigHomeDir(), 'ide')]

  if (getPlatform() !== 'wsl') {
    return paths
  }

  
  

  const windowsHome = await getWindowsUserProfile()

  if (windowsHome) {
    const converter = new WindowsToWSLConverter(process.env.WSL_DISTRO_NAME)
    const wslPath = converter.toLocalPath(windowsHome)
    paths.push(resolve(wslPath, '.claude', 'ide'))
  }

  
  
  try {
    const usersDir = '/mnt/c/Users'
    const userDirs = await getFsImplementation().readdir(usersDir)

    for (const user of userDirs) {
      
      
      
      
      if (!user.isDirectory() && !user.isSymbolicLink()) {
        continue
      }
      if (
        user.name === 'Public' ||
        user.name === 'Default' ||
        user.name === 'Default User' ||
        user.name === 'All Users'
      ) {
        continue 
      }
      paths.push(join(usersDir, user.name, '.claude', 'ide'))
    }
  } catch (error: unknown) {
    if (isFsInaccessible(error)) {
      
      logForDebugging(
        `WSL IDE lockfile path detection failed (${error.code}): ${errorMessage(error)}`,
      )
    } else {
      logError(error)
    }
  }
  return paths
}

export async function cleanupStaleIdeLockfiles(): Promise<void> {
  try {
    const lockfiles = await getSortedIdeLockfiles()

    for (const lockfilePath of lockfiles) {
      const lockfileInfo = await readIdeLockfile(lockfilePath)

      if (!lockfileInfo) {
        
        try {
          await getFsImplementation().unlink(lockfilePath)
        } catch (error) {
          logError(error as Error)
        }
        continue
      }

      const host = await detectHostIP(
        lockfileInfo.runningInWindows,
        lockfileInfo.port,
      )

      let shouldDelete = false

      if (lockfileInfo.pid) {
        
        if (!isProcessRunning(lockfileInfo.pid)) {
          if (getPlatform() !== 'wsl') {
            shouldDelete = true
          } else {
            
            const isResponding = await checkIdeConnection(
              host,
              lockfileInfo.port,
            )
            if (!isResponding) {
              shouldDelete = true
            }
          }
        }
      } else {
        
        const isResponding = await checkIdeConnection(host, lockfileInfo.port)
        if (!isResponding) {
          shouldDelete = true
        }
      }

      if (shouldDelete) {
        try {
          await getFsImplementation().unlink(lockfilePath)
        } catch (error) {
          logError(error as Error)
        }
      }
    }
  } catch (error) {
    logError(error as Error)
  }
}

export interface IDEExtensionInstallationStatus {
  installed: boolean
  error: string | null
  installedVersion: string | null
  ideType: IdeType | null
}

export async function maybeInstallIDEExtension(
  ideType: IdeType,
): Promise<IDEExtensionInstallationStatus | null> {
  try {
    
    const installedVersion = await installIDEExtension(ideType)
    
    logEvent('tengu_ext_installed', {})

    
    const globalConfig = getGlobalConfig()
    if (!globalConfig.diffTool) {
      saveGlobalConfig(current => ({ ...current, diffTool: 'auto' }))
    }
    return {
      installed: true,
      error: null,
      installedVersion,
      ideType: ideType,
    }
  } catch (error) {
    logEvent('tengu_ext_install_error', {})
    
    const errorMessage = error instanceof Error ? error.message : String(error)
    logError(error as Error)
    return {
      installed: false,
      error: errorMessage,
      installedVersion: null,
      ideType: ideType,
    }
  }
}

let currentIDESearch: AbortController | null = null

export async function findAvailableIDE(): Promise<DetectedIDEInfo | null> {
  if (currentIDESearch) {
    currentIDESearch.abort()
  }
  currentIDESearch = createAbortController()
  const signal = currentIDESearch.signal

  
  await cleanupStaleIdeLockfiles()
  const startTime = Date.now()
  while (Date.now() - startTime < 30_000 && !signal.aborted) {
    
    
    
    if (getIsScrollDraining()) {
      await sleep(1000, signal)
      continue
    }
    const ides = await detectIDEs(false)
    if (signal.aborted) {
      return null
    }
    
    
    
    if (ides.length === 1) {
      return ides[0]!
    }
    await sleep(1000, signal)
  }
  return null
}

export async function detectIDEs(
  includeInvalid: boolean,
): Promise<DetectedIDEInfo[]> {
  const detectedIDEs: DetectedIDEInfo[] = []

  try {
    
    const ssePort = process.env.CLAUDE_CODE_NEXT_SSE_PORT
    const envPort = ssePort ? parseInt(ssePort) : null

    
    
    
    
    const cwd = getOriginalCwd().normalize('NFC')

    
    
    
    const lockfiles = await getSortedIdeLockfiles()
    const lockfileInfos = await Promise.all(lockfiles.map(readIdeLockfile))

    
    
    
    const getAncestors = makeAncestorPidLookup()
    const needsAncestryCheck = getPlatform() !== 'wsl' && isSupportedTerminal()

    
    for (const lockfileInfo of lockfileInfos) {
      if (!lockfileInfo) continue

      let isValid = false
      if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_IDE_SKIP_VALID_CHECK)) {
        isValid = true
      } else if (lockfileInfo.port === envPort) {
        
        isValid = true
      } else {
        
        isValid = lockfileInfo.workspaceFolders.some(idePath => {
          if (!idePath) return false

          let localPath = idePath

          
          if (
            getPlatform() === 'wsl' &&
            lockfileInfo.runningInWindows &&
            process.env.WSL_DISTRO_NAME
          ) {
            
            if (!checkWSLDistroMatch(idePath, process.env.WSL_DISTRO_NAME)) {
              return false
            }

            
            
            const resolvedOriginal = resolve(localPath).normalize('NFC')
            if (
              cwd === resolvedOriginal ||
              cwd.startsWith(resolvedOriginal + pathSeparator)
            ) {
              return true
            }

            
            const converter = new WindowsToWSLConverter(
              process.env.WSL_DISTRO_NAME,
            )
            localPath = converter.toLocalPath(idePath)
          }

          const resolvedPath = resolve(localPath).normalize('NFC')

          
          if (getPlatform() === 'windows') {
            const normalizedCwd = cwd.replace(/^[a-zA-Z]:/, match =>
              match.toUpperCase(),
            )
            const normalizedResolvedPath = resolvedPath.replace(
              /^[a-zA-Z]:/,
              match => match.toUpperCase(),
            )
            return (
              normalizedCwd === normalizedResolvedPath ||
              normalizedCwd.startsWith(normalizedResolvedPath + pathSeparator)
            )
          }

          return (
            cwd === resolvedPath || cwd.startsWith(resolvedPath + pathSeparator)
          )
        })
      }

      if (!isValid && !includeInvalid) {
        continue
      }

      
      
      
      
      
      
      if (needsAncestryCheck) {
        const portMatchesEnv = envPort !== null && lockfileInfo.port === envPort
        if (!portMatchesEnv) {
          if (!lockfileInfo.pid || !isProcessRunning(lockfileInfo.pid)) {
            continue
          }
          if (process.ppid !== lockfileInfo.pid) {
            const ancestors = await getAncestors()
            if (!ancestors.has(lockfileInfo.pid)) {
              continue
            }
          }
        }
      }

      const ideName =
        lockfileInfo.ideName ??
        (isSupportedTerminal() ? toIDEDisplayName(envDynamic.terminal) : 'IDE')

      const host = await detectHostIP(
        lockfileInfo.runningInWindows,
        lockfileInfo.port,
      )
      let url
      if (lockfileInfo.useWebSocket) {
        url = `ws://${host}:${lockfileInfo.port}`
      } else {
        url = `http://${host}:${lockfileInfo.port}/sse`
      }

      detectedIDEs.push({
        url: url,
        name: ideName,
        workspaceFolders: lockfileInfo.workspaceFolders,
        port: lockfileInfo.port,
        isValid: isValid,
        authToken: lockfileInfo.authToken,
        ideRunningInWindows: lockfileInfo.runningInWindows,
      })
    }

    
    
    
    if (!includeInvalid && envPort) {
      const envPortMatch = detectedIDEs.filter(
        ide => ide.isValid && ide.port === envPort,
      )
      if (envPortMatch.length === 1) {
        return envPortMatch
      }
    }
  } catch (error) {
    logError(error as Error)
  }

  return detectedIDEs
}

export async function maybeNotifyIDEConnected(client: Client) {
  await client.notification({
    method: 'ide_connected',
    params: {
      pid: process.pid,
    },
  })
}

export function hasAccessToIDEExtensionDiffFeature(
  mcpClients: MCPServerConnection[],
): boolean {
  
  return mcpClients.some(
    client => client.type === 'connected' && client.name === 'ide',
  )
}

const EXTENSION_ID =
  process.env.USER_TYPE === 'ant'
    ? 'anthropic.claude-code-next-internal'
    : 'anthropic.claude-code-next'

export async function isIDEExtensionInstalled(
  ideType: IdeType,
): Promise<boolean> {
  if (isVSCodeIde(ideType)) {
    const command = await getVSCodeIDECommand(ideType)
    if (command) {
      try {
        const result = await execFileNoThrowWithCwd(
          command,
          ['--list-extensions'],
          {
            env: getInstallationEnv(),
          },
        )
        if (result.stdout?.includes(EXTENSION_ID)) {
          return true
        }
      } catch {
        
      }
    }
  } else if (isJetBrainsIde(ideType)) {
    return await isJetBrainsPluginInstalledCached(ideType)
  }
  return false
}

async function installIDEExtension(ideType: IdeType): Promise<string | null> {
  if (isVSCodeIde(ideType)) {
    const command = await getVSCodeIDECommand(ideType)

    if (command) {
      if (process.env.USER_TYPE === 'ant') {
        return await installFromArtifactory(command)
      }
      let version = await getInstalledVSCodeExtensionVersion(command)
      
      if (!version || lt(version, getClaudeCodeVersion())) {
        
        await sleep(500)
        const result = await execFileNoThrowWithCwd(
          command,
          ['--force', '--install-extension', 'anthropic.claude-code-next'],
          {
            env: getInstallationEnv(),
          },
        )
        if (result.code !== 0) {
          throw new Error(`${result.code}: ${result.error} ${result.stderr}`)
        }
        version = getClaudeCodeVersion()
      }
      return version
    }
  }
  
  
  
  return null
}

function getInstallationEnv(): NodeJS.ProcessEnv | undefined {
  
  
  
  
  if (getPlatform() === 'linux') {
    return {
      ...process.env,
      DISPLAY: '',
    }
  }
  return undefined
}

function getClaudeCodeVersion() {
  return MACRO.VERSION
}

async function getInstalledVSCodeExtensionVersion(
  command: string,
): Promise<string | null> {
  const { stdout } = await execFileNoThrow(
    command,
    ['--list-extensions', '--show-versions'],
    {
      env: getInstallationEnv(),
    },
  )
  const lines = stdout?.split('\n') || []
  for (const line of lines) {
    const [extensionId, version] = line.split('@')
    if (extensionId === 'anthropic.claude-code-next' && version) {
      return version
    }
  }
  return null
}

function getVSCodeIDECommandByParentProcess(): string | null {
  try {
    const platform = getPlatform()

    
    
    if (platform !== 'macos') {
      return null
    }

    let pid = process.ppid

    
    for (let i = 0; i < 10; i++) {
      if (!pid || pid === 0 || pid === 1) break

      
      
      const command = execSyncWithDefaults_DEPRECATED(
        
        `ps -o command= -p ${pid}`,
      )?.trim()

      if (command) {
        
        const appNames = {
          'Visual Studio Code.app': 'code',
          'Cursor.app': 'cursor',
          'Windsurf.app': 'windsurf',
          'Visual Studio Code - Insiders.app': 'code',
          'VSCodium.app': 'codium',
        }
        const pathToExecutable = '/Contents/MacOS/Electron'

        for (const [appName, executableName] of Object.entries(appNames)) {
          const appIndex = command.indexOf(appName + pathToExecutable)
          if (appIndex !== -1) {
            
            const folderPathEnd = appIndex + appName.length
            
            return (
              command.substring(0, folderPathEnd) +
              '/Contents/Resources/app/bin/' +
              executableName
            )
          }
        }
      }

      
      
      const ppidStr = execSyncWithDefaults_DEPRECATED(
        
        `ps -o ppid= -p ${pid}`,
      )?.trim()
      if (!ppidStr) {
        break
      }
      pid = parseInt(ppidStr.trim())
    }

    return null
  } catch {
    return null
  }
}
async function getVSCodeIDECommand(ideType: IdeType): Promise<string | null> {
  const parentExecutable = getVSCodeIDECommandByParentProcess()
  if (parentExecutable) {
    
    try {
      await getFsImplementation().stat(parentExecutable)
      return parentExecutable
    } catch {
      
    }
  }

  
  
  
  
  
  
  
  
  const ext = getPlatform() === 'windows' ? '.cmd' : ''
  switch (ideType) {
    case 'vscode':
      return 'code' + ext
    case 'cursor':
      return 'cursor' + ext
    case 'windsurf':
      return 'windsurf' + ext
    default:
      break
  }
  return null
}

export async function isCursorInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('cursor', ['--version'])
  return result.code === 0
}

export async function isWindsurfInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('windsurf', ['--version'])
  return result.code === 0
}

export async function isVSCodeInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('code', ['--help'])
  
  return (
    result.code === 0 && Boolean(result.stdout?.includes('Visual Studio Code'))
  )
}

let cachedRunningIDEs: IdeType[] | null = null

async function detectRunningIDEsImpl(): Promise<IdeType[]> {
  const runningIDEs: IdeType[] = []

  try {
    const platform = getPlatform()
    if (platform === 'macos') {
      
      const result = await execa(
        'ps aux | grep -E "Visual Studio Code|Code Helper|Cursor Helper|Windsurf Helper|IntelliJ IDEA|PyCharm|WebStorm|PhpStorm|RubyMine|CLion|GoLand|Rider|DataGrip|AppCode|DataSpell|Aqua|Gateway|Fleet|Android Studio" | grep -v grep',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''
      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsMac) {
          if (stdout.includes(keyword)) {
            runningIDEs.push(ide as IdeType)
            break
          }
        }
      }
    } else if (platform === 'windows') {
      
      const result = await execa(
        'tasklist | findstr /I "Code.exe Cursor.exe Windsurf.exe idea64.exe pycharm64.exe webstorm64.exe phpstorm64.exe rubymine64.exe clion64.exe goland64.exe rider64.exe datagrip64.exe appcode.exe dataspell64.exe aqua64.exe gateway64.exe fleet.exe studio64.exe"',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''

      const normalizedStdout = stdout.toLowerCase()

      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsWindows) {
          if (normalizedStdout.includes(keyword.toLowerCase())) {
            runningIDEs.push(ide as IdeType)
            break
          }
        }
      }
    } else if (platform === 'linux') {
      
      const result = await execa(
        'ps aux | grep -E "code|cursor|windsurf|idea|pycharm|webstorm|phpstorm|rubymine|clion|goland|rider|datagrip|dataspell|aqua|gateway|fleet|android-studio" | grep -v grep',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''

      const normalizedStdout = stdout.toLowerCase()

      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsLinux) {
          if (normalizedStdout.includes(keyword)) {
            if (ide !== 'vscode') {
              runningIDEs.push(ide as IdeType)
              break
            } else if (
              !normalizedStdout.includes('cursor') &&
              !normalizedStdout.includes('appcode')
            ) {
              
              runningIDEs.push(ide as IdeType)
              break
            }
          }
        }
      }
    }
  } catch (error) {
    
    logError(error as Error)
  }

  return runningIDEs
}

export async function detectRunningIDEs(): Promise<IdeType[]> {
  const result = await detectRunningIDEsImpl()
  cachedRunningIDEs = result
  return result
}

export async function detectRunningIDEsCached(): Promise<IdeType[]> {
  if (cachedRunningIDEs === null) {
    return detectRunningIDEs()
  }
  return cachedRunningIDEs
}

export function resetDetectRunningIDEs(): void {
  cachedRunningIDEs = null
}

export function getConnectedIdeName(
  mcpClients: MCPServerConnection[],
): string | null {
  const ideClient = mcpClients.find(
    client => client.type === 'connected' && client.name === 'ide',
  )
  return getIdeClientName(ideClient)
}

export function getIdeClientName(
  ideClient?: MCPServerConnection,
): string | null {
  const config = ideClient?.config
  return config?.type === 'sse-ide' || config?.type === 'ws-ide'
    ? config.ideName
    : isSupportedTerminal()
      ? toIDEDisplayName(envDynamic.terminal)
      : null
}

const EDITOR_DISPLAY_NAMES: Record<string, string> = {
  code: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  antigravity: 'Antigravity',
  vi: 'Vim',
  vim: 'Vim',
  nano: 'nano',
  notepad: 'Notepad',
  'start /wait notepad': 'Notepad',
  emacs: 'Emacs',
  subl: 'Sublime Text',
  atom: 'Atom',
}

export function toIDEDisplayName(terminal: string | null): string {
  if (!terminal) return 'IDE'

  const config = supportedIdeConfigs[terminal as IdeType]
  if (config) {
    return config.displayName
  }

  
  const editorName = EDITOR_DISPLAY_NAMES[terminal.toLowerCase().trim()]
  if (editorName) {
    return editorName
  }

  
  const command = terminal.split(' ')[0]
  const commandName = command ? basename(command).toLowerCase() : null
  if (commandName) {
    const mappedName = EDITOR_DISPLAY_NAMES[commandName]
    if (mappedName) {
      return mappedName
    }
    
    return capitalize(commandName)
  }

  
  return capitalize(terminal)
}

export { callIdeRpc }

export function getConnectedIdeClient(
  mcpClients?: MCPServerConnection[],
): ConnectedMCPServer | undefined {
  if (!mcpClients) {
    return undefined
  }

  const ideClient = mcpClients.find(
    client => client.type === 'connected' && client.name === 'ide',
  )

  
  return ideClient?.type === 'connected' ? ideClient : undefined
}

export async function closeOpenDiffs(
  ideClient: ConnectedMCPServer,
): Promise<void> {
  try {
    await callIdeRpc('closeAllDiffTabs', {}, ideClient)
  } catch (_) {
    
    
  }
}

export async function initializeIdeIntegration(
  onIdeDetected: (ide: DetectedIDEInfo | null) => void,
  ideToInstallExtension: IdeType | null,
  onShowIdeOnboarding: () => void,
  onInstallationComplete: (
    status: IDEExtensionInstallationStatus | null,
  ) => void,
): Promise<void> {
  
  void findAvailableIDE().then(onIdeDetected)

  const shouldAutoInstall = getGlobalConfig().autoInstallIdeExtension ?? true
  if (
    !isEnvTruthy(process.env.CLAUDE_CODE_NEXT_IDE_SKIP_AUTO_INSTALL) &&
    shouldAutoInstall
  ) {
    const ideType = ideToInstallExtension ?? getTerminalIdeType()
    if (ideType) {
      if (isVSCodeIde(ideType)) {
        void isIDEExtensionInstalled(ideType).then(async isAlreadyInstalled => {
          void maybeInstallIDEExtension(ideType)
            .catch(error => {
              const ideInstallationStatus: IDEExtensionInstallationStatus = {
                installed: false,
                error: error.message || 'Installation failed',
                installedVersion: null,
                ideType: ideType,
              }
              return ideInstallationStatus
            })
            .then(status => {
              onInstallationComplete(status)

              if (status?.installed) {
                
                void findAvailableIDE().then(onIdeDetected)
              }

              if (
                !isAlreadyInstalled &&
                status?.installed === true &&
                !ideOnboardingDialog().hasIdeOnboardingDialogBeenShown()
              ) {
                onShowIdeOnboarding()
              }
            })
        })
      } else if (isJetBrainsIde(ideType)) {
        
        void isIDEExtensionInstalled(ideType).then(async installed => {
          if (
            installed &&
            !ideOnboardingDialog().hasIdeOnboardingDialogBeenShown()
          ) {
            onShowIdeOnboarding()
          }
        })
      }
    }
  }
}

const detectHostIP = memoize(
  async (isIdeRunningInWindows: boolean, port: number) => {
    if (process.env.CLAUDE_CODE_NEXT_IDE_HOST_OVERRIDE) {
      return process.env.CLAUDE_CODE_NEXT_IDE_HOST_OVERRIDE
    }

    if (getPlatform() !== 'wsl' || !isIdeRunningInWindows) {
      return '127.0.0.1'
    }

    
    
    
    try {
      const routeResult = await execa('ip route show | grep -i default', {
        shell: true,
        reject: false,
      })
      if (routeResult.exitCode === 0 && routeResult.stdout) {
        const gatewayMatch = routeResult.stdout.match(
          /default via (\d+\.\d+\.\d+\.\d+)/,
        )
        if (gatewayMatch) {
          const gatewayIP = gatewayMatch[1]!
          if (await checkIdeConnection(gatewayIP, port)) {
            return gatewayIP
          }
        }
      }
    } catch (_) {
      
    }

    
    return '127.0.0.1'
  },
  (isIdeRunningInWindows, port) => `${isIdeRunningInWindows}:${port}`,
)

async function installFromArtifactory(command: string): Promise<string> {
  
  const npmrcPath = join(os.homedir(), '.npmrc')
  let authToken: string | null = null
  const fs = getFsImplementation()

  try {
    const npmrcContent = await fs.readFile(npmrcPath, {
      encoding: 'utf8',
    })
    const lines = npmrcContent.split('\n')
    for (const line of lines) {
      
      const match = line.match(
        /\/\/artifactory\.infra\.ant\.dev\/artifactory\/api\/npm\/npm-all\/:_authToken=(.+)/,
      )
      if (match && match[1]) {
        authToken = match[1].trim()
        break
      }
    }
  } catch (error) {
    logError(error as Error)
    throw new Error(`Failed to read npm authentication: ${error}`)
  }

  if (!authToken) {
    throw new Error('No artifactory auth token found in ~/.npmrc')
  }

  
  const versionUrl =
    'https://artifactory.infra.ant.dev/artifactory/armorcode-claude-code-next-internal/claude-vscode-releases/stable'

  try {
    const versionResponse = await axios.get(versionUrl, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })

    const version = versionResponse.data.trim()
    if (!version) {
      throw new Error('No version found in artifactory response')
    }

    
    const vsixUrl = `https://artifactory.infra.ant.dev/artifactory/armorcode-claude-code-next-internal/claude-vscode-releases/${version}/claude-code-next.vsix`
    const tempVsixPath = join(
      os.tmpdir(),
      `claude-code-next-${version}-${Date.now()}.vsix`,
    )

    try {
      const vsixResponse = await axios.get(vsixUrl, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        responseType: 'stream',
      })

      
      const writeStream = getFsImplementation().createWriteStream(tempVsixPath)
      await new Promise<void>((resolve, reject) => {
        vsixResponse.data.pipe(writeStream)
        writeStream.on('finish', resolve)
        writeStream.on('error', reject)
      })

      
      
      await sleep(500)

      const result = await execFileNoThrowWithCwd(
        command,
        ['--force', '--install-extension', tempVsixPath],
        {
          env: getInstallationEnv(),
        },
      )

      if (result.code !== 0) {
        throw new Error(`${result.code}: ${result.error} ${result.stderr}`)
      }

      return version
    } finally {
      
      try {
        await fs.unlink(tempVsixPath)
      } catch {
        
      }
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to fetch extension version from artifactory: ${error.message}`,
      )
    }
    throw error
  }
}
