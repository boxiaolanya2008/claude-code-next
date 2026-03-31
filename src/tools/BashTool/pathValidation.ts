import { homedir } from 'os'
import { isAbsolute, resolve } from 'path'
import type { z } from 'zod/v4'
import type { ToolPermissionContext } from '../../Tool.js'
import type { Redirect, SimpleCommand } from '../../utils/bash/ast.js'
import {
  extractOutputRedirections,
  splitCommand_DEPRECATED,
} from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { getDirectoryForPath } from '../../utils/path.js'
import { allWorkingDirectories } from '../../utils/permissions/filesystem.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import { createReadRuleSuggestion } from '../../utils/permissions/PermissionUpdate.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import {
  expandTilde,
  type FileOperationType,
  formatDirectoryList,
  isDangerousRemovalPath,
  validatePath,
} from '../../utils/permissions/pathValidation.js'
import type { BashTool } from './BashTool.js'
import { stripSafeWrappers } from './bashPermissions.js'
import { sedCommandIsAllowedByAllowlist } from './sedValidation.js'

export type PathCommand =
  | 'cd'
  | 'ls'
  | 'find'
  | 'mkdir'
  | 'touch'
  | 'rm'
  | 'rmdir'
  | 'mv'
  | 'cp'
  | 'cat'
  | 'head'
  | 'tail'
  | 'sort'
  | 'uniq'
  | 'wc'
  | 'cut'
  | 'paste'
  | 'column'
  | 'tr'
  | 'file'
  | 'stat'
  | 'diff'
  | 'awk'
  | 'strings'
  | 'hexdump'
  | 'od'
  | 'base64'
  | 'nl'
  | 'grep'
  | 'rg'
  | 'sed'
  | 'git'
  | 'jq'
  | 'sha256sum'
  | 'sha1sum'
  | 'md5sum'

function checkDangerousRemovalPaths(
  command: 'rm' | 'rmdir',
  args: string[],
  cwd: string,
): PermissionResult {
  
  const extractor = PATH_EXTRACTORS[command]
  const paths = extractor(args)

  for (const path of paths) {
    
    
    
    const cleanPath = expandTilde(path.replace(/^['"]|['"]$/g, ''))
    const absolutePath = isAbsolute(cleanPath)
      ? cleanPath
      : resolve(cwd, cleanPath)

    
    if (isDangerousRemovalPath(absolutePath)) {
      return {
        behavior: 'ask',
        message: `Dangerous ${command} operation detected: '${absolutePath}'\n\nThis command would remove a critical system directory. This requires explicit approval and cannot be auto-allowed by permission rules.`,
        decisionReason: {
          type: 'other',
          reason: `Dangerous ${command} operation on critical path: ${absolutePath}`,
        },
        
        suggestions: [],
      }
    }
  }

  
  return {
    behavior: 'passthrough',
    message: `No dangerous removals detected for ${command} command`,
  }
}

function filterOutFlags(args: string[]): string[] {
  const result: string[] = []
  let afterDoubleDash = false
  for (const arg of args) {
    if (afterDoubleDash) {
      result.push(arg)
    } else if (arg === '--') {
      afterDoubleDash = true
    } else if (!arg?.startsWith('-')) {
      result.push(arg)
    }
  }
  return result
}

function parsePatternCommand(
  args: string[],
  flagsWithArgs: Set<string>,
  defaults: string[] = [],
): string[] {
  const paths: string[] = []
  let patternFound = false
  
  
  let afterDoubleDash = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined || arg === null) continue

    if (!afterDoubleDash && arg === '--') {
      afterDoubleDash = true
      continue
    }

    if (!afterDoubleDash && arg.startsWith('-')) {
      const flag = arg.split('=')[0]
      
      if (flag && ['-e', '--regexp', '-f', '--file'].includes(flag)) {
        patternFound = true
      }
      
      if (flag && flagsWithArgs.has(flag) && !arg.includes('=')) {
        i++
      }
      continue
    }

    
    if (!patternFound) {
      patternFound = true
      continue
    }
    paths.push(arg)
  }

  return paths.length > 0 ? paths : defaults
}

export const PATH_EXTRACTORS: Record<
  PathCommand,
  (args: string[]) => string[]
> = {
  
  cd: args => (args.length === 0 ? [homedir()] : [args.join(' ')]),

  
  ls: args => {
    const paths = filterOutFlags(args)
    return paths.length > 0 ? paths : ['.']
  },

  
  
  
  
  
  
  
  
  find: args => {
    const paths: string[] = []
    const pathFlags = new Set([
      '-newer',
      '-anewer',
      '-cnewer',
      '-mnewer',
      '-samefile',
      '-path',
      '-wholename',
      '-ilname',
      '-lname',
      '-ipath',
      '-iwholename',
    ])
    const newerPattern = /^-newer[acmBt][acmtB]$/
    let foundNonGlobalFlag = false
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (!arg) continue

      if (afterDoubleDash) {
        paths.push(arg)
        continue
      }

      if (arg === '--') {
        afterDoubleDash = true
        continue
      }

      
      if (arg.startsWith('-')) {
        
        if (['-H', '-L', '-P'].includes(arg)) continue

        
        foundNonGlobalFlag = true

        
        if (pathFlags.has(arg) || newerPattern.test(arg)) {
          const nextArg = args[i + 1]
          if (nextArg) {
            paths.push(nextArg)
            i++ 
          }
        }
        continue
      }

      
      if (!foundNonGlobalFlag) {
        paths.push(arg)
      }
    }
    return paths.length > 0 ? paths : ['.']
  },

  
  mkdir: filterOutFlags,
  touch: filterOutFlags,
  rm: filterOutFlags,
  rmdir: filterOutFlags,
  mv: filterOutFlags,
  cp: filterOutFlags,
  cat: filterOutFlags,
  head: filterOutFlags,
  tail: filterOutFlags,
  sort: filterOutFlags,
  uniq: filterOutFlags,
  wc: filterOutFlags,
  cut: filterOutFlags,
  paste: filterOutFlags,
  column: filterOutFlags,
  file: filterOutFlags,
  stat: filterOutFlags,
  diff: filterOutFlags,
  awk: filterOutFlags,
  strings: filterOutFlags,
  hexdump: filterOutFlags,
  od: filterOutFlags,
  base64: filterOutFlags,
  nl: filterOutFlags,
  sha256sum: filterOutFlags,
  sha1sum: filterOutFlags,
  md5sum: filterOutFlags,

  
  tr: args => {
    const hasDelete = args.some(
      a =>
        a === '-d' ||
        a === '--delete' ||
        (a.startsWith('-') && a.includes('d')),
    )
    const nonFlags = filterOutFlags(args)
    return nonFlags.slice(hasDelete ? 1 : 2) 
  },

  
  grep: args => {
    const flags = new Set([
      '-e',
      '--regexp',
      '-f',
      '--file',
      '--exclude',
      '--include',
      '--exclude-dir',
      '--include-dir',
      '-m',
      '--max-count',
      '-A',
      '--after-context',
      '-B',
      '--before-context',
      '-C',
      '--context',
    ])
    const paths = parsePatternCommand(args, flags)
    
    if (
      paths.length === 0 &&
      args.some(a => ['-r', '-R', '--recursive'].includes(a))
    ) {
      return ['.']
    }
    return paths
  },

  
  rg: args => {
    const flags = new Set([
      '-e',
      '--regexp',
      '-f',
      '--file',
      '-t',
      '--type',
      '-T',
      '--type-not',
      '-g',
      '--glob',
      '-m',
      '--max-count',
      '--max-depth',
      '-r',
      '--replace',
      '-A',
      '--after-context',
      '-B',
      '--before-context',
      '-C',
      '--context',
    ])
    return parsePatternCommand(args, flags, ['.'])
  },

  
  sed: args => {
    const paths: string[] = []
    let skipNext = false
    let scriptFound = false
    
    
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      if (skipNext) {
        skipNext = false
        continue
      }

      const arg = args[i]
      if (!arg) continue

      if (!afterDoubleDash && arg === '--') {
        afterDoubleDash = true
        continue
      }

      
      if (!afterDoubleDash && arg.startsWith('-')) {
        
        if (['-f', '--file'].includes(arg)) {
          const scriptFile = args[i + 1]
          if (scriptFile) {
            paths.push(scriptFile) 
            skipNext = true
          }
          scriptFound = true
        }
        
        else if (['-e', '--expression'].includes(arg)) {
          skipNext = true
          scriptFound = true
        }
        
        else if (arg.includes('e') || arg.includes('f')) {
          scriptFound = true
        }
        continue
      }

      
      if (!scriptFound) {
        scriptFound = true
        continue
      }

      
      paths.push(arg)
    }

    return paths
  },

  
  
  
  jq: args => {
    const paths: string[] = []
    const flagsWithArgs = new Set([
      '-e',
      '--expression',
      '-f',
      '--from-file',
      '--arg',
      '--argjson',
      '--slurpfile',
      '--rawfile',
      '--args',
      '--jsonargs',
      '-L',
      '--library-path',
      '--indent',
      '--tab',
    ])
    let filterFound = false
    
    
    let afterDoubleDash = false

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === undefined || arg === null) continue

      if (!afterDoubleDash && arg === '--') {
        afterDoubleDash = true
        continue
      }

      if (!afterDoubleDash && arg.startsWith('-')) {
        const flag = arg.split('=')[0]
        
        if (flag && ['-e', '--expression'].includes(flag)) {
          filterFound = true
        }
        
        if (flag && flagsWithArgs.has(flag) && !arg.includes('=')) {
          i++
        }
        continue
      }

      
      if (!filterFound) {
        filterFound = true
        continue
      }
      paths.push(arg)
    }

    
    return paths
  },

  
  git: args => {
    
    
    
    if (args.length >= 1 && args[0] === 'diff') {
      if (args.includes('--no-index')) {
        
        
        
        const filePaths = filterOutFlags(args.slice(1))
        return filePaths.slice(0, 2) 
      }
    }
    
    
    
    return []
  },
}

const SUPPORTED_PATH_COMMANDS = Object.keys(PATH_EXTRACTORS) as PathCommand[]

const ACTION_VERBS: Record<PathCommand, string> = {
  cd: 'change directories to',
  ls: 'list files in',
  find: 'search files in',
  mkdir: 'create directories in',
  touch: 'create or modify files in',
  rm: 'remove files from',
  rmdir: 'remove directories from',
  mv: 'move files to/from',
  cp: 'copy files to/from',
  cat: 'concatenate files from',
  head: 'read the beginning of files from',
  tail: 'read the end of files from',
  sort: 'sort contents of files from',
  uniq: 'filter duplicate lines from files in',
  wc: 'count lines/words/bytes in files from',
  cut: 'extract columns from files in',
  paste: 'merge files from',
  column: 'format files from',
  tr: 'transform text from files in',
  file: 'examine file types in',
  stat: 'read file stats from',
  diff: 'compare files from',
  awk: 'process text from files in',
  strings: 'extract strings from files in',
  hexdump: 'display hex dump of files from',
  od: 'display octal dump of files from',
  base64: 'encode/decode files from',
  nl: 'number lines in files from',
  grep: 'search for patterns in files from',
  rg: 'search for patterns in files from',
  sed: 'edit files in',
  git: 'access files with git from',
  jq: 'process JSON from files in',
  sha256sum: 'compute SHA-256 checksums for files in',
  sha1sum: 'compute SHA-1 checksums for files in',
  md5sum: 'compute MD5 checksums for files in',
}

export const COMMAND_OPERATION_TYPE: Record<PathCommand, FileOperationType> = {
  cd: 'read',
  ls: 'read',
  find: 'read',
  mkdir: 'create',
  touch: 'create',
  rm: 'write',
  rmdir: 'write',
  mv: 'write',
  cp: 'write',
  cat: 'read',
  head: 'read',
  tail: 'read',
  sort: 'read',
  uniq: 'read',
  wc: 'read',
  cut: 'read',
  paste: 'read',
  column: 'read',
  tr: 'read',
  file: 'read',
  stat: 'read',
  diff: 'read',
  awk: 'read',
  strings: 'read',
  hexdump: 'read',
  od: 'read',
  base64: 'read',
  nl: 'read',
  grep: 'read',
  rg: 'read',
  sed: 'write',
  git: 'read',
  jq: 'read',
  sha256sum: 'read',
  sha1sum: 'read',
  md5sum: 'read',
}

const COMMAND_VALIDATOR: Partial<
  Record<PathCommand, (args: string[]) => boolean>
> = {
  mv: (args: string[]) => !args.some(arg => arg?.startsWith('-')),
  cp: (args: string[]) => !args.some(arg => arg?.startsWith('-')),
}

function validateCommandPaths(
  command: PathCommand,
  args: string[],
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
  operationTypeOverride?: FileOperationType,
): PermissionResult {
  const extractor = PATH_EXTRACTORS[command]
  const paths = extractor(args)
  const operationType = operationTypeOverride ?? COMMAND_OPERATION_TYPE[command]

  
  
  
  const validator = COMMAND_VALIDATOR[command]
  if (validator && !validator(args)) {
    return {
      behavior: 'ask',
      message: `${command} with flags requires manual approval to ensure path safety. For security, Claude Code Next cannot automatically validate ${command} commands that use flags, as some flags like --target-directory=PATH can bypass path validation.`,
      decisionReason: {
        type: 'other',
        reason: `${command} command with flags requires manual approval`,
      },
    }
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (compoundCommandHasCd && operationType !== 'read') {
    return {
      behavior: 'ask',
      message: `Commands that change directories and perform write operations require explicit approval to ensure paths are evaluated correctly. For security, Claude Code Next cannot automatically determine the final working directory when 'cd' is used in compound commands.`,
      decisionReason: {
        type: 'other',
        reason:
          'Compound command contains cd with write operation - manual approval required to prevent path resolution bypass',
      },
    }
  }

  for (const path of paths) {
    const { allowed, resolvedPath, decisionReason } = validatePath(
      path,
      cwd,
      toolPermissionContext,
      operationType,
    )

    if (!allowed) {
      const workingDirs = Array.from(
        allWorkingDirectories(toolPermissionContext),
      )
      const dirListStr = formatDirectoryList(workingDirs)

      
      
      const message =
        decisionReason?.type === 'other' ||
        decisionReason?.type === 'safetyCheck'
          ? decisionReason.reason
          : `${command} in '${resolvedPath}' was blocked. For security, Claude Code Next may only ${ACTION_VERBS[command]} the allowed working directories for this session: ${dirListStr}.`

      if (decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason,
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: resolvedPath,
        decisionReason,
      }
    }
  }

  
  return {
    behavior: 'passthrough',
    message: `Path validation passed for ${command} command`,
  }
}

export function createPathChecker(
  command: PathCommand,
  operationTypeOverride?: FileOperationType,
) {
  return (
    args: string[],
    cwd: string,
    context: ToolPermissionContext,
    compoundCommandHasCd?: boolean,
  ): PermissionResult => {
    
    const result = validateCommandPaths(
      command,
      args,
      cwd,
      context,
      compoundCommandHasCd,
      operationTypeOverride,
    )

    
    if (result.behavior === 'deny') {
      return result
    }

    
    
    
    
    if (command === 'rm' || command === 'rmdir') {
      const dangerousPathResult = checkDangerousRemovalPaths(command, args, cwd)
      if (dangerousPathResult.behavior !== 'passthrough') {
        return dangerousPathResult
      }
    }

    
    if (result.behavior === 'passthrough') {
      return result
    }

    
    if (result.behavior === 'ask') {
      const operationType =
        operationTypeOverride ?? COMMAND_OPERATION_TYPE[command]
      const suggestions: PermissionUpdate[] = []

      
      if (result.blockedPath) {
        if (operationType === 'read') {
          
          const dirPath = getDirectoryForPath(result.blockedPath)
          const suggestion = createReadRuleSuggestion(dirPath, 'session')
          if (suggestion) {
            suggestions.push(suggestion)
          }
        } else {
          
          suggestions.push({
            type: 'addDirectories',
            directories: [getDirectoryForPath(result.blockedPath)],
            destination: 'session',
          })
        }
      }

      
      if (operationType === 'write' || operationType === 'create') {
        suggestions.push({
          type: 'setMode',
          mode: 'acceptEdits',
          destination: 'session',
        })
      }

      result.suggestions = suggestions
    }

    
    return result
  }
}

function parseCommandArguments(cmd: string): string[] {
  const parseResult = tryParseShellCommand(cmd, env => `${env}`)
  if (!parseResult.success) {
    
    return []
  }
  const parsed = parseResult.tokens
  const extractedArgs: string[] = []

  for (const arg of parsed) {
    if (typeof arg === 'string') {
      
      extractedArgs.push(arg)
    } else if (
      typeof arg === 'object' &&
      arg !== null &&
      'op' in arg &&
      arg.op === 'glob' &&
      'pattern' in arg
    ) {
      
      extractedArgs.push(String(arg.pattern))
    }
  }

  return extractedArgs
}

function validateSinglePathCommand(
  cmd: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  
  
  
  
  
  const strippedCmd = stripSafeWrappers(cmd)

  
  const extractedArgs = parseCommandArguments(strippedCmd)
  if (extractedArgs.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'Empty command - no paths to validate',
    }
  }

  
  const [baseCmd, ...args] = extractedArgs
  if (!baseCmd || !SUPPORTED_PATH_COMMANDS.includes(baseCmd as PathCommand)) {
    return {
      behavior: 'passthrough',
      message: `Command '${baseCmd}' is not a path-restricted command`,
    }
  }

  
  
  
  
  const operationTypeOverride =
    baseCmd === 'sed' && sedCommandIsAllowedByAllowlist(strippedCmd)
      ? ('read' as FileOperationType)
      : undefined

  
  const pathChecker = createPathChecker(
    baseCmd as PathCommand,
    operationTypeOverride,
  )
  return pathChecker(args, cwd, toolPermissionContext, compoundCommandHasCd)
}

function validateSinglePathCommandArgv(
  cmd: SimpleCommand,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  const argv = stripWrappersFromArgv(cmd.argv)
  if (argv.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'Empty command - no paths to validate',
    }
  }
  const [baseCmd, ...args] = argv
  if (!baseCmd || !SUPPORTED_PATH_COMMANDS.includes(baseCmd as PathCommand)) {
    return {
      behavior: 'passthrough',
      message: `Command '${baseCmd}' is not a path-restricted command`,
    }
  }
  
  
  
  
  const operationTypeOverride =
    baseCmd === 'sed' &&
    sedCommandIsAllowedByAllowlist(stripSafeWrappers(cmd.text))
      ? ('read' as FileOperationType)
      : undefined
  const pathChecker = createPathChecker(
    baseCmd as PathCommand,
    operationTypeOverride,
  )
  return pathChecker(args, cwd, toolPermissionContext, compoundCommandHasCd)
}

function validateOutputRedirections(
  redirections: Array<{ target: string; operator: '>' | '>>' }>,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
): PermissionResult {
  
  
  
  
  
  if (compoundCommandHasCd && redirections.length > 0) {
    return {
      behavior: 'ask',
      message: `Commands that change directories and write via output redirection require explicit approval to ensure paths are evaluated correctly. For security, Claude Code Next cannot automatically determine the final working directory when 'cd' is used in compound commands.`,
      decisionReason: {
        type: 'other',
        reason:
          'Compound command contains cd with output redirection - manual approval required to prevent path resolution bypass',
      },
    }
  }
  for (const { target } of redirections) {
    
    if (target === '/dev/null') {
      continue
    }
    const { allowed, resolvedPath, decisionReason } = validatePath(
      target,
      cwd,
      toolPermissionContext,
      'create', 
    )

    if (!allowed) {
      const workingDirs = Array.from(
        allWorkingDirectories(toolPermissionContext),
      )
      const dirListStr = formatDirectoryList(workingDirs)

      
      
      const message =
        decisionReason?.type === 'other' ||
        decisionReason?.type === 'safetyCheck'
          ? decisionReason.reason
          : decisionReason?.type === 'rule'
            ? `Output redirection to '${resolvedPath}' was blocked by a deny rule.`
            : `Output redirection to '${resolvedPath}' was blocked. For security, Claude Code Next may only write to files in the allowed working directories for this session: ${dirListStr}.`

      
      if (decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason,
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: resolvedPath,
        decisionReason,
        suggestions: [
          {
            type: 'addDirectories',
            directories: [getDirectoryForPath(resolvedPath)],
            destination: 'session',
          },
        ],
      }
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No unsafe redirections found',
  }
}

export function checkPathConstraints(
  input: z.infer<typeof BashTool.inputSchema>,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
  astRedirects?: Redirect[],
  astCommands?: SimpleCommand[],
): PermissionResult {
  
  
  
  
  
  
  
  if (!astCommands && />>\s*>\s*\(|>\s*>\s*\(|<\s*\(/.test(input.command)) {
    return {
      behavior: 'ask',
      message:
        'Process substitution (>(...) or <(...)) can execute arbitrary commands and requires manual approval',
      decisionReason: {
        type: 'other',
        reason: 'Process substitution requires manual approval',
      },
    }
  }

  
  
  
  
  
  
  const { redirections, hasDangerousRedirection } = astRedirects
    ? astRedirectsToOutputRedirections(astRedirects)
    : extractOutputRedirections(input.command)

  
  
  if (hasDangerousRedirection) {
    return {
      behavior: 'ask',
      message: 'Shell expansion syntax in paths requires manual approval',
      decisionReason: {
        type: 'other',
        reason: 'Shell expansion syntax in paths requires manual approval',
      },
    }
  }
  const redirectionResult = validateOutputRedirections(
    redirections,
    cwd,
    toolPermissionContext,
    compoundCommandHasCd,
  )
  if (redirectionResult.behavior !== 'passthrough') {
    return redirectionResult
  }

  
  
  
  
  
  if (astCommands) {
    for (const cmd of astCommands) {
      const result = validateSinglePathCommandArgv(
        cmd,
        cwd,
        toolPermissionContext,
        compoundCommandHasCd,
      )
      if (result.behavior === 'ask' || result.behavior === 'deny') {
        return result
      }
    }
  } else {
    const commands = splitCommand_DEPRECATED(input.command)
    for (const cmd of commands) {
      const result = validateSinglePathCommand(
        cmd,
        cwd,
        toolPermissionContext,
        compoundCommandHasCd,
      )
      if (result.behavior === 'ask' || result.behavior === 'deny') {
        return result
      }
    }
  }

  
  return {
    behavior: 'passthrough',
    message: 'All path commands validated successfully',
  }
}

function astRedirectsToOutputRedirections(redirects: Redirect[]): {
  redirections: Array<{ target: string; operator: '>' | '>>' }>
  hasDangerousRedirection: boolean
} {
  const redirections: Array<{ target: string; operator: '>' | '>>' }> = []
  for (const r of redirects) {
    switch (r.op) {
      case '>':
      case '>|':
      case '&>':
        redirections.push({ target: r.target, operator: '>' })
        break
      case '>>':
      case '&>>':
        redirections.push({ target: r.target, operator: '>>' })
        break
      case '>&':
        
        
        if (!/^\d+$/.test(r.target)) {
          redirections.push({ target: r.target, operator: '>' })
        }
        break
      case '<':
      case '<<':
      case '<&':
      case '<<<':
        
        break
    }
  }
  
  
  return { redirections, hasDangerousRedirection: false }
}

const TIMEOUT_FLAG_VALUE_RE = /^[A-Za-z0-9_.+-]+$/

function skipTimeoutFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    const next = a[i + 1]
    if (
      arg === '--foreground' ||
      arg === '--preserve-status' ||
      arg === '--verbose'
    )
      i++
    else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (
      (arg === '--kill-after' || arg === '--signal') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (arg === '--') {
      i++
      break
    } 
    else if (arg.startsWith('--')) return -1
    else if (arg === '-v') i++
    else if (
      (arg === '-k' || arg === '-s') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (arg.startsWith('-')) return -1
    else break
  }
  return i
}

function skipStdbufFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    if (/^-[ioe]$/.test(arg) && a[i + 1]) i += 2
    else if (/^-[ioe]./.test(arg)) i++
    else if (/^--(input|output|error)=/.test(arg)) i++
    else if (arg.startsWith('-'))
      return -1 
    else break
  }
  return i > 1 && i < a.length ? i : -1
}

function skipEnvFlags(a: readonly string[]): number {
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    if (arg.includes('=') && !arg.startsWith('-')) i++
    else if (arg === '-i' || arg === '-0' || arg === '-v') i++
    else if (arg === '-u' && a[i + 1]) i += 2
    else if (arg.startsWith('-'))
      return -1 
    else break
  }
  return i < a.length ? i : -1
}

export function stripWrappersFromArgv(argv: string[]): string[] {
  let a = argv
  for (;;) {
    if (a[0] === 'time' || a[0] === 'nohup') {
      a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'timeout') {
      const i = skipTimeoutFlags(a)
      
      
      
      
      if (i < 0 || !a[i] || !/^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) return a
      a = a.slice(i + 1)
    } else if (a[0] === 'nice') {
      
      
      
      
      if (a[1] === '-n' && a[2] && /^-?\d+$/.test(a[2]))
        a = a.slice(a[3] === '--' ? 4 : 3)
      else if (a[1] && /^-\d+$/.test(a[1])) a = a.slice(a[2] === '--' ? 3 : 2)
      else a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'stdbuf') {
      
      
      
      
      
      const i = skipStdbufFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else if (a[0] === 'env') {
      
      const i = skipEnvFlags(a)
      if (i < 0) return a
      a = a.slice(i)
    } else {
      return a
    }
  }
}
