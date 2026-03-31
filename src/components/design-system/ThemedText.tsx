import { c as _c } from "react/compiler-runtime";
import type { ReactNode } from 'react';
import React, { useContext } from 'react';
import Text from '../../ink/components/Text.js';
import type { Color, Styles } from '../../ink/styles.js';
import { getTheme, type Theme } from '../../utils/theme.js';
import { useTheme } from './ThemeProvider.js';

export const TextHoverColorContext = React.createContext<keyof Theme | undefined>(undefined);
export type Props = {
  

  readonly color?: keyof Theme | Color;

  

  readonly backgroundColor?: keyof Theme;

  

  readonly dimColor?: boolean;

  

  readonly bold?: boolean;

  

  readonly italic?: boolean;

  

  readonly underline?: boolean;

  

  readonly strikethrough?: boolean;

  

  readonly inverse?: boolean;

  

  readonly wrap?: Styles['textWrap'];
  readonly children?: ReactNode;
};

function resolveColor(color: keyof Theme | Color | undefined, theme: Theme): Color | undefined {
  if (!color) return undefined;
  
  if (color.startsWith('rgb(') || color.startsWith('#') || color.startsWith('ansi256(') || color.startsWith('ansi:')) {
    return color as Color;
  }
  
  return theme[color as keyof Theme] as Color;
}

export default function ThemedText(t0) {
  const $ = _c(10);
  const {
    color,
    backgroundColor,
    dimColor: t1,
    bold: t2,
    italic: t3,
    underline: t4,
    strikethrough: t5,
    inverse: t6,
    wrap: t7,
    children
  } = t0;
  const dimColor = t1 === undefined ? false : t1;
  const bold = t2 === undefined ? false : t2;
  const italic = t3 === undefined ? false : t3;
  const underline = t4 === undefined ? false : t4;
  const strikethrough = t5 === undefined ? false : t5;
  const inverse = t6 === undefined ? false : t6;
  const wrap = t7 === undefined ? "wrap" : t7;
  const [themeName] = useTheme();
  const theme = getTheme(themeName);
  const hoverColor = useContext(TextHoverColorContext);
  const resolvedColor = !color && hoverColor ? resolveColor(hoverColor, theme) : dimColor ? theme.inactive as Color : resolveColor(color, theme);
  const resolvedBackgroundColor = backgroundColor ? theme[backgroundColor] as Color : undefined;
  let t8;
  if ($[0] !== bold || $[1] !== children || $[2] !== inverse || $[3] !== italic || $[4] !== resolvedBackgroundColor || $[5] !== resolvedColor || $[6] !== strikethrough || $[7] !== underline || $[8] !== wrap) {
    t8 = <Text color={resolvedColor} backgroundColor={resolvedBackgroundColor} bold={bold} italic={italic} underline={underline} strikethrough={strikethrough} inverse={inverse} wrap={wrap}>{children}</Text>;
    $[0] = bold;
    $[1] = children;
    $[2] = inverse;
    $[3] = italic;
    $[4] = resolvedBackgroundColor;
    $[5] = resolvedColor;
    $[6] = strikethrough;
    $[7] = underline;
    $[8] = wrap;
    $[9] = t8;
  } else {
    t8 = $[9];
  }
  return t8;
}
