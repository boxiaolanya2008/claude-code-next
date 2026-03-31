import { c as _c } from "react/compiler-runtime";
import { feature } from "../utils/bundle-mock.ts";
import React, { useContext, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { MailboxProvider } from '../context/mailbox.js';
import { useSettingsChange } from '../hooks/useSettingsChange.js';
import { logForDebugging } from '../utils/debug.js';
import { createDisabledBypassPermissionsContext, isBypassPermissionsModeDisabled } from '../utils/permissions/permissionSetup.js';
import { applySettingsChange } from '../utils/settings/applySettingsChange.js';
import type { SettingSource } from '../utils/settings/constants.js';
import { createStore } from './store.js';

const VoiceProvider: (props: {
  children: React.ReactNode;
}) => React.ReactNode = feature('VOICE_MODE') ? require('../context/voice.js').VoiceProvider : ({
  children
}) => children;

import { type AppState, type AppStateStore, getDefaultAppState } from './AppStateStore.js';

export { type AppState, type AppStateStore, type CompletionBoundary, getDefaultAppState, IDLE_SPECULATION_STATE, type SpeculationResult, type SpeculationState } from './AppStateStore.js';
export const AppStoreContext = React.createContext<AppStateStore | null>(null);
type Props = {
  children: React.ReactNode;
  initialState?: AppState;
  onChangeAppState?: (args: {
    newState: AppState;
    oldState: AppState;
  }) => void;
};
const HasAppStateContext = React.createContext<boolean>(false);
export function AppStateProvider(t0) {
  const $ = _c(13);
  const {
    children,
    initialState,
    onChangeAppState
  } = t0;
  const hasAppStateContext = useContext(HasAppStateContext);
  if (hasAppStateContext) {
    throw new Error("AppStateProvider can not be nested within another AppStateProvider");
  }
  let t1;
  if ($[0] !== initialState || $[1] !== onChangeAppState) {
    t1 = () => createStore(initialState ?? getDefaultAppState(), onChangeAppState);
    $[0] = initialState;
    $[1] = onChangeAppState;
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const [store] = useState(t1);
  let t2;
  if ($[3] !== store) {
    t2 = () => {
      const {
        toolPermissionContext
      } = store.getState();
      if (toolPermissionContext.isBypassPermissionsModeAvailable && isBypassPermissionsModeDisabled()) {
        logForDebugging("Disabling bypass permissions mode on mount (remote settings loaded before mount)");
        store.setState(_temp);
      }
    };
    $[3] = store;
    $[4] = t2;
  } else {
    t2 = $[4];
  }
  let t3;
  if ($[5] === Symbol.for("react.memo_cache_sentinel")) {
    t3 = [];
    $[5] = t3;
  } else {
    t3 = $[5];
  }
  useEffect(t2, t3);
  let t4;
  if ($[6] !== store.setState) {
    t4 = source => applySettingsChange(source, store.setState);
    $[6] = store.setState;
    $[7] = t4;
  } else {
    t4 = $[7];
  }
  const onSettingsChange = useEffectEvent(t4);
  useSettingsChange(onSettingsChange);
  let t5;
  if ($[8] !== children) {
    t5 = <MailboxProvider><VoiceProvider>{children}</VoiceProvider></MailboxProvider>;
    $[8] = children;
    $[9] = t5;
  } else {
    t5 = $[9];
  }
  let t6;
  if ($[10] !== store || $[11] !== t5) {
    t6 = <HasAppStateContext.Provider value={true}><AppStoreContext.Provider value={store}>{t5}</AppStoreContext.Provider></HasAppStateContext.Provider>;
    $[10] = store;
    $[11] = t5;
    $[12] = t6;
  } else {
    t6 = $[12];
  }
  return t6;
}
function _temp(prev) {
  return {
    ...prev,
    toolPermissionContext: createDisabledBypassPermissionsContext(prev.toolPermissionContext)
  };
}
function useAppStore(): AppStateStore {
  
  const store = useContext(AppStoreContext);
  if (!store) {
    throw new ReferenceError('useAppState/useSetAppState cannot be called outside of an <AppStateProvider />');
  }
  return store;
}

export function useAppState(selector) {
  const $ = _c(3);
  const store = useAppStore();
  let t0;
  if ($[0] !== selector || $[1] !== store) {
    t0 = () => {
      const state = store.getState();
      const selected = selector(state);
      if (false && state === selected) {
        throw new Error(`Your selector in \`useAppState(${selector.toString()})\` returned the original state, which is not allowed. You must instead return a property for optimised rendering.`);
      }
      return selected;
    };
    $[0] = selector;
    $[1] = store;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  const get = t0;
  return useSyncExternalStore(store.subscribe, get, get);
}

export function useSetAppState() {
  return useAppStore().setState;
}

export function useAppStateStore() {
  return useAppStore();
}
const NOOP_SUBSCRIBE = () => () => {};

export function useAppStateMaybeOutsideOfProvider(selector) {
  const $ = _c(3);
  const store = useContext(AppStoreContext);
  let t0;
  if ($[0] !== selector || $[1] !== store) {
    t0 = () => store ? selector(store.getState()) : undefined;
    $[0] = selector;
    $[1] = store;
    $[2] = t0;
  } else {
    t0 = $[2];
  }
  return useSyncExternalStore(store ? store.subscribe : NOOP_SUBSCRIBE, t0);
}
