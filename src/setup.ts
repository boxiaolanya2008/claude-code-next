

import { feature } from 'bun:bundle'
import chalk from 'chalk'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getCwd } from 'src/utils/cwd.js'
import { checkForReleaseNotes } from 'src/utils/releaseNotes.js'
import { setCwd } from 'src/utils/Shell.js'
import { initSinks } from 'src/utils/sinks.js'
import {
  getIsNonInteractiveSession,
  getProjectRoot,
  getSessionId,
  setOriginalCwd,
  setProjectRoot,
  switchSession,
} from './bootstrap/state.js'
import { getCommands } from './commands.js'
import { initSessionMemory } from './services/SessionMemory/sessionMemory.js'
import { asSessionId } from './types/ids.js'
import { isAgentSwarmsEnabled } from './utils/agentSwarmsEnabled.js'
import { checkAndRestoreTerminalBackup } from './utils/appleTerminalBackup.js'
import { prefetchApiKeyFromApiKeyHelperIfSafe } from './utils/auth.js'
import { clearMemoryFileCaches } from './utils/claudemd.js'
import { getCurrentProjectConfig, getGlobalConfig } from './utils/config.js'
import { logForDiagnosticsNoPII } from './utils/diagLogs.js'
import { env } from './utils/env.js'
import { envDynamic } from './utils/envDynamic.js'
import { isBareMode, isEnvTruthy } from './utils/envUtils.js'
import { errorMessage } from './utils/errors.js'
import { findCanonicalGitRoot, findGitRoot, getIsGit } from './utils/git.js'
import { initializeFileChangedWatcher } from './utils/hooks/fileChangedWatcher.js'
import {
  captureHooksConfigSnapshot,
  updateHooksConfigSnapshot,
} from './utils/hooks/hooksConfigSnapshot.js'
import { hasWorktreeCreateHook } from './utils/hooks.js'
import { checkAndRestoreITerm2Backup } from './utils/iTermBackup.js'
import { logError } from './utils/log.js'
import { getRecentActivity } from './utils/logoV2Utils.js'
import { lockCurrentVersion } from './utils/nativeInstaller/index.js'
import type { PermissionMode } from './utils/permissions/PermissionMode.js'
import { getPlanSlug } from './utils/plans.js'
import { saveWorktreeState } from './utils/sessionStorage.js'
import { profileCheckpoint } from './utils/startupProfiler.js'
import {
  createTmuxSessionForWorktree,
  createWorktreeForSession,
  generateTmuxSessionName,
  worktreeBranchName,
} from './utils/worktree.js'

export async function setup(
  cwd: string,
  permissionMode: PermissionMode,
  allowDangerouslySkipPermissions: boolean,
  worktreeEnabled: boolean,
  worktreeName: string | undefined,
  tmuxEnabled: boolean,
  customSessionId?: string | null,
  worktreePRNumber?: number,
  messagingSocketPath?: string,
): Promise<void> {
  logForDiagnosticsNoPII('info', 'setup_started')

  
  const nodeVersion = process.version.match(/^v(\d+)\./)?.[1]
  if (!nodeVersion || parseInt(nodeVersion) < 18) {
    
    console.error(
      chalk.bold.red(
        'Error: Claude Code Next requires Node.js version 18 or higher.',
      ),
    )
    process.exit(1)
  }

  
  if (customSessionId) {
    switchSession(asSessionId(customSessionId))
  }

  
  
  
  if (!isBareMode() || messagingSocketPath !== undefined) {
    
    
    
    
    
    if (feature('UDS_INBOX')) {
      const m = await import('./utils/udsMessaging.js')
      await m.startUdsMessaging(
        messagingSocketPath ?? m.getDefaultUdsSocketPath(),
        { isExplicit: messagingSocketPath !== undefined },
      )
    }
  }

  
  if (!isBareMode() && isAgentSwarmsEnabled()) {
    const { captureTeammateModeSnapshot } = await import(
      './utils/swarm/backends/teammateModeSnapshot.js'
    )
    captureTeammateModeSnapshot()
  }

  
  
  
  if (!getIsNonInteractiveSession()) {
    
    if (isAgentSwarmsEnabled()) {
      const restoredIterm2Backup = await checkAndRestoreITerm2Backup()
      if (restoredIterm2Backup.status === 'restored') {
        
        console.log(
          chalk.yellow(
            'Detected an interrupted iTerm2 setup. Your original settings have been restored. You may need to restart iTerm2 for the changes to take effect.',
          ),
        )
      } else if (restoredIterm2Backup.status === 'failed') {
        
        console.error(
          chalk.red(
            `Failed to restore iTerm2 settings. Please manually restore your original settings with: defaults import com.googlecode.iterm2 ${restoredIterm2Backup.backupPath}.`,
          ),
        )
      }
    }

    
    try {
      const restoredTerminalBackup = await checkAndRestoreTerminalBackup()
      if (restoredTerminalBackup.status === 'restored') {
        
        console.log(
          chalk.yellow(
            'Detected an interrupted Terminal.app setup. Your original settings have been restored. You may need to restart Terminal.app for the changes to take effect.',
          ),
        )
      } else if (restoredTerminalBackup.status === 'failed') {
        
        console.error(
          chalk.red(
            `Failed to restore Terminal.app settings. Please manually restore your original settings with: defaults import com.apple.Terminal ${restoredTerminalBackup.backupPath}.`,
          ),
        )
      }
    } catch (error) {
      
      logError(error)
    }
  }

  
  setCwd(cwd)

  
  
  const hooksStart = Date.now()
  captureHooksConfigSnapshot()
  logForDiagnosticsNoPII('info', 'setup_hooks_captured', {
    duration_ms: Date.now() - hooksStart,
  })

  
  initializeFileChangedWatcher(cwd)

  
  
  if (worktreeEnabled) {
    
    
    const hasHook = hasWorktreeCreateHook()
    const inGit = await getIsGit()
    if (!hasHook && !inGit) {
      process.stderr.write(
        chalk.red(
          `Error: Can only use --worktree in a git repository, but ${chalk.bold(cwd)} is not a git repository. ` +
            `Configure a WorktreeCreate hook in settings.json to use --worktree with other VCS systems.\n`,
        ),
      )
      process.exit(1)
    }

    const slug = worktreePRNumber
      ? `pr-${worktreePRNumber}`
      : (worktreeName ?? getPlanSlug())

    
    
    
    let tmuxSessionName: string | undefined
    if (inGit) {
      
      
      
      const mainRepoRoot = findCanonicalGitRoot(getCwd())
      if (!mainRepoRoot) {
        process.stderr.write(
          chalk.red(
            `Error: Could not determine the main git repository root.\n`,
          ),
        )
        process.exit(1)
      }

      
      if (mainRepoRoot !== (findGitRoot(getCwd()) ?? getCwd())) {
        logForDiagnosticsNoPII('info', 'worktree_resolved_to_main_repo')
        process.chdir(mainRepoRoot)
        setCwd(mainRepoRoot)
      }

      tmuxSessionName = tmuxEnabled
        ? generateTmuxSessionName(mainRepoRoot, worktreeBranchName(slug))
        : undefined
    } else {
      
      
      tmuxSessionName = tmuxEnabled
        ? generateTmuxSessionName(getCwd(), worktreeBranchName(slug))
        : undefined
    }

    let worktreeSession: Awaited<ReturnType<typeof createWorktreeForSession>>
    try {
      worktreeSession = await createWorktreeForSession(
        getSessionId(),
        slug,
        tmuxSessionName,
        worktreePRNumber ? { prNumber: worktreePRNumber } : undefined,
      )
    } catch (error) {
      process.stderr.write(
        chalk.red(`Error creating worktree: ${errorMessage(error)}\n`),
      )
      process.exit(1)
    }

    logEvent('tengu_worktree_created', { tmux_enabled: tmuxEnabled })

    
    if (tmuxEnabled && tmuxSessionName) {
      const tmuxResult = await createTmuxSessionForWorktree(
        tmuxSessionName,
        worktreeSession.worktreePath,
      )
      if (tmuxResult.created) {
        
        console.log(
          chalk.green(
            `Created tmux session: ${chalk.bold(tmuxSessionName)}\nTo attach: ${chalk.bold(`tmux attach -t ${tmuxSessionName}`)}`,
          ),
        )
      } else {
        
        console.error(
          chalk.yellow(
            `Warning: Failed to create tmux session: ${tmuxResult.error}`,
          ),
        )
      }
    }

    process.chdir(worktreeSession.worktreePath)
    setCwd(worktreeSession.worktreePath)
    setOriginalCwd(getCwd())
    
    
    
    setProjectRoot(getCwd())
    saveWorktreeState(worktreeSession)
    
    clearMemoryFileCaches()
    
    
    
    updateHooksConfigSnapshot()
  }

  
  logForDiagnosticsNoPII('info', 'setup_background_jobs_starting')
  
  
  
  
  if (!isBareMode()) {
    initSessionMemory() 
    if (feature('CONTEXT_COLLAPSE')) {
      
      ;(
        require('./services/contextCollapse/index.js') as typeof import('./services/contextCollapse/index.js')
      ).initContextCollapse()
      
    }
  }
  void lockCurrentVersion() 
  logForDiagnosticsNoPII('info', 'setup_background_jobs_launched')

  profileCheckpoint('setup_before_prefetch')
  
  logForDiagnosticsNoPII('info', 'setup_prefetch_starting')
  
  
  
  
  
  
  const skipPluginPrefetch =
    (getIsNonInteractiveSession() &&
      isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SYNC_PLUGIN_INSTALL)) ||
    
    
    isBareMode()
  if (!skipPluginPrefetch) {
    void getCommands(getProjectRoot())
  }
  void import('./utils/plugins/loadPluginHooks.js').then(m => {
    if (!skipPluginPrefetch) {
      void m.loadPluginHooks() 
      m.setupPluginHookHotReload() 
    }
  })
  
  
  
  
  
  
  if (!isBareMode()) {
    if (process.env.USER_TYPE === 'ant') {
      
      
      
      void import('./utils/commitAttribution.js').then(async m => {
        if (await m.isInternalModelRepo()) {
          const { clearSystemPromptSections } = await import(
            './constants/systemPromptSections.js'
          )
          clearSystemPromptSections()
        }
      })
    }
    if (feature('COMMIT_ATTRIBUTION')) {
      
      
      
      setImmediate(() => {
        void import('./utils/attributionHooks.js').then(
          ({ registerAttributionHooks }) => {
            registerAttributionHooks() 
          },
        )
      })
    }
    void import('./utils/sessionFileAccessHooks.js').then(m =>
      m.registerSessionFileAccessHooks(),
    ) 
    if (feature('TEAMMEM')) {
      void import('./services/teamMemorySync/watcher.js').then(m =>
        m.startTeamMemoryWatcher(),
      ) 
    }
  }
  initSinks() 

  
  
  
  
  
  logEvent('tengu_started', {})

  void prefetchApiKeyFromApiKeyHelperIfSafe(getIsNonInteractiveSession()) 
  profileCheckpoint('setup_after_prefetch')

  
  
  
  if (!isBareMode()) {
    const { hasReleaseNotes } = await checkForReleaseNotes(
      getGlobalConfig().lastReleaseNotesSeen,
    )
    if (hasReleaseNotes) {
      await getRecentActivity()
    }
  }

  
  if (
    permissionMode === 'bypassPermissions' ||
    allowDangerouslySkipPermissions
  ) {
    
    
    if (
      process.platform !== 'win32' &&
      typeof process.getuid === 'function' &&
      process.getuid() === 0 &&
      process.env.IS_SANDBOX !== '1' &&
      !isEnvTruthy(process.env.CLAUDE_CODE_NEXT_BUBBLEWRAP)
    ) {
      
      console.error(
        `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`,
      )
      process.exit(1)
    }

    if (
      process.env.USER_TYPE === 'ant' &&
      
      
      
      process.env.CLAUDE_CODE_NEXT_ENTRYPOINT !== 'local-agent' &&
      
      
      process.env.CLAUDE_CODE_NEXT_ENTRYPOINT !== 'claude-desktop'
    ) {
      
      const [isDocker, hasInternet] = await Promise.all([
        envDynamic.getIsDocker(),
        env.hasInternetAccess(),
      ])
      const isBubblewrap = envDynamic.getIsBubblewrapSandbox()
      const isSandbox = process.env.IS_SANDBOX === '1'
      const isSandboxed = isDocker || isBubblewrap || isSandbox
      if (!isSandboxed || hasInternet) {
        
        console.error(
          `--dangerously-skip-permissions can only be used in Docker/sandbox containers with no internet access but got Docker: ${isDocker}, Bubblewrap: ${isBubblewrap}, IS_SANDBOX: ${isSandbox}, hasInternet: ${hasInternet}`,
        )
        process.exit(1)
      }
    }
  }

  if (process.env.NODE_ENV === 'test') {
    return
  }

  
  const projectConfig = getCurrentProjectConfig()
  if (
    projectConfig.lastCost !== undefined &&
    projectConfig.lastDuration !== undefined
  ) {
    logEvent('tengu_exit', {
      last_session_cost: projectConfig.lastCost,
      last_session_api_duration: projectConfig.lastAPIDuration,
      last_session_tool_duration: projectConfig.lastToolDuration,
      last_session_duration: projectConfig.lastDuration,
      last_session_lines_added: projectConfig.lastLinesAdded,
      last_session_lines_removed: projectConfig.lastLinesRemoved,
      last_session_total_input_tokens: projectConfig.lastTotalInputTokens,
      last_session_total_output_tokens: projectConfig.lastTotalOutputTokens,
      last_session_total_cache_creation_input_tokens:
        projectConfig.lastTotalCacheCreationInputTokens,
      last_session_total_cache_read_input_tokens:
        projectConfig.lastTotalCacheReadInputTokens,
      last_session_fps_average: projectConfig.lastFpsAverage,
      last_session_fps_low_1_pct: projectConfig.lastFpsLow1Pct,
      last_session_id:
        projectConfig.lastSessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...projectConfig.lastSessionMetrics,
    })
    
    
    
  }
}
