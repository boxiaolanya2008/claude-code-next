import { performBackgroundPluginInstallations } from '../../services/plugins/PluginInstallationManager.js';
import type { AppState } from '../../state/AppState.js';
import { checkHasTrustDialogAccepted } from '../config.js';
import { logForDebugging } from '../debug.js';
import { clearMarketplacesCache, registerSeedMarketplaces } from './marketplaceManager.js';
import { clearPluginCache } from './pluginLoader.js';
type SetAppState = (f: (prevState: AppState) => AppState) => void;

export async function performStartupChecks(setAppState: SetAppState): Promise<void> {
  logForDebugging('performStartupChecks called');

  
  if (!checkHasTrustDialogAccepted()) {
    logForDebugging('Trust not accepted for current directory - skipping plugin installations');
    return;
  }
  try {
    logForDebugging('Starting background plugin installations');

    
    
    
    
    
    
    
    const seedChanged = await registerSeedMarketplaces();
    if (seedChanged) {
      clearMarketplacesCache();
      clearPluginCache('performStartupChecks: seed marketplaces changed');
      
      
      
      
      setAppState(prev => {
        if (prev.plugins.needsRefresh) return prev;
        return {
          ...prev,
          plugins: {
            ...prev.plugins,
            needsRefresh: true
          }
        };
      });
    }

    
    
    await performBackgroundPluginInstallations(setAppState);
  } catch (error) {
    
    logForDebugging(`Error initiating background plugin installations: ${error}`);
  }
}
