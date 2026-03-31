import { c as _c } from "react/compiler-runtime";
import { feature } from "../utils/bundle-mock.ts";
import * as React from 'react';
import { resetCostState } from '../../bootstrap/state.js';
import { clearTrustedDeviceToken, enrollTrustedDevice } from '../../bridge/trustedDevice.js';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js';
import { ConsoleOAuthFlow } from '../../components/ConsoleOAuthFlow.js';
import { Dialog } from '../../components/design-system/Dialog.js';
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js';
import { Text } from '../../ink.js';
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js';
import { refreshPolicyLimits } from '../../services/policyLimits/index.js';
import { refreshRemoteManagedSettings } from '../../services/remoteManagedSettings/index.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { stripSignatureBlocks } from '../../utils/messages.js';
import { checkAndDisableAutoModeIfNeeded, checkAndDisableBypassPermissionsIfNeeded, resetAutoModeGateCheck, resetBypassPermissionsCheck } from '../../utils/permissions/bypassPermissionsKillswitch.js';
import { resetUserCache } from '../../utils/user.js';
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <Login onDone={async success => {
    context.onChangeAPIKey();
    
    
    context.setMessages(stripSignatureBlocks);
    if (success) {
      
      
      resetCostState();
      
      void refreshRemoteManagedSettings();
      
      void refreshPolicyLimits();
      
      resetUserCache();
      
      refreshGrowthBookAfterAuthChange();
      
      
      
      clearTrustedDeviceToken();
      
      void enrollTrustedDevice();
      
      resetBypassPermissionsCheck();
      const appState = context.getAppState();
      void checkAndDisableBypassPermissionsIfNeeded(appState.toolPermissionContext, context.setAppState);
      if (feature('TRANSCRIPT_CLASSIFIER')) {
        resetAutoModeGateCheck();
        void checkAndDisableAutoModeIfNeeded(appState.toolPermissionContext, context.setAppState, appState.fastMode);
      }
      
      context.setAppState(prev => ({
        ...prev,
        authVersion: prev.authVersion + 1
      }));
    }
    onDone(success ? 'Login successful' : 'Login interrupted');
  }} />;
}
export function Login(props) {
  const $ = _c(12);
  const mainLoopModel = useMainLoopModel();
  let t0;
  if ($[0] !== mainLoopModel || $[1] !== props) {
    t0 = () => props.onDone(false, mainLoopModel);
    $[0] = mainLoopModel;
    $[1] = props;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  let t1;
  if ($[3] !== mainLoopModel || $[4] !== props) {
    t1 = () => props.onDone(true, mainLoopModel);
    $[3] = mainLoopModel;
    $[4] = props;
    $[5] = t1;
  } else {
    t1 = $[5];
  }
  let t2;
  if ($[6] !== props.startingMessage || $[7] !== t1) {
    t2 = <ConsoleOAuthFlow onDone={t1} startingMessage={props.startingMessage} />;
    $[6] = props.startingMessage;
    $[7] = t1;
    $[8] = t2;
  } else {
    t2 = $[8];
  }
  let t3;
  if ($[9] !== t0 || $[10] !== t2) {
    t3 = <Dialog title="Login" onCancel={t0} color="permission" inputGuide={_temp}>{t2}</Dialog>;
    $[9] = t0;
    $[10] = t2;
    $[11] = t3;
  } else {
    t3 = $[11];
  }
  return t3;
}
function _temp(exitState) {
  return exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />;
}
