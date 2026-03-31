import { c as _c } from "react/compiler-runtime";
import React from 'react';
export type Props = {
  

  readonly count?: number;
};

export default function Newline(t0) {
  const $ = _c(4);
  const {
    count: t1
  } = t0;
  const count = t1 === undefined ? 1 : t1;
  let t2;
  if ($[0] !== count) {
    t2 = "\n".repeat(count);
    $[0] = count;
    $[1] = t2;
  } else {
    t2 = $[1];
  }
  let t3;
  if ($[2] !== t2) {
    t3 = <ink-text>{t2}</ink-text>;
    $[2] = t2;
    $[3] = t3;
  } else {
    t3 = $[3];
  }
  return t3;
}
