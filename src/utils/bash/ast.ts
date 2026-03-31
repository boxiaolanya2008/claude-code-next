

import { SHELL_KEYWORDS } from './bashParser.js'
import type { Node } from './parser.js'
import { PARSE_ABORTED, parseCommandRaw } from './parser.js'

export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

export type SimpleCommand = {
  
  argv: string[]
  
  envVars: { name: string; value: string }[]
  
  redirects: Redirect[]
  
  text: string
}

export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }

const STRUCTURAL_TYPES = new Set([
  'program',
  'list',
  'pipeline',
  'redirected_statement',
])

const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&', '\n'])

const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'

const VAR_PLACEHOLDER = '__TRACKED_VAR__'

function containsAnyPlaceholder(value: string): boolean {
  return value.includes(CMDSUB_PLACEHOLDER) || value.includes(VAR_PLACEHOLDER)
}

const BARE_VAR_UNSAFE_RE = /[ \t\n*?[]/

const STDBUF_SHORT_SEP_RE = /^-[ioe]$/
const STDBUF_SHORT_FUSED_RE = /^-[ioe]./
const STDBUF_LONG_RE = /^--(input|output|error)=/

const SAFE_ENV_VARS = new Set([
  'HOME', 
  'PWD', 
  'OLDPWD', 
  'USER', 
  'LOGNAME', 
  'SHELL', 
  'PATH', 
  'HOSTNAME', 
  'UID', 
  'EUID', 
  'PPID', 
  'RANDOM', 
  'SECONDS', 
  'LINENO', 
  'TMPDIR', 
  
  'BASH_VERSION', 
  'BASHPID', 
  'SHLVL', 
  'HISTFILE', 
  'IFS', 
  
  
])

const SPECIAL_VAR_NAMES = new Set([
  '?', 
  ', 
  '!', 
  '#', 
  '0', 
  '-', 
])

const DANGEROUS_TYPES = new Set([
  'command_substitution',
  'process_substitution',
  'expansion',
  'simple_expansion',
  'brace_expression',
  'subshell',
  'compound_statement',
  'for_statement',
  'while_statement',
  'until_statement',
  'if_statement',
  'case_statement',
  'function_definition',
  'test_command',
  'ansi_c_string',
  'translated_string',
  'herestring_redirect',
  'heredoc_redirect',
])

const DANGEROUS_TYPE_IDS = [...DANGEROUS_TYPES]
export function nodeTypeId(nodeType: string | undefined): number {
  if (!nodeType) return -2
  if (nodeType === 'ERROR') return -1
  const i = DANGEROUS_TYPE_IDS.indexOf(nodeType)
  return i >= 0 ? i + 1 : 0
}

const REDIRECT_OPS: Record<string, Redirect['op']> = {
  '>': '>',
  '>>': '>>',
  '<': '<',
  '>&': '>&',
  '<&': '<&',
  '>|': '>|',
  '&>': '&>',
  '&>>': '&>>',
  '<<<': '<<<',
}

const BRACE_EXPANSION_RE = /\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/

const UNICODE_WHITESPACE_RE =
  /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/

const BACKSLASH_WHITESPACE_RE = /\\[ \t]|[^ \t\n\\]\\\n/

const ZSH_TILDE_BRACKET_RE = /~\[/

const ZSH_EQUALS_EXPANSION_RE = /(?:^|[\s;&|])=[a-zA-Z_]/

const BRACE_WITH_QUOTE_RE = /\{[^}]*['"]/

function maskBracesInQuotedContexts(cmd: string): string {
  
  if (!cmd.includes('{')) return cmd
  const out: string[] = []
  let inSingle = false
  let inDouble = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (inSingle) {
      if (c === "'") inSingle = false
      out.push(c === '{' ? ' ' : c)
      i++
    } else if (inDouble) {

import { SHELL_KEYWORDS } from './bashParser.js'
import type { Node } from './parser.js'
import { PARSE_ABORTED, parseCommandRaw } from './parser.js'

export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

export type SimpleCommand = {
  
  argv: string[]
  
  envVars: { name: string; value: string }[]
  
  redirects: Redirect[]
  
  text: string
}

export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }

const STRUCTURAL_TYPES = new Set([
  'program',
  'list',
  'pipeline',
  'redirected_statement',
])

const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&', '\n'])

const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'

const VAR_PLACEHOLDER = '__TRACKED_VAR__'

function containsAnyPlaceholder(value: string): boolean {
  return value.includes(CMDSUB_PLACEHOLDER) || value.includes(VAR_PLACEHOLDER)
}

const BARE_VAR_UNSAFE_RE = /[ \t\n*?[]/

const STDBUF_SHORT_SEP_RE = /^-[ioe]$/
const STDBUF_SHORT_FUSED_RE = /^-[ioe]./
const STDBUF_LONG_RE = /^--(input|output|error)=/

const SAFE_ENV_VARS = new Set([
  'HOME', 
  'PWD', 
  'OLDPWD', 
  'USER', 
  'LOGNAME', 
  'SHELL', 
  'PATH', 
  'HOSTNAME', 
  'UID', 
  'EUID', 
  'PPID', 
  'RANDOM', 
  'SECONDS', 
  'LINENO', 
  'TMPDIR', 
  
  'BASH_VERSION', 
  'BASHPID', 
  'SHLVL', 
  'HISTFILE', 
  'IFS', 
  
  
])

const SPECIAL_VAR_NAMES = new Set([
  '?', 
  ', 
  '!', 
  '#', 
  '0', 
  '-', 
])

const DANGEROUS_TYPES = new Set([
  'command_substitution',
  'process_substitution',
  'expansion',
  'simple_expansion',
  'brace_expression',
  'subshell',
  'compound_statement',
  'for_statement',
  'while_statement',
  'until_statement',
  'if_statement',
  'case_statement',
  'function_definition',
  'test_command',
  'ansi_c_string',
  'translated_string',
  'herestring_redirect',
  'heredoc_redirect',
])

const DANGEROUS_TYPE_IDS = [...DANGEROUS_TYPES]
export function nodeTypeId(nodeType: string | undefined): number {
  if (!nodeType) return -2
  if (nodeType === 'ERROR') return -1
  const i = DANGEROUS_TYPE_IDS.indexOf(nodeType)
  return i >= 0 ? i + 1 : 0
}

const REDIRECT_OPS: Record<string, Redirect['op']> = {
  '>': '>',
  '>>': '>>',
  '<': '<',
  '>&': '>&',
  '<&': '<&',
  '>|': '>|',
  '&>': '&>',
  '&>>': '&>>',
  '<<<': '<<<',
}

const BRACE_EXPANSION_RE = /\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/

const UNICODE_WHITESPACE_RE =
  /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/

const BACKSLASH_WHITESPACE_RE = /\\[ \t]|[^ \t\n\\]\\\n/

const ZSH_TILDE_BRACKET_RE = /~\[/

const ZSH_EQUALS_EXPANSION_RE = /(?:^|[\s;&|])=[a-zA-Z_]/

const BRACE_WITH_QUOTE_RE = /\{[^}]*['"]/

function maskBracesInQuotedContexts(cmd: string): string {
  // Fast path: no `{` → nothing to mask. Skips the char-by-char scan for
  
  if (!cmd.includes('{')) return cmd
  const out: string[] = []
  let inSingle = false
  let inDouble = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (inSingle) {
      // Bash single quotes: no escapes, `'` always terminates.
      if (c === "'") inSingle = false
      out.push(c === '{' ? ' ' : c)
      i++
    } else if (inDouble) {
      // Bash double quotes: `\` escapes `, backtick,
      
      if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === '"') inDouble = false
        out.push(c === '{' ? ' ' : c)
        i++
      }
    } else {
      
      if (c === '\\' && i + 1 < cmd.length) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === "'") inSingle = true
        else if (c === '"') inDouble = true
        out.push(c)
        i++
      }
    }
  }
  return out.join('')
}

const DOLLAR = String.fromCharCode(0x24)

export async function parseForSecurity(
  cmd: string,
): Promise<ParseForSecurityResult> {
  
  
  
  if (cmd === '') return { kind: 'simple', commands: [] }
  const root = await parseCommandRaw(cmd)
  return root === null
    ? { kind: 'parse-unavailable' }
    : parseForSecurityFromAst(cmd, root)
}

export function parseForSecurityFromAst(
  cmd: string,
  root: Node | typeof PARSE_ABORTED,
): ParseForSecurityResult {
  
  
  
  
  if (CONTROL_CHAR_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains control characters' }
  }
  if (UNICODE_WHITESPACE_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains Unicode whitespace' }
  }
  if (BACKSLASH_WHITESPACE_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains backslash-escaped whitespace',
    }
  }
  if (ZSH_TILDE_BRACKET_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh ~[ dynamic directory syntax',
    }
  }
  if (ZSH_EQUALS_EXPANSION_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh =cmd equals expansion',
    }
  }
  if (BRACE_WITH_QUOTE_RE.test(maskBracesInQuotedContexts(cmd))) {
    return {
      kind: 'too-complex',
      reason: 'Contains brace with quote character (expansion obfuscation)',
    }
  }

  const trimmed = cmd.trim()
  if (trimmed === '') {
    return { kind: 'simple', commands: [] }
  }

  if (root === PARSE_ABORTED) {
    
    
    
    
    
    
    return {
      kind: 'too-complex',
      reason:
        'Parser aborted (timeout or resource limit) — possible adversarial input',
      nodeType: 'PARSE_ABORT',
    }
  }

  return walkProgram(root)
}

function walkProgram(root: Node): ParseForSecurityResult {
  
  
  
  const commands: SimpleCommand[] = []
  
  
  
  
  
  const varScope = new Map<string, string>()
  const err = collectCommands(root, commands, varScope)
  if (err) return err
  return { kind: 'simple', commands }
}

function collectCommands(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  if (node.type === 'command') {
    
    
    const result = walkCommand(node, [], commands, varScope)
    if (result.kind !== 'simple') return result
    commands.push(...result.commands)
    return null
  }

  if (node.type === 'redirected_statement') {
    return walkRedirectedStatement(node, commands, varScope)
  }

  if (node.type === 'comment') {
    return null
  }

  if (STRUCTURAL_TYPES.has(node.type)) {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const isPipeline = node.type === 'pipeline'
    let needsSnapshot = false
    if (!isPipeline) {
      for (const c of node.children) {
        if (c && (c.type === '||' || c.type === '&')) {
          needsSnapshot = true
          break
        }
      }
    }
    const snapshot = needsSnapshot ? new Map(varScope) : null
    
    
    
    let scope = isPipeline ? new Map(varScope) : varScope
    for (const child of node.children) {
      if (!child) continue
      if (SEPARATOR_TYPES.has(child.type)) {
        if (
          child.type === '||' ||
          child.type === '|' ||
          child.type === '|&' ||
          child.type === '&'
        ) {
          
          
          
          scope = new Map(snapshot ?? varScope)
        }
        continue
      }
      const err = collectCommands(child, commands, scope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'negated_command') {
    
    
    
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '!') continue
      return collectCommands(child, commands, varScope)
    }
    return null
  }

  if (node.type === 'declaration_command') {
    
    
    
    
    
    
    
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'export':
        case 'local':
        case 'readonly':
        case 'declare':
        case 'typeset':
          argv.push(child.text)
          break
        case 'word':
        case 'number':
        case 'raw_string':
        case 'string':
        case 'concatenation': {
          
          
          
          
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            /^-[a-zA-Z]*[niaA]/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare flag ${arg} changes assignment semantics (nameref/integer/array)`,
              nodeType: 'declaration_command',
            }
          }
          
          
          
          
          
          
          
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            arg[0] !== '-' &&
            /^[^=]*\[/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare positional '${arg}' contains array subscript — bash evaluates $(cmd) in subscripts`,
              nodeType: 'declaration_command',
            }
          }
          argv.push(arg)
          break
        }
        case 'variable_assignment': {
          const ev = walkVariableAssignment(child, commands, varScope)
          if ('kind' in ev) return ev
          
          applyVarToScope(varScope, ev)
          argv.push(`${ev.name}=${ev.value}`)
          break
        }
        case 'variable_name':
          
          argv.push(child.text)
          break
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type === 'variable_assignment') {
    
    
    
    
    
    
    
    const ev = walkVariableAssignment(node, commands, varScope)
    if ('kind' in ev) return ev
    
    applyVarToScope(varScope, ev)
    return null
  }

  if (node.type === 'for_statement') {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let loopVar: string | null = null
    let doGroup: Node | null = null
    for (const child of node.children) {
      if (!child) continue
      if (child.type === 'variable_name') {
        loopVar = child.text
      } else if (child.type === 'do_group') {
        doGroup = child
      } else if (
        child.type === 'for' ||
        child.type === 'in' ||
        child.type === 'select' ||
        child.type === ';'
      ) {
        continue 
      } else if (child.type === 'command_substitution') {
        
        const err = collectCommandSubstitution(child, commands, varScope)
        if (err) return err
      } else {
        
        
        
        
        
        const arg = walkArgument(child, commands, varScope)
        if (typeof arg !== 'string') return arg
      }
    }
    if (loopVar === null || doGroup === null) return tooComplex(node)
    
    
    
    if (loopVar === 'PS4' || loopVar === 'IFS') {
      return {
        kind: 'too-complex',
        reason: `${loopVar} as loop variable bypasses assignment validation`,
        nodeType: 'for_statement',
      }
    }
    
    
    
    
    varScope.set(loopVar, VAR_PLACEHOLDER)
    const bodyScope = new Map(varScope)
    for (const c of doGroup.children) {
      if (!c) continue
      if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
      const err = collectCommands(c, commands, bodyScope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'if_statement' || node.type === 'while_statement') {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let seenThen = false
    for (const child of node.children) {
      if (!child) continue
      if (
        child.type === 'if' ||
        child.type === 'fi' ||
        child.type === 'else' ||
        child.type === 'elif' ||
        child.type === 'while' ||
        child.type === 'until' ||
        child.type === ';'
      ) {
        continue
      }
      if (child.type === 'then') {
        seenThen = true
        continue
      }
      if (child.type === 'do_group') {
        
        
        
        const bodyScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
          const err = collectCommands(c, commands, bodyScope)
          if (err) return err
        }
        continue
      }
      if (child.type === 'elif_clause' || child.type === 'else_clause') {
        
        
        const branchScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (
            c.type === 'elif' ||
            c.type === 'else' ||
            c.type === 'then' ||
            c.type === ';'
          ) {
            continue
          }
          const err = collectCommands(c, commands, branchScope)
          if (err) return err
        }
        continue
      }
      
      
      
      
      const targetScope = seenThen ? new Map(varScope) : varScope
      const before = commands.length
      const err = collectCommands(child, commands, targetScope)
      if (err) return err
      
      
      
      if (!seenThen) {
        for (let i = before; i < commands.length; i++) {
          const c = commands[i]
          if (c?.argv[0] === 'read') {
            for (const a of c.argv.slice(1)) {
              
              if (!a.startsWith('-') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) {
                
                
                
                
                
                
                
                
                
                
                
                
                const existing = varScope.get(a)
                if (
                  existing !== undefined &&
                  !containsAnyPlaceholder(existing)
                ) {
                  return {
                    kind: 'too-complex',
                    reason: `'read ${a}' in condition may not execute (||/pipeline/subshell); cannot prove it overwrites tracked literal '${existing}'`,
                    nodeType: 'if_statement',
                  }
                }
                varScope.set(a, VAR_PLACEHOLDER)
              }
            }
          }
        }
      }
    }
    return null
  }

  if (node.type === 'subshell') {
    
    
    
    
    const innerScope = new Map(varScope)
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '(' || child.type === ')') continue
      const err = collectCommands(child, commands, innerScope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'test_command') {
    
    
    
    
    
    
    
    const argv: string[] = ['[[']
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '[[' || child.type === ']]') continue
      if (child.type === '[' || child.type === ']') continue
      
      
      
      const err = walkTestExpr(child, argv, commands, varScope)
      if (err) return err
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type === 'unset_command') {
    
    
    
    
    
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'unset':
          argv.push(child.text)
          break
        case 'variable_name':
          argv.push(child.text)
          
          
          
          varScope.delete(child.text)
          break
        case 'word': {
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          argv.push(arg)
          break
        }
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  return tooComplex(node)
}

function walkTestExpr(
  node: Node,
  argv: string[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  switch (node.type) {
    case 'unary_expression':
    case 'binary_expression':
    case 'negated_expression':
    case 'parenthesized_expression': {
      for (const c of node.children) {
        if (!c) continue
        const err = walkTestExpr(c, argv, innerCommands, varScope)
        if (err) return err
      }
      return null
    }
    case 'test_operator':
    case '!':
    case '(':
    case ')':
    case '&&':
    case '||':
    case '==':
    case '=':
    case '!=':
    case '<':
    case '>':
    case '=~':
      argv.push(node.text)
      return null
    case 'regex':
    case 'extglob_pattern':
      
      
      
      argv.push(node.text)
      return null
    default: {
      
      const arg = walkArgument(node, innerCommands, varScope)
      if (typeof arg !== 'string') return arg
      argv.push(arg)
      return null
    }
  }
}

function walkRedirectedStatement(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  const redirects: Redirect[] = []
  let innerCommand: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_redirect') {
      
      
      const r = walkFileRedirect(child, commands, varScope)
      if ('kind' in r) return r
      redirects.push(r)
    } else if (child.type === 'heredoc_redirect') {
      const r = walkHeredocRedirect(child)
      if (r) return r
    } else if (
      child.type === 'command' ||
      child.type === 'pipeline' ||
      child.type === 'list' ||
      child.type === 'negated_command' ||
      child.type === 'declaration_command' ||
      child.type === 'unset_command'
    ) {
      innerCommand = child
    } else {
      return tooComplex(child)
    }
  }

  if (!innerCommand) {
    
    
    commands.push({ argv: [], envVars: [], redirects, text: node.text })
    return null
  }

  const before = commands.length
  const err = collectCommands(innerCommand, commands, varScope)
  if (err) return err
  if (commands.length > before && redirects.length > 0) {
    const last = commands[commands.length - 1]
    if (last) last.redirects.push(...redirects)
  }
  return null
}

function walkFileRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): Redirect | ParseForSecurityResult {
  let op: Redirect['op'] | null = null
  let target: string | null = null
  let fd: number | undefined

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_descriptor') {
      fd = Number(child.text)
    } else if (child.type in REDIRECT_OPS) {
      op = REDIRECT_OPS[child.type] ?? null
    } else if (child.type === 'word' || child.type === 'number') {
      
      
      
      
      if (child.children.length > 0) return tooComplex(child)
      
      
      
      
      if (BRACE_EXPANSION_RE.test(child.text)) return tooComplex(child)
      
      
      
      
      target = child.text.replace(/\\(.)/g, '$1')
    } else if (child.type === 'raw_string') {
      target = stripRawString(child.text)
    } else if (child.type === 'string') {
      const s = walkString(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else if (child.type === 'concatenation') {
      
      
      
      const s = walkArgument(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else {
      return tooComplex(child)
    }
  }

  if (!op || target === null) {
    return {
      kind: 'too-complex',
      reason: 'Unrecognized redirect shape',
      nodeType: node.type,
    }
  }
  return { op, target, fd }
}

function walkHeredocRedirect(node: Node): ParseForSecurityResult | null {
  let startText: string | null = null
  let body: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'heredoc_start') startText = child.text
    else if (child.type === 'heredoc_body') body = child
    else if (
      child.type === '<<' ||
      child.type === '<<-' ||
      child.type === 'heredoc_end' ||
      child.type === 'file_descriptor'
    ) {
      
      
      
    } else {
      
      
      
      
      
      return tooComplex(child)
    }
  }

  const isQuoted =
    startText !== null &&
    ((startText.startsWith("'") && startText.endsWith("'")) ||
      (startText.startsWith('"') && startText.endsWith('"')) ||
      startText.startsWith('\\'))

  if (!isQuoted) {
    return {
      kind: 'too-complex',
      reason: 'Heredoc with unquoted delimiter undergoes shell expansion',
      nodeType: 'heredoc_redirect',
    }
  }

  if (body) {
    for (const child of body.children) {
      if (!child) continue
      if (child.type !== 'heredoc_content') {
        return tooComplex(child)
      }
    }
  }
  return null
}

function walkHerestringRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.type === '<<<') continue
    
    
    
    const content = walkArgument(child, innerCommands, varScope)
    if (typeof content !== 'string') return content
    
    
    
    if (NEWLINE_HASH_RE.test(content)) return tooComplex(child)
  }
  return null
}

function walkCommand(
  node: Node,
  extraRedirects: Redirect[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult {
  const argv: string[] = []
  const envVars: { name: string; value: string }[] = []
  const redirects: Redirect[] = [...extraRedirects]

  for (const child of node.children) {
    if (!child) continue

    switch (child.type) {
      case 'variable_assignment': {
        const ev = walkVariableAssignment(child, innerCommands, varScope)
        if ('kind' in ev) return ev
        
        
        
        
        envVars.push({ name: ev.name, value: ev.value })
        break
      }
      case 'command_name': {
        const arg = walkArgument(
          child.children[0] ?? child,
          innerCommands,
          varScope,
        )
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
      case 'word':
      case 'number':
      case 'raw_string':
      case 'string':
      case 'concatenation':
      case 'arithmetic_expansion': {
        const arg = walkArgument(child, innerCommands, varScope)
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
      
      
      
      
      
      
      
      case 'simple_expansion': {
        
        
        
        const v = resolveSimpleExpansion(child, varScope, false)
        if (typeof v !== 'string') return v
        argv.push(v)
        break
      }
      case 'file_redirect': {
        const r = walkFileRedirect(child, innerCommands, varScope)
        if ('kind' in r) return r
        redirects.push(r)
        break
      }
      case 'herestring_redirect': {
        
        
        const err = walkHerestringRedirect(child, innerCommands, varScope)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const text =
    /\$[A-Za-z_]/.test(node.text) || node.text.includes('\n')
      ? argv
          .map(a =>
            a === '' || /["'\\ \t\n

import { SHELL_KEYWORDS } from './bashParser.js'
import type { Node } from './parser.js'
import { PARSE_ABORTED, parseCommandRaw } from './parser.js'

export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

export type SimpleCommand = {
  
  argv: string[]
  
  envVars: { name: string; value: string }[]
  
  redirects: Redirect[]
  
  text: string
}

export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }

const STRUCTURAL_TYPES = new Set([
  'program',
  'list',
  'pipeline',
  'redirected_statement',
])

const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&', '\n'])

const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'

const VAR_PLACEHOLDER = '__TRACKED_VAR__'

function containsAnyPlaceholder(value: string): boolean {
  return value.includes(CMDSUB_PLACEHOLDER) || value.includes(VAR_PLACEHOLDER)
}

const BARE_VAR_UNSAFE_RE = /[ \t\n*?[]/

const STDBUF_SHORT_SEP_RE = /^-[ioe]$/
const STDBUF_SHORT_FUSED_RE = /^-[ioe]./
const STDBUF_LONG_RE = /^--(input|output|error)=/

const SAFE_ENV_VARS = new Set([
  'HOME', 
  'PWD', 
  'OLDPWD', 
  'USER', 
  'LOGNAME', 
  'SHELL', 
  'PATH', 
  'HOSTNAME', 
  'UID', 
  'EUID', 
  'PPID', 
  'RANDOM', 
  'SECONDS', 
  'LINENO', 
  'TMPDIR', 
  
  'BASH_VERSION', 
  'BASHPID', 
  'SHLVL', 
  'HISTFILE', 
  'IFS', 
  
  
])

const SPECIAL_VAR_NAMES = new Set([
  '?', 
  ', 
  '!', 
  '#', 
  '0', 
  '-', 
])

const DANGEROUS_TYPES = new Set([
  'command_substitution',
  'process_substitution',
  'expansion',
  'simple_expansion',
  'brace_expression',
  'subshell',
  'compound_statement',
  'for_statement',
  'while_statement',
  'until_statement',
  'if_statement',
  'case_statement',
  'function_definition',
  'test_command',
  'ansi_c_string',
  'translated_string',
  'herestring_redirect',
  'heredoc_redirect',
])

const DANGEROUS_TYPE_IDS = [...DANGEROUS_TYPES]
export function nodeTypeId(nodeType: string | undefined): number {
  if (!nodeType) return -2
  if (nodeType === 'ERROR') return -1
  const i = DANGEROUS_TYPE_IDS.indexOf(nodeType)
  return i >= 0 ? i + 1 : 0
}

const REDIRECT_OPS: Record<string, Redirect['op']> = {
  '>': '>',
  '>>': '>>',
  '<': '<',
  '>&': '>&',
  '<&': '<&',
  '>|': '>|',
  '&>': '&>',
  '&>>': '&>>',
  '<<<': '<<<',
}

const BRACE_EXPANSION_RE = /\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/

const UNICODE_WHITESPACE_RE =
  /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/

const BACKSLASH_WHITESPACE_RE = /\\[ \t]|[^ \t\n\\]\\\n/

const ZSH_TILDE_BRACKET_RE = /~\[/

const ZSH_EQUALS_EXPANSION_RE = /(?:^|[\s;&|])=[a-zA-Z_]/

const BRACE_WITH_QUOTE_RE = /\{[^}]*['"]/

function maskBracesInQuotedContexts(cmd: string): string {
  
  
  if (!cmd.includes('{')) return cmd
  const out: string[] = []
  let inSingle = false
  let inDouble = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (inSingle) {
      
      if (c === "'") inSingle = false
      out.push(c === '{' ? ' ' : c)
      i++
    } else if (inDouble) {
      

import { SHELL_KEYWORDS } from './bashParser.js'
import type { Node } from './parser.js'
import { PARSE_ABORTED, parseCommandRaw } from './parser.js'

export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

export type SimpleCommand = {
  
  argv: string[]
  
  envVars: { name: string; value: string }[]
  
  redirects: Redirect[]
  
  text: string
}

export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }

const STRUCTURAL_TYPES = new Set([
  'program',
  'list',
  'pipeline',
  'redirected_statement',
])

const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&', '\n'])

const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'

const VAR_PLACEHOLDER = '__TRACKED_VAR__'

function containsAnyPlaceholder(value: string): boolean {
  return value.includes(CMDSUB_PLACEHOLDER) || value.includes(VAR_PLACEHOLDER)
}

const BARE_VAR_UNSAFE_RE = /[ \t\n*?[]/

const STDBUF_SHORT_SEP_RE = /^-[ioe]$/
const STDBUF_SHORT_FUSED_RE = /^-[ioe]./
const STDBUF_LONG_RE = /^--(input|output|error)=/

const SAFE_ENV_VARS = new Set([
  'HOME', 
  'PWD', 
  'OLDPWD', 
  'USER', 
  'LOGNAME', 
  'SHELL', 
  'PATH', 
  'HOSTNAME', 
  'UID', 
  'EUID', 
  'PPID', 
  'RANDOM', 
  'SECONDS', 
  'LINENO', 
  'TMPDIR', 
  
  'BASH_VERSION', 
  'BASHPID', 
  'SHLVL', 
  'HISTFILE', 
  'IFS', 
  
  
])

const SPECIAL_VAR_NAMES = new Set([
  '?', 
  ', 
  '!', 
  '#', 
  '0', 
  '-', 
])

const DANGEROUS_TYPES = new Set([
  'command_substitution',
  'process_substitution',
  'expansion',
  'simple_expansion',
  'brace_expression',
  'subshell',
  'compound_statement',
  'for_statement',
  'while_statement',
  'until_statement',
  'if_statement',
  'case_statement',
  'function_definition',
  'test_command',
  'ansi_c_string',
  'translated_string',
  'herestring_redirect',
  'heredoc_redirect',
])

const DANGEROUS_TYPE_IDS = [...DANGEROUS_TYPES]
export function nodeTypeId(nodeType: string | undefined): number {
  if (!nodeType) return -2
  if (nodeType === 'ERROR') return -1
  const i = DANGEROUS_TYPE_IDS.indexOf(nodeType)
  return i >= 0 ? i + 1 : 0
}

const REDIRECT_OPS: Record<string, Redirect['op']> = {
  '>': '>',
  '>>': '>>',
  '<': '<',
  '>&': '>&',
  '<&': '<&',
  '>|': '>|',
  '&>': '&>',
  '&>>': '&>>',
  '<<<': '<<<',
}

const BRACE_EXPANSION_RE = /\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/

const UNICODE_WHITESPACE_RE =
  /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/

const BACKSLASH_WHITESPACE_RE = /\\[ \t]|[^ \t\n\\]\\\n/

const ZSH_TILDE_BRACKET_RE = /~\[/

const ZSH_EQUALS_EXPANSION_RE = /(?:^|[\s;&|])=[a-zA-Z_]/

const BRACE_WITH_QUOTE_RE = /\{[^}]*['"]/

function maskBracesInQuotedContexts(cmd: string): string {
  
  if (!cmd.includes('{')) return cmd
  const out: string[] = []
  let inSingle = false
  let inDouble = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (inSingle) {
      if (c === "'") inSingle = false
      out.push(c === '{' ? ' ' : c)
      i++
    } else if (inDouble) {
      // newline — but those don't affect quote state so we let them pass).
      if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === '"') inDouble = false
        out.push(c === '{' ? ' ' : c)
        i++
      }
    } else {
      
      if (c === '\\' && i + 1 < cmd.length) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === "'") inSingle = true
        else if (c === '"') inDouble = true
        out.push(c)
        i++
      }
    }
  }
  return out.join('')
}

const DOLLAR = String.fromCharCode(0x24)

export async function parseForSecurity(
  cmd: string,
): Promise<ParseForSecurityResult> {
  
  
  
  if (cmd === '') return { kind: 'simple', commands: [] }
  const root = await parseCommandRaw(cmd)
  return root === null
    ? { kind: 'parse-unavailable' }
    : parseForSecurityFromAst(cmd, root)
}

export function parseForSecurityFromAst(
  cmd: string,
  root: Node | typeof PARSE_ABORTED,
): ParseForSecurityResult {
  
  
  
  
  if (CONTROL_CHAR_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains control characters' }
  }
  if (UNICODE_WHITESPACE_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains Unicode whitespace' }
  }
  if (BACKSLASH_WHITESPACE_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains backslash-escaped whitespace',
    }
  }
  if (ZSH_TILDE_BRACKET_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh ~[ dynamic directory syntax',
    }
  }
  if (ZSH_EQUALS_EXPANSION_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh =cmd equals expansion',
    }
  }
  if (BRACE_WITH_QUOTE_RE.test(maskBracesInQuotedContexts(cmd))) {
    return {
      kind: 'too-complex',
      reason: 'Contains brace with quote character (expansion obfuscation)',
    }
  }

  const trimmed = cmd.trim()
  if (trimmed === '') {
    return { kind: 'simple', commands: [] }
  }

  if (root === PARSE_ABORTED) {
    
    
    
    
    
    
    return {
      kind: 'too-complex',
      reason:
        'Parser aborted (timeout or resource limit) — possible adversarial input',
      nodeType: 'PARSE_ABORT',
    }
  }

  return walkProgram(root)
}

function walkProgram(root: Node): ParseForSecurityResult {
  
  
  
  const commands: SimpleCommand[] = []
  
  
  
  
  
  const varScope = new Map<string, string>()
  const err = collectCommands(root, commands, varScope)
  if (err) return err
  return { kind: 'simple', commands }
}

function collectCommands(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  if (node.type === 'command') {
    
    
    const result = walkCommand(node, [], commands, varScope)
    if (result.kind !== 'simple') return result
    commands.push(...result.commands)
    return null
  }

  if (node.type === 'redirected_statement') {
    return walkRedirectedStatement(node, commands, varScope)
  }

  if (node.type === 'comment') {
    return null
  }

  if (STRUCTURAL_TYPES.has(node.type)) {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const isPipeline = node.type === 'pipeline'
    let needsSnapshot = false
    if (!isPipeline) {
      for (const c of node.children) {
        if (c && (c.type === '||' || c.type === '&')) {
          needsSnapshot = true
          break
        }
      }
    }
    const snapshot = needsSnapshot ? new Map(varScope) : null
    
    
    
    let scope = isPipeline ? new Map(varScope) : varScope
    for (const child of node.children) {
      if (!child) continue
      if (SEPARATOR_TYPES.has(child.type)) {
        if (
          child.type === '||' ||
          child.type === '|' ||
          child.type === '|&' ||
          child.type === '&'
        ) {
          
          
          
          scope = new Map(snapshot ?? varScope)
        }
        continue
      }
      const err = collectCommands(child, commands, scope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'negated_command') {
    
    
    
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '!') continue
      return collectCommands(child, commands, varScope)
    }
    return null
  }

  if (node.type === 'declaration_command') {
    
    
    
    
    
    
    
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'export':
        case 'local':
        case 'readonly':
        case 'declare':
        case 'typeset':
          argv.push(child.text)
          break
        case 'word':
        case 'number':
        case 'raw_string':
        case 'string':
        case 'concatenation': {
          
          
          
          
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          
          
          
          
          
          
          
          
          
          
          
          
          
          
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            /^-[a-zA-Z]*[niaA]/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare flag ${arg} changes assignment semantics (nameref/integer/array)`,
              nodeType: 'declaration_command',
            }
          }
          
          
          
          
          
          
          
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            arg[0] !== '-' &&
            /^[^=]*\[/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare positional '${arg}' contains array subscript — bash evaluates $(cmd) in subscripts`,
              nodeType: 'declaration_command',
            }
          }
          argv.push(arg)
          break
        }
        case 'variable_assignment': {
          const ev = walkVariableAssignment(child, commands, varScope)
          if ('kind' in ev) return ev
          
          applyVarToScope(varScope, ev)
          argv.push(`${ev.name}=${ev.value}`)
          break
        }
        case 'variable_name':
          
          argv.push(child.text)
          break
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type === 'variable_assignment') {
    
    
    
    
    
    
    
    const ev = walkVariableAssignment(node, commands, varScope)
    if ('kind' in ev) return ev
    
    applyVarToScope(varScope, ev)
    return null
  }

  if (node.type === 'for_statement') {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let loopVar: string | null = null
    let doGroup: Node | null = null
    for (const child of node.children) {
      if (!child) continue
      if (child.type === 'variable_name') {
        loopVar = child.text
      } else if (child.type === 'do_group') {
        doGroup = child
      } else if (
        child.type === 'for' ||
        child.type === 'in' ||
        child.type === 'select' ||
        child.type === ';'
      ) {
        continue 
      } else if (child.type === 'command_substitution') {
        
        const err = collectCommandSubstitution(child, commands, varScope)
        if (err) return err
      } else {
        
        
        
        
        
        const arg = walkArgument(child, commands, varScope)
        if (typeof arg !== 'string') return arg
      }
    }
    if (loopVar === null || doGroup === null) return tooComplex(node)
    
    
    
    if (loopVar === 'PS4' || loopVar === 'IFS') {
      return {
        kind: 'too-complex',
        reason: `${loopVar} as loop variable bypasses assignment validation`,
        nodeType: 'for_statement',
      }
    }
    
    
    
    
    varScope.set(loopVar, VAR_PLACEHOLDER)
    const bodyScope = new Map(varScope)
    for (const c of doGroup.children) {
      if (!c) continue
      if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
      const err = collectCommands(c, commands, bodyScope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'if_statement' || node.type === 'while_statement') {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let seenThen = false
    for (const child of node.children) {
      if (!child) continue
      if (
        child.type === 'if' ||
        child.type === 'fi' ||
        child.type === 'else' ||
        child.type === 'elif' ||
        child.type === 'while' ||
        child.type === 'until' ||
        child.type === ';'
      ) {
        continue
      }
      if (child.type === 'then') {
        seenThen = true
        continue
      }
      if (child.type === 'do_group') {
        
        
        
        const bodyScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
          const err = collectCommands(c, commands, bodyScope)
          if (err) return err
        }
        continue
      }
      if (child.type === 'elif_clause' || child.type === 'else_clause') {
        
        
        const branchScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (
            c.type === 'elif' ||
            c.type === 'else' ||
            c.type === 'then' ||
            c.type === ';'
          ) {
            continue
          }
          const err = collectCommands(c, commands, branchScope)
          if (err) return err
        }
        continue
      }
      
      
      
      
      const targetScope = seenThen ? new Map(varScope) : varScope
      const before = commands.length
      const err = collectCommands(child, commands, targetScope)
      if (err) return err
      
      
      
      if (!seenThen) {
        for (let i = before; i < commands.length; i++) {
          const c = commands[i]
          if (c?.argv[0] === 'read') {
            for (const a of c.argv.slice(1)) {
              
              if (!a.startsWith('-') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) {
                
                
                
                
                
                
                
                
                
                
                
                
                const existing = varScope.get(a)
                if (
                  existing !== undefined &&
                  !containsAnyPlaceholder(existing)
                ) {
                  return {
                    kind: 'too-complex',
                    reason: `'read ${a}' in condition may not execute (||/pipeline/subshell); cannot prove it overwrites tracked literal '${existing}'`,
                    nodeType: 'if_statement',
                  }
                }
                varScope.set(a, VAR_PLACEHOLDER)
              }
            }
          }
        }
      }
    }
    return null
  }

  if (node.type === 'subshell') {
    
    
    
    
    const innerScope = new Map(varScope)
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '(' || child.type === ')') continue
      const err = collectCommands(child, commands, innerScope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'test_command') {
    
    
    
    
    
    
    
    const argv: string[] = ['[[']
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '[[' || child.type === ']]') continue
      if (child.type === '[' || child.type === ']') continue
      
      
      
      const err = walkTestExpr(child, argv, commands, varScope)
      if (err) return err
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type === 'unset_command') {
    
    
    
    
    
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'unset':
          argv.push(child.text)
          break
        case 'variable_name':
          argv.push(child.text)
          
          
          
          varScope.delete(child.text)
          break
        case 'word': {
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          argv.push(arg)
          break
        }
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  return tooComplex(node)
}

function walkTestExpr(
  node: Node,
  argv: string[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  switch (node.type) {
    case 'unary_expression':
    case 'binary_expression':
    case 'negated_expression':
    case 'parenthesized_expression': {
      for (const c of node.children) {
        if (!c) continue
        const err = walkTestExpr(c, argv, innerCommands, varScope)
        if (err) return err
      }
      return null
    }
    case 'test_operator':
    case '!':
    case '(':
    case ')':
    case '&&':
    case '||':
    case '==':
    case '=':
    case '!=':
    case '<':
    case '>':
    case '=~':
      argv.push(node.text)
      return null
    case 'regex':
    case 'extglob_pattern':
      
      
      
      argv.push(node.text)
      return null
    default: {
      
      const arg = walkArgument(node, innerCommands, varScope)
      if (typeof arg !== 'string') return arg
      argv.push(arg)
      return null
    }
  }
}

function walkRedirectedStatement(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  const redirects: Redirect[] = []
  let innerCommand: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_redirect') {
      
      
      const r = walkFileRedirect(child, commands, varScope)
      if ('kind' in r) return r
      redirects.push(r)
    } else if (child.type === 'heredoc_redirect') {
      const r = walkHeredocRedirect(child)
      if (r) return r
    } else if (
      child.type === 'command' ||
      child.type === 'pipeline' ||
      child.type === 'list' ||
      child.type === 'negated_command' ||
      child.type === 'declaration_command' ||
      child.type === 'unset_command'
    ) {
      innerCommand = child
    } else {
      return tooComplex(child)
    }
  }

  if (!innerCommand) {
    
    
    commands.push({ argv: [], envVars: [], redirects, text: node.text })
    return null
  }

  const before = commands.length
  const err = collectCommands(innerCommand, commands, varScope)
  if (err) return err
  if (commands.length > before && redirects.length > 0) {
    const last = commands[commands.length - 1]
    if (last) last.redirects.push(...redirects)
  }
  return null
}

function walkFileRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): Redirect | ParseForSecurityResult {
  let op: Redirect['op'] | null = null
  let target: string | null = null
  let fd: number | undefined

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_descriptor') {
      fd = Number(child.text)
    } else if (child.type in REDIRECT_OPS) {
      op = REDIRECT_OPS[child.type] ?? null
    } else if (child.type === 'word' || child.type === 'number') {
      
      
      
      
      if (child.children.length > 0) return tooComplex(child)
      
      
      
      
      if (BRACE_EXPANSION_RE.test(child.text)) return tooComplex(child)
      
      
      
      
      target = child.text.replace(/\\(.)/g, '$1')
    } else if (child.type === 'raw_string') {
      target = stripRawString(child.text)
    } else if (child.type === 'string') {
      const s = walkString(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else if (child.type === 'concatenation') {
      
      
      
      const s = walkArgument(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else {
      return tooComplex(child)
    }
  }

  if (!op || target === null) {
    return {
      kind: 'too-complex',
      reason: 'Unrecognized redirect shape',
      nodeType: node.type,
    }
  }
  return { op, target, fd }
}

function walkHeredocRedirect(node: Node): ParseForSecurityResult | null {
  let startText: string | null = null
  let body: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'heredoc_start') startText = child.text
    else if (child.type === 'heredoc_body') body = child
    else if (
      child.type === '<<' ||
      child.type === '<<-' ||
      child.type === 'heredoc_end' ||
      child.type === 'file_descriptor'
    ) {
      
      
      
    } else {
      
      
      
      
      
      return tooComplex(child)
    }
  }

  const isQuoted =
    startText !== null &&
    ((startText.startsWith("'") && startText.endsWith("'")) ||
      (startText.startsWith('"') && startText.endsWith('"')) ||
      startText.startsWith('\\'))

  if (!isQuoted) {
    return {
      kind: 'too-complex',
      reason: 'Heredoc with unquoted delimiter undergoes shell expansion',
      nodeType: 'heredoc_redirect',
    }
  }

  if (body) {
    for (const child of body.children) {
      if (!child) continue
      if (child.type !== 'heredoc_content') {
        return tooComplex(child)
      }
    }
  }
  return null
}

function walkHerestringRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.type === '<<<') continue
    
    
    
    const content = walkArgument(child, innerCommands, varScope)
    if (typeof content !== 'string') return content
    
    
    
    if (NEWLINE_HASH_RE.test(content)) return tooComplex(child)
  }
  return null
}

function walkCommand(
  node: Node,
  extraRedirects: Redirect[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult {
  const argv: string[] = []
  const envVars: { name: string; value: string }[] = []
  const redirects: Redirect[] = [...extraRedirects]

  for (const child of node.children) {
    if (!child) continue

    switch (child.type) {
      case 'variable_assignment': {
        const ev = walkVariableAssignment(child, innerCommands, varScope)
        if ('kind' in ev) return ev
        
        
        
        
        envVars.push({ name: ev.name, value: ev.value })
        break
      }
      case 'command_name': {
        const arg = walkArgument(
          child.children[0] ?? child,
          innerCommands,
          varScope,
        )
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
      case 'word':
      case 'number':
      case 'raw_string':
      case 'string':
      case 'concatenation':
      case 'arithmetic_expansion': {
        const arg = walkArgument(child, innerCommands, varScope)
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
      
      
      
      
      
      
      
      case 'simple_expansion': {
        
        
        
        const v = resolveSimpleExpansion(child, varScope, false)
        if (typeof v !== 'string') return v
        argv.push(v)
        break
      }
      case 'file_redirect': {
        const r = walkFileRedirect(child, innerCommands, varScope)
        if ('kind' in r) return r
        redirects.push(r)
        break
      }
      case 'herestring_redirect': {
        
        
        const err = walkHerestringRedirect(child, innerCommands, varScope)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const text =
    /\$[A-Za-z_]/.test(node.text) || node.text.includes('\n')
      ? argv
          .map(a =>
            a === '' || /[;|&<>(){}*?[\]~#]/.test(a)
              ? `'${a.replace(/'/g, "'\\''")}'`
              : a,
          )
          .join(' ')
      : node.text
  return {
    kind: 'simple',
    commands: [{ argv, envVars, redirects, text }],
  }
}

function collectCommandSubstitution(
  csNode: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  
  
  
  const innerScope = new Map(varScope)
  
  for (const child of csNode.children) {
    if (!child) continue
    if (child.type === '$(' || child.type === '`' || child.type === ')') {
      continue
    }
    const err = collectCommands(child, innerCommands, innerScope)
    if (err) return err
  }
  return null
}

function walkArgument(
  node: Node | null,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): string | ParseForSecurityResult {
  if (!node) {
    return { kind: 'too-complex', reason: 'Null argument node' }
  }

  switch (node.type) {
    case 'word': {
      
      
      
      
      
      
      
      
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind: 'too-complex',
          reason: 'Word contains brace expansion syntax',
          nodeType: 'word',
        }
      }
      return node.text.replace(/\\(.)/g, '$1')
    }

    case 'number':
      
      
      
      
      
      
      if (node.children.length > 0) {
        return {
          kind: 'too-complex',
          reason: 'Number node contains expansion (NN# arithmetic base syntax)',
          nodeType: node.children[0]?.type,
        }
      }
      return node.text

    case 'raw_string':
      return stripRawString(node.text)

    case 'string':
      return walkString(node, innerCommands, varScope)

    case 'concatenation': {
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind: 'too-complex',
          reason: 'Brace expansion',
          nodeType: 'concatenation',
        }
      }
      let result = ''
      for (const child of node.children) {
        if (!child) continue
        const part = walkArgument(child, innerCommands, varScope)
        if (typeof part !== 'string') return part
        result += part
      }
      return result
    }

    case 'arithmetic_expansion': {
      const err = walkArithmetic(node)
      if (err) return err
      return node.text
    }

    case 'simple_expansion': {
      
      
      
      return resolveSimpleExpansion(node, varScope, false)
    }

    
    
    
    
    
    

    default:
      return tooComplex(node)
  }
}

function walkString(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): string | ParseForSecurityResult {
  let result = ''
  let cursor = -1
  
  
  
  
  
  
  
  
  
  let sawDynamicPlaceholder = false
  let sawLiteralContent = false
  for (const child of node.children) {
    if (!child) continue
    
    
    
    
    
    
    if (cursor !== -1 && child.startIndex > cursor && child.type !== '"') {
      result += '\n'.repeat(child.startIndex - cursor)
      sawLiteralContent = true
    }
    cursor = child.endIndex
    switch (child.type) {
      case '"':
        
        
        cursor = child.endIndex
        break
      case 'string_content':
        
        
        
        
        
        
        result += child.text.replace(/\\([$`"\\])/g, '$1')
        sawLiteralContent = true
        break
      case DOLLAR:
        
        
        result += DOLLAR
        sawLiteralContent = true
        break
      case 'command_substitution': {
        
        
        
        
        
        
        
        const heredocBody = extractSafeCatHeredoc(child)
        if (heredocBody === 'DANGEROUS') return tooComplex(child)
        if (heredocBody !== null) {
          
          
          
          
          
          
          
          
          
          
          
          
          const trimmed = heredocBody.replace(/\n+$/, '')
          if (trimmed.includes('\n')) {
            sawLiteralContent = true
            break
          }
          result += trimmed
          sawLiteralContent = true
          break
        }
        
        
        
        
        
        
        
        const err = collectCommandSubstitution(child, innerCommands, varScope)
        if (err) return err
        result += CMDSUB_PLACEHOLDER
        sawDynamicPlaceholder = true
        break
      }
      case 'simple_expansion': {
        
        const v = resolveSimpleExpansion(child, varScope, true)
        if (typeof v !== 'string') return v
        
        
        
        if (v === VAR_PLACEHOLDER) sawDynamicPlaceholder = true
        else sawLiteralContent = true
        result += v
        break
      }
      case 'arithmetic_expansion': {
        const err = walkArithmetic(child)
        if (err) return err
        result += child.text
        
        sawLiteralContent = true
        break
      }
      default:
        }) inside "..."
        return tooComplex(child)
    }
  }
  
  
  
  
  
  if (sawDynamicPlaceholder && !sawLiteralContent) {
    return tooComplex(node)
  }
  
  
  
  
  
  
  
  
  
  if (!sawLiteralContent && !sawDynamicPlaceholder && node.text.length > 2) {
    return tooComplex(node)
  }
  return result
}

const ARITH_LEAF_RE =
  /^(?:[0-9]+|0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[-+*/%^&|~!<>=?:(),]+|<<|>>|\*\*|&&|\|\||[<>=!]=|\$\(\(|\)\))$/

function walkArithmetic(node: Node): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.children.length === 0) {
      if (!ARITH_LEAF_RE.test(child.text)) {
        return {
          kind: 'too-complex',
          reason: `Arithmetic expansion references variable or non-literal: ${child.text}`,
          nodeType: 'arithmetic_expansion',
        }
      }
      continue
    }
    switch (child.type) {
      case 'binary_expression':
      case 'unary_expression':
      case 'ternary_expression':
      case 'parenthesized_expression': {
        const err = walkArithmetic(child)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }
  return null
}

function extractSafeCatHeredoc(subNode: Node): string | 'DANGEROUS' | null {
  
  let stmt: Node | null = null
  for (const child of subNode.children) {
    if (!child) continue
    if (child.type === '$(' || child.type === ')') continue
    if (child.type === 'redirected_statement' && stmt === null) {
      stmt = child
    } else {
      return null
    }
  }
  if (!stmt) return null

  
  let sawCat = false
  let body: string | null = null
  for (const child of stmt.children) {
    if (!child) continue
    if (child.type === 'command') {
      
      const cmdChildren = child.children.filter(c => c)
      if (cmdChildren.length !== 1) return null
      const nameNode = cmdChildren[0]
      if (nameNode?.type !== 'command_name' || nameNode.text !== 'cat') {
        return null
      }
      sawCat = true
    } else if (child.type === 'heredoc_redirect') {
      
      
      if (walkHeredocRedirect(child) !== null) return null
      for (const hc of child.children) {
        if (hc?.type === 'heredoc_body') body = hc.text
      }
    } else {
      return null
    }
  }

  if (!sawCat || body === null) return null
  
  
  
  
  
  
  
  
  if (PROC_ENVIRON_RE.test(body)) return 'DANGEROUS'
  
  
  if (/\bsystem\s*\(/.test(body)) return 'DANGEROUS'
  return body
}

function walkVariableAssignment(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): { name: string; value: string; isAppend: boolean } | ParseForSecurityResult {
  let name: string | null = null
  let value = ''
  let isAppend = false

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'variable_name') {
      name = child.text
    } else if (child.type === '=' || child.type === '+=') {
      
      
      
      isAppend = child.type === '+='
      continue
    } else if (child.type === 'command_substitution') {
      
      
      
      
      
      const err = collectCommandSubstitution(child, innerCommands, varScope)
      if (err) return err
      value = CMDSUB_PLACEHOLDER
    } else if (child.type === 'simple_expansion') {
      
      
      
      
      
      
      const v = resolveSimpleExpansion(child, varScope, true)
      if (typeof v !== 'string') return v
      
      
      value = v
    } else {
      const v = walkArgument(child, innerCommands, varScope)
      if (typeof v !== 'string') return v
      value = v
    }
  }

  if (name === null) {
    return {
      kind: 'too-complex',
      reason: 'Variable assignment without name',
      nodeType: 'variable_assignment',
    }
  }
  
  
  
  
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return {
      kind: 'too-complex',
      reason: `Invalid variable name (bash treats as command): ${name}`,
      nodeType: 'variable_assignment',
    }
  }
  
  
  
  
  if (name === 'IFS') {
    return {
      kind: 'too-complex',
      reason: 'IFS assignment changes word-splitting — cannot model statically',
      nodeType: 'variable_assignment',
    }
  }
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (name === 'PS4') {
    if (isAppend) {
      return {
        kind: 'too-complex',
        reason:
          'PS4 += cannot be statically verified — combine into a single PS4= assignment',
        nodeType: 'variable_assignment',
      }
    }
    if (containsAnyPlaceholder(value)) {
      return {
        kind: 'too-complex',
        reason: 'PS4 value derived from cmdsub/variable — runtime unknowable',
        nodeType: 'variable_assignment',
      }
    }
    if (
      !/^[A-Za-z0-9 _+:./=[\]-]*$/.test(
        value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''),
      )
    ) {
      return {
        kind: 'too-complex',
        reason:
          'PS4 value outside safe charset — only ${VAR} refs and [A-Za-z0-9 _+:.=/[]-] allowed',
        nodeType: 'variable_assignment',
      }
    }
  }
  
  
  
  
  
  
  
  if (value.includes('~')) {
    return {
      kind: 'too-complex',
      reason: 'Tilde in assignment value — bash may expand at assignment time',
      nodeType: 'variable_assignment',
    }
  }
  return { name, value, isAppend }
}

function resolveSimpleExpansion(
  node: Node,
  varScope: Map<string, string>,
  insideString: boolean,
): string | ParseForSecurityResult {
  let varName: string | null = null
  let isSpecial = false
  for (const c of node.children) {
    if (c?.type === 'variable_name') {
      varName = c.text
      break
    }
    if (c?.type === 'special_variable_name') {
      varName = c.text
      isSpecial = true
      break
    }
  }
  if (varName === null) return tooComplex(node)
  
  
  
  
  
  
  
  
  
  
  const trackedValue = varScope.get(varName)
  if (trackedValue !== undefined) {
    if (containsAnyPlaceholder(trackedValue)) {
      
      
      if (!insideString) return tooComplex(node)
      return VAR_PLACEHOLDER
    }
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    if (!insideString) {
      if (trackedValue === '') return tooComplex(node)
      if (BARE_VAR_UNSAFE_RE.test(trackedValue)) return tooComplex(node)
    }
    return trackedValue
  }
  
  
  
  if (insideString) {
    if (SAFE_ENV_VARS.has(varName)) return VAR_PLACEHOLDER
    if (
      isSpecial &&
      (SPECIAL_VAR_NAMES.has(varName) || /^[0-9]+$/.test(varName))
    ) {
      return VAR_PLACEHOLDER
    }
  }
  return tooComplex(node)
}

function applyVarToScope(
  varScope: Map<string, string>,
  ev: { name: string; value: string; isAppend: boolean },
): void {
  const existing = varScope.get(ev.name) ?? ''
  const combined = ev.isAppend ? existing + ev.value : ev.value
  varScope.set(
    ev.name,
    containsAnyPlaceholder(combined) ? VAR_PLACEHOLDER : combined,
  )
}

function stripRawString(text: string): string {
  return text.slice(1, -1)
}

function tooComplex(node: Node): ParseForSecurityResult {
  const reason =
    node.type === 'ERROR'
      ? 'Parse error'
      : DANGEROUS_TYPES.has(node.type)
        ? `Contains ${node.type}`
        : `Unhandled node type: ${node.type}`
  return { kind: 'too-complex', reason, nodeType: node.type }
}

const ZSH_DANGEROUS_BUILTINS = new Set([
  'zmodload',
  'emulate',
  'sysopen',
  'sysread',
  'syswrite',
  'sysseek',
  'zpty',
  'ztcp',
  'zsocket',
  'zf_rm',
  'zf_mv',
  'zf_ln',
  'zf_chmod',
  'zf_chown',
  'zf_mkdir',
  'zf_rmdir',
  'zf_chgrp',
])

const EVAL_LIKE_BUILTINS = new Set([
  'eval',
  'source',
  '.',
  'exec',
  'command',
  'builtin',
  'fc',
  
  
  
  'coproc',
  
  
  
  
  'noglob',
  'nocorrect',
  
  
  'trap',
  
  
  'enable',
  
  
  'mapfile',
  'readarray',
  
  
  'hash',
  
  
  
  
  'bind',
  'complete',
  'compgen',
  
  
  
  'alias',
  
  
  
  
  
  'let',
])

const SUBSCRIPT_EVAL_FLAGS: Record<string, Set<string>> = {
  test: new Set(['-v', '-R']),
  '[': new Set(['-v', '-R']),
  '[[': new Set(['-v', '-R']),
  printf: new Set(['-v']),
  read: new Set(['-a']),
  unset: new Set(['-v']),
  
  
  
  
  wait: new Set(['-p']),
}

const TEST_ARITH_CMP_OPS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge'])

const BARE_SUBSCRIPT_NAME_BUILTINS = new Set(['read', 'unset'])

const READ_DATA_FLAGS = new Set(['-p', '-d', '-n', '-N', '-t', '-u', '-i'])

const PROC_ENVIRON_RE = /\/proc\/.*\/environ/

const NEWLINE_HASH_RE = /\n[ \t]*#/

export type SemanticCheckResult = { ok: true } | { ok: false; reason: string }

export function checkSemantics(commands: SimpleCommand[]): SemanticCheckResult {
  for (const cmd of commands) {
    
    
    
    
    let a = cmd.argv
    for (;;) {
      if (a[0] === 'time' || a[0] === 'nohup') {
        a = a.slice(1)
      } else if (a[0] === 'timeout') {
        
        
        
        
        
        
        
        
        
        
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (
            arg === '--foreground' ||
            arg === '--preserve-status' ||
            arg === '--verbose'
          ) {
            i++ 
          } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ 
          } else if (
            (arg === '--kill-after' || arg === '--signal') &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 
          } else if (arg.startsWith('--')) {
            
            
            return {
              ok: false,
              reason: `timeout with ${arg} flag cannot be statically analyzed`,
            }
          } else if (arg === '-v') {
            i++ 
          } else if (
            (arg === '-k' || arg === '-s') &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 
          } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ 
          } else if (arg.startsWith('-')) {
            
            
            return {
              ok: false,
              reason: `timeout with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break 
          }
        }
        if (a[i] && /^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) {
          a = a.slice(i + 1)
        } else if (a[i]) {
          
          
          
          
          
          
          
          
          return {
            ok: false,
            reason: `timeout duration '${a[i]}' cannot be statically analyzed`,
          }
        } else {
          break 
        }
      } else if (a[0] === 'nice') {
        
        
        if (a[1] === '-n' && a[2] && /^-?\d+$/.test(a[2])) {
          a = a.slice(3)
        } else if (a[1] && /^-\d+$/.test(a[1])) {
          a = a.slice(2) 
        } else if (a[1] && /[$(`]/.test(a[1])) {
          
          
          
          
          
          return {
            ok: false,
            reason: `nice argument '${a[1]}' contains expansion — cannot statically determine wrapped command`,
          }
        } else {
          a = a.slice(1) 
        }
      } else if (a[0] === 'env') {
        
        
        
        
        
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (arg.includes('=') && !arg.startsWith('-')) {
            i++ 
          } else if (arg === '-i' || arg === '-0' || arg === '-v') {
            i++ 
          } else if (arg === '-u' && a[i + 1]) {
            i += 2 
          } else if (arg.startsWith('-')) {
            
            
            return {
              ok: false,
              reason: `env with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break 
          }
        }
        if (i < a.length) {
          a = a.slice(i)
        } else {
          break 
        }
      } else if (a[0] === 'stdbuf') {
        
        
        
        
        
        
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (STDBUF_SHORT_SEP_RE.test(arg) && a[i + 1]) {
            i += 2 
          } else if (STDBUF_SHORT_FUSED_RE.test(arg)) {
            i++ 
          } else if (STDBUF_LONG_RE.test(arg)) {
            i++ 
          } else if (arg.startsWith('-')) {
            
            
            
            return {
              ok: false,
              reason: `stdbuf with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break 
          }
        }
        if (i > 1 && i < a.length) {
          a = a.slice(i)
        } else {
          break 
        }
      } else {
        break
      }
    }
    const name = a[0]
    if (name === undefined) continue

    
    
    
    
    
    
    
    if (name === '') {
      return {
        ok: false,
        reason: 'Empty command name — argv[0] may not reflect what bash runs',
      }
    }

    
    
    
    
    if (name.includes(CMDSUB_PLACEHOLDER) || name.includes(VAR_PLACEHOLDER)) {
      return {
        ok: false,
        reason: 'Command name is runtime-determined (placeholder argv[0])',
      }
    }

    
    
    if (name.startsWith('-') || name.startsWith('|') || name.startsWith('&')) {
      return {
        ok: false,
        reason: 'Command appears to be an incomplete fragment',
      }
    }

    
    
    
    
    
    
    const dangerFlags = SUBSCRIPT_EVAL_FLAGS[name]
    if (dangerFlags !== undefined) {
      for (let i = 1; i < a.length; i++) {
        const arg = a[i]!
        
        if (dangerFlags.has(arg) && a[i + 1]?.includes('[')) {
          return {
            ok: false,
            reason: `'${name} ${arg}' operand contains array subscript — bash evaluates $(cmd) in subscripts`,
          }
        }
        
        
        
        if (
          arg.length > 2 &&
          arg[0] === '-' &&
          arg[1] !== '-' &&
          !arg.includes('[')
        ) {
          for (const flag of dangerFlags) {
            if (flag.length === 2 && arg.includes(flag[1]!)) {
              if (a[i + 1]?.includes('[')) {
                return {
                  ok: false,
                  reason: `'${name} ${flag}' (combined in '${arg}') operand contains array subscript — bash evaluates $(cmd) in subscripts`,
                }
              }
            }
          }
        }
        
        
        for (const flag of dangerFlags) {
          if (
            flag.length === 2 &&
            arg.startsWith(flag) &&
            arg.length > 2 &&
            arg.includes('[')
          ) {
            return {
              ok: false,
              reason: `'${name} ${flag}' (fused) operand contains array subscript — bash evaluates $(cmd) in subscripts`,
            }
          }
        }
      }
    }

    
    
    
    
    
    
    
    if (name === '[[') {
      
      
      for (let i = 2; i < a.length; i++) {
        if (!TEST_ARITH_CMP_OPS.has(a[i]!)) continue
        if (a[i - 1]?.includes('[') || a[i + 1]?.includes('[')) {
          return {
            ok: false,
            reason: `'[[ ... ${a[i]} ... ]]' operand contains array subscript — bash arithmetically evaluates $(cmd) in subscripts`,
          }
        }
      }
    }

    
    
    
    
    
    
    if (BARE_SUBSCRIPT_NAME_BUILTINS.has(name)) {
      let skipNext = false
      for (let i = 1; i < a.length; i++) {
        const arg = a[i]!
        if (skipNext) {
          skipNext = false
          continue
        }
        if (arg[0] === '-') {
          if (name === 'read') {
            if (READ_DATA_FLAGS.has(arg)) {
              skipNext = true
            } else if (arg.length > 2 && arg[1] !== '-') {
              
              
              
              
              
              
              for (let j = 1; j < arg.length; j++) {
                if (READ_DATA_FLAGS.has('-' + arg[j])) {
                  if (j === arg.length - 1) skipNext = true
                  break
                }
              }
            }
          }
          continue
        }
        if (arg.includes('[')) {
          return {
            ok: false,
            reason: `'${name}' positional NAME '${arg}' contains array subscript — bash evaluates $(cmd) in subscripts`,
          }
        }
      }
    }

    
    
    
    
    
    if (SHELL_KEYWORDS.has(name)) {
      return {
        ok: false,
        reason: `Shell keyword '${name}' as command name — tree-sitter mis-parse`,
      }
    }

    
    
    
    
    
    
    for (const arg of cmd.argv) {
      if (arg.includes('\n') && NEWLINE_HASH_RE.test(arg)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside a quoted argument can hide arguments from path validation',
        }
      }
    }
    for (const ev of cmd.envVars) {
      if (ev.value.includes('\n') && NEWLINE_HASH_RE.test(ev.value)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside an env var value can hide arguments from path validation',
        }
      }
    }
    for (const r of cmd.redirects) {
      if (r.target.includes('\n') && NEWLINE_HASH_RE.test(r.target)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside a redirect target can hide arguments from path validation',
        }
      }
    }

    
    
    
    
    
    
    if (name === 'jq') {
      for (const arg of a) {
        if (/\bsystem\s*\(/.test(arg)) {
          return {
            ok: false,
            reason:
              'jq command contains system() function which executes arbitrary commands',
          }
        }
      }
      if (
        a.some(arg =>
          /^(?:-[fL](?:$|[^A-Za-z])|--(?:from-file|rawfile|slurpfile|library-path)(?:$|=))/.test(
            arg,
          ),
        )
      ) {
        return {
          ok: false,
          reason:
            'jq command contains dangerous flags that could execute code or read arbitrary files',
        }
      }
    }

    if (ZSH_DANGEROUS_BUILTINS.has(name)) {
      return {
        ok: false,
        reason: `Zsh builtin '${name}' can bypass security checks`,
      }
    }

    if (EVAL_LIKE_BUILTINS.has(name)) {
      
      
      
      if (name === 'command' && (a[1] === '-v' || a[1] === '-V')) {
        
      } else if (
        name === 'fc' &&
        !a.slice(1).some(arg => /^-[^-]*[es]/.test(arg))
      ) {
        
        
        
        
        
      } else if (
        name === 'compgen' &&
        !a.slice(1).some(arg => /^-[^-]*[CFW]/.test(arg))
      ) {
        
        
        
        
        
      } else {
        return {
          ok: false,
          reason: `'${name}' evaluates arguments as shell code`,
        }
      }
    }

    
    
    
    for (const arg of cmd.argv) {
      if (arg.includes('/proc/') && PROC_ENVIRON_RE.test(arg)) {
        return {
          ok: false,
          reason: 'Accesses /proc

environ which may expose secrets',
        }
      }
    }
  }
  return { ok: true }
}
, 
   STR59654 , 
   STR59655 , 
   STR59656 , 
   STR59657 , 
])

const DANGEROUS_TYPES = new Set([
   STR59658 ,
   STR59659 ,
   STR59660 ,
   STR59661 ,
   STR59662 ,
   STR59663 ,
   STR59664 ,
   STR59665 ,
   STR59666 ,
   STR59667 ,
   STR59668 ,
   STR59669 ,
   STR59670 ,
   STR59671 ,
   STR59672 ,
   STR59673 ,
   STR59674 ,
   STR59675 ,
])

const DANGEROUS_TYPE_IDS = [...DANGEROUS_TYPES]
export function nodeTypeId(nodeType: string | undefined): number {
  if (!nodeType) return -2
  if (nodeType ===  STR59676 ) return -1
  const i = DANGEROUS_TYPE_IDS.indexOf(nodeType)
  return i >= 0 ? i + 1 : 0
}

const REDIRECT_OPS: Record<string, Redirect[ STR59677 ]> = {
   STR59678 :  STR59679 ,
   STR59680 :  STR59681 ,
   STR59682 :  STR59683 ,
   STR59684 :  STR59685 ,
   STR59686 :  STR59687 ,
   STR59688 :  STR59689 ,
   STR59690 :  STR59691 ,
   STR59692 :  STR59693 ,
   STR59694 :  STR59695 ,
}

const BRACE_EXPANSION_RE = /\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/

const UNICODE_WHITESPACE_RE =
  /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/

const BACKSLASH_WHITESPACE_RE = /\\[ \t]|[^ \t\n\\]\\\n/

const ZSH_TILDE_BRACKET_RE = /~\[/

const ZSH_EQUALS_EXPANSION_RE = /(?:^|[\s;&|])=[a-zA-Z_]/

const BRACE_WITH_QUOTE_RE = /\{[^}]*[ STR59696 { STR59697  STR59698 \ STR59699  STR59700  STR59701 \\ STR59702  STR59703  STR59704  STR59705 $NOW STR59706 FOO=bar STR59707 FOO=bar STR59708 remove
          
          
          
          if (
            (argv[0] ===  STR59709  ||
              argv[0] ===  STR59710  ||
              argv[0] ===  STR59711 ) &&
            /^-[a-zA-Z]*[niaA]/.test(arg)
          ) {
            return {
              kind:  STR59712 ,
              reason:  STR59713 ,
              nodeType:  STR59714 ,
            }
          }
          
          
          
          
          
          
          
          if (
            (argv[0] ===  STR59715  ||
              argv[0] ===  STR59716  ||
              argv[0] ===  STR59717 ) &&
            arg[0] !==  STR59718  &&
            /^[^=]*\[/.test(arg)
          ) {
            return {
              kind:  STR59719 ,
              reason:  STR59720 ,
              nodeType:  STR59721 ,
            }
          }
          argv.push(arg)
          break
        }
        case  STR59722 : {
          const ev = walkVariableAssignment(child, commands, varScope)
          if ( STR59723  in ev) return ev
          
          applyVarToScope(varScope, ev)
          argv.push( STR59724 )
          break
        }
        case  STR59725 :
          
          argv.push(child.text)
          break
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type ===  STR59726 ) {
    
    
    
    
    
    
    
    const ev = walkVariableAssignment(node, commands, varScope)
    if ( STR59727  in ev) return ev
    
    applyVarToScope(varScope, ev)
    return null
  }

  if (node.type ===  STR59728 ) {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let loopVar: string | null = null
    let doGroup: Node | null = null
    for (const child of node.children) {
      if (!child) continue
      if (child.type ===  STR59729 ) {
        loopVar = child.text
      } else if (child.type ===  STR59730 ) {
        doGroup = child
      } else if (
        child.type ===  STR59731  ||
        child.type ===  STR59732  ||
        child.type ===  STR59733  ||
        child.type ===  STR59734 
      ) {
        continue 
      } else if (child.type ===  STR59735 ) {
        
        const err = collectCommandSubstitution(child, commands, varScope)
        if (err) return err
      } else {
        
        
        
        
        
        const arg = walkArgument(child, commands, varScope)
        if (typeof arg !==  STR59736 ) return arg
      }
    }
    if (loopVar === null || doGroup === null) return tooComplex(node)
    
    
    
    if (loopVar ===  STR59737  || loopVar ===  STR59738 ) {
      return {
        kind:  STR59739 ,
        reason:  STR59740 ,
        nodeType:  STR59741 ,
      }
    }
    
    
    
    
    varScope.set(loopVar, VAR_PLACEHOLDER)
    const bodyScope = new Map(varScope)
    for (const c of doGroup.children) {
      if (!c) continue
      if (c.type ===  STR59742  || c.type ===  STR59743  || c.type ===  STR59744 ) continue
      const err = collectCommands(c, commands, bodyScope)
      if (err) return err
    }
    return null
  }

  if (node.type ===  STR59745  || node.type ===  STR59746 ) {
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    let seenThen = false
    for (const child of node.children) {
      if (!child) continue
      if (
        child.type ===  STR59747  ||
        child.type ===  STR59748  ||
        child.type ===  STR59749  ||
        child.type ===  STR59750  ||
        child.type ===  STR59751  ||
        child.type ===  STR59752  ||
        child.type ===  STR59753 
      ) {
        continue
      }
      if (child.type ===  STR59754 ) {
        seenThen = true
        continue
      }
      if (child.type ===  STR59755 ) {
        
        
        
        const bodyScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (c.type ===  STR59756  || c.type ===  STR59757  || c.type ===  STR59758 ) continue
          const err = collectCommands(c, commands, bodyScope)
          if (err) return err
        }
        continue
      }
      if (child.type ===  STR59759  || child.type ===  STR59760 ) {
        
        
        const branchScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (
            c.type ===  STR59761  ||
            c.type ===  STR59762  ||
            c.type ===  STR59763  ||
            c.type ===  STR59764 
          ) {
            continue
          }
          const err = collectCommands(c, commands, branchScope)
          if (err) return err
        }
        continue
      }
      
      
      
      
      const targetScope = seenThen ? new Map(varScope) : varScope
      const before = commands.length
      const err = collectCommands(child, commands, targetScope)
      if (err) return err
      
      
      
      if (!seenThen) {
        for (let i = before; i < commands.length; i++) {
          const c = commands[i]
          if (c?.argv[0] ===  STR59765 ) {
            for (const a of c.argv.slice(1)) {
              
              if (!a.startsWith( STR59766 ) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) {
                
                
                
                
                
                
                
                
                
                
                
                
                const existing = varScope.get(a)
                if (
                  existing !== undefined &&
                  !containsAnyPlaceholder(existing)
                ) {
                  return {
                    kind:  STR59767 ,
                    reason:  STR59768 ,
                    nodeType:  STR59769 ,
                  }
                }
                varScope.set(a, VAR_PLACEHOLDER)
              }
            }
          }
        }
      }
    }
    return null
  }

  if (node.type ===  STR59770 ) {
    
    
    
    
    const innerScope = new Map(varScope)
    for (const child of node.children) {
      if (!child) continue
      if (child.type ===  STR59771  || child.type ===  STR59772 ) continue
      const err = collectCommands(child, commands, innerScope)
      if (err) return err
    }
    return null
  }

  if (node.type ===  STR59773 ) {
    
    
    
    
    
    
    
    const argv: string[] = [ STR59774 ]
    for (const child of node.children) {
      if (!child) continue
      if (child.type ===  STR59775  || child.type ===  STR59776 ) continue
      if (child.type ===  STR59777  || child.type ===  STR59778 ) continue
      
      
      
      const err = walkTestExpr(child, argv, commands, varScope)
      if (err) return err
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type ===  STR59779 ) {
    
    
    
    
    
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case  STR59780 :
          argv.push(child.text)
          break
        case  STR59781 :
          argv.push(child.text)
          
          
          
          varScope.delete(child.text)
          break
        case  STR59782 : {
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !==  STR59783 ) return arg
          argv.push(arg)
          break
        }
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  return tooComplex(node)
}

function walkTestExpr(
  node: Node,
  argv: string[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  switch (node.type) {
    case  STR59784 :
    case  STR59785 :
    case  STR59786 :
    case  STR59787 : {
      for (const c of node.children) {
        if (!c) continue
        const err = walkTestExpr(c, argv, innerCommands, varScope)
        if (err) return err
      }
      return null
    }
    case  STR59788 :
    case  STR59789 :
    case  STR59790 :
    case  STR59791 :
    case  STR59792 :
    case  STR59793 :
    case  STR59794 :
    case  STR59795 :
    case  STR59796 :
    case  STR59797 :
    case  STR59798 :
    case  STR59799 :
      argv.push(node.text)
      return null
    case  STR59800 :
    case  STR59801 :
      
      
      
      argv.push(node.text)
      return null
    default: {
      
      const arg = walkArgument(node, innerCommands, varScope)
      if (typeof arg !==  STR59802 ) return arg
      argv.push(arg)
      return null
    }
  }
}

function walkRedirectedStatement(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  const redirects: Redirect[] = []
  let innerCommand: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type ===  STR59803 ) {
      
      
      const r = walkFileRedirect(child, commands, varScope)
      if ( STR59804  in r) return r
      redirects.push(r)
    } else if (child.type ===  STR59805 ) {
      const r = walkHeredocRedirect(child)
      if (r) return r
    } else if (
      child.type ===  STR59806  ||
      child.type ===  STR59807  ||
      child.type ===  STR59808  ||
      child.type ===  STR59809  ||
      child.type ===  STR59810  ||
      child.type ===  STR59811 
    ) {
      innerCommand = child
    } else {
      return tooComplex(child)
    }
  }

  if (!innerCommand) {
    
    
    commands.push({ argv: [], envVars: [], redirects, text: node.text })
    return null
  }

  const before = commands.length
  const err = collectCommands(innerCommand, commands, varScope)
  if (err) return err
  if (commands.length > before && redirects.length > 0) {
    const last = commands[commands.length - 1]
    if (last) last.redirects.push(...redirects)
  }
  return null
}

function walkFileRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): Redirect | ParseForSecurityResult {
  let op: Redirect[ STR59812 ] | null = null
  let target: string | null = null
  let fd: number | undefined

  for (const child of node.children) {
    if (!child) continue
    if (child.type ===  STR59813 ) {
      fd = Number(child.text)
    } else if (child.type in REDIRECT_OPS) {
      op = REDIRECT_OPS[child.type] ?? null
    } else if (child.type ===  STR59814  || child.type ===  STR59815 ) {
      
      
      
      
      if (child.children.length > 0) return tooComplex(child)
      
      
      
      
      if (BRACE_EXPANSION_RE.test(child.text)) return tooComplex(child)
      
      
      
      
      target = child.text.replace(/\\(.)/g,  STR59816 )
    } else if (child.type ===  STR59817 ) {
      target = stripRawString(child.text)
    } else if (child.type ===  STR59818 ) {
      const s = walkString(child, innerCommands, varScope)
      if (typeof s !==  STR59819 ) return s
      target = s
    } else if (child.type ===  STR59820 ) {
      
      
      
      const s = walkArgument(child, innerCommands, varScope)
      if (typeof s !==  STR59821 ) return s
      target = s
    } else {
      return tooComplex(child)
    }
  }

  if (!op || target === null) {
    return {
      kind:  STR59822 ,
      reason:  STR59823 ,
      nodeType: node.type,
    }
  }
  return { op, target, fd }
}

function walkHeredocRedirect(node: Node): ParseForSecurityResult | null {
  let startText: string | null = null
  let body: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type ===  STR59824 ) startText = child.text
    else if (child.type ===  STR59825 ) body = child
    else if (
      child.type ===  STR59826  ||
      child.type ===  STR59827  ||
      child.type ===  STR59828  ||
      child.type ===  STR59829 
    ) {
      
      
      
    } else {
      
      
      
      
      
      return tooComplex(child)
    }
  }

  const isQuoted =
    startText !== null &&
    ((startText.startsWith( STR59830 ) && startText.endsWith( STR59831 )) ||
      (startText.startsWith( STR59832 ) && startText.endsWith( STR59833 )) ||
      startText.startsWith( STR59834 ))

  if (!isQuoted) {
    return {
      kind:  STR59835 ,
      reason:  STR59836 ,
      nodeType:  STR59837 ,
    }
  }

  if (body) {
    for (const child of body.children) {
      if (!child) continue
      if (child.type !==  STR59838 ) {
        return tooComplex(child)
      }
    }
  }
  return null
}

function walkHerestringRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.type ===  STR59839 ) continue
    
    
    
    const content = walkArgument(child, innerCommands, varScope)
    if (typeof content !==  STR59840 ) return content
    
    
    
    if (NEWLINE_HASH_RE.test(content)) return tooComplex(child)
  }
  return null
}

function walkCommand(
  node: Node,
  extraRedirects: Redirect[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult {
  const argv: string[] = []
  const envVars: { name: string; value: string }[] = []
  const redirects: Redirect[] = [...extraRedirects]

  for (const child of node.children) {
    if (!child) continue

    switch (child.type) {
      case  STR59841 : {
        const ev = walkVariableAssignment(child, innerCommands, varScope)
        if ( STR59842  in ev) return ev
        
        
        
        
        envVars.push({ name: ev.name, value: ev.value })
        break
      }
      case  STR59843 : {
        const arg = walkArgument(
          child.children[0] ?? child,
          innerCommands,
          varScope,
        )
        if (typeof arg !==  STR59844 ) return arg
        argv.push(arg)
        break
      }
      case  STR59845 :
      case  STR59846 :
      case  STR59847 :
      case  STR59848 :
      case  STR59849 :
      case  STR59850 : {
        const arg = walkArgument(child, innerCommands, varScope)
        if (typeof arg !==  STR59851 ) return arg
        argv.push(arg)
        break
      }
      
      
      
      
      
      
      
      case  STR59852 : {
        
        
        
        const v = resolveSimpleExpansion(child, varScope, false)
        if (typeof v !==  STR59853 ) return v
        argv.push(v)
        break
      }
      case  STR59854 : {
        const r = walkFileRedirect(child, innerCommands, varScope)
        if ( STR59855  in r) return r
        redirects.push(r)
        break
      }
      case  STR59856 : {
        
        
        const err = walkHerestringRedirect(child, innerCommands, varScope)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const text =
    /\$[A-Za-z_]/.test(node.text) || node.text.includes( STR59857 )
      ? argv
          .map(a =>
            a ===  STR59858  || /[ STR59859  STR59860  STR59861  STR59862 echo $(git rev-parse HEAD) STR59863 echo $(git rev-parse HEAD) STR59864 git rev-parse HEAD STR59865  STR59866 ) STR59867 too-complex STR59868 Null argument node STR59869 word STR59870 s quote
      
      
      
      
      
      
      
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind:  STR59871 ,
          reason:  STR59872 ,
          nodeType:  STR59873 ,
        }
      }
      return node.text.replace(/\\(.)/g,  STR59874 )
    }

    case  STR59875 :
      
      
      
      
      
      
      if (node.children.length > 0) {
        return {
          kind:  STR59876 ,
          reason:  STR59877 ,
          nodeType: node.children[0]?.type,
        }
      }
      return node.text

    case  STR59878 :
      return stripRawString(node.text)

    case  STR59879 :
      return walkString(node, innerCommands, varScope)

    case  STR59880 : {
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind:  STR59881 ,
          reason:  STR59882 ,
          nodeType:  STR59883 ,
        }
      }
      let result =  STR59884 
      for (const child of node.children) {
        if (!child) continue
        const part = walkArgument(child, innerCommands, varScope)
        if (typeof part !==  STR59885 ) return part
        result += part
      }
      return result
    }

    case  STR59886 : {
      const err = walkArithmetic(node)
      if (err) return err
      return node.text
    }

    case  STR59887 : {
      
      
      
      return resolveSimpleExpansion(node, varScope, false)
    }

    
    
    
    
    
    

    default:
      return tooComplex(node)
  }
}

function walkString(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): string | ParseForSecurityResult {
  let result =  STR59888 
  let cursor = -1
  
  
  
  
  
  
  
  
  
  let sawDynamicPlaceholder = false
  let sawLiteralContent = false
  for (const child of node.children) {
    if (!child) continue
    
    
    
    
    
    
    if (cursor !== -1 && child.startIndex > cursor && child.type !==  STR59889 ) {
      result +=  STR59890 .repeat(child.startIndex - cursor)
      sawLiteralContent = true
    }
    cursor = child.endIndex
    switch (child.type) {
      case  STR59891 :
        
        
        cursor = child.endIndex
        break
      case  STR59892 :
        
        
        
        
        
        
        result += child.text.replace(/\\([$ STR59893 $(cat << STR59894  ... EOF) STR59895 $VAR STR59896  STR59897  STR59898  STR59899  STR59900  STR59901 cat STR59902 :/new STR59903 ...$VAR... STR59904 Home: $HOME STR59905 prefix$(cmd) STR59906 can we tokenize? STR59907 is the resulting argv dangerous in ways that don STR59908 re here (not in bashSecurity.ts) because they operate

const ZSH_DANGEROUS_BUILTINS = new Set([
   STR59909 ,
   STR59910 ,
   STR59911 ,
   STR59912 ,
   STR59913 ,
   STR59914 ,
   STR59915 ,
   STR59916 ,
   STR59917 ,
   STR59918 ,
   STR59919 ,
   STR59920 ,
   STR59921 ,
   STR59922 ,
   STR59923 ,
   STR59924 ,
   STR59925 ,
])

const EVAL_LIKE_BUILTINS = new Set([
   STR59926 ,
   STR59927 ,
   STR59928 ,
   STR59929 ,
   STR59930 ,
   STR59931 ,
   STR59932 ,
  
  
  
   STR59933 ,
  
  
  
  
   STR59934 ,
   STR59935 ,
  
  
   STR59936 ,
  
  
   STR59937 ,
  
  
   STR59938 ,
   STR59939 ,
  
  
   STR59940 ,
  
  
  
  
   STR59941 ,
   STR59942 ,
   STR59943 ,
  
  
  
   STR59944 ,
  
  
  
  
  
   STR59945 ,
])

const SUBSCRIPT_EVAL_FLAGS: Record<string, Set<string>> = {
  test: new Set([ STR59946 ,  STR59947 ]),
   STR59948 : new Set([ STR59949 ,  STR59950 ]),
   STR59951 : new Set([ STR59952 ,  STR59953 ]),
  printf: new Set([ STR59954 ]),
  read: new Set([ STR59955 ]),
  unset: new Set([ STR59956 ]),
  
  
  
  
  wait: new Set([ STR59957 ]),
}

const TEST_ARITH_CMP_OPS = new Set([ STR59958 ,  STR59959 ,  STR59960 ,  STR59961 ,  STR59962 ,  STR59963 ])

const BARE_SUBSCRIPT_NAME_BUILTINS = new Set([ STR59964 ,  STR59965 ])

const READ_DATA_FLAGS = new Set([ STR59966 ,  STR59967 ,  STR59968 ,  STR59969 ,  STR59970 ,  STR59971 ,  STR59972 ])

const PROC_ENVIRON_RE = /\/proc\/.*\/environ/

const NEWLINE_HASH_RE = /\n[ \t]*#/

export type SemanticCheckResult = { ok: true } | { ok: false; reason: string }

export function checkSemantics(commands: SimpleCommand[]): SemanticCheckResult {
  for (const cmd of commands) {
    
    
    
    
    let a = cmd.argv
    for (;;) {
      if (a[0] ===  STR59973  || a[0] ===  STR59974 ) {
        a = a.slice(1)
      } else if (a[0] ===  STR59975 ) {
        
        
        
        
        
        
        
        
        
        
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (
            arg ===  STR59976  ||
            arg ===  STR59977  ||
            arg ===  STR59978 
          ) {
            i++ 
          } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ 
          } else if (
            (arg ===  STR59979  || arg ===  STR59980 ) &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 
          } else if (arg.startsWith( STR59981 )) {
            
            
            return {
              ok: false,
              reason:  STR59982 ,
            }
          } else if (arg ===  STR59983 ) {
            i++ 
          } else if (
            (arg ===  STR59984  || arg ===  STR59985 ) &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 
          } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ 
          } else if (arg.startsWith( STR59986 )) {
            
            
            return {
              ok: false,
              reason:  STR59987 ,
            }
          } else {
            break 
          }
        }
        if (a[i] && /^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) {
          a = a.slice(i + 1)
        } else if (a[i]) {
          
          
          
          
          
          
          
          
          return {
            ok: false,
            reason:  STR59988 ,
          }
        } else {
          break 
        }
      } else if (a[0] ===  STR59989 ) {
        
        
        if (a[1] ===  STR59990  && a[2] && /^-?\d+$/.test(a[2])) {
          a = a.slice(3)
        } else if (a[1] && /^-\d+$/.test(a[1])) {
          a = a.slice(2) 
        } else if (a[1] && /[$( STR59991 nice $((0-5)) jq ... STR59992 nice argument  STR59993  contains expansion — cannot statically determine wrapped command STR59994 env [VAR=val...] [-i] [-0] [-v] [-u NAME...] cmd args STR59995 env with ${arg} flag cannot be statically analyzed STR59996 env STR59997 stdbuf -o0 cmd STR59998 stdbuf -o 0 cmd STR59999 stdbuf -o0 -eL cmd STR60000 --output=0 STR60001 stdbuf --output 0 eval STR60002 = STR60003 stdbuf with ${arg} flag cannot be statically analyzed STR60004 printf -v NAME STR60005 printf -vNAME STR60006 -v STR60007  STR60008  operand contains array subscript — bash evaluates $(cmd) in subscripts STR60009 -ra STR60010 -r -a STR60011  STR60012  (combined in  STR60013 ) operand contains array subscript — bash evaluates $(cmd) in subscripts STR60014 -vNAME STR60015  STR60016  (fused) operand contains array subscript — bash evaluates $(cmd) in subscripts STR60017 [[ ARG OP ARG ]] STR60018  STR60019  operand contains array subscript — bash arithmetically evaluates $(cmd) in subscripts STR60020 read STR60021 unset STR60022 -rp STR60023  STR60024  positional NAME  STR60025  contains array subscript — bash evaluates $(cmd) in subscripts STR60026 Shell keyword  STR60027  as command name — tree-sitter mis-parse STR60028  STR60029  STR60030 astSubcommands === null STR60031 Zsh builtin  STR60032  can bypass security checks STR60033 command -v foo STR60034 command -V foo STR60035 command foo STR60036 fc -l STR60037 fc -ln STR60038 fc -e ed STR60039 fc -s [pat=rep] STR60040 e STR60041 s STR60042 fc -l STR60043 compgen -c/-f/-v STR60044 compgen -C cmd STR60045 -F func STR60046 -W list STR60047  STR60048  evaluates arguments as shell code STR60049 cat /proc/self/environ STR60050 cat < /proc/self/environ STR60051 