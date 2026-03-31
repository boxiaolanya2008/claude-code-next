import {
  LayoutAlign,
  LayoutDisplay,
  LayoutEdge,
  LayoutFlexDirection,
  LayoutGutter,
  LayoutJustify,
  type LayoutNode,
  LayoutOverflow,
  LayoutPositionType,
  LayoutWrap,
} from './layout/node.js'
import type { BorderStyle, BorderTextOptions } from './render-border.js'

export type RGBColor = `rgb(${number},${number},${number})`
export type HexColor = `#${string}`
export type Ansi256Color = `ansi256(${number})`
export type AnsiColor =
  | 'ansi:black'
  | 'ansi:red'
  | 'ansi:green'
  | 'ansi:yellow'
  | 'ansi:blue'
  | 'ansi:magenta'
  | 'ansi:cyan'
  | 'ansi:white'
  | 'ansi:blackBright'
  | 'ansi:redBright'
  | 'ansi:greenBright'
  | 'ansi:yellowBright'
  | 'ansi:blueBright'
  | 'ansi:magentaBright'
  | 'ansi:cyanBright'
  | 'ansi:whiteBright'

export type Color = RGBColor | HexColor | Ansi256Color | AnsiColor

export type TextStyles = {
  readonly color?: Color
  readonly backgroundColor?: Color
  readonly dim?: boolean
  readonly bold?: boolean
  readonly italic?: boolean
  readonly underline?: boolean
  readonly strikethrough?: boolean
  readonly inverse?: boolean
}

export type Styles = {
  readonly textWrap?:
    | 'wrap'
    | 'wrap-trim'
    | 'end'
    | 'middle'
    | 'truncate-end'
    | 'truncate'
    | 'truncate-middle'
    | 'truncate-start'

  readonly position?: 'absolute' | 'relative'
  readonly top?: number | `${number}%`
  readonly bottom?: number | `${number}%`
  readonly left?: number | `${number}%`
  readonly right?: number | `${number}%`

  

  readonly columnGap?: number

  

  readonly rowGap?: number

  

  readonly gap?: number

  

  readonly margin?: number

  

  readonly marginX?: number

  

  readonly marginY?: number

  

  readonly marginTop?: number

  

  readonly marginBottom?: number

  

  readonly marginLeft?: number

  

  readonly marginRight?: number

  

  readonly padding?: number

  

  readonly paddingX?: number

  

  readonly paddingY?: number

  

  readonly paddingTop?: number

  

  readonly paddingBottom?: number

  

  readonly paddingLeft?: number

  

  readonly paddingRight?: number

  

  readonly flexGrow?: number

  

  readonly flexShrink?: number

  

  readonly flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'

  

  readonly flexBasis?: number | string

  

  readonly flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'

  

  readonly alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch'

  

  readonly alignSelf?: 'flex-start' | 'center' | 'flex-end' | 'auto'

  

  readonly justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | 'center'

  

  readonly width?: number | string

  

  readonly height?: number | string

  

  readonly minWidth?: number | string

  

  readonly minHeight?: number | string

  

  readonly maxWidth?: number | string

  

  readonly maxHeight?: number | string

  

  readonly display?: 'flex' | 'none'

  

  readonly borderStyle?: BorderStyle

  

  readonly borderTop?: boolean

  

  readonly borderBottom?: boolean

  

  readonly borderLeft?: boolean

  

  readonly borderRight?: boolean

  

  readonly borderColor?: Color

  

  readonly borderTopColor?: Color

  

  readonly borderBottomColor?: Color

  

  readonly borderLeftColor?: Color

  

  readonly borderRightColor?: Color

  

  readonly borderDimColor?: boolean

  

  readonly borderTopDimColor?: boolean

  

  readonly borderBottomDimColor?: boolean

  

  readonly borderLeftDimColor?: boolean

  

  readonly borderRightDimColor?: boolean

  

  readonly borderText?: BorderTextOptions

  

  readonly backgroundColor?: Color

  

  readonly opaque?: boolean

  

  readonly overflow?: 'visible' | 'hidden' | 'scroll'

  

  readonly overflowX?: 'visible' | 'hidden' | 'scroll'

  

  readonly overflowY?: 'visible' | 'hidden' | 'scroll'

  

  readonly noSelect?: boolean | 'from-left-edge'
}

const applyPositionStyles = (node: LayoutNode, style: Styles): void => {
  if ('position' in style) {
    node.setPositionType(
      style.position === 'absolute'
        ? LayoutPositionType.Absolute
        : LayoutPositionType.Relative,
    )
  }
  if ('top' in style) applyPositionEdge(node, 'top', style.top)
  if ('bottom' in style) applyPositionEdge(node, 'bottom', style.bottom)
  if ('left' in style) applyPositionEdge(node, 'left', style.left)
  if ('right' in style) applyPositionEdge(node, 'right', style.right)
}

function applyPositionEdge(
  node: LayoutNode,
  edge: 'top' | 'bottom' | 'left' | 'right',
  v: number | `${number}%` | undefined,
): void {
  if (typeof v === 'string') {
    node.setPositionPercent(edge, Number.parseInt(v, 10))
  } else if (typeof v === 'number') {
    node.setPosition(edge, v)
  } else {
    node.setPosition(edge, Number.NaN)
  }
}

const applyOverflowStyles = (node: LayoutNode, style: Styles): void => {
  
  
  
  
  const y = style.overflowY ?? style.overflow
  const x = style.overflowX ?? style.overflow
  if (y === 'scroll' || x === 'scroll') {
    node.setOverflow(LayoutOverflow.Scroll)
  } else if (y === 'hidden' || x === 'hidden') {
    node.setOverflow(LayoutOverflow.Hidden)
  } else if (
    'overflow' in style ||
    'overflowX' in style ||
    'overflowY' in style
  ) {
    node.setOverflow(LayoutOverflow.Visible)
  }
}

const applyMarginStyles = (node: LayoutNode, style: Styles): void => {
  if ('margin' in style) {
    node.setMargin(LayoutEdge.All, style.margin ?? 0)
  }

  if ('marginX' in style) {
    node.setMargin(LayoutEdge.Horizontal, style.marginX ?? 0)
  }

  if ('marginY' in style) {
    node.setMargin(LayoutEdge.Vertical, style.marginY ?? 0)
  }

  if ('marginLeft' in style) {
    node.setMargin(LayoutEdge.Start, style.marginLeft || 0)
  }

  if ('marginRight' in style) {
    node.setMargin(LayoutEdge.End, style.marginRight || 0)
  }

  if ('marginTop' in style) {
    node.setMargin(LayoutEdge.Top, style.marginTop || 0)
  }

  if ('marginBottom' in style) {
    node.setMargin(LayoutEdge.Bottom, style.marginBottom || 0)
  }
}

const applyPaddingStyles = (node: LayoutNode, style: Styles): void => {
  if ('padding' in style) {
    node.setPadding(LayoutEdge.All, style.padding ?? 0)
  }

  if ('paddingX' in style) {
    node.setPadding(LayoutEdge.Horizontal, style.paddingX ?? 0)
  }

  if ('paddingY' in style) {
    node.setPadding(LayoutEdge.Vertical, style.paddingY ?? 0)
  }

  if ('paddingLeft' in style) {
    node.setPadding(LayoutEdge.Left, style.paddingLeft || 0)
  }

  if ('paddingRight' in style) {
    node.setPadding(LayoutEdge.Right, style.paddingRight || 0)
  }

  if ('paddingTop' in style) {
    node.setPadding(LayoutEdge.Top, style.paddingTop || 0)
  }

  if ('paddingBottom' in style) {
    node.setPadding(LayoutEdge.Bottom, style.paddingBottom || 0)
  }
}

const applyFlexStyles = (node: LayoutNode, style: Styles): void => {
  if ('flexGrow' in style) {
    node.setFlexGrow(style.flexGrow ?? 0)
  }

  if ('flexShrink' in style) {
    node.setFlexShrink(
      typeof style.flexShrink === 'number' ? style.flexShrink : 1,
    )
  }

  if ('flexWrap' in style) {
    if (style.flexWrap === 'nowrap') {
      node.setFlexWrap(LayoutWrap.NoWrap)
    }

    if (style.flexWrap === 'wrap') {
      node.setFlexWrap(LayoutWrap.Wrap)
    }

    if (style.flexWrap === 'wrap-reverse') {
      node.setFlexWrap(LayoutWrap.WrapReverse)
    }
  }

  if ('flexDirection' in style) {
    if (style.flexDirection === 'row') {
      node.setFlexDirection(LayoutFlexDirection.Row)
    }

    if (style.flexDirection === 'row-reverse') {
      node.setFlexDirection(LayoutFlexDirection.RowReverse)
    }

    if (style.flexDirection === 'column') {
      node.setFlexDirection(LayoutFlexDirection.Column)
    }

    if (style.flexDirection === 'column-reverse') {
      node.setFlexDirection(LayoutFlexDirection.ColumnReverse)
    }
  }

  if ('flexBasis' in style) {
    if (typeof style.flexBasis === 'number') {
      node.setFlexBasis(style.flexBasis)
    } else if (typeof style.flexBasis === 'string') {
      node.setFlexBasisPercent(Number.parseInt(style.flexBasis, 10))
    } else {
      node.setFlexBasis(Number.NaN)
    }
  }

  if ('alignItems' in style) {
    if (style.alignItems === 'stretch' || !style.alignItems) {
      node.setAlignItems(LayoutAlign.Stretch)
    }

    if (style.alignItems === 'flex-start') {
      node.setAlignItems(LayoutAlign.FlexStart)
    }

    if (style.alignItems === 'center') {
      node.setAlignItems(LayoutAlign.Center)
    }

    if (style.alignItems === 'flex-end') {
      node.setAlignItems(LayoutAlign.FlexEnd)
    }
  }

  if ('alignSelf' in style) {
    if (style.alignSelf === 'auto' || !style.alignSelf) {
      node.setAlignSelf(LayoutAlign.Auto)
    }

    if (style.alignSelf === 'flex-start') {
      node.setAlignSelf(LayoutAlign.FlexStart)
    }

    if (style.alignSelf === 'center') {
      node.setAlignSelf(LayoutAlign.Center)
    }

    if (style.alignSelf === 'flex-end') {
      node.setAlignSelf(LayoutAlign.FlexEnd)
    }
  }

  if ('justifyContent' in style) {
    if (style.justifyContent === 'flex-start' || !style.justifyContent) {
      node.setJustifyContent(LayoutJustify.FlexStart)
    }

    if (style.justifyContent === 'center') {
      node.setJustifyContent(LayoutJustify.Center)
    }

    if (style.justifyContent === 'flex-end') {
      node.setJustifyContent(LayoutJustify.FlexEnd)
    }

    if (style.justifyContent === 'space-between') {
      node.setJustifyContent(LayoutJustify.SpaceBetween)
    }

    if (style.justifyContent === 'space-around') {
      node.setJustifyContent(LayoutJustify.SpaceAround)
    }

    if (style.justifyContent === 'space-evenly') {
      node.setJustifyContent(LayoutJustify.SpaceEvenly)
    }
  }
}

const applyDimensionStyles = (node: LayoutNode, style: Styles): void => {
  if ('width' in style) {
    if (typeof style.width === 'number') {
      node.setWidth(style.width)
    } else if (typeof style.width === 'string') {
      node.setWidthPercent(Number.parseInt(style.width, 10))
    } else {
      node.setWidthAuto()
    }
  }

  if ('height' in style) {
    if (typeof style.height === 'number') {
      node.setHeight(style.height)
    } else if (typeof style.height === 'string') {
      node.setHeightPercent(Number.parseInt(style.height, 10))
    } else {
      node.setHeightAuto()
    }
  }

  if ('minWidth' in style) {
    if (typeof style.minWidth === 'string') {
      node.setMinWidthPercent(Number.parseInt(style.minWidth, 10))
    } else {
      node.setMinWidth(style.minWidth ?? 0)
    }
  }

  if ('minHeight' in style) {
    if (typeof style.minHeight === 'string') {
      node.setMinHeightPercent(Number.parseInt(style.minHeight, 10))
    } else {
      node.setMinHeight(style.minHeight ?? 0)
    }
  }

  if ('maxWidth' in style) {
    if (typeof style.maxWidth === 'string') {
      node.setMaxWidthPercent(Number.parseInt(style.maxWidth, 10))
    } else {
      node.setMaxWidth(style.maxWidth ?? 0)
    }
  }

  if ('maxHeight' in style) {
    if (typeof style.maxHeight === 'string') {
      node.setMaxHeightPercent(Number.parseInt(style.maxHeight, 10))
    } else {
      node.setMaxHeight(style.maxHeight ?? 0)
    }
  }
}

const applyDisplayStyles = (node: LayoutNode, style: Styles): void => {
  if ('display' in style) {
    node.setDisplay(
      style.display === 'flex' ? LayoutDisplay.Flex : LayoutDisplay.None,
    )
  }
}

const applyBorderStyles = (
  node: LayoutNode,
  style: Styles,
  resolvedStyle?: Styles,
): void => {
  
  
  
  
  const resolved = resolvedStyle ?? style

  if ('borderStyle' in style) {
    const borderWidth = style.borderStyle ? 1 : 0

    node.setBorder(
      LayoutEdge.Top,
      resolved.borderTop !== false ? borderWidth : 0,
    )
    node.setBorder(
      LayoutEdge.Bottom,
      resolved.borderBottom !== false ? borderWidth : 0,
    )
    node.setBorder(
      LayoutEdge.Left,
      resolved.borderLeft !== false ? borderWidth : 0,
    )
    node.setBorder(
      LayoutEdge.Right,
      resolved.borderRight !== false ? borderWidth : 0,
    )
  } else {
    
    
    
    if ('borderTop' in style && style.borderTop !== undefined) {
      node.setBorder(LayoutEdge.Top, style.borderTop === false ? 0 : 1)
    }
    if ('borderBottom' in style && style.borderBottom !== undefined) {
      node.setBorder(LayoutEdge.Bottom, style.borderBottom === false ? 0 : 1)
    }
    if ('borderLeft' in style && style.borderLeft !== undefined) {
      node.setBorder(LayoutEdge.Left, style.borderLeft === false ? 0 : 1)
    }
    if ('borderRight' in style && style.borderRight !== undefined) {
      node.setBorder(LayoutEdge.Right, style.borderRight === false ? 0 : 1)
    }
  }
}

const applyGapStyles = (node: LayoutNode, style: Styles): void => {
  if ('gap' in style) {
    node.setGap(LayoutGutter.All, style.gap ?? 0)
  }

  if ('columnGap' in style) {
    node.setGap(LayoutGutter.Column, style.columnGap ?? 0)
  }

  if ('rowGap' in style) {
    node.setGap(LayoutGutter.Row, style.rowGap ?? 0)
  }
}

const styles = (
  node: LayoutNode,
  style: Styles = {},
  resolvedStyle?: Styles,
): void => {
  applyPositionStyles(node, style)
  applyOverflowStyles(node, style)
  applyMarginStyles(node, style)
  applyPaddingStyles(node, style)
  applyFlexStyles(node, style)
  applyDimensionStyles(node, style)
  applyDisplayStyles(node, style)
  applyBorderStyles(node, style, resolvedStyle)
  applyGapStyles(node, style)
}

export default styles
