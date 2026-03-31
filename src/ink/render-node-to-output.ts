import indentString from 'indent-string'
import { applyTextStyles } from './colorize.js'
import type { DOMElement } from './dom.js'
import getMaxWidth from './get-max-width.js'
import type { Rectangle } from './layout/geometry.js'
import { LayoutDisplay, LayoutEdge, type LayoutNode } from './layout/node.js'
import { nodeCache, pendingClears } from './node-cache.js'
import type Output from './output.js'
import renderBorder from './render-border.js'
import type { Screen } from './screen.js'
import {
  type StyledSegment,
  squashTextNodesToSegments,
} from './squash-text-nodes.js'
import type { Color } from './styles.js'
import { isXtermJs } from './terminal.js'
import { widestLine } from './widest-line.js'
import wrapText from './wrap-text.js'

function isXtermJsHost(): boolean {
  return process.env.TERM_PROGRAM === 'vscode' || isXtermJs()
}

let layoutShifted = false

export function resetLayoutShifted(): void {
  layoutShifted = false
}

export function didLayoutShift(): boolean {
  return layoutShifted
}

export type ScrollHint = { top: number; bottom: number; delta: number }
let scrollHint: ScrollHint | null = null

let absoluteRectsPrev: Rectangle[] = []
let absoluteRectsCur: Rectangle[] = []

export function resetScrollHint(): void {
  scrollHint = null
  absoluteRectsPrev = absoluteRectsCur
  absoluteRectsCur = []
}

export function getScrollHint(): ScrollHint | null {
  return scrollHint
}

let scrollDrainNode: DOMElement | null = null

export function resetScrollDrainNode(): void {
  scrollDrainNode = null
}

export function getScrollDrainNode(): DOMElement | null {
  return scrollDrainNode
}

export type FollowScroll = {
  delta: number
  viewportTop: number
  viewportBottom: number
}
let followScroll: FollowScroll | null = null

export function consumeFollowScroll(): FollowScroll | null {
  const f = followScroll
  followScroll = null
  return f
}

const SCROLL_MIN_PER_FRAME = 4

const SCROLL_INSTANT_THRESHOLD = 5 
const SCROLL_HIGH_PENDING = 12 
const SCROLL_STEP_MED = 2 
const SCROLL_STEP_HIGH = 3 
const SCROLL_MAX_PENDING = 30 

function drainAdaptive(
  node: DOMElement,
  pending: number,
  innerHeight: number,
): number {
  const sign = pending > 0 ? 1 : -1
  let abs = Math.abs(pending)
  let applied = 0
  
  if (abs > SCROLL_MAX_PENDING) {
    applied += sign * (abs - SCROLL_MAX_PENDING)
    abs = SCROLL_MAX_PENDING
  }
  
  const step =
    abs <= SCROLL_INSTANT_THRESHOLD
      ? abs
      : abs < SCROLL_HIGH_PENDING
        ? SCROLL_STEP_MED
        : SCROLL_STEP_HIGH
  applied += sign * step
  const rem = abs - step
  
  
  const cap = Math.max(1, innerHeight - 1)
  const totalAbs = Math.abs(applied)
  if (totalAbs > cap) {
    const excess = totalAbs - cap
    node.pendingScrollDelta = sign * (rem + excess)
    return sign * cap
  }
  node.pendingScrollDelta = rem > 0 ? sign * rem : undefined
  return applied
}

function drainProportional(
  node: DOMElement,
  pending: number,
  innerHeight: number,
): number {
  const abs = Math.abs(pending)
  const cap = Math.max(1, innerHeight - 1)
  const step = Math.min(cap, Math.max(SCROLL_MIN_PER_FRAME, (abs * 3) >> 2))
  if (abs <= step) {
    node.pendingScrollDelta = undefined
    return pending
  }
  const applied = pending > 0 ? step : -step
  node.pendingScrollDelta = pending - applied
  return applied
}

const OSC = '\u001B]'
const BEL = '\u0007'

function wrapWithOsc8Link(text: string, url: string): string {
  return `${OSC}8;;${url}${BEL}${text}${OSC}8;;${BEL}`
}

function buildCharToSegmentMap(segments: StyledSegment[]): number[] {
  const map: number[] = []
  for (let i = 0; i < segments.length; i++) {
    const len = segments[i]!.text.length
    for (let j = 0; j < len; j++) {
      map.push(i)
    }
  }
  return map
}

function applyStylesToWrappedText(
  wrappedPlain: string,
  segments: StyledSegment[],
  charToSegment: number[],
  originalPlain: string,
  trimEnabled: boolean = false,
): string {
  const lines = wrappedPlain.split('\n')
  const resultLines: string[] = []

  let charIndex = 0
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!

    
    
    
    
    if (trimEnabled && line.length > 0) {
      const lineStartsWithWhitespace = /\s/.test(line[0]!)
      const originalHasWhitespace =
        charIndex < originalPlain.length && /\s/.test(originalPlain[charIndex]!)

      
      if (originalHasWhitespace && !lineStartsWithWhitespace) {
        while (
          charIndex < originalPlain.length &&
          /\s/.test(originalPlain[charIndex]!)
        ) {
          charIndex++
        }
      }
    }

    let styledLine = ''
    let runStart = 0
    let runSegmentIndex = charToSegment[charIndex] ?? 0

    for (let i = 0; i < line.length; i++) {
      const currentSegmentIndex = charToSegment[charIndex] ?? runSegmentIndex

      if (currentSegmentIndex !== runSegmentIndex) {
        
        const runText = line.slice(runStart, i)
        const segment = segments[runSegmentIndex]
        if (segment) {
          let styled = applyTextStyles(runText, segment.styles)
          if (segment.hyperlink) {
            styled = wrapWithOsc8Link(styled, segment.hyperlink)
          }
          styledLine += styled
        } else {
          styledLine += runText
        }
        runStart = i
        runSegmentIndex = currentSegmentIndex
      }

      charIndex++
    }

    
    const runText = line.slice(runStart)
    const segment = segments[runSegmentIndex]
    if (segment) {
      let styled = applyTextStyles(runText, segment.styles)
      if (segment.hyperlink) {
        styled = wrapWithOsc8Link(styled, segment.hyperlink)
      }
      styledLine += styled
    } else {
      styledLine += runText
    }

    resultLines.push(styledLine)

    
    
    
    
    
    if (charIndex < originalPlain.length && originalPlain[charIndex] === '\n') {
      charIndex++
    }

    
    
    
    
    
    if (trimEnabled && lineIdx < lines.length - 1) {
      const nextLine = lines[lineIdx + 1]!
      const nextLineFirstChar = nextLine.length > 0 ? nextLine[0] : null

      
      while (
        charIndex < originalPlain.length &&
        /\s/.test(originalPlain[charIndex]!)
      ) {
        
        if (
          nextLineFirstChar !== null &&
          originalPlain[charIndex] === nextLineFirstChar
        ) {
          break
        }
        charIndex++
      }
    }
  }

  return resultLines.join('\n')
}

function wrapWithSoftWrap(
  plainText: string,
  maxWidth: number,
  textWrap: Parameters<typeof wrapText>[2],
): { wrapped: string; softWrap: boolean[] | undefined } {
  if (textWrap !== 'wrap' && textWrap !== 'wrap-trim') {
    return {
      wrapped: wrapText(plainText, maxWidth, textWrap),
      softWrap: undefined,
    }
  }
  const origLines = plainText.split('\n')
  const outLines: string[] = []
  const softWrap: boolean[] = []
  for (const orig of origLines) {
    const pieces = wrapText(orig, maxWidth, textWrap).split('\n')
    for (let i = 0; i < pieces.length; i++) {
      outLines.push(pieces[i]!)
      softWrap.push(i > 0)
    }
  }
  return { wrapped: outLines.join('\n'), softWrap }
}

function applyPaddingToText(
  node: DOMElement,
  text: string,
  softWrap?: boolean[],
): string {
  const yogaNode = node.childNodes[0]?.yogaNode

  if (yogaNode) {
    const offsetX = yogaNode.getComputedLeft()
    const offsetY = yogaNode.getComputedTop()
    text = '\n'.repeat(offsetY) + indentString(text, offsetX)
    if (softWrap && offsetY > 0) {
      
      
      softWrap.unshift(...Array<boolean>(offsetY).fill(false))
    }
  }

  return text
}

function renderNodeToOutput(
  node: DOMElement,
  output: Output,
  {
    offsetX = 0,
    offsetY = 0,
    prevScreen,
    skipSelfBlit = false,
    inheritedBackgroundColor,
  }: {
    offsetX?: number
    offsetY?: number
    prevScreen: Screen | undefined
    
    
    
    
    
    skipSelfBlit?: boolean
    inheritedBackgroundColor?: Color
  },
): void {
  const { yogaNode } = node

  if (yogaNode) {
    if (yogaNode.getDisplay() === LayoutDisplay.None) {
      
      if (node.dirty) {
        const cached = nodeCache.get(node)
        if (cached) {
          output.clear({
            x: Math.floor(cached.x),
            y: Math.floor(cached.y),
            width: Math.floor(cached.width),
            height: Math.floor(cached.height),
          })
          
          
          
          
          
          dropSubtreeCache(node)
          layoutShifted = true
        }
      }
      return
    }

    
    const x = offsetX + yogaNode.getComputedLeft()
    const yogaTop = yogaNode.getComputedTop()
    let y = offsetY + yogaTop
    const width = yogaNode.getComputedWidth()
    const height = yogaNode.getComputedHeight()

    
    
    
    
    
    
    if (y < 0 && node.style.position === 'absolute') {
      y = 0
    }

    
    
    const cached = nodeCache.get(node)
    if (
      !node.dirty &&
      !skipSelfBlit &&
      node.pendingScrollDelta === undefined &&
      cached &&
      cached.x === x &&
      cached.y === y &&
      cached.width === width &&
      cached.height === height &&
      prevScreen
    ) {
      const fx = Math.floor(x)
      const fy = Math.floor(y)
      const fw = Math.floor(width)
      const fh = Math.floor(height)
      output.blit(prevScreen, fx, fy, fw, fh)
      if (node.style.position === 'absolute') {
        absoluteRectsCur.push(cached)
      }
      
      
      
      
      
      
      blitEscapingAbsoluteDescendants(node, output, prevScreen, fx, fy, fw, fh)
      return
    }

    
    
    
    const positionChanged =
      cached !== undefined &&
      (cached.x !== x ||
        cached.y !== y ||
        cached.width !== width ||
        cached.height !== height)
    if (positionChanged) {
      layoutShifted = true
    }
    if (cached && (node.dirty || positionChanged)) {
      output.clear(
        {
          x: Math.floor(cached.x),
          y: Math.floor(cached.y),
          width: Math.floor(cached.width),
          height: Math.floor(cached.height),
        },
        node.style.position === 'absolute',
      )
    }

    
    
    const clears = pendingClears.get(node)
    const hasRemovedChild = clears !== undefined
    if (hasRemovedChild) {
      layoutShifted = true
      for (const rect of clears) {
        output.clear({
          x: Math.floor(rect.x),
          y: Math.floor(rect.y),
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        })
      }
      pendingClears.delete(node)
    }

    
    
    
    
    
    
    
    
    
    
    if (height === 0 && siblingSharesY(node, yogaNode)) {
      nodeCache.set(node, { x, y, width, height, top: yogaTop })
      node.dirty = false
      return
    }

    if (node.nodeName === 'ink-raw-ansi') {
      
      
      
      const text = node.attributes['rawText'] as string
      if (text) {
        output.write(x, y, text)
      }
    } else if (node.nodeName === 'ink-text') {
      const segments = squashTextNodesToSegments(
        node,
        inheritedBackgroundColor
          ? { backgroundColor: inheritedBackgroundColor }
          : undefined,
      )

      
      const plainText = segments.map(s => s.text).join('')

      if (plainText.length > 0) {
        
        
        
        
        
        
        
        const maxWidth = Math.min(getMaxWidth(yogaNode), output.width - x)
        const textWrap = node.style.textWrap ?? 'wrap'

        
        const needsWrapping = widestLine(plainText) > maxWidth

        let text: string
        let softWrap: boolean[] | undefined
        if (needsWrapping && segments.length === 1) {
          
          const segment = segments[0]!
          const w = wrapWithSoftWrap(plainText, maxWidth, textWrap)
          softWrap = w.softWrap
          text = w.wrapped
            .split('\n')
            .map(line => {
              let styled = applyTextStyles(line, segment.styles)
              
              
              
              
              if (segment.hyperlink) {
                styled = wrapWithOsc8Link(styled, segment.hyperlink)
              }
              return styled
            })
            .join('\n')
        } else if (needsWrapping) {
          
          
          
          const w = wrapWithSoftWrap(plainText, maxWidth, textWrap)
          softWrap = w.softWrap
          const charToSegment = buildCharToSegmentMap(segments)
          text = applyStylesToWrappedText(
            w.wrapped,
            segments,
            charToSegment,
            plainText,
            textWrap === 'wrap-trim',
          )
          
          
        } else {
          
          text = segments
            .map(segment => {
              let styledText = applyTextStyles(segment.text, segment.styles)
              if (segment.hyperlink) {
                styledText = wrapWithOsc8Link(styledText, segment.hyperlink)
              }
              return styledText
            })
            .join('')
        }

        text = applyPaddingToText(node, text, softWrap)

        output.write(x, y, text, softWrap)
      }
    } else if (node.nodeName === 'ink-box') {
      const boxBackgroundColor =
        node.style.backgroundColor ?? inheritedBackgroundColor

      
      
      
      
      
      
      
      
      
      
      
      
      if (node.style.noSelect) {
        const boxX = Math.floor(x)
        const fromEdge = node.style.noSelect === 'from-left-edge'
        output.noSelect({
          x: fromEdge ? 0 : boxX,
          y: Math.floor(y),
          width: fromEdge ? boxX + Math.floor(width) : Math.floor(width),
          height: Math.floor(height),
        })
      }

      const overflowX = node.style.overflowX ?? node.style.overflow
      const overflowY = node.style.overflowY ?? node.style.overflow
      const clipHorizontally = overflowX === 'hidden' || overflowX === 'scroll'
      const clipVertically = overflowY === 'hidden' || overflowY === 'scroll'
      const isScrollY = overflowY === 'scroll'

      const needsClip = clipHorizontally || clipVertically
      let y1: number | undefined
      let y2: number | undefined
      if (needsClip) {
        const x1 = clipHorizontally
          ? x + yogaNode.getComputedBorder(LayoutEdge.Left)
          : undefined

        const x2 = clipHorizontally
          ? x +
            yogaNode.getComputedWidth() -
            yogaNode.getComputedBorder(LayoutEdge.Right)
          : undefined

        y1 = clipVertically
          ? y + yogaNode.getComputedBorder(LayoutEdge.Top)
          : undefined

        y2 = clipVertically
          ? y +
            yogaNode.getComputedHeight() -
            yogaNode.getComputedBorder(LayoutEdge.Bottom)
          : undefined

        output.clip({ x1, x2, y1, y2 })
      }

      if (isScrollY) {
        
        
        
        
        
        
        const padTop = yogaNode.getComputedPadding(LayoutEdge.Top)
        const innerHeight = Math.max(
          0,
          (y2 ?? y + height) -
            (y1 ?? y) -
            padTop -
            yogaNode.getComputedPadding(LayoutEdge.Bottom),
        )

        const content = node.childNodes.find(c => (c as DOMElement).yogaNode) as
          | DOMElement
          | undefined
        const contentYoga = content?.yogaNode
        
        
        
        
        
        const scrollHeight = contentYoga?.getComputedHeight() ?? 0
        
        
        const prevScrollHeight = node.scrollHeight ?? scrollHeight
        const prevInnerHeight = node.scrollViewportHeight ?? innerHeight
        node.scrollHeight = scrollHeight
        node.scrollViewportHeight = innerHeight
        
        
        
        node.scrollViewportTop = (y1 ?? y) + padTop

        const maxScroll = Math.max(0, scrollHeight - innerHeight)
        
        
        
        
        
        
        
        
        
        
        
        if (node.scrollAnchor) {
          const anchorTop = node.scrollAnchor.el.yogaNode?.getComputedTop()
          if (anchorTop != null) {
            node.scrollTop = anchorTop + node.scrollAnchor.offset
            node.pendingScrollDelta = undefined
          }
          node.scrollAnchor = undefined
        }
        
        
        
        
        
        
        
        
        
        
        
        const scrollTopBeforeFollow = node.scrollTop ?? 0
        const sticky =
          node.stickyScroll ?? Boolean(node.attributes['stickyScroll'])
        const prevMaxScroll = Math.max(0, prevScrollHeight - prevInnerHeight)
        
        
        
        
        const grew = scrollHeight >= prevScrollHeight
        const atBottom =
          sticky || (grew && scrollTopBeforeFollow >= prevMaxScroll)
        if (atBottom && (node.pendingScrollDelta ?? 0) >= 0) {
          node.scrollTop = maxScroll
          node.pendingScrollDelta = undefined
          
          
          
          
          
          
          
          
          
          
          if (
            node.stickyScroll === false &&
            scrollTopBeforeFollow >= prevMaxScroll
          ) {
            node.stickyScroll = true
          }
        }
        const followDelta = (node.scrollTop ?? 0) - scrollTopBeforeFollow
        if (followDelta > 0) {
          const vpTop = node.scrollViewportTop ?? 0
          followScroll = {
            delta: followDelta,
            viewportTop: vpTop,
            viewportBottom: vpTop + innerHeight - 1,
          }
        }
        
        
        
        
        
        
        
        let cur = node.scrollTop ?? 0
        const pending = node.pendingScrollDelta
        const cMin = node.scrollClampMin
        const cMax = node.scrollClampMax
        const haveClamp = cMin !== undefined && cMax !== undefined
        if (pending !== undefined && pending !== 0) {
          
          
          
          
          
          
          
          
          
          
          
          
          const pastClamp =
            haveClamp &&
            ((pending < 0 && cur < cMin) || (pending > 0 && cur > cMax))
          const eff = pastClamp ? Math.min(4, innerHeight >> 3) : innerHeight
          cur += isXtermJsHost()
            ? drainAdaptive(node, pending, eff)
            : drainProportional(node, pending, eff)
        } else if (pending === 0) {
          
          
          node.pendingScrollDelta = undefined
        }
        let scrollTop = Math.max(0, Math.min(cur, maxScroll))
        
        
        
        
        
        
        
        
        const clamped = haveClamp
          ? Math.max(cMin, Math.min(scrollTop, cMax))
          : scrollTop
        node.scrollTop = scrollTop
        
        
        if (scrollTop !== cur) node.pendingScrollDelta = undefined
        if (node.pendingScrollDelta !== undefined) scrollDrainNode = node
        scrollTop = clamped

        if (content && contentYoga) {
          
          
          const contentX = x + contentYoga.getComputedLeft()
          const contentY = y + contentYoga.getComputedTop() - scrollTop
          
          
          
          
          
          
          const contentCached = nodeCache.get(content)
          let hint: ScrollHint | null = null
          if (contentCached && contentCached.y !== contentY) {
            
            
            
            
            const delta = contentCached.y - contentY
            const regionTop = Math.floor(y + contentYoga.getComputedTop())
            const regionBottom = regionTop + innerHeight - 1
            if (
              cached?.y === y &&
              cached.height === height &&
              innerHeight > 0 &&
              Math.abs(delta) < innerHeight
            ) {
              hint = { top: regionTop, bottom: regionBottom, delta }
              scrollHint = hint
            } else {
              layoutShifted = true
            }
          }
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          const scrollHeight = contentYoga.getComputedHeight()
          const prevHeight = contentCached?.height ?? scrollHeight
          const heightDelta = scrollHeight - prevHeight
          const safeForFastPath =
            !hint ||
            heightDelta === 0 ||
            (hint.delta > 0 && heightDelta === hint.delta)
          
          
          
          
          if (!safeForFastPath) scrollHint = null
          if (hint && prevScreen && safeForFastPath) {
            const { top, bottom, delta } = hint
            const w = Math.floor(width)
            output.blit(prevScreen, Math.floor(x), top, w, bottom - top + 1)
            output.shift(top, bottom, delta)
            
            const edgeTop = delta > 0 ? bottom - delta + 1 : top
            const edgeBottom = delta > 0 ? bottom : top - delta - 1
            output.clear({
              x: Math.floor(x),
              y: edgeTop,
              width: w,
              height: edgeBottom - edgeTop + 1,
            })
            output.clip({
              x1: undefined,
              x2: undefined,
              y1: edgeTop,
              y2: edgeBottom + 1,
            })
            
            
            
            const dirtyChildren = content.dirty
              ? new Set(content.childNodes.filter(c => (c as DOMElement).dirty))
              : null
            renderScrolledChildren(
              content,
              output,
              contentX,
              contentY,
              hasRemovedChild,
              undefined,
              
              edgeTop - contentY,
              edgeBottom + 1 - contentY,
              boxBackgroundColor,
              true,
            )
            output.unclip()

            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            
            if (dirtyChildren) {
              const edgeTopLocal = edgeTop - contentY
              const edgeBottomLocal = edgeBottom + 1 - contentY
              const spaces = ' '.repeat(w)
              
              
              
              
              
              
              
              
              
              
              
              
              let cumHeightShift = 0
              for (const childNode of content.childNodes) {
                const childElem = childNode as DOMElement
                const isDirty = dirtyChildren.has(childNode)
                if (!isDirty && cumHeightShift === 0) {
                  if (nodeCache.has(childElem)) continue
                  
                  
                  
                }
                const cy = childElem.yogaNode
                if (!cy) continue
                const childTop = cy.getComputedTop()
                const childH = cy.getComputedHeight()
                const childBottom = childTop + childH
                if (isDirty) {
                  const prev = nodeCache.get(childElem)
                  cumHeightShift += childH - (prev ? prev.height : 0)
                }
                
                if (
                  childBottom <= scrollTop ||
                  childTop >= scrollTop + innerHeight
                )
                  continue
                
                if (childTop >= edgeTopLocal && childBottom <= edgeBottomLocal)
                  continue
                const screenY = Math.floor(contentY + childTop)
                
                
                
                
                
                
                if (!isDirty) {
                  const childCached = nodeCache.get(childElem)
                  if (
                    childCached &&
                    Math.floor(childCached.y) - delta === screenY
                  ) {
                    continue
                  }
                }
                
                
                
                const screenBottom = Math.min(
                  Math.floor(contentY + childBottom),
                  Math.floor((y1 ?? y) + padTop + innerHeight),
                )
                if (screenY < screenBottom) {
                  const fill = Array(screenBottom - screenY)
                    .fill(spaces)
                    .join('\n')
                  output.write(Math.floor(x), screenY, fill)
                  output.clip({
                    x1: undefined,
                    x2: undefined,
                    y1: screenY,
                    y2: screenBottom,
                  })
                  renderNodeToOutput(childElem, output, {
                    offsetX: contentX,
                    offsetY: contentY,
                    prevScreen: undefined,
                    inheritedBackgroundColor: boxBackgroundColor,
                  })
                  output.unclip()
                }
              }
            }

            
            
            
            
            
            
            
            const spaces = absoluteRectsPrev.length ? ' '.repeat(w) : ''
            for (const r of absoluteRectsPrev) {
              if (r.y >= bottom + 1 || r.y + r.height <= top) continue
              const shiftedTop = Math.max(top, Math.floor(r.y) - delta)
              const shiftedBottom = Math.min(
                bottom + 1,
                Math.floor(r.y + r.height) - delta,
              )
              
              if (shiftedTop >= edgeTop && shiftedBottom <= edgeBottom + 1)
                continue
              if (shiftedTop >= shiftedBottom) continue
              const fill = Array(shiftedBottom - shiftedTop)
                .fill(spaces)
                .join('\n')
              output.write(Math.floor(x), shiftedTop, fill)
              output.clip({
                x1: undefined,
                x2: undefined,
                y1: shiftedTop,
                y2: shiftedBottom,
              })
              renderScrolledChildren(
                content,
                output,
                contentX,
                contentY,
                hasRemovedChild,
                undefined,
                shiftedTop - contentY,
                shiftedBottom - contentY,
                boxBackgroundColor,
                true,
              )
              output.unclip()
            }
          } else {
            
            
            
            
            
            
            
            
            
            
            
            
            
            const scrolled = contentCached && contentCached.y !== contentY
            if (scrolled && y1 !== undefined && y2 !== undefined) {
              output.clear({
                x: Math.floor(x),
                y: Math.floor(y1),
                width: Math.floor(width),
                height: Math.floor(y2 - y1),
              })
            }
            
            
            
            
            
            
            renderScrolledChildren(
              content,
              output,
              contentX,
              contentY,
              hasRemovedChild,
              scrolled || positionChanged ? undefined : prevScreen,
              scrollTop,
              scrollTop + innerHeight,
              boxBackgroundColor,
            )
          }
          nodeCache.set(content, {
            x: contentX,
            y: contentY,
            width: contentYoga.getComputedWidth(),
            height: contentYoga.getComputedHeight(),
          })
          content.dirty = false
        }
      } else {
        
        
        
        
        
        
        
        const ownBackgroundColor = node.style.backgroundColor
        if (ownBackgroundColor || node.style.opaque) {
          const borderLeft = yogaNode.getComputedBorder(LayoutEdge.Left)
          const borderRight = yogaNode.getComputedBorder(LayoutEdge.Right)
          const borderTop = yogaNode.getComputedBorder(LayoutEdge.Top)
          const borderBottom = yogaNode.getComputedBorder(LayoutEdge.Bottom)
          const innerWidth = Math.floor(width) - borderLeft - borderRight
          const innerHeight = Math.floor(height) - borderTop - borderBottom
          if (innerWidth > 0 && innerHeight > 0) {
            const spaces = ' '.repeat(innerWidth)
            const fillLine = ownBackgroundColor
              ? applyTextStyles(spaces, { backgroundColor: ownBackgroundColor })
              : spaces
            const fill = Array(innerHeight).fill(fillLine).join('\n')
            output.write(x + borderLeft, y + borderTop, fill)
          }
        }

        renderChildren(
          node,
          output,
          x,
          y,
          hasRemovedChild,
          
          
          
          
          
          
          
          ownBackgroundColor || node.style.opaque ? undefined : prevScreen,
          boxBackgroundColor,
        )
      }

      if (needsClip) {
        output.unclip()
      }

      
      
      
      renderBorder(x, y, node, output)
    } else if (node.nodeName === 'ink-root') {
      renderChildren(
        node,
        output,
        x,
        y,
        hasRemovedChild,
        prevScreen,
        inheritedBackgroundColor,
      )
    }

    
    const rect = { x, y, width, height, top: yogaTop }
    nodeCache.set(node, rect)
    if (node.style.position === 'absolute') {
      absoluteRectsCur.push(rect)
    }
    node.dirty = false
  }
}

function renderChildren(
  node: DOMElement,
  output: Output,
  offsetX: number,
  offsetY: number,
  hasRemovedChild: boolean,
  prevScreen: Screen | undefined,
  inheritedBackgroundColor: Color | undefined,
): void {
  let seenDirtyChild = false
  let seenDirtyClipped = false
  for (const childNode of node.childNodes) {
    const childElem = childNode as DOMElement
    
    const wasDirty = childElem.dirty
    const isAbsolute = childElem.style.position === 'absolute'
    renderNodeToOutput(childElem, output, {
      offsetX,
      offsetY,
      prevScreen: hasRemovedChild || seenDirtyChild ? undefined : prevScreen,
      
      
      skipSelfBlit:
        seenDirtyClipped &&
        isAbsolute &&
        !childElem.style.opaque &&
        childElem.style.backgroundColor === undefined,
      inheritedBackgroundColor,
    })
    if (wasDirty && !seenDirtyChild) {
      if (!clipsBothAxes(childElem) || isAbsolute) {
        seenDirtyChild = true
      } else {
        seenDirtyClipped = true
      }
    }
  }
}

function clipsBothAxes(node: DOMElement): boolean {
  const ox = node.style.overflowX ?? node.style.overflow
  const oy = node.style.overflowY ?? node.style.overflow
  return (
    (ox === 'hidden' || ox === 'scroll') && (oy === 'hidden' || oy === 'scroll')
  )
}

function siblingSharesY(node: DOMElement, yogaNode: LayoutNode): boolean {
  const parent = node.parentNode
  if (!parent) return false
  const myTop = yogaNode.getComputedTop()
  const siblings = parent.childNodes
  const idx = siblings.indexOf(node)
  for (let i = idx + 1; i < siblings.length; i++) {
    const sib = (siblings[i] as DOMElement).yogaNode
    if (!sib) continue
    return sib.getComputedTop() === myTop
  }
  
  
  for (let i = idx - 1; i >= 0; i--) {
    const sib = (siblings[i] as DOMElement).yogaNode
    if (!sib) continue
    return sib.getComputedTop() === myTop
  }
  return false
}

function blitEscapingAbsoluteDescendants(
  node: DOMElement,
  output: Output,
  prevScreen: Screen,
  px: number,
  py: number,
  pw: number,
  ph: number,
): void {
  const pr = px + pw
  const pb = py + ph
  for (const child of node.childNodes) {
    if (child.nodeName === '#text') continue
    const elem = child as DOMElement
    if (elem.style.position === 'absolute') {
      const cached = nodeCache.get(elem)
      if (cached) {
        absoluteRectsCur.push(cached)
        const cx = Math.floor(cached.x)
        const cy = Math.floor(cached.y)
        const cw = Math.floor(cached.width)
        const ch = Math.floor(cached.height)
        
        
        if (cx < px || cy < py || cx + cw > pr || cy + ch > pb) {
          output.blit(prevScreen, cx, cy, cw, ch)
        }
      }
    }
    
    blitEscapingAbsoluteDescendants(elem, output, prevScreen, px, py, pw, ph)
  }
}

function renderScrolledChildren(
  node: DOMElement,
  output: Output,
  offsetX: number,
  offsetY: number,
  hasRemovedChild: boolean,
  prevScreen: Screen | undefined,
  scrollTopY: number,
  scrollBottomY: number,
  inheritedBackgroundColor: Color | undefined,
  
  
  
  preserveCulledCache = false,
): void {
  let seenDirtyChild = false
  
  
  
  
  
  
  
  let cumHeightShift = 0
  for (const childNode of node.childNodes) {
    const childElem = childNode as DOMElement
    const cy = childElem.yogaNode
    if (cy) {
      const cached = nodeCache.get(childElem)
      let top: number
      let height: number
      if (
        cached?.top !== undefined &&
        !childElem.dirty &&
        cumHeightShift === 0
      ) {
        top = cached.top
        height = cached.height
      } else {
        top = cy.getComputedTop()
        height = cy.getComputedHeight()
        if (childElem.dirty) {
          cumHeightShift += height - (cached ? cached.height : 0)
        }
        
        
        
        
        if (cached) cached.top = top
      }
      const bottom = top + height
      if (bottom <= scrollTopY || top >= scrollBottomY) {
        
        
        
        
        if (!preserveCulledCache) dropSubtreeCache(childElem)
        continue
      }
    }
    const wasDirty = childElem.dirty
    renderNodeToOutput(childElem, output, {
      offsetX,
      offsetY,
      prevScreen: hasRemovedChild || seenDirtyChild ? undefined : prevScreen,
      inheritedBackgroundColor,
    })
    if (wasDirty) {
      seenDirtyChild = true
    }
  }
}

function dropSubtreeCache(node: DOMElement): void {
  nodeCache.delete(node)
  for (const child of node.childNodes) {
    if (child.nodeName !== '#text') {
      dropSubtreeCache(child as DOMElement)
    }
  }
}

export { buildCharToSegmentMap, applyStylesToWrappedText }

export default renderNodeToOutput
