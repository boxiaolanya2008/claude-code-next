import type { z } from 'zod/v4'
import type { ToolPermissionContext } from '../../Tool.js'
import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import type { BashTool } from './BashTool.js'

const ACCEPT_EDITS_ALLOWED_COMMANDS = [
  'mkdir',
  'touch',
  'rm',
  'rmdir',
  'mv',
  'cp',
  'sed',
] as const

type FilesystemCommand = (typeof ACCEPT_EDITS_ALLOWED_COMMANDS)[number]

function isFilesystemCommand(command: string): command is FilesystemCommand {
  return ACCEPT_EDITS_ALLOWED_COMMANDS.includes(command as FilesystemCommand)
}

function validateCommandForMode(
  cmd: string,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  const trimmedCmd = cmd.trim()
  const [baseCmd] = trimmedCmd.split(/\s+/)

  if (!baseCmd) {
    return {
      behavior: 'passthrough',
      message: 'Base command not found',
    }
  }

  
  if (
    toolPermissionContext.mode === 'acceptEdits' &&
    isFilesystemCommand(baseCmd)
  ) {
    return {
      behavior: 'allow',
      updatedInput: { command: cmd },
      decisionReason: {
        type: 'mode',
        mode: 'acceptEdits',
      },
    }
  }

  return {
    behavior: 'passthrough',
    message: `No mode-specific handling for '${baseCmd}' in ${toolPermissionContext.mode} mode`,
  }
}

export function checkPermissionMode(
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  
  if (toolPermissionContext.mode === 'bypassPermissions') {
    return {
      behavior: 'passthrough',
      message: 'Bypass mode is handled in main permission flow',
    }
  }

  
  if (toolPermissionContext.mode === 'dontAsk') {
    return {
      behavior: 'passthrough',
      message: 'DontAsk mode is handled in main permission flow',
    }
  }

  const commands = splitCommand_DEPRECATED(input.command)

  
  for (const cmd of commands) {
    const result = validateCommandForMode(cmd, toolPermissionContext)

    
    if (result.behavior !== 'passthrough') {
      return result
    }
  }

  
  return {
    behavior: 'passthrough',
    message: 'No mode-specific validation required',
  }
}

export function getAutoAllowedCommands(
  mode: ToolPermissionContext['mode'],
): readonly string[] {
  return mode === 'acceptEdits' ? ACCEPT_EDITS_ALLOWED_COMMANDS : []
}
