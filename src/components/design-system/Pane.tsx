import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { useIsInsideModal } from '../../context/modalContext.js';
import { Box } from '../../ink.js';
import type { Theme } from '../../utils/theme.js';
import { Divider } from './Divider.js';
type PaneProps = {
  children: React.ReactNode;
  

  color?: keyof Theme;
};

export function Pane(t0) {
  const $ = _c(9);
  const {
    children,
    color
  } = t0;
  if (useIsInsideModal()) {
    let t1;
    if ($[0] !== children) {
      t1 = <Box flexDirection="column" paddingX={1} flexShrink={0}>{children}</Box>;
      $[0] = children;
      $[1] = t1;
    } else {
      t1 = $[1];
    }
    return t1;
  }
  let t1;
  if ($[2] !== color) {
    t1 = <Divider color={color} />;
    $[2] = color;
    $[3] = t1;
  } else {
    t1 = $[3];
  }
  let t2;
  if ($[4] !== children) {
    t2 = <Box flexDirection="column" paddingX={2}>{children}</Box>;
    $[4] = children;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  let t3;
  if ($[6] !== t1 || $[7] !== t2) {
    t3 = <Box flexDirection="column" paddingTop={1}>{t1}{t2}</Box>;
    $[6] = t1;
    $[7] = t2;
    $[8] = t3;
  } else {
    t3 = $[8];
  }
  return t3;
}
