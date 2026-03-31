

import { CROSS_PLATFORM_CODE_EXEC } from '../permissions/dangerousPatterns.js'
import { COMMON_ALIASES } from './parser.js'

export const FILEPATH_EXECUTION_CMDLETS = new Set([
  'invoke-command',
  'start-job',
  'start-threadjob',
  'register-scheduledjob',
])

export const DANGEROUS_SCRIPT_BLOCK_CMDLETS = new Set([
  'invoke-command',
  'invoke-expression',
  'start-job',
  'start-threadjob',
  'register-scheduledjob',
  'register-engineevent',
  'register-objectevent',
  'register-wmievent',
  'new-pssession',
  'enter-pssession',
])

export const MODULE_LOADING_CMDLETS = new Set([
  'import-module',
  'ipmo',
  'install-module',
  'save-module',
  'update-module',
  'install-script',
  'save-script',
])

const SHELLS_AND_SPAWNERS = [
  'pwsh',
  'powershell',
  'cmd',
  'bash',
  'wsl',
  'sh',
  'start-process',
  'start',
  'add-type',
  'new-object',
] as const

function aliasesOf(targets: ReadonlySet<string>): string[] {
  return Object.entries(COMMON_ALIASES)
    .filter(([, target]) => targets.has(target.toLowerCase()))
    .map(([alias]) => alias)
}

/**
 * Network cmdlets — wildcard rules for these enable exfil/download without
 * prompt. No legitimate narrow prefix exists.
 */
export const NETWORK_CMDLETS = new Set([
  'invoke-webrequest',
  'invoke-restmethod',
])

export const ALIAS_HIJACK_CMDLETS = new Set([
  'set-alias',
  'sal', // alias not in COMMON_ALIASES — list explicitly
  'new-alias',
  'nal', // alias not in COMMON_ALIASES — list explicitly
  'set-variable',
  'sv', // alias not in COMMON_ALIASES — list explicitly
  'new-variable',
  'nv', // alias not in COMMON_ALIASES — list explicitly
])

export const WMI_CIM_CMDLETS = new Set([
  'invoke-wmimethod',
  'iwmi', // alias not in COMMON_ALIASES — list explicitly
  'invoke-cimmethod',
])

export const ARG_GATED_CMDLETS = new Set([
  'select-object',
  'sort-object',
  'group-object',
  'where-object',
  'measure-object',
  'write-output',
  'write-host',
  'start-sleep',
  'format-table',
  'format-list',
  'format-wide',
  'format-custom',
  'out-string',
  'out-host',
  // Native executables with callback-gated args (e.g. ipconfig /flushdns
  
  'ipconfig',
  'hostname',
  'route',
])

export const NEVER_SUGGEST: ReadonlySet<string> = (() => {
  const core = new Set<string>([
    ...SHELLS_AND_SPAWNERS,
    ...FILEPATH_EXECUTION_CMDLETS,
    ...DANGEROUS_SCRIPT_BLOCK_CMDLETS,
    ...MODULE_LOADING_CMDLETS,
    ...NETWORK_CMDLETS,
    ...ALIAS_HIJACK_CMDLETS,
    ...WMI_CIM_CMDLETS,
    ...ARG_GATED_CMDLETS,
    // ForEach-Object's -MemberName (positional: `% Delete`) resolves against
    // the runtime pipeline object — `Get-ChildItem | % Delete` invokes
    // FileInfo.Delete(). StaticParameterBinder identifies the
    // PropertyAndMethodSet parameter set, but the set handles both; the arg
    // is a plain StringConstantExpressionAst with no property/method signal.
    // Pipeline type inference (upstream OutputType → GetMember) misses ETS
    // AliasProperty members and has no answer for `$var | %` or external
    // upstream. Not in ARG_GATED (no allowlist entry to sync with).
    'foreach-object',
    // Interpreters/runners — `node script.js` stops at the file arg and
    // suggests bare `node:*`, auto-allowing arbitrary code via -e/-p. The
    // auto-mode classifier strips these rules (isDangerousPowerShellPermission)
    // but the suggestion gate didn't. Multi-word entries ('npm run') are
    
    ...CROSS_PLATFORM_CODE_EXEC.filter(p => !p.includes(' ')),
  ])
  return new Set([...core, ...aliasesOf(core)])
})()
