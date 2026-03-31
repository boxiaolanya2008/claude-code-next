

import type {
  ParsedCommandElement,
  ParsedPowerShellCommand,
} from '../../utils/powershell/parser.js'

type ParsedStatement = ParsedPowerShellCommand['statements'][number]

import { getPlatform } from '../../utils/platform.js'
import {
  COMMON_ALIASES,
  deriveSecurityFlags,
  getPipelineSegments,
  isNullRedirectionTarget,
  isPowerShellParameter,
} from '../../utils/powershell/parser.js'
import type { ExternalCommandConfig } from '../../utils/shell/readOnlyCommandValidation.js'
import {
  DOCKER_READ_ONLY_COMMANDS,
  EXTERNAL_READONLY_COMMANDS,
  GH_READ_ONLY_COMMANDS,
  GIT_READ_ONLY_COMMANDS,
  validateFlags,
} from '../../utils/shell/readOnlyCommandValidation.js'
import { COMMON_PARAMETERS } from './commonParameters.js'

const DOTNET_READ_ONLY_FLAGS = new Set([
  '--version',
  '--info',
  '--list-runtimes',
  '--list-sdks',
])

type CommandConfig = {
  
  safeFlags?: string[]
  

  allowAllFlags?: boolean
  
  regex?: RegExp
  
  additionalCommandIsDangerousCallback?: (
    command: string,
    element?: ParsedCommandElement,
  ) => boolean
}

export function argLeaksValue(
  _cmd: string,
  element?: ParsedCommandElement,
): boolean {
  const argTypes = (element?.elementTypes ?? []).slice(1)
  const args = element?.args ?? []
  const children = element?.children
  for (let i = 0; i < argTypes.length; i++) {
    if (argTypes[i] !== 'StringConstant' && argTypes[i] !== 'Parameter') {
      
      
      
      
      
      
      if (!/[$(@{[]/.test(args[i] ?? '')) {
        continue
      }
      return true
    }
    if (argTypes[i] === 'Parameter') {
      const paramChildren = children?.[i]
      if (paramChildren) {
        if (paramChildren.some(c => c.type !== 'StringConstant')) {
          return true
        }
      } else {
        
        
        
        const arg = args[i] ?? ''
        const colonIdx = arg.indexOf(':')
        if (colonIdx > 0 && /[$(@{[]/.test(arg.slice(colonIdx + 1))) {
          return true
        }
      }
    }
  }
  return false
}

export const CMDLET_ALLOWLIST: Record<string, CommandConfig> = Object.assign(
  Object.create(null) as Record<string, CommandConfig>,
  {
    
    
    
    'get-childitem': {
      safeFlags: [
        '-Path',
        '-LiteralPath',
        '-Filter',
        '-Include',
        '-Exclude',
        '-Recurse',
        '-Depth',
        '-Name',
        '-Force',
        '-Attributes',
        '-Directory',
        '-File',
        '-Hidden',
        '-ReadOnly',
        '-System',
      ],
    },
    'get-content': {
      safeFlags: [
        '-Path',
        '-LiteralPath',
        '-TotalCount',
        '-Head',
        '-Tail',
        '-Raw',
        '-Encoding',
        '-Delimiter',
        '-ReadCount',
      ],
    },
    'get-item': {
      safeFlags: ['-Path', '-LiteralPath', '-Force', '-Stream'],
    },
    'get-itemproperty': {
      safeFlags: ['-Path', '-LiteralPath', '-Name'],
    },
    'test-path': {
      safeFlags: [
        '-Path',
        '-LiteralPath',
        '-PathType',
        '-Filter',
        '-Include',
        '-Exclude',
        '-IsValid',
        '-NewerThan',
        '-OlderThan',
      ],
    },
    'resolve-path': {
      safeFlags: ['-Path', '-LiteralPath', '-Relative'],
    },
    'get-filehash': {
      safeFlags: ['-Path', '-LiteralPath', '-Algorithm', '-InputStream'],
    },
    'get-acl': {
      safeFlags: [
        '-Path',
        '-LiteralPath',
        '-Audit',
        '-Filter',
        '-Include',
        '-Exclude',
      ],
    },

    
    
    
    'set-location': {
      safeFlags: ['-Path', '-LiteralPath', '-PassThru', '-StackName'],
    },
    'push-location': {
      safeFlags: ['-Path', '-LiteralPath', '-PassThru', '-StackName'],
    },
    'pop-location': {
      safeFlags: ['-PassThru', '-StackName'],
    },

    
    
    
    'select-string': {
      safeFlags: [
        '-Path',
        '-LiteralPath',
        '-Pattern',
        '-InputObject',
        '-SimpleMatch',
        '-CaseSensitive',
        '-Quiet',
        '-List',
        '-NotMatch',
        '-AllMatches',
        '-Encoding',
        '-Context',
        '-Raw',
        '-NoEmphasis',
      ],
    },

    
    
    
    'convertto-json': {
      safeFlags: [
        '-InputObject',
        '-Depth',
        '-Compress',
        '-EnumsAsStrings',
        '-AsArray',
      ],
    },
    'convertfrom-json': {
      safeFlags: ['-InputObject', '-Depth', '-AsHashtable', '-NoEnumerate'],
    },
    'convertto-csv': {
      safeFlags: [
        '-InputObject',
        '-Delimiter',
        '-NoTypeInformation',
        '-NoHeader',
        '-UseQuotes',
      ],
    },
    'convertfrom-csv': {
      safeFlags: ['-InputObject', '-Delimiter', '-Header', '-UseCulture'],
    },
    'convertto-xml': {
      safeFlags: ['-InputObject', '-Depth', '-As', '-NoTypeInformation'],
    },
    'convertto-html': {
      safeFlags: [
        '-InputObject',
        '-Property',
        '-Head',
        '-Title',
        '-Body',
        '-Pre',
        '-Post',
        '-As',
        '-Fragment',
      ],
    },
    'format-hex': {
      safeFlags: [
        '-Path',
        '-LiteralPath',
        '-InputObject',
        '-Encoding',
        '-Count',
        '-Offset',
      ],
    },

    
    
    
    'get-member': {
      safeFlags: [
        '-InputObject',
        '-MemberType',
        '-Name',
        '-Static',
        '-View',
        '-Force',
      ],
    },
    'get-unique': {
      safeFlags: ['-InputObject', '-AsString', '-CaseInsensitive', '-OnType'],
    },
    'compare-object': {
      safeFlags: [
        '-ReferenceObject',
        '-DifferenceObject',
        '-Property',
        '-SyncWindow',
        '-CaseSensitive',
        '-Culture',
        '-ExcludeDifferent',
        '-IncludeEqual',
        '-PassThru',
      ],
    },
    
    
    
    
    
    
    'join-string': {
      safeFlags: [
        '-InputObject',
        '-Property',
        '-Separator',
        '-OutputPrefix',
        '-OutputSuffix',
        '-SingleQuote',
        '-DoubleQuote',
        '-FormatString',
      ],
    },
    
    
    
    
    
    'get-random': {
      safeFlags: [
        '-InputObject',
        '-Minimum',
        '-Maximum',
        '-Count',
        '-SetSeed',
        '-Shuffle',
      ],
    },

    
    
    
    
    
    
    'convert-path': {
      safeFlags: ['-Path', '-LiteralPath'],
    },
    'join-path': {
      
      
      
      safeFlags: ['-Path', '-ChildPath', '-AdditionalChildPath'],
    },
    'split-path': {
      
      
      safeFlags: [
        '-Path',
        '-LiteralPath',
        '-Qualifier',
        '-NoQualifier',
        '-Parent',
        '-Leaf',
        '-LeafBase',
        '-Extension',
        '-IsAbsolute',
      ],
    },

    
    
    
    
    
    
    'get-hotfix': {
      safeFlags: ['-Id', '-Description'],
    },
    'get-itempropertyvalue': {
      safeFlags: ['-Path', '-LiteralPath', '-Name'],
    },
    'get-psprovider': {
      safeFlags: ['-PSProvider'],
    },

    
    
    
    'get-process': {
      safeFlags: [
        '-Name',
        '-Id',
        '-Module',
        '-FileVersionInfo',
        '-IncludeUserName',
      ],
    },
    'get-service': {
      safeFlags: [
        '-Name',
        '-DisplayName',
        '-DependentServices',
        '-RequiredServices',
        '-Include',
        '-Exclude',
      ],
    },
    'get-computerinfo': {
      allowAllFlags: true,
    },
    'get-host': {
      allowAllFlags: true,
    },
    'get-date': {
      safeFlags: ['-Date', '-Format', '-UFormat', '-DisplayHint', '-AsUTC'],
    },
    'get-location': {
      safeFlags: ['-PSProvider', '-PSDrive', '-Stack', '-StackName'],
    },
    'get-psdrive': {
      safeFlags: ['-Name', '-PSProvider', '-Scope'],
    },
    
    
    
    
    
    
    
    'get-module': {
      safeFlags: [
        '-Name',
        '-ListAvailable',
        '-All',
        '-FullyQualifiedName',
        '-PSEdition',
      ],
    },
    
    
    
    'get-alias': {
      safeFlags: ['-Name', '-Definition', '-Scope', '-Exclude'],
    },
    'get-history': {
      safeFlags: ['-Id', '-Count'],
    },
    'get-culture': {
      allowAllFlags: true,
    },
    'get-uiculture': {
      allowAllFlags: true,
    },
    'get-timezone': {
      safeFlags: ['-Name', '-Id', '-ListAvailable'],
    },
    'get-uptime': {
      allowAllFlags: true,
    },

    
    
    
    
    
    
    'write-output': {
      safeFlags: ['-InputObject', '-NoEnumerate'],
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    
    
    
    'write-host': {
      safeFlags: [
        '-Object',
        '-NoNewline',
        '-Separator',
        '-ForegroundColor',
        '-BackgroundColor',
      ],
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    
    
    
    'start-sleep': {
      safeFlags: ['-Seconds', '-Milliseconds', '-Duration'],
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    'format-table': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'format-list': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'format-wide': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'format-custom': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'measure-object': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    
    
    
    
    
    
    
    
    
    'select-object': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'sort-object': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'group-object': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'where-object': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    
    
    
    
    
    'out-string': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },
    'out-host': {
      allowAllFlags: true,
      additionalCommandIsDangerousCallback: argLeaksValue,
    },

    
    
    
    'get-netadapter': {
      safeFlags: [
        '-Name',
        '-InterfaceDescription',
        '-InterfaceIndex',
        '-Physical',
      ],
    },
    'get-netipaddress': {
      safeFlags: [
        '-InterfaceIndex',
        '-InterfaceAlias',
        '-AddressFamily',
        '-Type',
      ],
    },
    'get-netipconfiguration': {
      safeFlags: ['-InterfaceIndex', '-InterfaceAlias', '-Detailed', '-All'],
    },
    'get-netroute': {
      safeFlags: [
        '-InterfaceIndex',
        '-InterfaceAlias',
        '-AddressFamily',
        '-DestinationPrefix',
      ],
    },
    'get-dnsclientcache': {
      
      
      safeFlags: ['-Entry', '-Name', '-Type', '-Status', '-Section', '-Data'],
    },
    'get-dnsclient': {
      safeFlags: ['-InterfaceIndex', '-InterfaceAlias'],
    },

    
    
    
    'get-eventlog': {
      safeFlags: [
        '-LogName',
        '-Newest',
        '-After',
        '-Before',
        '-EntryType',
        '-Index',
        '-InstanceId',
        '-Message',
        '-Source',
        '-UserName',
        '-AsBaseObject',
        '-List',
      ],
    },
    'get-winevent': {
      
      
      
      
      
      
      safeFlags: [
        '-LogName',
        '-ListLog',
        '-ListProvider',
        '-ProviderName',
        '-Path',
        '-MaxEvents',
        '-FilterXPath',
        '-Force',
        '-Oldest',
      ],
    },

    
    
    
    
    
    
    
    
    
    
    
    
    'get-cimclass': {
      safeFlags: [
        '-ClassName',
        '-Namespace',
        '-MethodName',
        '-PropertyName',
        '-QualifierName',
      ],
    },

    
    
    
    git: {},

    
    
    
    gh: {},

    
    
    
    docker: {},

    
    
    
    ipconfig: {
      
      
      
      
      
      safeFlags: ['/all', '/displaydns', '/allcompartments'],
      additionalCommandIsDangerousCallback: (
        _cmd: string,
        element?: ParsedCommandElement,
      ) => {
        return (element?.args ?? []).some(
          a => !a.startsWith('/') && !a.startsWith('-'),
        )
      },
    },
    netstat: {
      safeFlags: [
        '-a',
        '-b',
        '-e',
        '-f',
        '-n',
        '-o',
        '-p',
        '-q',
        '-r',
        '-s',
        '-t',
        '-x',
        '-y',
      ],
    },
    systeminfo: {
      safeFlags: ['/FO', '/NH'],
    },
    tasklist: {
      safeFlags: ['/M', '/SVC', '/V', '/FI', '/FO', '/NH'],
    },
    
    
    
    
    'where.exe': {
      allowAllFlags: true,
    },
    hostname: {
      
      
      
      safeFlags: ['-a', '-d', '-f', '-i', '-I', '-s', '-y', '-A'],
      additionalCommandIsDangerousCallback: (
        _cmd: string,
        element?: ParsedCommandElement,
      ) => {
        
        return (element?.args ?? []).some(a => !a.startsWith('-'))
      },
    },
    whoami: {
      safeFlags: [
        '/user',
        '/groups',
        '/claims',
        '/priv',
        '/logonid',
        '/all',
        '/fo',
        '/nh',
      ],
    },
    ver: {
      allowAllFlags: true,
    },
    arp: {
      safeFlags: ['-a', '-g', '-v', '-N'],
    },
    route: {
      safeFlags: ['print', 'PRINT', '-4', '-6'],
      additionalCommandIsDangerousCallback: (
        _cmd: string,
        element?: ParsedCommandElement,
      ) => {
        
        
        
        
        
        if (!element) {
          return true
        }
        const verb = element.args.find(a => !a.startsWith('-'))
        return verb?.toLowerCase() !== 'print'
      },
    },
    
    
    
    
    
    
    
    
    getmac: {
      safeFlags: ['/FO', '/NH', '/V'],
    },

    
    
    
    
    
    
    file: {
      safeFlags: [
        '-b',
        '--brief',
        '-i',
        '--mime',
        '-L',
        '--dereference',
        '--mime-type',
        '--mime-encoding',
        '-z',
        '--uncompress',
        '-p',
        '--preserve-date',
        '-k',
        '--keep-going',
        '-r',
        '--raw',
        '-v',
        '--version',
        '-0',
        '--print0',
        '-s',
        '--special-files',
        '-l',
        '-F',
        '--separator',
        '-e',
        '-P',
        '-N',
        '--no-pad',
        '-E',
        '--extension',
      ],
    },
    tree: {
      safeFlags: ['/F', '/A', '/Q', '/L'],
    },
    findstr: {
      safeFlags: [
        '/B',
        '/E',
        '/L',
        '/R',
        '/S',
        '/I',
        '/X',
        '/V',
        '/N',
        '/M',
        '/O',
        '/P',
        
        
        '/C',
        '/G',
        '/D',
        '/A',
      ],
    },

    
    
    
    dotnet: {},

    
    
    
    
  },
)

const SAFE_OUTPUT_CMDLETS = new Set([
  'out-null',
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
])

const PIPELINE_TAIL_CMDLETS = new Set([
  'format-table',
  'format-list',
  'format-wide',
  'format-custom',
  'measure-object',
  'select-object',
  'sort-object',
  'group-object',
  'where-object',
  'out-string',
  'out-host',
])

const SAFE_EXTERNAL_EXES = new Set(['where.exe'])

const WINDOWS_PATHEXT = /\.(exe|cmd|bat|com)$/

export function resolveToCanonical(name: string): string {
  let lower = name.toLowerCase()
  
  
  if (!lower.includes('\\') && !lower.includes('/')) {
    lower = lower.replace(WINDOWS_PATHEXT, '')
  }
  const alias = COMMON_ALIASES[lower]
  if (alias) {
    return alias.toLowerCase()
  }
  return lower
}

export function isCwdChangingCmdlet(name: string): boolean {
  const canonical = resolveToCanonical(name)
  return (
    canonical === 'set-location' ||
    canonical === 'push-location' ||
    canonical === 'pop-location' ||
    
    
    
    canonical === 'new-psdrive' ||
    
    
    
    (getPlatform() === 'windows' &&
      (canonical === 'ndr' || canonical === 'mount'))
  )
}

export function isSafeOutputCommand(name: string): boolean {
  const canonical = resolveToCanonical(name)
  return SAFE_OUTPUT_CMDLETS.has(canonical)
}

export function isAllowlistedPipelineTail(
  cmd: ParsedCommandElement,
  originalCommand: string,
): boolean {
  const canonical = resolveToCanonical(cmd.name)
  if (!PIPELINE_TAIL_CMDLETS.has(canonical)) {
    return false
  }
  return isAllowlistedCommand(cmd, originalCommand)
}

export function isProvablySafeStatement(stmt: ParsedStatement): boolean {
  if (stmt.statementType !== 'PipelineAst') return false
  
  
  
  if (stmt.commands.length === 0) return false
  for (const cmd of stmt.commands) {
    if (cmd.elementType !== 'CommandAst') return false
  }
  return true
}

function lookupAllowlist(name: string): CommandConfig | undefined {
  const lower = name.toLowerCase()
  
  const direct = CMDLET_ALLOWLIST[lower]
  if (direct) {
    return direct
  }
  
  const canonical = resolveToCanonical(lower)
  if (canonical !== lower) {
    return CMDLET_ALLOWLIST[canonical]
  }
  return undefined
}

export function hasSyncSecurityConcerns(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) {
    return false
  }

  
  if (/\$\(/.test(trimmed)) {
    return true
  }

  
  
  
  
  if (/(?:^|[^\w.])@\w+/.test(trimmed)) {
    return true
  }

  
  if (/\.\w+\s*\(/.test(trimmed)) {
    return true
  }

  
  if (/\$\w+\s*[+\-*/]?=/.test(trimmed)) {
    return true
  }

  
  if (/--%/.test(trimmed)) {
    return true
  }

  
  
  
  if (/\\\\/.test(trimmed) || /(?<!:)\/\
    return true
  }

  
  if (/::/.test(trimmed)) {
    return true
  }

  return false
}

export function isReadOnlyCommand(
  command: string,
  parsed?: ParsedPowerShellCommand,
): boolean {
  const trimmedCommand = command.trim()
  if (!trimmedCommand) {
    return false
  }

  
  if (!parsed) {
    return false
  }

  
  if (!parsed.valid) {
    return false
  }

  const security = deriveSecurityFlags(parsed)
  
  
  
  if (
    security.hasScriptBlocks ||
    security.hasSubExpressions ||
    security.hasExpandableStrings ||
    security.hasSplatting ||
    security.hasMemberInvocations ||
    security.hasAssignments ||
    security.hasStopParsing
  ) {
    return false
  }

  const segments = getPipelineSegments(parsed)

  if (segments.length === 0) {
    return false
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const totalCommands = segments.reduce(
    (sum, seg) => sum + seg.commands.length,
    0,
  )
  if (totalCommands > 1) {
    const hasCd = segments.some(seg =>
      seg.commands.some(cmd => isCwdChangingCmdlet(cmd.name)),
    )
    if (hasCd) {
      return false
    }
  }

  
  for (const pipeline of segments) {
    if (!pipeline || pipeline.commands.length === 0) {
      return false
    }

    
    
    if (pipeline.redirections.length > 0) {
      const hasFileRedirection = pipeline.redirections.some(
        r => !r.isMerging && !isNullRedirectionTarget(r.target),
      )
      if (hasFileRedirection) {
        return false
      }
    }

    
    const firstCmd = pipeline.commands[0]
    if (!firstCmd) {
      return false
    }

    if (!isAllowlistedCommand(firstCmd, command)) {
      return false
    }

    
    
    
    
    
    
    
    
    
    for (let i = 1; i < pipeline.commands.length; i++) {
      const cmd = pipeline.commands[i]
      if (!cmd || cmd.nameType === 'application') {
        return false
      }
      
      
      
      
      
      
      
      
      if (isSafeOutputCommand(cmd.name) && cmd.args.length === 0) {
        continue
      }
      if (!isAllowlistedCommand(cmd, command)) {
        return false
      }
    }

    
    
    
    
    
    
    if (pipeline.nestedCommands && pipeline.nestedCommands.length > 0) {
      return false
    }
  }

  return true
}

export function isAllowlistedCommand(
  cmd: ParsedCommandElement,
  originalCommand: string,
): boolean {
  
  
  
  
  
  
  
  
  if (cmd.nameType === 'application') {
    
    
    
    
    const rawFirstToken = cmd.text.split(/\s/, 1)[0]?.toLowerCase() ?? ''
    if (!SAFE_EXTERNAL_EXES.has(rawFirstToken)) {
      return false
    }
    
    
  }

  const config = lookupAllowlist(cmd.name)
  if (!config) {
    return false
  }

  
  if (config.regex && !config.regex.test(originalCommand)) {
    return false
  }

  
  if (config.additionalCommandIsDangerousCallback?.(originalCommand, cmd)) {
    return false
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (!cmd.elementTypes) {
    return false
  }
  {
    for (let i = 1; i < cmd.elementTypes.length; i++) {
      const t = cmd.elementTypes[i]
      if (t !== 'StringConstant' && t !== 'Parameter') {
        
        
        
        
        if (!/[$(@{[]/.test(cmd.args[i - 1] ?? '')) {
          continue
        }
        return false
      }
      
      
      
      
      
      
      
      
      
      
      
      
      
      if (t === 'Parameter') {
        const paramChildren = cmd.children?.[i - 1]
        if (paramChildren) {
          if (paramChildren.some(c => c.type !== 'StringConstant')) {
            return false
          }
        } else {
          
          
          
          const arg = cmd.args[i - 1] ?? ''
          const colonIdx = arg.indexOf(':')
          if (colonIdx > 0 && /[$(@{[]/.test(arg.slice(colonIdx + 1))) {
            return false
          }
        }
      }
    }
  }

  const canonical = resolveToCanonical(cmd.name)

  
  if (
    canonical === 'git' ||
    canonical === 'gh' ||
    canonical === 'docker' ||
    canonical === 'dotnet'
  ) {
    return isExternalCommandSafe(canonical, cmd.args)
  }

  
  
  
  
  const isCmdlet = canonical.includes('-')

  
  
  
  if (config.allowAllFlags) {
    return true
  }
  if (!config.safeFlags || config.safeFlags.length === 0) {
    
    
    
    const hasFlags = cmd.args.some((arg, i) => {
      if (isCmdlet) {
        return isPowerShellParameter(arg, cmd.elementTypes?.[i + 1])
      }
      return (
        arg.startsWith('-') ||
        (process.platform === 'win32' && arg.startsWith('/'))
      )
    })
    return !hasFlags
  }

  
  
  
  
  
  
  
  for (let i = 0; i < cmd.args.length; i++) {
    const arg = cmd.args[i]!
    
    
    
    const isFlag = isCmdlet
      ? isPowerShellParameter(arg, cmd.elementTypes?.[i + 1])
      : arg.startsWith('-') ||
        (process.platform === 'win32' && arg.startsWith('/'))
    if (isFlag) {
      
      
      
      let paramName = isCmdlet ? '-' + arg.slice(1) : arg
      const colonIndex = paramName.indexOf(':')
      if (colonIndex > 0) {
        paramName = paramName.substring(0, colonIndex)
      }

      
      
      
      
      
      
      
      const paramLower = paramName.toLowerCase()
      if (isCmdlet && COMMON_PARAMETERS.has(paramLower)) {
        continue
      }
      const isSafe = config.safeFlags.some(
        flag => flag.toLowerCase() === paramLower,
      )
      if (!isSafe) {
        return false
      }
    }
  }

  return true
}

function isExternalCommandSafe(command: string, args: string[]): boolean {
  switch (command) {
    case 'git':
      return isGitSafe(args)
    case 'gh':
      return isGhSafe(args)
    case 'docker':
      return isDockerSafe(args)
    case 'dotnet':
      return isDotnetSafe(args)
    default:
      return false
  }
}

const DANGEROUS_GIT_GLOBAL_FLAGS = new Set([
  '-c',
  '-C',
  '--exec-path',
  '--config-env',
  '--git-dir',
  '--work-tree',
  
  
  
  
  
  
  
  
  '--attr-source',
])

const GIT_GLOBAL_FLAGS_WITH_VALUES = new Set([
  '-c',
  '-C',
  '--exec-path',
  '--config-env',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--super-prefix',
  '--shallow-file',
])

const DANGEROUS_GIT_SHORT_FLAGS_ATTACHED = ['-c', '-C']

function isGitSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes(')) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith('-')) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag === '-C' || arg[shortFlag.length] !== '-')
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes('=')
    const flagName = hasInlineValue ? arg.split('=')[0] || '' : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() || ''
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() || '' : ''

  
  const twoWordKey = `git ${first} ${second}`
  const oneWordKey = `git ${first}`

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first === 'ls-remote') {
    for (const arg of flagArgs) {
      if (!arg.startsWith('-')) {
        if (
          arg.includes(':
          arg.includes('@') ||
          arg.includes(':') ||
          arg.includes(')
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback('', flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName: 'git' })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !== 'ant') {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey = `gh ${args[0]?.toLowerCase()} ${args[1]?.toLowerCase()}`
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey = `gh ${args[0]?.toLowerCase()}`
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes(')) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback('', flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes(')) {
      return false
    }
  }

  const oneWordKey = `docker ${args[0]?.toLowerCase()}`

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback('', flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
)) {
      return false
    }
  }

  
  
  
  let idx = 0
  while (idx < args.length) {
    const arg = args[idx]
    if (!arg || !arg.startsWith( STR55542 )) {
      break
    }
    
    
    
    
    
    
    
    
    for (const shortFlag of DANGEROUS_GIT_SHORT_FLAGS_ATTACHED) {
      if (
        arg.length > shortFlag.length &&
        arg.startsWith(shortFlag) &&
        (shortFlag ===  STR55543  || arg[shortFlag.length] !==  STR55544 )
      ) {
        return false
      }
    }
    const hasInlineValue = arg.includes( STR55545 )
    const flagName = hasInlineValue ? arg.split( STR55546 )[0] ||  STR55547  : arg
    if (DANGEROUS_GIT_GLOBAL_FLAGS.has(flagName)) {
      return false
    }
    
    if (!hasInlineValue && GIT_GLOBAL_FLAGS_WITH_VALUES.has(flagName)) {
      idx += 2
    } else {
      idx++
    }
  }

  if (idx >= args.length) {
    return true
  }

  
  const first = args[idx]?.toLowerCase() ||  STR55548 
  const second = idx + 1 < args.length ? args[idx + 1]?.toLowerCase() ||  STR55549  :  STR55550 

  
  const twoWordKey =  STR55551 
  const oneWordKey =  STR55552 

  let config: ExternalCommandConfig | undefined =
    GIT_READ_ONLY_COMMANDS[twoWordKey]
  let subcommandTokens = 2

  if (!config) {
    config = GIT_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(idx + subcommandTokens)

  
  
  
  
  
  
  
  
  if (first ===  STR55553 ) {
    for (const arg of flagArgs) {
      if (!arg.startsWith( STR55554 )) {
        if (
          arg.includes( STR55555 ) ||
          arg.includes( STR55556 ) ||
          arg.includes( STR55557 ) ||
          arg.includes( STR55558 )
        ) {
          return false
        }
      }
    }
  }

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55559 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config, { commandName:  STR55560  })
}

function isGhSafe(args: string[]): boolean {
  
  if (process.env.USER_TYPE !==  STR55561 ) {
    return false
  }

  if (args.length === 0) {
    return true
  }

  
  let config: ExternalCommandConfig | undefined
  let subcommandTokens = 0

  if (args.length >= 2) {
    const twoWordKey =  STR55562 
    config = GH_READ_ONLY_COMMANDS[twoWordKey]
    subcommandTokens = 2
  }

  
  if (!config && args.length >= 1) {
    const oneWordKey =  STR55563 
    config = GH_READ_ONLY_COMMANDS[oneWordKey]
    subcommandTokens = 1
  }

  if (!config) {
    return false
  }

  const flagArgs = args.slice(subcommandTokens)

  
  
  
  
  
  
  
  
  
  for (const arg of flagArgs) {
    if (arg.includes( STR55564 )) {
      return false
    }
  }
  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55565 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDockerSafe(args: string[]): boolean {
  if (args.length === 0) {
    return true
  }

  
  
  
  
  
  
  
  
  
  
  
  
  for (const arg of args) {
    if (arg.includes( STR55566 )) {
      return false
    }
  }

  const oneWordKey =  STR55567 

  
  
  if (EXTERNAL_READONLY_COMMANDS.includes(oneWordKey)) {
    return true
  }

  
  
  const config: ExternalCommandConfig | undefined =
    DOCKER_READ_ONLY_COMMANDS[oneWordKey]
  if (!config) {
    return false
  }

  const flagArgs = args.slice(1)

  if (
    config.additionalCommandIsDangerousCallback &&
    config.additionalCommandIsDangerousCallback( STR55568 , flagArgs)
  ) {
    return false
  }
  return validateFlags(flagArgs, 0, config)
}

function isDotnetSafe(args: string[]): boolean {
  if (args.length === 0) {
    return false
  }

  
  
  for (const arg of args) {
    if (!DOTNET_READ_ONLY_FLAGS.has(arg.toLowerCase())) {
      return false
    }
  }

  return true
}
