import { feature } from "./utils/bundle-mock.ts";
import { appendFileSync } from 'fs';
import React from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import { gracefulShutdown, gracefulShutdownSync } from 'src/utils/gracefulShutdown.js';
import { type ChannelEntry, getAllowedChannels, setAllowedChannels, setHasDevChannels, setSessionTrustAccepted, setStatsStore } from './bootstrap/state.js';
import type { Command } from './commands.js';
import { createStatsStore, type StatsStore } from './context/stats.js';
import { getSystemContext } from './context.js';
import { initializeTelemetryAfterTrust } from './entrypoints/init.js';
import { isSynchronizedOutputSupported } from './ink/terminal.js';
import type { RenderOptions, Root, TextProps } from './ink.js';
import { KeybindingSetup } from './keybindings/KeybindingProviderSetup.js';
import { startDeferredPrefetches } from './main.js';
import { checkGate_CACHED_OR_BLOCKING, initializeGrowthBook, resetGrowthBook } from './services/analytics/growthbook.js';
import { isQualifiedForGrove } from './services/api/grove.js';
import { handleMcpjsonServerApprovals } from './services/mcpServerApproval.js';
import { AppStateProvider } from './state/AppState.js';
import { onChangeAppState } from './state/onChangeAppState.js';
import { normalizeApiKeyForConfig } from './utils/authPortable.js';
import { getExternalClaudeMdIncludes, getMemoryFiles, shouldShowClaudeMdExternalIncludesWarning } from './utils/claudemd.js';
import { checkHasTrustDialogAccepted, getCustomApiKeyStatus, getGlobalConfig, saveGlobalConfig } from './utils/config.js';
import { updateDeepLinkTerminalPreference } from './utils/deepLink/terminalPreference.js';
import { isEnvTruthy, isRunningOnHomespace } from './utils/envUtils.js';
import { type FpsMetrics, FpsTracker } from './utils/fpsTracker.js';
import { updateGithubRepoPathMapping } from './utils/githubRepoPathMapping.js';
import { applyConfigEnvironmentVariables } from './utils/managedEnv.js';
import type { PermissionMode } from './utils/permissions/PermissionMode.js';
import { getBaseRenderOptions } from './utils/renderOptions.js';
import { getSettingsWithAllErrors } from './utils/settings/allErrors.js';
import { hasAutoModeOptIn, hasSkipDangerousModePermissionPrompt } from './utils/settings/settings.js';
export function completeOnboarding(): void {
  saveGlobalConfig(current => ({
    ...current,
    hasCompletedOnboarding: true,
    lastOnboardingVersion: MACRO.VERSION
  }));
}
export function showDialog<T = void>(root: Root, renderer: (done: (result: T) => void) => React.ReactNode): Promise<T> {
  return new Promise<T>(resolve => {
    const done = (result: T): void => void resolve(result);
    root.render(renderer(done));
  });
}

export async function exitWithError(root: Root, message: string, beforeExit?: () => Promise<void>): Promise<never> {
  return exitWithMessage(root, message, {
    color: 'error',
    beforeExit
  });
}

export async function exitWithMessage(root: Root, message: string, options?: {
  color?: TextProps['color'];
  exitCode?: number;
  beforeExit?: () => Promise<void>;
}): Promise<never> {
  const {
    Text
  } = await import('./ink.js');
  const color = options?.color;
  const exitCode = options?.exitCode ?? 1;
  root.render(color ? <Text color={color}>{message}</Text> : <Text>{message}</Text>);
  root.unmount();
  await options?.beforeExit?.();
  
  process.exit(exitCode);
}

export function showSetupDialog<T = void>(root: Root, renderer: (done: (result: T) => void) => React.ReactNode, options?: {
  onChangeAppState?: typeof onChangeAppState;
}): Promise<T> {
  return showDialog<T>(root, done => <AppStateProvider onChangeAppState={options?.onChangeAppState}>
      <KeybindingSetup>{renderer(done)}</KeybindingSetup>
    </AppStateProvider>);
}

export async function renderAndRun(root: Root, element: React.ReactNode): Promise<void> {
  root.render(element);
  startDeferredPrefetches();
  await root.waitUntilExit();
  await gracefulShutdown(0);
}
export async function showSetupScreens(root: Root, permissionMode: PermissionMode, allowDangerouslySkipPermissions: boolean, commands?: Command[], claudeInChrome?: boolean, devChannels?: ChannelEntry[]): Promise<boolean> {
  if ("production" === 'test' || isEnvTruthy(false) || process.env.IS_DEMO 
  ) {
    return false;
  }
  const config = getGlobalConfig();
  let onboardingShown = false;
  if (!config.theme || !config.hasCompletedOnboarding 
  ) {
    onboardingShown = true;
    const {
      Onboarding
    } = await import('./components/Onboarding.js');
    await showSetupDialog(root, done => <Onboarding onDone={() => {
      completeOnboarding();
      void done();
    }} />, {
      onChangeAppState
    });
  }

  
  
  
  
  
  
  if (!isEnvTruthy(process.env.CLAUBBIT)) {
    
    
    
    if (!checkHasTrustDialogAccepted()) {
      const {
        TrustDialog
      } = await import('./components/TrustDialog/TrustDialog.js');
      await showSetupDialog(root, done => <TrustDialog commands={commands} onDone={done} />);
    }

    
    
    setSessionTrustAccepted(true);

    
    
    
    resetGrowthBook();
    void initializeGrowthBook();

    
    void getSystemContext();

    
    const {
      errors: allErrors
    } = getSettingsWithAllErrors();
    if (allErrors.length === 0) {
      await handleMcpjsonServerApprovals(root);
    }

    
    if (await shouldShowClaudeMdExternalIncludesWarning()) {
      const externalIncludes = getExternalClaudeMdIncludes(await getMemoryFiles(true));
      const {
        ClaudeMdExternalIncludesDialog
      } = await import('./components/ClaudeMdExternalIncludesDialog.js');
      await showSetupDialog(root, done => <ClaudeMdExternalIncludesDialog onDone={done} isStandaloneDialog externalIncludes={externalIncludes} />);
    }
  }

  
  
  void updateGithubRepoPathMapping();
  if (feature('LODESTONE')) {
    updateDeepLinkTerminalPreference();
  }

  
  
  
  
  applyConfigEnvironmentVariables();

  
  
  
  
  setImmediate(() => initializeTelemetryAfterTrust());
  if (await isQualifiedForGrove()) {
    const {
      GroveDialog
    } = await import('src/components/grove/Grove.js');
    const decision = await showSetupDialog<string>(root, done => <GroveDialog showIfAlreadyViewed={false} location={onboardingShown ? 'onboarding' : 'policy_update_modal'} onDone={done} />);
    if (decision === 'escape') {
      logEvent('tengu_grove_policy_exited', {});
      gracefulShutdownSync(0);
      return false;
    }
  }

  
  
  
  if (process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()) {
    const customApiKeyTruncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
    const keyStatus = getCustomApiKeyStatus(customApiKeyTruncated);
    if (keyStatus === 'new') {
      const {
        ApproveApiKey
      } = await import('./components/ApproveApiKey.js');
      await showSetupDialog<boolean>(root, done => <ApproveApiKey customApiKeyTruncated={customApiKeyTruncated} onDone={done} />, {
        onChangeAppState
      });
    }
  }
  if ((permissionMode === 'bypassPermissions' || allowDangerouslySkipPermissions) && !hasSkipDangerousModePermissionPrompt()) {
    const {
      BypassPermissionsModeDialog
    } = await import('./components/BypassPermissionsModeDialog.js');
    await showSetupDialog(root, done => <BypassPermissionsModeDialog onAccept={done} />);
  }
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    
    
    
    
    if (permissionMode === 'auto' && !hasAutoModeOptIn()) {
      const {
        AutoModeOptInDialog
      } = await import('./components/AutoModeOptInDialog.js');
      await showSetupDialog(root, done => <AutoModeOptInDialog onAccept={done} onDecline={() => gracefulShutdownSync(1)} declineExits />);
    }
  }

  
  
  
  
  if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
    
    
    
    
    
    
    
    
    if (getAllowedChannels().length > 0 || (devChannels?.length ?? 0) > 0) {
      await checkGate_CACHED_OR_BLOCKING('tengu_harbor');
    }
    if (devChannels && devChannels.length > 0) {
      const [{
        isChannelsEnabled
      }, {
        getClaudeAIOAuthTokens
      }] = await Promise.all([import('./services/mcp/channelAllowlist.js'), import('./utils/auth.js')]);
      
      
      
      
      
      
      
      if (!isChannelsEnabled() || !getClaudeAIOAuthTokens()?.accessToken) {
        setAllowedChannels([...getAllowedChannels(), ...devChannels.map(c => ({
          ...c,
          dev: true
        }))]);
        setHasDevChannels(true);
      } else {
        const {
          DevChannelsDialog
        } = await import('./components/DevChannelsDialog.js');
        await showSetupDialog(root, done => <DevChannelsDialog channels={devChannels} onAccept={() => {
          
          
          setAllowedChannels([...getAllowedChannels(), ...devChannels.map(c => ({
            ...c,
            dev: true
          }))]);
          setHasDevChannels(true);
          void done();
        }} />);
      }
    }
  }

  
  if (claudeInChrome && !getGlobalConfig().hasCompletedClaudeInChromeOnboarding) {
    const {
      ClaudeInChromeOnboarding
    } = await import('./components/ClaudeInChromeOnboarding.js');
    await showSetupDialog(root, done => <ClaudeInChromeOnboarding onDone={done} />);
  }
  return onboardingShown;
}
export function getRenderContext(exitOnCtrlC: boolean): {
  renderOptions: RenderOptions;
  getFpsMetrics: () => FpsMetrics | undefined;
  stats: StatsStore;
} {
  let lastFlickerTime = 0;
  const baseOptions = getBaseRenderOptions(exitOnCtrlC);

  
  if (baseOptions.stdin) {
    logEvent('tengu_stdin_interactive', {});
  }
  const fpsTracker = new FpsTracker();
  const stats = createStatsStore();
  setStatsStore(stats);

  
  
  
  
  const frameTimingLogPath = process.env.CLAUDE_CODE_NEXT_FRAME_TIMING_LOG;
  return {
    getFpsMetrics: () => fpsTracker.getMetrics(),
    stats,
    renderOptions: {
      ...baseOptions,
      onFrame: event => {
        fpsTracker.record(event.durationMs);
        stats.observe('frame_duration_ms', event.durationMs);
        if (frameTimingLogPath && event.phases) {
          
          
          
          const line =
          
          JSON.stringify({
            total: event.durationMs,
            ...event.phases,
            rss: process.memoryUsage.rss(),
            cpu: process.cpuUsage()
          }) + '\n';
          
          appendFileSync(frameTimingLogPath, line);
        }
        
        
        if (isSynchronizedOutputSupported()) {
          return;
        }
        for (const flicker of event.flickers) {
          if (flicker.reason === 'resize') {
            continue;
          }
          const now = Date.now();
          if (now - lastFlickerTime < 1000) {
            logEvent('tengu_flicker', {
              desiredHeight: flicker.desiredHeight,
              actualHeight: flicker.availableHeight,
              reason: flicker.reason
            } as unknown as Record<string, boolean | number | undefined>);
          }
          lastFlickerTime = now;
        }
      }
    }
  };
}
