import React from 'react';
import { getIsInteractive } from '../../bootstrap/state.js';
import { ManagedSettingsSecurityDialog } from '../../components/ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.js';
import { extractDangerousSettings, hasDangerousSettings, hasDangerousSettingsChanged } from '../../components/ManagedSettingsSecurityDialog/utils.js';
import { render } from '../../ink.js';
import { KeybindingSetup } from '../../keybindings/KeybindingProviderSetup.js';
import { AppStateProvider } from '../../state/AppState.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';
import { getBaseRenderOptions } from '../../utils/renderOptions.js';
import type { SettingsJson } from '../../utils/settings/types.js';
import { logEvent } from '../analytics/index.js';
export type SecurityCheckResult = 'approved' | 'rejected' | 'no_check_needed';

export async function checkManagedSettingsSecurity(cachedSettings: SettingsJson | null, newSettings: SettingsJson | null): Promise<SecurityCheckResult> {
  
  if (!newSettings || !hasDangerousSettings(extractDangerousSettings(newSettings))) {
    return 'no_check_needed';
  }

  
  if (!hasDangerousSettingsChanged(cachedSettings, newSettings)) {
    return 'no_check_needed';
  }

  
  if (!getIsInteractive()) {
    return 'no_check_needed';
  }

  
  logEvent('tengu_managed_settings_security_dialog_shown', {});

  
  return new Promise<SecurityCheckResult>(resolve => {
    void (async () => {
      const {
        unmount
      } = await render(<AppStateProvider>
          <KeybindingSetup>
            <ManagedSettingsSecurityDialog settings={newSettings} onAccept={() => {
            logEvent('tengu_managed_settings_security_dialog_accepted', {});
            unmount();
            void resolve('approved');
          }} onReject={() => {
            logEvent('tengu_managed_settings_security_dialog_rejected', {});
            unmount();
            void resolve('rejected');
          }} />
          </KeybindingSetup>
        </AppStateProvider>, getBaseRenderOptions(false));
    })();
  });
}

export function handleSecurityCheckResult(result: SecurityCheckResult): boolean {
  if (result === 'rejected') {
    gracefulShutdownSync(1);
    return false;
  }
  return true;
}
