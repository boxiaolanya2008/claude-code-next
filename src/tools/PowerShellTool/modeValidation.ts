

import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import type { ParsedPowerShellCommand } from '../../utils/powershell/parser.js'
import {
  deriveSecurityFlags,
  getPipelineSegments,
  PS_TOKENIZER_DASH_CHARS,
} from '../../utils/powershell/parser.js'
import {
  argLeaksValue,
  isAllowlistedPipelineTail,
  isCwdChangingCmdlet,
  isSafeOutputCommand,
  resolveToCanonical,
} from './readOnlyValidation.js'

const ACCEPT_EDITS_ALLOWED_CMDLETS = new Set([
  'set-content',
  'add-content',
  'remove-item',
  'clear-content',
])

function isAcceptEditsAllowedCmdlet(name: string): boolean {
  
  
  
  
  const canonical = resolveToCanonical(name)
  return ACCEPT_EDITS_ALLOWED_CMDLETS.has(canonical)
}

const LINK_ITEM_TYPES = new Set(['symboliclink', 'junction', 'hardlink'])

function isItemTypeParamAbbrev(p: string): boolean {
  return (
    (p.length >= 3 && '-itemtype'.startsWith(p)) ||
    (p.length >= 3 && '-type'.startsWith(p))
  )
}

export function isSymlinkCreatingCommand(cmd: {
  name: string
  args: string[]
}): boolean {
  const canonical = resolveToCanonical(cmd.name)
  if (canonical !== 'new-item') return false
  for (let i = 0; i < cmd.args.length; i++) {
    const raw = cmd.args[i] ?? ''
    if (raw.length === 0) continue
    
    
    
    const normalized =
      PS_TOKENIZER_DASH_CHARS.has(raw[0]!) || raw[0] === '/'
        ? '-' + raw.slice(1)
        : raw
    const lower = normalized.toLowerCase()
    
    const colonIdx = lower.indexOf(':', 1)
    const paramRaw = colonIdx > 0 ? lower.slice(0, colonIdx) : lower
    
    const param = paramRaw.replace(/`/g, '')
    if (!isItemTypeParamAbbrev(param)) continue
    const rawVal =
      colonIdx > 0
        ? lower.slice(colonIdx + 1)
        : (cmd.args[i + 1]?.toLowerCase() ?? '')
    
    
    
    
    const val = rawVal.replace(/`/g, '').replace(/^['"]|['"]$/g, '')
    if (LINK_ITEM_TYPES.has(val)) return true
  }
  return false
}

export function checkPermissionMode(
  input: { command: string },
  parsed: ParsedPowerShellCommand,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  
  if (
    toolPermissionContext.mode === 'bypassPermissions' ||
    toolPermissionContext.mode === 'dontAsk'
  ) {
    return {
      behavior: 'passthrough',
      message: 'Mode is handled in main permission flow',
    }
  }

  if (toolPermissionContext.mode !== 'acceptEdits') {
    return {
      behavior: 'passthrough',
      message: 'No mode-specific validation required',
    }
  }

  
  if (!parsed.valid) {
    return {
      behavior: 'passthrough',
      message: 'Cannot validate mode for unparsed command',
    }
  }

  
  
  const securityFlags = deriveSecurityFlags(parsed)
  if (
    securityFlags.hasSubExpressions ||
    securityFlags.hasScriptBlocks ||
    securityFlags.hasMemberInvocations ||
    securityFlags.hasSplatting ||
    securityFlags.hasAssignments ||
    securityFlags.hasStopParsing ||
    securityFlags.hasExpandableStrings
  ) {
    return {
      behavior: 'passthrough',
      message:
        'Command contains subexpressions, script blocks, or member invocations that require approval',
    }
  }

  const segments = getPipelineSegments(parsed)

  
  if (segments.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'No commands found to validate for acceptEdits mode',
    }
  }

  
  
  
  
  
  
  
  
  
  
  const totalCommands = segments.reduce(
    (sum, seg) => sum + seg.commands.length,
    0,
  )
  if (totalCommands > 1) {
    let hasCdCommand = false
    let hasSymlinkCreate = false
    let hasWriteCommand = false
    for (const seg of segments) {
      for (const cmd of seg.commands) {
        if (cmd.elementType !== 'CommandAst') continue
        if (isCwdChangingCmdlet(cmd.name)) hasCdCommand = true
        if (isSymlinkCreatingCommand(cmd)) hasSymlinkCreate = true
        if (isAcceptEditsAllowedCmdlet(cmd.name)) hasWriteCommand = true
      }
    }
    if (hasCdCommand && hasWriteCommand) {
      return {
        behavior: 'passthrough',
        message:
          'Compound command contains a directory-changing command (Set-Location/Push-Location/Pop-Location) with a write operation — cannot auto-allow because path validation uses stale cwd',
      }
    }
    
    
    
    
    
    
    
    
    
    
    if (hasSymlinkCreate) {
      return {
        behavior: 'passthrough',
        message:
          'Compound command creates a filesystem link (New-Item -ItemType SymbolicLink/Junction/HardLink) — cannot auto-allow because path validation cannot follow just-created links',
      }
    }
  }

  for (const segment of segments) {
    for (const cmd of segment.commands) {
      if (cmd.elementType !== 'CommandAst') {
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        
        return {
          behavior: 'passthrough',
          message: `Pipeline contains expression source (${cmd.elementType}) that cannot be statically validated`,
        }
      }
      
      
      
      
      if (cmd.nameType === 'application') {
        return {
          behavior: 'passthrough',
          message: `Command '${cmd.name}' resolved from a path-like name and requires approval`,
        }
      }
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      
      if (cmd.elementTypes) {
        for (let i = 1; i < cmd.elementTypes.length; i++) {
          const t = cmd.elementTypes[i]
          if (t !== 'StringConstant' && t !== 'Parameter') {
            return {
              behavior: 'passthrough',
              message: `Command argument has unvalidatable type (${t}) — variable paths cannot be statically resolved`,
            }
          }
          if (t === 'Parameter') {
            
            const arg = cmd.args[i - 1] ?? ''
            const colonIdx = arg.indexOf(':')
            if (colonIdx > 0 && /[$(@{[]/.test(arg.slice(colonIdx + 1))) {
              return {
                behavior: 'passthrough',
                message:
                  'Colon-bound parameter contains an expression that cannot be statically validated',
              }
            }
          }
        }
      }
      
      
      
      
      
      
      
      if (
        isSafeOutputCommand(cmd.name) ||
        isAllowlistedPipelineTail(cmd, input.command)
      ) {
        continue
      }
      if (!isAcceptEditsAllowedCmdlet(cmd.name)) {
        return {
          behavior: 'passthrough',
          message: `No mode-specific handling for '${cmd.name}' in acceptEdits mode`,
        }
      }
      
      
      
      
      
      
      
      
      if (argLeaksValue(cmd.name, cmd)) {
        return {
          behavior: 'passthrough',
          message: `Arguments in '${cmd.name}' cannot be statically validated in acceptEdits mode`,
        }
      }
    }

    
    if (segment.nestedCommands) {
      for (const cmd of segment.nestedCommands) {
        if (cmd.elementType !== 'CommandAst') {
          
          
          return {
            behavior: 'passthrough',
            message: `Nested expression element (${cmd.elementType}) cannot be statically validated`,
          }
        }
        if (cmd.nameType === 'application') {
          return {
            behavior: 'passthrough',
            message: `Nested command '${cmd.name}' resolved from a path-like name and requires approval`,
          }
        }
        if (
          isSafeOutputCommand(cmd.name) ||
          isAllowlistedPipelineTail(cmd, input.command)
        ) {
          continue
        }
        if (!isAcceptEditsAllowedCmdlet(cmd.name)) {
          return {
            behavior: 'passthrough',
            message: `No mode-specific handling for '${cmd.name}' in acceptEdits mode`,
          }
        }
        
        if (argLeaksValue(cmd.name, cmd)) {
          return {
            behavior: 'passthrough',
            message: `Arguments in nested '${cmd.name}' cannot be statically validated in acceptEdits mode`,
          }
        }
      }
    }
  }

  
  return {
    behavior: 'allow',
    updatedInput: input,
    decisionReason: {
      type: 'mode',
      mode: 'acceptEdits',
    },
  }
}
