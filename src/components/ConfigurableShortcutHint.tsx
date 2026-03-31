import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import type { KeybindingAction, KeybindingContextName } from '../keybindings/types.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
type Props = {
  
  action: KeybindingAction;
  
  context: KeybindingContextName;
  
  fallback: string;
  
  description: string;
  
  parens?: boolean;
  
  bold?: boolean;
};

export function ConfigurableShortcutHint(t0) {
  const $ = _c(5);
  const {
    action,
    context,
    fallback,
    description,
    parens,
    bold
  } = t0;
  const shortcut = useShortcutDisplay(action, context, fallback);
  let t1;
  if ($[0] !== bold || $[1] !== description || $[2] !== parens || $[3] !== shortcut) {
    t1 = <KeyboardShortcutHint shortcut={shortcut} action={description} parens={parens} bold={bold} />;
    $[0] = bold;
    $[1] = description;
    $[2] = parens;
    $[3] = shortcut;
    $[4] = t1;
  } else {
    t1 = $[4];
  }
  return t1;
}
