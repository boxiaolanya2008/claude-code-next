import { c as _c } from "react/compiler-runtime";
import React from 'react';
import Text from '../../ink/components/Text.js';
type Props = {
  
  shortcut: string;
  
  action: string;
  
  parens?: boolean;
  
  bold?: boolean;
};

export function KeyboardShortcutHint(t0) {
  const $ = _c(9);
  const {
    shortcut,
    action,
    parens: t1,
    bold: t2
  } = t0;
  const parens = t1 === undefined ? false : t1;
  const bold = t2 === undefined ? false : t2;
  let t3;
  if ($[0] !== bold || $[1] !== shortcut) {
    t3 = bold ? <Text bold={true}>{shortcut}</Text> : shortcut;
    $[0] = bold;
    $[1] = shortcut;
    $[2] = t3;
  } else {
    t3 = $[2];
  }
  const shortcutText = t3;
  if (parens) {
    let t4;
    if ($[3] !== action || $[4] !== shortcutText) {
      t4 = <Text>({shortcutText} to {action})</Text>;
      $[3] = action;
      $[4] = shortcutText;
      $[5] = t4;
    } else {
      t4 = $[5];
    }
    return t4;
  }
  let t4;
  if ($[6] !== action || $[7] !== shortcutText) {
    t4 = <Text>{shortcutText} to {action}</Text>;
    $[6] = action;
    $[7] = shortcutText;
    $[8] = t4;
  } else {
    t4 = $[8];
  }
  return t4;
}
