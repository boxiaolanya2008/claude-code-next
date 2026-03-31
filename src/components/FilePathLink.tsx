import { c as _c } from "react/compiler-runtime";
import React from 'react';
import { pathToFileURL } from 'url';
import Link from '../ink/components/Link.js';
type Props = {
  
  filePath: string;
  
  children?: React.ReactNode;
};

export function FilePathLink(t0) {
  const $ = _c(5);
  const {
    filePath,
    children
  } = t0;
  let t1;
  if ($[0] !== filePath) {
    t1 = pathToFileURL(filePath);
    $[0] = filePath;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  const t2 = children ?? filePath;
  let t3;
  if ($[2] !== t1.href || $[3] !== t2) {
    t3 = <Link url={t1.href}>{t2}</Link>;
    $[2] = t1.href;
    $[3] = t2;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
