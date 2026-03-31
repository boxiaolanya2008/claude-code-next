import memoize from 'lodash-es/memoize.js'
import {
  extractOutputRedirections,
  splitCommandWithOperators,
} from './commands.js'
import type { Node } from './parser.js'
import {
  analyzeCommand,
  type TreeSitterAnalysis,
} from './treeSitterAnalysis.js'

export type OutputRedirection = {
  target: string
  operator: '>' | '>>'
}

export interface IParsedCommand {
  readonly originalCommand: string
  toString(): string
  getPipeSegments(): string[]
  withoutOutputRedirections(): string
  getOutputRedirections(): OutputRedirection[]
  

  getTreeSitterAnalysis(): TreeSitterAnalysis | null
}

export class RegexParsedCommand_DEPRECATED implements IParsedCommand {
  readonly originalCommand: string

  constructor(command: string) {
    this.originalCommand = command
  }

  toString(): string {
    return this.originalCommand
  }

  getPipeSegments(): string[] {
    try {
      const parts = splitCommandWithOperators(this.originalCommand)
      const segments: string[] = []
      let currentSegment: string[] = []

      for (const part of parts) {
        if (part === '|') {
          if (currentSegment.length > 0) {
            segments.push(currentSegment.join(' '))
            currentSegment = []
          }
        } else {
          currentSegment.push(part)
        }
      }

      if (currentSegment.length > 0) {
        segments.push(currentSegment.join(' '))
      }

      return segments.length > 0 ? segments : [this.originalCommand]
    } catch {
      return [this.originalCommand]
    }
  }

  withoutOutputRedirections(): string {
    if (!this.originalCommand.includes('>')) {
      return this.originalCommand
    }
    const { commandWithoutRedirections, redirections } =
      extractOutputRedirections(this.originalCommand)
    return redirections.length > 0
      ? commandWithoutRedirections
      : this.originalCommand
  }

  getOutputRedirections(): OutputRedirection[] {
    const { redirections } = extractOutputRedirections(this.originalCommand)
    return redirections
  }

  getTreeSitterAnalysis(): TreeSitterAnalysis | null {
    return null
  }
}

type RedirectionNode = OutputRedirection & {
  startIndex: number
  endIndex: number
}

function visitNodes(node: Node, visitor: (node: Node) => void): void {
  visitor(node)
  for (const child of node.children) {
    visitNodes(child, visitor)
  }
}

function extractPipePositions(rootNode: Node): number[] {
  const pipePositions: number[] = []
  visitNodes(rootNode, node => {
    if (node.type === 'pipeline') {
      for (const child of node.children) {
        if (child.type === '|') {
          pipePositions.push(child.startIndex)
        }
      }
    }
  })
  
  
  
  
  return pipePositions.sort((a, b) => a - b)
}

function extractRedirectionNodes(rootNode: Node): RedirectionNode[] {
  const redirections: RedirectionNode[] = []
  visitNodes(rootNode, node => {
    if (node.type === 'file_redirect') {
      const children = node.children
      const op = children.find(c => c.type === '>' || c.type === '>>')
      const target = children.find(c => c.type === 'word')
      if (op && target) {
        redirections.push({
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          target: target.text,
          operator: op.type as '>' | '>>',
        })
      }
    }
  })
  return redirections
}

class TreeSitterParsedCommand implements IParsedCommand {
  readonly originalCommand: string
  
  
  
  
  
  
  private readonly commandBytes: Buffer
  private readonly pipePositions: number[]
  private readonly redirectionNodes: RedirectionNode[]
  private readonly treeSitterAnalysis: TreeSitterAnalysis

  constructor(
    command: string,
    pipePositions: number[],
    redirectionNodes: RedirectionNode[],
    treeSitterAnalysis: TreeSitterAnalysis,
  ) {
    this.originalCommand = command
    this.commandBytes = Buffer.from(command, 'utf8')
    this.pipePositions = pipePositions
    this.redirectionNodes = redirectionNodes
    this.treeSitterAnalysis = treeSitterAnalysis
  }

  toString(): string {
    return this.originalCommand
  }

  getPipeSegments(): string[] {
    if (this.pipePositions.length === 0) {
      return [this.originalCommand]
    }

    const segments: string[] = []
    let currentStart = 0

    for (const pipePos of this.pipePositions) {
      const segment = this.commandBytes
        .subarray(currentStart, pipePos)
        .toString('utf8')
        .trim()
      if (segment) {
        segments.push(segment)
      }
      currentStart = pipePos + 1
    }

    const lastSegment = this.commandBytes
      .subarray(currentStart)
      .toString('utf8')
      .trim()
    if (lastSegment) {
      segments.push(lastSegment)
    }

    return segments
  }

  withoutOutputRedirections(): string {
    if (this.redirectionNodes.length === 0) return this.originalCommand

    const sorted = [...this.redirectionNodes].sort(
      (a, b) => b.startIndex - a.startIndex,
    )

    let result = this.commandBytes
    for (const redir of sorted) {
      result = Buffer.concat([
        result.subarray(0, redir.startIndex),
        result.subarray(redir.endIndex),
      ])
    }
    return result.toString('utf8').trim().replace(/\s+/g, ' ')
  }

  getOutputRedirections(): OutputRedirection[] {
    return this.redirectionNodes.map(({ target, operator }) => ({
      target,
      operator,
    }))
  }

  getTreeSitterAnalysis(): TreeSitterAnalysis {
    return this.treeSitterAnalysis
  }
}

const getTreeSitterAvailable = memoize(async (): Promise<boolean> => {
  try {
    const { parseCommand } = await import('./parser.js')
    const testResult = await parseCommand('echo test')
    return testResult !== null
  } catch {
    return false
  }
})

export function buildParsedCommandFromRoot(
  command: string,
  root: Node,
): IParsedCommand {
  const pipePositions = extractPipePositions(root)
  const redirectionNodes = extractRedirectionNodes(root)
  const analysis = analyzeCommand(root, command)
  return new TreeSitterParsedCommand(
    command,
    pipePositions,
    redirectionNodes,
    analysis,
  )
}

async function doParse(command: string): Promise<IParsedCommand | null> {
  if (!command) return null

  const treeSitterAvailable = await getTreeSitterAvailable()
  if (treeSitterAvailable) {
    try {
      const { parseCommand } = await import('./parser.js')
      const data = await parseCommand(command)
      if (data) {
        
        
        return buildParsedCommandFromRoot(command, data.rootNode)
      }
    } catch {
      
    }
  }

  
  return new RegexParsedCommand_DEPRECATED(command)
}

let lastCmd: string | undefined
let lastResult: Promise<IParsedCommand | null> | undefined

export const ParsedCommand = {
  

  parse(command: string): Promise<IParsedCommand | null> {
    if (command === lastCmd && lastResult !== undefined) {
      return lastResult
    }
    lastCmd = command
    lastResult = doParse(command)
    return lastResult
  },
}
