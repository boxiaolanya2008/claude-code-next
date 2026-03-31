import { c as _c } from "react/compiler-runtime";
import React, { type PropsWithChildren } from 'react';
import Box, { type Props as BoxProps } from './Box.js';
type Props = Omit<BoxProps, 'noSelect'> & {
  

  fromLeftEdge?: boolean;
};

export function NoSelect(t0) {
  const $ = _c(8);
  let boxProps;
  let children;
  let fromLeftEdge;
  if ($[0] !== t0) {
    ({
      children,
      fromLeftEdge,
      ...boxProps
    } = t0);
    $[0] = t0;
    $[1] = boxProps;
    $[2] = children;
    $[3] = fromLeftEdge;
  } else {
    boxProps = $[1];
    children = $[2];
    fromLeftEdge = $[3];
  }
  const t1 = fromLeftEdge ? "from-left-edge" : true;
  let t2;
  if ($[4] !== boxProps || $[5] !== children || $[6] !== t1) {
    t2 = <Box {...boxProps} noSelect={t1}>{children}</Box>;
    $[4] = boxProps;
    $[5] = children;
    $[6] = t1;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  return t2;
}
