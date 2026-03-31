import { feature } from 'bun:bundle'
import { access } from 'fs/promises'
import { tmpdir as osTmpdir } from 'os'
import { join as nativeJoin } from 'path'
import { join as posixJoin } from 'path/posix'
import { rearrangePipeCommand } from '../bash/bashPipeCommand.js'
import { createAndSaveSnapshot } from '../bash/ShellSnapshot.js'
import { formatShellPrefixCommand } from '../bash/shellPrefix.js'
import { quote } from '../bash/shellQuote.js'
import {
  quoteShellCommand,
  rewriteWindowsNullRedirect,
  shouldAddStdinRedirect,
} from '../bash/shellQuoting.js'
import { logForDebugging } from '../debug.js'
import { getPlatform } from '../platform.js'
import { getSessionEnvironmentScript } from '../sessionEnvironment.js'
import { getSessionEnvVars } from '../sessionEnvVars.js'
import {
  ensureSocketInitialized,
  getClaudeTmuxEnv,
  hasTmuxToolBeenUsed,
} from '../tmuxSocket.js'
import { windowsPathToPosixPath } from '../windowsPaths.js'
import type { ShellProvider } from './shellProvider.js'

function getDisableExtglobCommand(shellPath: string): string | null {
  // When CLAUDE_CODE_SHELL_PREFIX is set, the wrapper may use a different shell
  
  if (process.env.CLAUDE_CODE_SHELL_PREFIX) {
    // Redirect both stdout and stderr because zsh's command_not_found_handler
    // writes to stdout instead of stderr
    return '{ shopt -u extglob || setopt NO_EXTENDED_GLOB; } >/dev/null 2>&1 || true'
  }

  // No shell prefix - use shell-specific command
  if (shellPath.includes('bash')) {
    return 'shopt -u extglob 2>/dev/null || true'
  } else if (shellPath.includes('zsh')) {
    return 'setopt NO_EXTENDED_GLOB 2>/dev/null || true'
  }
  // Unknown shell - do nothing, we don't know the right command
  return null
}

export async function createBashShellProvider(
  shellPath: string,
  options?: { skipSnapshot?: boolean },
): Promise<ShellProvider> {
  let currentSandboxTmpDir: string | undefined
  const snapshotPromise: Promise<string | undefined> = options?.skipSnapshot
    ? Promise.resolve(undefined)
    : createAndSaveSnapshot(shellPath).catch(error => {
        logForDebugging(`Failed to create shell snapshot: ${error}`)
        return undefined
      })
  
  let lastSnapshotFilePath: string | undefined

  return {
    type: 'bash',
    shellPath,
    detached: true,

    async buildExecCommand(
      command: string,
      opts: {
        id: number | string
        sandboxTmpDir?: string
        useSandbox: boolean
      },
    ): Promise<{ commandString: string; cwdFilePath: string }> {
      let snapshotFilePath = await snapshotPromise
      
      
      
      
      // `source ... || true` silently fails and commands run with NO shell
      
      
      if (snapshotFilePath) {
        try {
          await access(snapshotFilePath)
        } catch {
          logForDebugging(
            `Snapshot file missing, falling back to login shell: ${snapshotFilePath}`,
          )
          snapshotFilePath = undefined
        }
      }
      lastSnapshotFilePath = snapshotFilePath

      
      currentSandboxTmpDir = opts.sandboxTmpDir

      const tmpdir = osTmpdir()
      const isWindows = getPlatform() === 'windows'
      const shellTmpdir = isWindows ? windowsPathToPosixPath(tmpdir) : tmpdir

      
      
      
      
      const shellCwdFilePath = opts.useSandbox
        ? posixJoin(opts.sandboxTmpDir!, `cwd-${opts.id}`)
        : posixJoin(shellTmpdir, `claude-${opts.id}-cwd`)
      const cwdFilePath = opts.useSandbox
        ? posixJoin(opts.sandboxTmpDir!, `cwd-${opts.id}`)
        : nativeJoin(tmpdir, `claude-${opts.id}-cwd`)

      
      
      
      
      const normalizedCommand = rewriteWindowsNullRedirect(command)
      const addStdinRedirect = shouldAddStdinRedirect(normalizedCommand)
      let quotedCommand = quoteShellCommand(normalizedCommand, addStdinRedirect)

      
      
      if (
        feature('COMMIT_ATTRIBUTION') &&
        (command.includes('<<') || command.includes('\n'))
      ) {
        logForDebugging(
          `Shell: Command before quoting (first 500 chars):\n${command.slice(0, 500)}`,
        )
        logForDebugging(
          `Shell: Quoted command (first 500 chars):\n${quotedCommand.slice(0, 500)}`,
        )
      }

      // Special handling for pipes: move stdin redirect after first command
      
      
      
      
      
      // not the raw command (since PR #9189).
      if (normalizedCommand.includes('|') && addStdinRedirect) {
        quotedCommand = rearrangePipeCommand(normalizedCommand)
      }

      const commandParts: string[] = []

      
      
      
      if (snapshotFilePath) {
        const finalPath =
          getPlatform() === 'windows'
            ? windowsPathToPosixPath(snapshotFilePath)
            : snapshotFilePath
        commandParts.push(`source ${quote([finalPath])} 2>/dev/null || true`)
      }

      // Source session environment variables captured from session start hooks
      const sessionEnvScript = await getSessionEnvironmentScript()
      if (sessionEnvScript) {
        commandParts.push(sessionEnvScript)
      }

      // Disable extended glob patterns for security (after sourcing user config to override)
      const disableExtglobCmd = getDisableExtglobCommand(shellPath)
      if (disableExtglobCmd) {
        commandParts.push(disableExtglobCmd)
      }

      // When sourcing a file with aliases, they won't be expanded in the same command line
      // because the shell parses the entire line before execution. Using eval after
      // sourcing causes a second parsing pass where aliases are now available for expansion.
      commandParts.push(`eval ${quotedCommand}`)
      // Use `pwd -P` to get the physical path of the current working directory for consistency with `process.cwd()`
      commandParts.push(`pwd -P >| ${quote([shellCwdFilePath])}`)
      let commandString = commandParts.join(' && ')

      // Apply CLAUDE_CODE_SHELL_PREFIX if set
      if (process.env.CLAUDE_CODE_SHELL_PREFIX) {
        commandString = formatShellPrefixCommand(
          process.env.CLAUDE_CODE_SHELL_PREFIX,
          commandString,
        )
      }

      return { commandString, cwdFilePath }
    },

    getSpawnArgs(commandString: string): string[] {
      const skipLoginShell = lastSnapshotFilePath !== undefined
      if (skipLoginShell) {
        logForDebugging('Spawning shell without login (-l flag skipped)')
      }
      return ['-c', ...(skipLoginShell ? [] : ['-l']), commandString]
    },

    async getEnvironmentOverrides(
      command: string,
    ): Promise<Record<string, string>> {
      // TMUX SOCKET ISOLATION (DEFERRED):
      // We initialize Claude's tmux socket ONLY AFTER the Tmux tool has been used
      
      
      
      
      
      
      
      const commandUsesTmux = command.includes('tmux')
      if (
        process.env.USER_TYPE === 'ant' &&
        (hasTmuxToolBeenUsed() || commandUsesTmux)
      ) {
        await ensureSocketInitialized()
      }
      const claudeTmuxEnv = getClaudeTmuxEnv()
      const env: Record<string, string> = {}
      // CRITICAL: Override TMUX to isolate ALL tmux commands to Claude's socket.
      // This is NOT the user's TMUX value - it points to Claude's isolated socket.
      // When null (before socket initializes), user's TMUX is preserved.
      if (claudeTmuxEnv) {
        env.TMUX = claudeTmuxEnv
      }
      if (currentSandboxTmpDir) {
        let posixTmpDir = currentSandboxTmpDir
        if (getPlatform() === 'windows') {
          posixTmpDir = windowsPathToPosixPath(posixTmpDir)
        }
        env.TMPDIR = posixTmpDir
        env.CLAUDE_CODE_TMPDIR = posixTmpDir
        
        // not TMPDIR. Set it to a path inside the sandbox tmp dir so
        
        
        env.TMPPREFIX = posixJoin(posixTmpDir, 'zsh')
      }
      // Apply session env vars set via /env (child processes only, not the REPL)
      for (const [key, value] of getSessionEnvVars()) {
        env[key] = value
      }
      return env
    },
  }
}
