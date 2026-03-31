import { c as _c } from "react/compiler-runtime";
import React, { type ReactNode } from 'react';
import { ListItem } from '../design-system/ListItem.js';
export type SelectOptionProps = {
  

  readonly isFocused: boolean;

  

  readonly isSelected: boolean;

  

  readonly children: ReactNode;

  

  readonly description?: string;

  

  readonly shouldShowDownArrow?: boolean;

  

  readonly shouldShowUpArrow?: boolean;

  

  readonly declareCursor?: boolean;
};
export function SelectOption(t0) {
  const $ = _c(8);
  const {
    isFocused,
    isSelected,
    children,
    description,
    shouldShowDownArrow,
    shouldShowUpArrow,
    declareCursor
  } = t0;
  let t1;
  if ($[0] !== children || $[1] !== declareCursor || $[2] !== description || $[3] !== isFocused || $[4] !== isSelected || $[5] !== shouldShowDownArrow || $[6] !== shouldShowUpArrow) {
    t1 = <ListItem isFocused={isFocused} isSelected={isSelected} description={description} showScrollDown={shouldShowDownArrow} showScrollUp={shouldShowUpArrow} styled={false} declareCursor={declareCursor}>{children}</ListItem>;
    $[0] = children;
    $[1] = declareCursor;
    $[2] = description;
    $[3] = isFocused;
    $[4] = isSelected;
    $[5] = shouldShowDownArrow;
    $[6] = shouldShowUpArrow;
    $[7] = t1;
  } else {
    t1 = $[7];
  }
  return t1;
}
