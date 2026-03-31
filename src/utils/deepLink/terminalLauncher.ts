

import { spawn } from 'child_process'
import { basename } from 'path'
import { getGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { which } from '../which.js'

export type TerminalInfo = {
  name: string
  command: string
}

const MACOS_TERMINALS: Array<{
  name: string
  bundleId: string
  app: string
}> = [
  { name: 'iTerm2', bundleId: 'com.googlecode.iterm2', app: 'iTerm' },
  { name: 'Ghostty', bundleId: 'com.mitchellh.ghostty', app: 'Ghostty' },
  { name: 'Kitty', bundleId: 'net.kovidgoyal.kitty', app: 'kitty' },
  { name: 'Alacritty', bundleId: 'org.alacritty', app: 'Alacritty' },
  { name: 'WezTerm', bundleId: 'com.github.wez.wezterm', app: 'WezTerm' },
  {
    name: 'Terminal.app',
    bundleId: 'com.apple.Terminal',
    app: 'Terminal',
  },
]

const LINUX_TERMINALS = [
  'ghostty',
  'kitty',
  'alacritty',
  'wezterm',
  'gnome-terminal',
  'konsole',
  'xfce4-terminal',
  'mate-terminal',
  'tilix',
  'xterm',
]

async function detectMacosTerminal(): Promise<TerminalInfo> {
  
  
  
  const stored = getGlobalConfig().deepLinkTerminal
  if (stored) {
    const match = MACOS_TERMINALS.find(t => t.app === stored)
    if (match) {
      return { name: match.name, command: match.app }
    }
  }

  
  
  const termProgram = process.env.TERM_PROGRAM
  if (termProgram) {
    const normalized = termProgram.replace(/\.app$/i, '').toLowerCase()
    const match = MACOS_TERMINALS.find(
      t =>
        t.app.toLowerCase() === normalized ||
        t.name.toLowerCase() === normalized,
    )
    if (match) {
      return { name: match.name, command: match.app }
    }
  }

  
  
  
  
  for (const terminal of MACOS_TERMINALS) {
    const { code, stdout } = await execFileNoThrow(
      'mdfind',
      [`kMDItemCFBundleIdentifier == "${terminal.bundleId}"`],
      { timeout: 5000, useCwd: false },
    )
    if (code === 0 && stdout.trim().length > 0) {
      return { name: terminal.name, command: terminal.app }
    }
  }

  
  
  for (const terminal of MACOS_TERMINALS) {
    const { code: lsCode } = await execFileNoThrow(
      'ls',
      [`/Applications/${terminal.app}.app`],
      { timeout: 1000, useCwd: false },
    )
    if (lsCode === 0) {
      return { name: terminal.name, command: terminal.app }
    }
  }

  
  return { name: 'Terminal.app', command: 'Terminal' }
}

async function detectLinuxTerminal(): Promise<TerminalInfo | null> {
  
  const termEnv = process.env.TERMINAL
  if (termEnv) {
    const resolved = await which(termEnv)
    if (resolved) {
      return { name: basename(termEnv), command: resolved }
    }
  }

  
  const xte = await which('x-terminal-emulator')
  if (xte) {
    return { name: 'x-terminal-emulator', command: xte }
  }

  
  for (const terminal of LINUX_TERMINALS) {
    const resolved = await which(terminal)
    if (resolved) {
      return { name: terminal, command: resolved }
    }
  }

  return null
}

async function detectWindowsTerminal(): Promise<TerminalInfo> {
  
  const wt = await which('wt.exe')
  if (wt) {
    return { name: 'Windows Terminal', command: wt }
  }

  
  const pwsh = await which('pwsh.exe')
  if (pwsh) {
    return { name: 'PowerShell', command: pwsh }
  }

  
  const powershell = await which('powershell.exe')
  if (powershell) {
    return { name: 'PowerShell', command: powershell }
  }

  
  return { name: 'Command Prompt', command: 'cmd.exe' }
}

export async function detectTerminal(): Promise<TerminalInfo | null> {
  switch (process.platform) {
    case 'darwin':
      return detectMacosTerminal()
    case 'linux':
      return detectLinuxTerminal()
    case 'win32':
      return detectWindowsTerminal()
    default:
      return null
  }
}

export async function launchInTerminal(
  claudePath: string,
  action: {
    query?: string
    cwd?: string
    repo?: string
    lastFetchMs?: number
  },
): Promise<boolean> {
  const terminal = await detectTerminal()
  if (!terminal) {
    logForDebugging('No terminal emulator detected', { level: 'error' })
    return false
  }

  logForDebugging(
    `Launching in terminal: ${terminal.name} (${terminal.command})`,
  )
  const claudeArgs = ['--deep-link-origin']
  if (action.repo) {
    claudeArgs.push('--deep-link-repo', action.repo)
    if (action.lastFetchMs !== undefined) {
      claudeArgs.push('--deep-link-last-fetch', String(action.lastFetchMs))
    }
  }
  if (action.query) {
    claudeArgs.push('--prefill', action.query)
  }

  switch (process.platform) {
    case 'darwin':
      return launchMacosTerminal(terminal, claudePath, claudeArgs, action.cwd)
    case 'linux':
      return launchLinuxTerminal(terminal, claudePath, claudeArgs, action.cwd)
    case 'win32':
      return launchWindowsTerminal(terminal, claudePath, claudeArgs, action.cwd)
    default:
      return false
  }
}

async function launchMacosTerminal(
  terminal: TerminalInfo,
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): Promise<boolean> {
  switch (terminal.command) {
    
    
    

    case 'iTerm': {
      const shCmd = buildShellCommand(claudePath, claudeArgs, cwd)
      
      
      
      
      
      const script = `tell application "iTerm"
  if running then
    create window with default profile
  else
    activate
  end if
  tell current session of current window
    write text ${appleScriptQuote(shCmd)}
  end tell
end tell`
      const { code } = await execFileNoThrow('osascript', ['-e', script], {
        useCwd: false,
      })
      if (code === 0) return true
      break
    }

    case 'Terminal': {
      const shCmd = buildShellCommand(claudePath, claudeArgs, cwd)
      const script = `tell application "Terminal"
  do script ${appleScriptQuote(shCmd)}
  activate
end tell`
      const { code } = await execFileNoThrow('osascript', ['-e', script], {
        useCwd: false,
      })
      return code === 0
    }

    
    
    

    case 'Ghostty': {
      const args = [
        '-na',
        terminal.command,
        '--args',
        '--window-save-state=never',
      ]
      if (cwd) args.push(`--working-directory=${cwd}`)
      args.push('-e', claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }

    case 'Alacritty': {
      const args = ['-na', terminal.command, '--args']
      if (cwd) args.push('--working-directory', cwd)
      args.push('-e', claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }

    case 'kitty': {
      const args = ['-na', terminal.command, '--args']
      if (cwd) args.push('--directory', cwd)
      args.push(claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }

    case 'WezTerm': {
      const args = ['-na', terminal.command, '--args', 'start']
      if (cwd) args.push('--cwd', cwd)
      args.push('--', claudePath, ...claudeArgs)
      const { code } = await execFileNoThrow('open', args, { useCwd: false })
      if (code === 0) return true
      break
    }
  }

  logForDebugging(
    `Failed to launch ${terminal.name}, falling back to Terminal.app`,
  )
  return launchMacosTerminal(
    { name: 'Terminal.app', command: 'Terminal' },
    claudePath,
    claudeArgs,
    cwd,
  )
}

async function launchLinuxTerminal(
  terminal: TerminalInfo,
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): Promise<boolean> {
  
  
  
  
  

  let args: string[]
  let spawnCwd: string | undefined

  switch (terminal.name) {
    case 'gnome-terminal':
      args = cwd ? [`--working-directory=${cwd}`, '--'] : ['--']
      args.push(claudePath, ...claudeArgs)
      break
    case 'konsole':
      args = cwd ? ['--workdir', cwd, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    case 'kitty':
      args = cwd ? ['--directory', cwd] : []
      args.push(claudePath, ...claudeArgs)
      break
    case 'wezterm':
      args = cwd ? ['start', '--cwd', cwd, '--'] : ['start', '--']
      args.push(claudePath, ...claudeArgs)
      break
    case 'alacritty':
      args = cwd ? ['--working-directory', cwd, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    case 'ghostty':
      args = cwd ? [`--working-directory=${cwd}`, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    case 'xfce4-terminal':
    case 'mate-terminal':
      args = cwd ? [`--working-directory=${cwd}`, '-x'] : ['-x']
      args.push(claudePath, ...claudeArgs)
      break
    case 'tilix':
      args = cwd ? [`--working-directory=${cwd}`, '-e'] : ['-e']
      args.push(claudePath, ...claudeArgs)
      break
    default:
      
      
      args = ['-e', claudePath, ...claudeArgs]
      spawnCwd = cwd
      break
  }

  return spawnDetached(terminal.command, args, { cwd: spawnCwd })
}

async function launchWindowsTerminal(
  terminal: TerminalInfo,
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): Promise<boolean> {
  const args: string[] = []

  switch (terminal.name) {
    
    case 'Windows Terminal':
      if (cwd) args.push('-d', cwd)
      args.push('--', claudePath, ...claudeArgs)
      break

    
    
    
    
    

    case 'PowerShell': {
      
      
      
      const cdCmd = cwd ? `Set-Location ${psQuote(cwd)}; ` : ''
      args.push(
        '-NoExit',
        '-Command',
        `${cdCmd}& ${psQuote(claudePath)} ${claudeArgs.map(psQuote).join(' ')}`,
      )
      break
    }

    default: {
      const cdCmd = cwd ? `cd /d ${cmdQuote(cwd)} && ` : ''
      args.push(
        '/k',
        `${cdCmd}${cmdQuote(claudePath)} ${claudeArgs.map(a => cmdQuote(a)).join(' ')}`,
      )
      break
    }
  }

  
  
  
  return spawnDetached(terminal.command, args, {
    windowsVerbatimArguments: terminal.name === 'Command Prompt',
  })
}

function spawnDetached(
  command: string,
  args: string[],
  opts: { cwd?: string; windowsVerbatimArguments?: boolean } = {},
): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      cwd: opts.cwd,
      windowsVerbatimArguments: opts.windowsVerbatimArguments,
    })
    child.once('error', err => {
      logForDebugging(`Failed to spawn ${command}: ${err.message}`, {
        level: 'error',
      })
      void resolve(false)
    })
    child.once('spawn', () => {
      child.unref()
      void resolve(true)
    })
  })
}

function buildShellCommand(
  claudePath: string,
  claudeArgs: string[],
  cwd?: string,
): string {
  const cdPrefix = cwd ? `cd ${shellQuote(cwd)} && ` : ''
  return `${cdPrefix}${[claudePath, ...claudeArgs].map(shellQuote).join(' ')}`
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function appleScriptQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

function cmdQuote(arg: string): string {
  const stripped = arg.replace(/"/g, '').replace(/%/g, '%%')
  const escaped = stripped.replace(/(\\+)$/, '$1$1')
  return `"${escaped}"`
}
