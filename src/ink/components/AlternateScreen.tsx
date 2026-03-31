import { c as _c } from "react/compiler-runtime";
import React, { type PropsWithChildren, useContext, useInsertionEffect } from 'react';
import instances from '../instances.js';
import { DISABLE_MOUSE_TRACKING, ENABLE_MOUSE_TRACKING, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN } from '../termio/dec.js';
import { TerminalWriteContext } from '../useTerminalNotification.js';
import Box from './Box.js';
import { TerminalSizeContext } from './TerminalSizeContext.js';
type Props = PropsWithChildren<{
  
  mouseTracking?: boolean;
}>;

export function AlternateScreen(t0) {
  const $ = _c(7);
  const {
    children,
    mouseTracking: t1
  } = t0;
  const mouseTracking = t1 === undefined ? true : t1;
  const size = useContext(TerminalSizeContext);
  const writeRaw = useContext(TerminalWriteContext);
  let t2;
  let t3;
  if ($[0] !== mouseTracking || $[1] !== writeRaw) {
    t2 = () => {
      const ink = instances.get(process.stdout);
      if (!writeRaw) {
        return;
      }
      writeRaw(ENTER_ALT_SCREEN + "\x1B[2J\x1B[H" + (mouseTracking ? ENABLE_MOUSE_TRACKING : ""));
      ink?.setAltScreenActive(true, mouseTracking);
      return () => {
        ink?.setAltScreenActive(false);
        ink?.clearTextSelection();
        writeRaw((mouseTracking ? DISABLE_MOUSE_TRACKING : "") + EXIT_ALT_SCREEN);
      };
    };
    t3 = [writeRaw, mouseTracking];
    $[0] = mouseTracking;
    $[1] = writeRaw;
    $[2] = t2;
    $[3] = t3;
  } else {
    t2 = $[2];
    t3 = $[3];
  }
  useInsertionEffect(t2, t3);
  const t4 = size?.rows ?? 24;
  let t5;
  if ($[4] !== children || $[5] !== t4) {
    t5 = <Box flexDirection="column" height={t4} width="100%" flexShrink={0}>{children}</Box>;
    $[4] = children;
    $[5] = t4;
    $[6] = t5;
  } else {
    t5 = $[6];
  }
  return t5;
}
