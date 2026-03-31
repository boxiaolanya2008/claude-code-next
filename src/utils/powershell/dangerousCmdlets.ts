

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

export const NETWORK_CMDLETS = new Set([
  'invoke-webrequest',
  'invoke-restmethod',
])

export const ALIAS_HIJACK_CMDLETS = new Set([
  'set-alias',
  'sal', 
  'new-alias',
  'nal', 
  'set-variable',
  'sv', 
  'new-variable',
  'nv', 
])

export const WMI_CIM_CMDLETS = new Set([
  'invoke-wmimethod',
  'iwmi', 
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
    
    
    
    
    
    
    
    
    'foreach-object',
    
    
    
    
    
    ...CROSS_PLATFORM_CODE_EXEC.filter(p => !p.includes(' ')),
  ])
  return new Set([...core, ...aliasesOf(core)])
})()
