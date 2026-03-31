import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useContext } from 'react';

const ExpandShellOutputContext = React.createContext(false);
export function ExpandShellOutputProvider(t0) {
  const $ = _c(2);
  const {
    children
  } = t0;
  let t1;
  if ($[0] !== children) {
    t1 = <ExpandShellOutputContext.Provider value={true}>{children}</ExpandShellOutputContext.Provider>;
    $[0] = children;
    $[1] = t1;
  } else {
    t1 = $[1];
  }
  return t1;
}

export function useExpandShellOutput() {
  return useContext(ExpandShellOutputContext);
}
