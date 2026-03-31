import { feature } from 'bun:bundle'
import { stat } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'
import { env, JETBRAINS_IDES } from './env.js'
import { isEnvTruthy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { getAncestorCommandsAsync } from './genericProcessUtils.js'

const getIsDocker = memoize(async (): Promise<boolean> => {
  if (process.platform !== 'linux') return false
  
  const { code } = await execFileNoThrow('test', ['-f', '/.dockerenv'])
  return code === 0
})

function getIsBubblewrapSandbox(): boolean {
  return (
    process.platform === 'linux' &&
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_BUBBLEWRAP)
  )
}

let muslRuntimeCache: boolean | null = null

if (process.platform === 'linux') {
  const muslArch = process.arch === 'x64' ? 'x86_64' : 'aarch64'
  void stat(`/lib/libc.musl-${muslArch}.so.1`).then(
    () => {
      muslRuntimeCache = true
    },
    () => {
      muslRuntimeCache = false
    },
  )
}

function isMuslEnvironment(): boolean {
  if (feature('IS_LIBC_MUSL')) return true
  if (feature('IS_LIBC_GLIBC')) return false

  
  if (process.platform !== 'linux') return false
  return muslRuntimeCache ?? false
}

let jetBrainsIDECache: string | null | undefined

async function detectJetBrainsIDEFromParentProcessAsync(): Promise<
  string | null
> {
  if (jetBrainsIDECache !== undefined) {
    return jetBrainsIDECache
  }

  if (process.platform === 'darwin') {
    jetBrainsIDECache = null
    return null 
  }

  try {
    
    const commands = await getAncestorCommandsAsync(process.pid, 10)

    for (const command of commands) {
      const lowerCommand = command.toLowerCase()
      
      for (const ide of JETBRAINS_IDES) {
        if (lowerCommand.includes(ide)) {
          jetBrainsIDECache = ide
          return ide
        }
      }
    }
  } catch {
    
  }

  jetBrainsIDECache = null
  return null
}

export async function getTerminalWithJetBrainsDetectionAsync(): Promise<
  string | null
> {
  
  if (process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') {
    
    if (env.platform !== 'darwin') {
      const specificIDE = await detectJetBrainsIDEFromParentProcessAsync()
      return specificIDE || 'pycharm'
    }
  }
  return env.terminal
}

export function getTerminalWithJetBrainsDetection(): string | null {
  
  if (process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') {
    
    if (env.platform !== 'darwin') {
      
      
      if (jetBrainsIDECache !== undefined) {
        return jetBrainsIDECache || 'pycharm'
      }
      
      return 'pycharm'
    }
  }
  return env.terminal
}

export async function initJetBrainsDetection(): Promise<void> {
  if (process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') {
    await detectJetBrainsIDEFromParentProcessAsync()
  }
}

export const envDynamic = {
  ...env, 
  terminal: getTerminalWithJetBrainsDetection(),
  getIsDocker,
  getIsBubblewrapSandbox,
  isMuslEnvironment,
  getTerminalWithJetBrainsDetectionAsync,
  initJetBrainsDetection,
}
