import { c as _c } from "react/compiler-runtime";

import { useContext, useEffect, useLayoutEffect } from 'react';
import instances from '../ink/instances.js';
import { AppStoreContext, useAppState } from '../state/AppState.js';

const NON_MODAL_OVERLAYS = new Set(['autocomplete']);

export function useRegisterOverlay(id, t0) {
  const $ = _c(8);
  const enabled = t0 === undefined ? true : t0;
  const store = useContext(AppStoreContext);
  const setAppState = store?.setState;
  let t1;
  let t2;
  if ($[0] !== enabled || $[1] !== id || $[2] !== setAppState) {
    t1 = () => {
      if (!enabled || !setAppState) {
        return;
      }
      setAppState(prev => {
        if (prev.activeOverlays.has(id)) {
          return prev;
        }
        const next = new Set(prev.activeOverlays);
        next.add(id);
        return {
          ...prev,
          activeOverlays: next
        };
      });
      return () => {
        setAppState(prev_0 => {
          if (!prev_0.activeOverlays.has(id)) {
            return prev_0;
          }
          const next_0 = new Set(prev_0.activeOverlays);
          next_0.delete(id);
          return {
            ...prev_0,
            activeOverlays: next_0
          };
        });
      };
    };
    t2 = [id, enabled, setAppState];
    $[0] = enabled;
    $[1] = id;
    $[2] = setAppState;
    $[3] = t1;
    $[4] = t2;
  } else {
    t1 = $[3];
    t2 = $[4];
  }
  useEffect(t1, t2);
  let t3;
  let t4;
  if ($[5] !== enabled) {
    t3 = () => {
      if (!enabled) {
        return;
      }
      return _temp;
    };
    t4 = [enabled];
    $[5] = enabled;
    $[6] = t3;
    $[7] = t4;
  } else {
    t3 = $[6];
    t4 = $[7];
  }
  useLayoutEffect(t3, t4);
}

function _temp() {
  return instances.get(process.stdout)?.invalidatePrevFrame();
}
export function useIsOverlayActive() {
  return useAppState(_temp2);
}

function _temp2(s) {
  return s.activeOverlays.size > 0;
}
export function useIsModalOverlayActive() {
  return useAppState(_temp3);
}
function _temp3(s) {
  for (const id of s.activeOverlays) {
    if (!NON_MODAL_OVERLAYS.has(id)) {
      return true;
    }
  }
  return false;
}
