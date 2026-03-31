import { feature } from 'bun:bundle'
import { logEvent } from '../../services/analytics/index.js'
import { logForDebugging } from '../debug.js'
import {
  ensureParserInitialized,
  getParserModule,
  type TsNode,
} from './bashParser.js'

export type Node = TsNode

export interface ParsedCommandData {
  rootNode: Node
  envVars: string[]
  commandNode: Node | null
  originalCommand: string
}

const MAX_COMMAND_LENGTH = 10000
const DECLARATION_COMMANDS = new Set([
  'export',
  'declare',
  'typeset',
  'readonly',
  'local',
  'unset',
  'unsetenv',
])
const ARGUMENT_TYPES = new Set(['word', 'string', 'raw_string', 'number'])
const SUBSTITUTION_TYPES = new Set([
  'command_substitution',
  'process_substitution',
])
const COMMAND_TYPES = new Set(['command', 'declaration_command'])

let logged = false
function logLoadOnce(success: boolean): void {
  if (logged) return
  logged = true
  logForDebugging(
    success ? 'tree-sitter: native module loaded' : 'tree-sitter: unavailable',
  )
  logEvent('tengu_tree_sitter_load', { success })
}

export async function ensureInitialized(): Promise<void> {
  if (feature('TREE_SITTER_BASH') || feature('TREE_SITTER_BASH_SHADOW')) {
    await ensureParserInitialized()
  }
}

export async function parseCommand(
  command: string,
): Promise<ParsedCommandData | null> {
  if (!command || command.length > MAX_COMMAND_LENGTH) return null

  
  
  
  
  if (feature('TREE_SITTER_BASH')) {
    await ensureParserInitialized()
    const mod = getParserModule()
    logLoadOnce(mod !== null)
    if (!mod) return null

    try {
      const rootNode = mod.parse(command)
      if (!rootNode) return null

      const commandNode = findCommandNode(rootNode, null)
      const envVars = extractEnvVars(commandNode)

      return { rootNode, envVars, commandNode, originalCommand: command }
    } catch {
      return null
    }
  }
  return null
}

export const PARSE_ABORTED = Symbol('parse-aborted')

export async function parseCommandRaw(
  command: string,
): Promise<Node | null | typeof PARSE_ABORTED> {
  if (!command || command.length > MAX_COMMAND_LENGTH) return null
  if (feature('TREE_SITTER_BASH') || feature('TREE_SITTER_BASH_SHADOW')) {
    await ensureParserInitialized()
    const mod = getParserModule()
    logLoadOnce(mod !== null)
    if (!mod) return null
    try {
      const result = mod.parse(command)
      
      
      
      
      if (result === null) {
        logEvent('tengu_tree_sitter_parse_abort', {
          cmdLength: command.length,
          panic: false,
        })
        return PARSE_ABORTED
      }
      return result
    } catch {
      logEvent('tengu_tree_sitter_parse_abort', {
        cmdLength: command.length,
        panic: true,
      })
      return PARSE_ABORTED
    }
  }
  return null
}

function findCommandNode(node: Node, parent: Node | null): Node | null {
  const { type, children } = node

  if (COMMAND_TYPES.has(type)) return node

  
  if (type === 'variable_assignment' && parent) {
    return (
      parent.children.find(
        c => COMMAND_TYPES.has(c.type) && c.startIndex > node.startIndex,
      ) ?? null
    )
  }

  
  if (type === 'pipeline') {
    for (const child of children) {
      const result = findCommandNode(child, node)
      if (result) return result
    }
    return null
  }

  
  if (type === 'redirected_statement') {
    return children.find(c => COMMAND_TYPES.has(c.type)) ?? null
  }

  
  for (const child of children) {
    const result = findCommandNode(child, node)
    if (result) return result
  }

  return null
}

function extractEnvVars(commandNode: Node | null): string[] {
  if (!commandNode || commandNode.type !== 'command') return []

  const envVars: string[] = []
  for (const child of commandNode.children) {
    if (child.type === 'variable_assignment') {
      envVars.push(child.text)
    } else if (child.type === 'command_name' || child.type === 'word') {
      break
    }
  }
  return envVars
}

export function extractCommandArguments(commandNode: Node): string[] {
  
  if (commandNode.type === 'declaration_command') {
    const firstChild = commandNode.children[0]
    return firstChild && DECLARATION_COMMANDS.has(firstChild.text)
      ? [firstChild.text]
      : []
  }

  const args: string[] = []
  let foundCommandName = false

  for (const child of commandNode.children) {
    if (child.type === 'variable_assignment') continue

    
    if (
      child.type === 'command_name' ||
      (!foundCommandName && child.type === 'word')
    ) {
      foundCommandName = true
      args.push(child.text)
      continue
    }

    
    if (ARGUMENT_TYPES.has(child.type)) {
      args.push(stripQuotes(child.text))
    } else if (SUBSTITUTION_TYPES.has(child.type)) {
      break
    }
  }
  return args
}

function stripQuotes(text: string): string {
  return text.length >= 2 &&
    ((text[0] === '"' && text.at(-1) === '"') ||
      (text[0] === "'" && text.at(-1) === "'"))
    ? text.slice(1, -1)
    : text
}
