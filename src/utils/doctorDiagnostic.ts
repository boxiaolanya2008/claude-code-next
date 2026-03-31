import { execa } from 'execa'
import { readFile, realpath } from 'fs/promises'
import { homedir } from 'os'
import { delimiter, join, posix, win32 } from 'path'
import { checkGlobalInstallPermissions } from './autoUpdater.js'
import { isInBundledMode } from './bundledMode.js'
import {
  formatAutoUpdaterDisabledReason,
  getAutoUpdaterDisabledReason,
  getGlobalConfig,
  type InstallMethod,
} from './config.js'
import { getCwd } from './cwd.js'
import { isEnvTruthy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  getShellType,
  isRunningFromLocalInstallation,
  localInstallationExists,
} from './localInstaller.js'
import {
  detectApk,
  detectAsdf,
  detectDeb,
  detectHomebrew,
  detectMise,
  detectPacman,
  detectRpm,
  detectWinget,
  getPackageManager,
} from './nativeInstaller/packageManagers.js'
import { getPlatform } from './platform.js'
import { getRipgrepStatus } from './ripgrep.js'
import { SandboxManager } from './sandbox/sandbox-adapter.js'
import { getManagedFilePath } from './settings/managedPath.js'
import { CUSTOMIZATION_SURFACES } from './settings/types.js'
import {
  findClaudeAlias,
  findValidClaudeAlias,
  getShellConfigPaths,
} from './shellConfig.js'
import { jsonParse } from './slowOperations.js'
import { which } from './which.js'

export type InstallationType =
  | 'npm-global'
  | 'npm-local'
  | 'native'
  | 'package-manager'
  | 'development'
  | 'unknown'

export type DiagnosticInfo = {
  installationType: InstallationType
  version: string
  installationPath: string
  invokedBinary: string
  configInstallMethod: InstallMethod | 'not set'
  autoUpdates: string
  hasUpdatePermissions: boolean | null
  multipleInstallations: Array<{ type: string; path: string }>
  warnings: Array<{ issue: string; fix: string }>
  recommendation?: string
  packageManager?: string
  ripgrepStatus: {
    working: boolean
    mode: 'system' | 'builtin' | 'embedded'
    systemPath: string | null
  }
}

function getNormalizedPaths(): [invokedPath: string, execPath: string] {
  let invokedPath = process.argv[1] || ''
  let execPath = process.execPath || process.argv[0] || ''

  
  if (getPlatform() === 'windows') {
    invokedPath = invokedPath.split(win32.sep).join(posix.sep)
    execPath = execPath.split(win32.sep).join(posix.sep)
  }

  return [invokedPath, execPath]
}

export async function getCurrentInstallationType(): Promise<InstallationType> {
  if (process.env.NODE_ENV === 'development') {
    return 'development'
  }

  const [invokedPath] = getNormalizedPaths()

  
  if (isInBundledMode()) {
    
    if (
      detectHomebrew() ||
      detectWinget() ||
      detectMise() ||
      detectAsdf() ||
      (await detectPacman()) ||
      (await detectDeb()) ||
      (await detectRpm()) ||
      (await detectApk())
    ) {
      return 'package-manager'
    }
    return 'native'
  }

  
  if (isRunningFromLocalInstallation()) {
    return 'npm-local'
  }

  
  const npmGlobalPaths = [
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/.nvm/versions/node/', 
  ]

  if (npmGlobalPaths.some(path => invokedPath.includes(path))) {
    return 'npm-global'
  }

  
  if (invokedPath.includes('/npm/') || invokedPath.includes('/nvm/')) {
    return 'npm-global'
  }

  const npmConfigResult = await execa('npm config get prefix', {
    shell: true,
    reject: false,
  })
  const globalPrefix =
    npmConfigResult.exitCode === 0 ? npmConfigResult.stdout.trim() : null

  if (globalPrefix && invokedPath.startsWith(globalPrefix)) {
    return 'npm-global'
  }

  
  return 'unknown'
}

async function getInstallationPath(): Promise<string> {
  if (process.env.NODE_ENV === 'development') {
    return getCwd()
  }

  
  if (isInBundledMode()) {
    
    try {
      return await realpath(process.execPath)
    } catch {
      
    }

    try {
      const path = await which('claude')
      if (path) {
        return path
      }
    } catch {
      
    }

    
    try {
      await getFsImplementation().stat(join(homedir(), '.local/bin/claude'))
      return join(homedir(), '.local/bin/claude')
    } catch {
      
    }
    return 'native'
  }

  
  try {
    return process.argv[0] || 'unknown'
  } catch {
    return 'unknown'
  }
}

export function getInvokedBinary(): string {
  try {
    
    if (isInBundledMode()) {
      return process.execPath || 'unknown'
    }

    
    return process.argv[1] || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function detectMultipleInstallations(): Promise<
  Array<{ type: string; path: string }>
> {
  const fs = getFsImplementation()
  const installations: Array<{ type: string; path: string }> = []

  
  const localPath = join(homedir(), '.claude', 'local')
  if (await localInstallationExists()) {
    installations.push({ type: 'npm-local', path: localPath })
  }

  
  const packagesToCheck = ['@anthropic-ai/claude-code-next']
  if (MACRO.PACKAGE_URL && MACRO.PACKAGE_URL !== '@anthropic-ai/claude-code-next') {
    packagesToCheck.push(MACRO.PACKAGE_URL)
  }
  const npmResult = await execFileNoThrow('npm', [
    '-g',
    'config',
    'get',
    'prefix',
  ])
  if (npmResult.code === 0 && npmResult.stdout) {
    const npmPrefix = npmResult.stdout.trim()
    const isWindows = getPlatform() === 'windows'

    
    
    
    const globalBinPath = isWindows
      ? join(npmPrefix, 'claude')
      : join(npmPrefix, 'bin', 'claude')

    let globalBinExists = false
    try {
      await fs.stat(globalBinPath)
      globalBinExists = true
    } catch {
      
    }

    if (globalBinExists) {
      
      
      
      let isCurrentHomebrewInstallation = false

      try {
        
        const realPath = await realpath(globalBinPath)

        
        
        if (realPath.includes('/Caskroom/')) {
          isCurrentHomebrewInstallation = detectHomebrew()
        }
      } catch {
        
      }

      if (!isCurrentHomebrewInstallation) {
        installations.push({ type: 'npm-global', path: globalBinPath })
      }
    } else {
      
      for (const packageName of packagesToCheck) {
        const globalPackagePath = isWindows
          ? join(npmPrefix, 'node_modules', packageName)
          : join(npmPrefix, 'lib', 'node_modules', packageName)

        try {
          await fs.stat(globalPackagePath)
          installations.push({
            type: 'npm-global-orphan',
            path: globalPackagePath,
          })
        } catch {
          
        }
      }
    }
  }

  

  
  const nativeBinPath = join(homedir(), '.local', 'bin', 'claude')
  try {
    await fs.stat(nativeBinPath)
    installations.push({ type: 'native', path: nativeBinPath })
  } catch {
    
  }

  
  const config = getGlobalConfig()
  if (config.installMethod === 'native') {
    const nativeDataPath = join(homedir(), '.local', 'share', 'claude')
    try {
      await fs.stat(nativeDataPath)
      if (!installations.some(i => i.type === 'native')) {
        installations.push({ type: 'native', path: nativeDataPath })
      }
    } catch {
      
    }
  }

  return installations
}

async function detectConfigurationIssues(
  type: InstallationType,
): Promise<Array<{ issue: string; fix: string }>> {
  const warnings: Array<{ issue: string; fix: string }> = []

  
  
  
  
  
  
  try {
    const raw = await readFile(
      join(getManagedFilePath(), 'managed-settings.json'),
      'utf-8',
    )
    const parsed: unknown = jsonParse(raw)
    const field =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).strictPluginOnlyCustomization
        : undefined
    if (field !== undefined && typeof field !== 'boolean') {
      if (!Array.isArray(field)) {
        
        
        
        warnings.push({
          issue: `managed-settings.json: strictPluginOnlyCustomization has an invalid value (expected true or an array, got ${typeof field})`,
          fix: `The field is silently ignored (schema .catch rescues it). Set it to true, or an array of: ${CUSTOMIZATION_SURFACES.join(', ')}.`,
        })
      } else {
        const unknown = field.filter(
          x =>
            typeof x === 'string' &&
            !(CUSTOMIZATION_SURFACES as readonly string[]).includes(x),
        )
        if (unknown.length > 0) {
          warnings.push({
            issue: `managed-settings.json: strictPluginOnlyCustomization has ${unknown.length} value(s) this client doesn't recognize: ${unknown.map(String).join(', ')}`,
            fix: `These are silently ignored (forwards-compat). Known surfaces for this version: ${CUSTOMIZATION_SURFACES.join(', ')}. Either remove them, or this client is older than the managed-settings intended.`,
          })
        }
      }
    }
  } catch {
    
    
  }

  const config = getGlobalConfig()

  
  if (type === 'development') {
    return warnings
  }

  
  if (type === 'native') {
    const path = process.env.PATH || ''
    const pathDirectories = path.split(delimiter)
    const homeDir = homedir()
    const localBinPath = join(homeDir, '.local', 'bin')

    
    let normalizedLocalBinPath = localBinPath
    if (getPlatform() === 'windows') {
      normalizedLocalBinPath = localBinPath.split(win32.sep).join(posix.sep)
    }

    
    
    const localBinInPath = pathDirectories.some(dir => {
      let normalizedDir = dir
      if (getPlatform() === 'windows') {
        normalizedDir = dir.split(win32.sep).join(posix.sep)
      }
      
      const trimmedDir = normalizedDir.replace(/\/+$/, '')
      const trimmedRawDir = dir.replace(/[/\\]+$/, '')
      return (
        trimmedDir === normalizedLocalBinPath ||
        trimmedRawDir === '~/.local/bin' ||
        trimmedRawDir === '$HOME/.local/bin'
      )
    })

    if (!localBinInPath) {
      const isWindows = getPlatform() === 'windows'
      if (isWindows) {
        
        const windowsLocalBinPath = localBinPath
          .split(posix.sep)
          .join(win32.sep)
        warnings.push({
          issue: `Native installation exists but ${windowsLocalBinPath} is not in your PATH`,
          fix: `Add it by opening: System Properties → Environment Variables → Edit User PATH → New → Add the path above. Then restart your terminal.`,
        })
      } else {
        
        const shellType = getShellType()
        const configPaths = getShellConfigPaths()
        const configFile = configPaths[shellType as keyof typeof configPaths]
        const displayPath = configFile
          ? configFile.replace(homedir(), '~')
          : 'your shell config file'

        warnings.push({
          issue:
            'Native installation exists but ~/.local/bin is not in your PATH',
          fix: `Run: echo 'export PATH="$HOME/.local/bin:$PATH"' >> ${displayPath} then open a new terminal or run: source ${displayPath}`,
        })
      }
    }
  }

  
  
  if (!isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)) {
    if (type === 'npm-local' && config.installMethod !== 'local') {
      warnings.push({
        issue: `Running from local installation but config install method is '${config.installMethod}'`,
        fix: 'Consider using native installation: claude install',
      })
    }

    if (type === 'native' && config.installMethod !== 'native') {
      warnings.push({
        issue: `Running native installation but config install method is '${config.installMethod}'`,
        fix: 'Run claude install to update configuration',
      })
    }
  }

  if (type === 'npm-global' && (await localInstallationExists())) {
    warnings.push({
      issue: 'Local installation exists but not being used',
      fix: 'Consider using native installation: claude install',
    })
  }

  const existingAlias = await findClaudeAlias()
  const validAlias = await findValidClaudeAlias()

  
  if (type === 'npm-local') {
    
    const whichResult = await which('claude')
    const claudeInPath = !!whichResult

    
    if (!claudeInPath && !validAlias) {
      if (existingAlias) {
        
        warnings.push({
          issue: 'Local installation not accessible',
          fix: `Alias exists but points to invalid target: ${existingAlias}. Update alias: alias claude="~/.claude/local/claude"`,
        })
      } else {
        
        warnings.push({
          issue: 'Local installation not accessible',
          fix: 'Create alias: alias claude="~/.claude/local/claude"',
        })
      }
    }
  }

  return warnings
}

export function detectLinuxGlobPatternWarnings(): Array<{
  issue: string
  fix: string
}> {
  if (getPlatform() !== 'linux') {
    return []
  }

  const warnings: Array<{ issue: string; fix: string }> = []
  const globPatterns = SandboxManager.getLinuxGlobPatternWarnings()

  if (globPatterns.length > 0) {
    
    const displayPatterns = globPatterns.slice(0, 3).join(', ')
    const remaining = globPatterns.length - 3
    const patternList =
      remaining > 0 ? `${displayPatterns} (${remaining} more)` : displayPatterns

    warnings.push({
      issue: `Glob patterns in sandbox permission rules are not fully supported on Linux`,
      fix: `Found ${globPatterns.length} pattern(s): ${patternList}. On Linux, glob patterns in Edit/Read rules will be ignored.`,
    })
  }

  return warnings
}

export async function getDoctorDiagnostic(): Promise<DiagnosticInfo> {
  const installationType = await getCurrentInstallationType()
  const version =
    typeof MACRO !== 'undefined' && MACRO.VERSION ? MACRO.VERSION : 'unknown'
  const installationPath = await getInstallationPath()
  const invokedBinary = getInvokedBinary()
  const multipleInstallations = await detectMultipleInstallations()
  const warnings = await detectConfigurationIssues(installationType)

  
  warnings.push(...detectLinuxGlobPatternWarnings())

  
  if (installationType === 'native') {
    const npmInstalls = multipleInstallations.filter(
      i =>
        i.type === 'npm-global' ||
        i.type === 'npm-global-orphan' ||
        i.type === 'npm-local',
    )

    const isWindows = getPlatform() === 'windows'

    for (const install of npmInstalls) {
      if (install.type === 'npm-global') {
        let uninstallCmd = 'npm -g uninstall @anthropic-ai/claude-code-next'
        if (
          MACRO.PACKAGE_URL &&
          MACRO.PACKAGE_URL !== '@anthropic-ai/claude-code-next'
        ) {
          uninstallCmd += ` && npm -g uninstall ${MACRO.PACKAGE_URL}`
        }
        warnings.push({
          issue: `Leftover npm global installation at ${install.path}`,
          fix: `Run: ${uninstallCmd}`,
        })
      } else if (install.type === 'npm-global-orphan') {
        warnings.push({
          issue: `Orphaned npm global package at ${install.path}`,
          fix: isWindows
            ? `Run: rmdir /s /q "${install.path}"`
            : `Run: rm -rf ${install.path}`,
        })
      } else if (install.type === 'npm-local') {
        warnings.push({
          issue: `Leftover npm local installation at ${install.path}`,
          fix: isWindows
            ? `Run: rmdir /s /q "${install.path}"`
            : `Run: rm -rf ${install.path}`,
        })
      }
    }
  }

  const config = getGlobalConfig()

  
  const configInstallMethod = config.installMethod || 'not set'

  
  let hasUpdatePermissions: boolean | null = null
  if (installationType === 'npm-global') {
    const permCheck = await checkGlobalInstallPermissions()
    hasUpdatePermissions = permCheck.hasPermissions

    
    if (!hasUpdatePermissions && !getAutoUpdaterDisabledReason()) {
      warnings.push({
        issue: 'Insufficient permissions for auto-updates',
        fix: 'Do one of: (1) Re-install node without sudo, or (2) Use `claude install` for native installation',
      })
    }
  }

  
  const ripgrepStatusRaw = getRipgrepStatus()

  
  const ripgrepStatus = {
    working: ripgrepStatusRaw.working ?? true, 
    mode: ripgrepStatusRaw.mode,
    systemPath:
      ripgrepStatusRaw.mode === 'system' ? ripgrepStatusRaw.path : null,
  }

  
  const packageManager =
    installationType === 'package-manager'
      ? await getPackageManager()
      : undefined

  const diagnostic: DiagnosticInfo = {
    installationType,
    version,
    installationPath,
    invokedBinary,
    configInstallMethod,
    autoUpdates: (() => {
      const reason = getAutoUpdaterDisabledReason()
      return reason
        ? `disabled (${formatAutoUpdaterDisabledReason(reason)})`
        : 'enabled'
    })(),
    hasUpdatePermissions,
    multipleInstallations,
    warnings,
    packageManager,
    ripgrepStatus,
  }

  return diagnostic
}
