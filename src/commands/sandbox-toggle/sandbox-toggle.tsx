import { relative } from 'path';
import React from 'react';
import { getCwdState } from '../../bootstrap/state.js';
import { SandboxSettings } from '../../components/sandbox/SandboxSettings.js';
import { color } from '../../ink.js';
import { getPlatform } from '../../utils/platform.js';
import { addToExcludedCommands, SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { getSettings_DEPRECATED, getSettingsFilePathForSource } from '../../utils/settings/settings.js';
import type { ThemeName } from '../../utils/theme.js';
export async function call(onDone: (result?: string) => void, _context: unknown, args?: string): Promise<React.ReactNode | null> {
  const settings = getSettings_DEPRECATED();
  const themeName: ThemeName = settings.theme as ThemeName || 'light';
  const platform = getPlatform();
  if (!SandboxManager.isSupportedPlatform()) {
    
    const errorMessage = platform === 'wsl' ? 'Error: Sandboxing requires WSL2. WSL1 is not supported.' : 'Error: Sandboxing is currently only supported on macOS, Linux, and WSL2.';
    const message = color('error', themeName)(errorMessage);
    onDone(message);
    return null;
  }

  
  const depCheck = SandboxManager.checkDependencies();

  
  if (!SandboxManager.isPlatformInEnabledList()) {
    const message = color('error', themeName)(`Error: Sandboxing is disabled for this platform (${platform}) via the enabledPlatforms setting.`);
    onDone(message);
    return null;
  }

  
  if (SandboxManager.areSandboxSettingsLockedByPolicy()) {
    const message = color('error', themeName)('Error: Sandbox settings are overridden by a higher-priority configuration and cannot be changed locally.');
    onDone(message);
    return null;
  }

  
  const trimmedArgs = args?.trim() || '';

  
  if (!trimmedArgs) {
    return <SandboxSettings onComplete={onDone} depCheck={depCheck} />;
  }

  
  if (trimmedArgs) {
    const parts = trimmedArgs.split(' ');
    const subcommand = parts[0];
    if (subcommand === 'exclude') {
      
      const commandPattern = trimmedArgs.slice('exclude '.length).trim();
      if (!commandPattern) {
        const message = color('error', themeName)('Error: Please provide a command pattern to exclude (e.g., /sandbox exclude "npm run test:*")');
        onDone(message);
        return null;
      }

      
      const cleanPattern = commandPattern.replace(/^["']|["']$/g, '');

      
      addToExcludedCommands(cleanPattern);

      
      const localSettingsPath = getSettingsFilePathForSource('localSettings');
      const relativePath = localSettingsPath ? relative(getCwdState(), localSettingsPath) : '.claude/settings.local.json';
      const message = color('success', themeName)(`Added "${cleanPattern}" to excluded commands in ${relativePath}`);
      onDone(message);
      return null;
    } else {
      
      const message = color('error', themeName)(`Error: Unknown subcommand "${subcommand}". Available subcommand: exclude`);
      onDone(message);
      return null;
    }
  }

  
  return null;
}
