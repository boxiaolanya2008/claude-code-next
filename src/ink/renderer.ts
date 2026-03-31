import { logForDebugging } from 'src/utils/debug.js'
import { type DOMElement, markDirty } from './dom.js'
import type { Frame } from './frame.js'
import { consumeAbsoluteRemovedFlag } from './node-cache.js'
import Output from './output.js'
import renderNodeToOutput, {
  getScrollDrainNode,
  getScrollHint,
  resetLayoutShifted,
  resetScrollDrainNode,
  resetScrollHint,
} from './render-node-to-output.js'
import { createScreen, type StylePool } from './screen.js'

export type RenderOptions = {
  frontFrame: Frame
  backFrame: Frame
  isTTY: boolean
  terminalWidth: number
  terminalRows: number
  altScreen: boolean
  
  
  
  
  prevFrameContaminated: boolean
}

export type Renderer = (options: RenderOptions) => Frame

export default function createRenderer(
  node: DOMElement,
  stylePool: StylePool,
): Renderer {
  
  
  let output: Output | undefined
  return options => {
    const { frontFrame, backFrame, isTTY, terminalWidth, terminalRows } =
      options
    const prevScreen = frontFrame.screen
    const backScreen = backFrame.screen
    
    
    const charPool = backScreen.charPool
    const hyperlinkPool = backScreen.hyperlinkPool

    
    
    
    
    const computedHeight = node.yogaNode?.getComputedHeight()
    const computedWidth = node.yogaNode?.getComputedWidth()
    const hasInvalidHeight =
      computedHeight === undefined ||
      !Number.isFinite(computedHeight) ||
      computedHeight < 0
    const hasInvalidWidth =
      computedWidth === undefined ||
      !Number.isFinite(computedWidth) ||
      computedWidth < 0

    if (!node.yogaNode || hasInvalidHeight || hasInvalidWidth) {
      
      if (node.yogaNode && (hasInvalidHeight || hasInvalidWidth)) {
        logForDebugging(
          `Invalid yoga dimensions: width=${computedWidth}, height=${computedHeight}, ` +
            `childNodes=${node.childNodes.length}, terminalWidth=${terminalWidth}, terminalRows=${terminalRows}`,
        )
      }
      return {
        screen: createScreen(
          terminalWidth,
          0,
          stylePool,
          charPool,
          hyperlinkPool,
        ),
        viewport: { width: terminalWidth, height: terminalRows },
        cursor: { x: 0, y: 0, visible: true },
      }
    }

    const width = Math.floor(node.yogaNode.getComputedWidth())
    const yogaHeight = Math.floor(node.yogaNode.getComputedHeight())
    
    
    
    
    
    
    
    
    
    
    
    const height = options.altScreen ? terminalRows : yogaHeight
    if (options.altScreen && yogaHeight > terminalRows) {
      logForDebugging(
        `alt-screen: yoga height ${yogaHeight} > terminalRows ${terminalRows} — ` +
          `something is rendering outside <AlternateScreen>. Overflow clipped.`,
        { level: 'warn' },
      )
    }
    const screen =
      backScreen ??
      createScreen(width, height, stylePool, charPool, hyperlinkPool)
    if (output) {
      output.reset(width, height, screen)
    } else {
      output = new Output({ width, height, stylePool, screen })
    }

    resetLayoutShifted()
    resetScrollHint()
    resetScrollDrainNode()

    
    
    
    
    
    
    
    
    
    
    
    const absoluteRemoved = consumeAbsoluteRemovedFlag()
    renderNodeToOutput(node, output, {
      prevScreen:
        absoluteRemoved || options.prevFrameContaminated
          ? undefined
          : prevScreen,
    })

    const renderedScreen = output.get()

    
    
    
    
    const drainNode = getScrollDrainNode()
    if (drainNode) markDirty(drainNode)

    return {
      scrollHint: options.altScreen ? getScrollHint() : null,
      scrollDrainPending: drainNode !== null,
      screen: renderedScreen,
      viewport: {
        width: terminalWidth,
        
        
        
        
        
        
        
        
        height: options.altScreen ? terminalRows + 1 : terminalRows,
      },
      cursor: {
        x: 0,
        
        
        
        
        
        
        y: options.altScreen
          ? Math.max(0, Math.min(screen.height, terminalRows) - 1)
          : screen.height,
        
        visible: !isTTY || screen.height === 0,
      },
    }
  }
}
