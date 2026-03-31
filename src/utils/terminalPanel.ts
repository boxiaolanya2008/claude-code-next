

import { spawn, spawnSync } from 'child_process'
import { getSessionId } from '../bootstrap/state.js'
import instances from '../ink/instances.js'
import { registerCleanup } from './cleanupRegistry.js'
import { pwd } from './cwd.js'
import { logForDebugging } from './debug.js'

const TMUX_SESSION = 'panel'

export function getTerminalPanelSocket(): string {
  
  const sessionId = getSessionId()
  return `claude-panel-${sessionId.slice(0, 8)}`
}

let instance: TerminalPanel | undefined

export function getTerminalPanel(): TerminalPanel {
  if (!instance) {
    instance = new TerminalPanel()
  }
  return instance
}

class TerminalPanel {
  private hasTmux: boolean | undefined
  private cleanupRegistered = false

  

  toggle(): void {
    this.showShell()
  }

  

  private checkTmux(): boolean {
    if (this.hasTmux !== undefined) return this.hasTmux
    const result = spawnSync('tmux', ['-V'], { encoding: 'utf-8' })
    this.hasTmux = result.status === 0
    if (!this.hasTmux) {
      logForDebugging(
        'Terminal panel: tmux not found, falling back to non-persistent shell',
      )
    }
    return this.hasTmux
  }

  private hasSession(): boolean {
    const result = spawnSync(
      'tmux',
      ['-L', getTerminalPanelSocket(), 'has-session', '-t', TMUX_SESSION],
      { encoding: 'utf-8' },
    )
    return result.status === 0
  }

  private createSession(): boolean {
    const shell = process.env.SHELL || '/bin/bash'
    const cwd = pwd()
    const socket = getTerminalPanelSocket()

    const result = spawnSync(
      'tmux',
      [
        '-L',
        socket,
        'new-session',
        '-d',
        '-s',
        TMUX_SESSION,
        '-c',
        cwd,
        shell,
        '-l',
      ],
      { encoding: 'utf-8' },
    )

    if (result.status !== 0) {
      logForDebugging(
        `Terminal panel: failed to create tmux session: ${result.stderr}`,
      )
      return false
    }

    
    
    
    
    spawnSync('tmux', [
      '-L', socket,
      'bind-key', '-n', 'M-j', 'detach-client', ';',
      'set-option', '-g', 'status-style', 'bg=default', ';',
      'set-option', '-g', 'status-left', '', ';',
      'set-option', '-g', 'status-right', ' Alt+J to return to Claude ', ';',
      'set-option', '-g', 'status-right-style', 'fg=brightblack',
    ])

    if (!this.cleanupRegistered) {
      this.cleanupRegistered = true
      registerCleanup(async () => {
        
        
        
        
        spawn('tmux', ['-L', socket, 'kill-server'], {
          detached: true,
          stdio: 'ignore',
        })
          .on('error', () => {})
          .unref()
      })
    }

    return true
  }

  private attachSession(): void {
    spawnSync(
      'tmux',
      ['-L', getTerminalPanelSocket(), 'attach-session', '-t', TMUX_SESSION],
      { stdio: 'inherit' },
    )
  }

  

  private showShell(): void {
    const inkInstance = instances.get(process.stdout)
    if (!inkInstance) {
      logForDebugging('Terminal panel: no Ink instance found, aborting')
      return
    }

    inkInstance.enterAlternateScreen()
    try {
      if (this.checkTmux() && this.ensureSession()) {
        this.attachSession()
      } else {
        this.runShellDirect()
      }
    } finally {
      inkInstance.exitAlternateScreen()
    }
  }

  

  
  private ensureSession(): boolean {
    if (this.hasSession()) return true
    return this.createSession()
  }

  
  private runShellDirect(): void {
    const shell = process.env.SHELL || '/bin/bash'
    const cwd = pwd()
    spawnSync(shell, ['-i', '-l'], {
      stdio: 'inherit',
      cwd,
      env: process.env,
    })
  }
}
