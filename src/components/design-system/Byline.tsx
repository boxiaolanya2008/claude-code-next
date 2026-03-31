import { c as _c } from "react/compiler-runtime";
import React, { Children, isValidElement } from 'react';
import { Text } from '../../ink.js';
type Props = {
  
  children: React.ReactNode;
};

export function Byline(t0) {
  const $ = _c(5);
  const {
    children
  } = t0;
  let t1;
  let t2;
  if ($[0] !== children) {
    t2 = Symbol.for("react.early_return_sentinel");
    bb0: {
      const validChildren = Children.toArray(children);
      if (validChildren.length === 0) {
        t2 = null;
        break bb0;
      }
      t1 = validChildren.map(_temp);
    }
    $[0] = children;
    $[1] = t1;
    $[2] = t2;
  } else {
    t1 = $[1];
    t2 = $[2];
  }
  if (t2 !== Symbol.for("react.early_return_sentinel")) {
    return t2;
  }
  let t3;
  if ($[3] !== t1) {
    t3 = <>{t1}</>;
    $[3] = t1;
    $[4] = t3;
  } else {
    t3 = $[4];
  }
  return t3;
}
function _temp(child, index) {
  return <React.Fragment key={isValidElement(child) ? child.key ?? index : index}>{index > 0 && <Text dimColor={true}> · </Text>}{child}</React.Fragment>;
}
