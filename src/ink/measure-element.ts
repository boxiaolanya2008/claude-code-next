import type { DOMElement } from './dom.js'

type Output = {
  

  width: number

  

  height: number
}

const measureElement = (node: DOMElement): Output => ({
  width: node.yogaNode?.getComputedWidth() ?? 0,
  height: node.yogaNode?.getComputedHeight() ?? 0,
})

export default measureElement
