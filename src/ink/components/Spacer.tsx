import { c as _c } from "react/compiler-runtime";
import React from 'react';
import Box from './Box.js';

export default function Spacer() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t0 = <Box flexGrow={1} />;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
