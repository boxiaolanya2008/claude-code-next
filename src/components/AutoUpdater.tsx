import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { useInterval } from 'usehooks-ts';
import { useUpdateNotification } from '../hooks/useUpdateNotification.js';
import { Box, Text } from '../ink.js';
import { type AutoUpdaterResult, getLatestVersion, getMaxVersion, type InstallStatus, installGlobalPackage, shouldSkipVersion } from '../utils/autoUpdater.js';
import { getGlobalConfig, isAutoUpdaterDisabled } from '../utils/config.js';
import { logForDebugging } from '../utils/debug.js';
import { getCurrentInstallationType } from '../utils/doctorDiagnostic.js';
import { installOrUpdateClaudePackage, localInstallationExists } from '../utils/localInstaller.js';
import { removeInstalledSymlink } from '../utils/nativeInstaller/index.js';
import { gt, gte } from '../utils/semver.js';
import { getInitialSettings } from '../utils/settings/settings.js';
type Props = {
  isUpdating: boolean;
  onChangeIsUpdating: (isUpdating: boolean) => void;
  onAutoUpdaterResult: (autoUpdaterResult: AutoUpdaterResult) => void;
  autoUpdaterResult: AutoUpdaterResult | null;
  showSuccessMessage: boolean;
  verbose: boolean;
};
export function AutoUpdater({
  isUpdating,
  onChangeIsUpdating,
  onAutoUpdaterResult,
  autoUpdaterResult,
  showSuccessMessage,
  verbose
}: Props): React.ReactNode {
  const [versions, setVersions] = useState<{
    global?: string | null;
    latest?: string | null;
  }>({});
  const [hasLocalInstall, setHasLocalInstall] = useState(false);
  const updateSemver = useUpdateNotification(autoUpdaterResult?.version);
  useEffect(() => {
    void localInstallationExists().then(setHasLocalInstall);
  }, []);

  
  
  
  
  
  const isUpdatingRef = useRef(isUpdating);
  isUpdatingRef.current = isUpdating;
  const checkForUpdates = React.useCallback(async () => {
    if (isUpdatingRef.current) {
      return;
    }
    if ("production" === 'test' || "production" === 'development') {
      logForDebugging('AutoUpdater: Skipping update check in test/dev environment');
      return;
    }
    const currentVersion = MACRO.VERSION;
    const channel = getInitialSettings()?.autoUpdatesChannel ?? 'latest';
    let latestVersion = await getLatestVersion(channel);
    const isDisabled = isAutoUpdaterDisabled();

    
    const maxVersion = await getMaxVersion();
    if (maxVersion && latestVersion && gt(latestVersion, maxVersion)) {
      logForDebugging(`AutoUpdater: maxVersion ${maxVersion} is set, capping update from ${latestVersion} to ${maxVersion}`);
      if (gte(currentVersion, maxVersion)) {
        logForDebugging(`AutoUpdater: current version ${currentVersion} is already at or above maxVersion ${maxVersion}, skipping update`);
        setVersions({
          global: currentVersion,
          latest: latestVersion
        });
        return;
      }
      latestVersion = maxVersion;
    }
    setVersions({
      global: currentVersion,
      latest: latestVersion
    });

    
    if (!isDisabled && currentVersion && latestVersion && !gte(currentVersion, latestVersion) && !shouldSkipVersion(latestVersion)) {
      const startTime = Date.now();
      onChangeIsUpdating(true);

      
      
      const config = getGlobalConfig();
      if (config.installMethod !== 'native') {
        await removeInstalledSymlink();
      }

      
      const installationType = await getCurrentInstallationType();
      logForDebugging(`AutoUpdater: Detected installation type: ${installationType}`);

      
      if (installationType === 'development') {
        logForDebugging('AutoUpdater: Cannot auto-update development build');
        onChangeIsUpdating(false);
        return;
      }

      
      let installStatus: InstallStatus;
      let updateMethod: 'local' | 'global';
      if (installationType === 'npm-local') {
        
        logForDebugging('AutoUpdater: Using local update method');
        updateMethod = 'local';
        installStatus = await installOrUpdateClaudePackage(channel);
      } else if (installationType === 'npm-global') {
        
        logForDebugging('AutoUpdater: Using global update method');
        updateMethod = 'global';
        installStatus = await installGlobalPackage();
      } else if (installationType === 'native') {
        
        logForDebugging('AutoUpdater: Unexpected native installation in non-native updater');
        onChangeIsUpdating(false);
        return;
      } else {
        
        logForDebugging(`AutoUpdater: Unknown installation type, falling back to config`);
        const isMigrated = config.installMethod === 'local';
        updateMethod = isMigrated ? 'local' : 'global';
        if (isMigrated) {
          installStatus = await installOrUpdateClaudePackage(channel);
        } else {
          installStatus = await installGlobalPackage();
        }
      }
      onChangeIsUpdating(false);
      if (installStatus === 'success') {
        logEvent('tengu_auto_updater_success', {
          fromVersion: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toVersion: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs: Date.now() - startTime,
          wasMigrated: updateMethod === 'local',
          installationType: installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      } else {
        logEvent('tengu_auto_updater_fail', {
          fromVersion: currentVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          attemptedVersion: latestVersion as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          status: installStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          durationMs: Date.now() - startTime,
          wasMigrated: updateMethod === 'local',
          installationType: installationType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
      onAutoUpdaterResult({
        version: latestVersion,
        status: installStatus
      });
    }
    
    
    
    
    
  }, [onAutoUpdaterResult]);

  
  useEffect(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  
  useInterval(checkForUpdates, 30 * 60 * 1000);
  if (!autoUpdaterResult?.version && (!versions.global || !versions.latest)) {
    return null;
  }
  if (!autoUpdaterResult?.version && !isUpdating) {
    return null;
  }
  return <Box flexDirection="row" gap={1}>
      {verbose && <Text dimColor wrap="truncate">
          globalVersion: {versions.global} &middot; latestVersion:{' '}
          {versions.latest}
        </Text>}
      {isUpdating ? <>
          <Box>
            <Text color="text" dimColor wrap="truncate">
              Auto-updating…
            </Text>
          </Box>
        </> : autoUpdaterResult?.status === 'success' && showSuccessMessage && updateSemver && <Text color="success" wrap="truncate">
            ✓ Update installed · Restart to apply
          </Text>}
      {(autoUpdaterResult?.status === 'install_failed' || autoUpdaterResult?.status === 'no_permissions') && <Text color="error" wrap="truncate">
          ✗ Auto-update failed &middot; Try <Text bold>claude doctor</Text> or{' '}
          <Text bold>
            {hasLocalInstall ? `cd ~/.claude/local && npm update ${MACRO.PACKAGE_URL}` : `npm i -g ${MACRO.PACKAGE_URL}`}
          </Text>
        </Text>}
    </Box>;
}
