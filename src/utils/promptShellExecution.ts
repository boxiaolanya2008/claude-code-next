import { randomUUID } from 'crypto'
import type { Tool, ToolUseContext } from '../Tool.js'
import { BashTool } from '../tools/BashTool/BashTool.js'
import { logForDebugging } from './debug.js'
import { errorMessage, MalformedCommandError, ShellError } from './errors.js'
import type { FrontmatterShell } from './frontmatterParser.js'
import { createAssistantMessage } from './messages.js'
import { hasPermissionsToUseTool } from './permissions/permissions.js'
import { processToolResultBlock } from './toolResultStorage.js'

type ShellOut = { stdout: string; stderr: string; interrupted: boolean }
type PromptShellTool = Tool & {
  call(
    input: { command: string },
    context: ToolUseContext,
  ): Promise<{ data: ShellOut }>
}

import { isPowerShellToolEnabled } from './shell/shellToolUtils.js'

const getPowerShellTool = (() => {
  let cached: PromptShellTool | undefined
  return (): PromptShellTool => {
    if (!cached) {
      cached = (
        require('../tools/PowerShellTool/PowerShellTool.js') as typeof import('../tools/PowerShellTool/PowerShellTool.js')
      ).PowerShellTool
    }
    return cached
  }
})()

const BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g

const INLINE_PATTERN = /(?<=^|\s)!`([^`]+)`/gm

export async function executeShellCommandsInPrompt(
  text: string,
  context: ToolUseContext,
  slashCommandName: string,
  shell?: FrontmatterShell,
): Promise<string> {
  let result = text

  
  
  
  const shellTool: PromptShellTool =
    shell === 'powershell' && isPowerShellToolEnabled()
      ? getPowerShellTool()
      : BashTool

  
  
  
  
  const blockMatches = text.matchAll(BLOCK_PATTERN)
  const inlineMatches = text.includes('!`') ? text.matchAll(INLINE_PATTERN) : []

  await Promise.all(
    [...blockMatches, ...inlineMatches].map(async match => {
      const command = match[1]?.trim()
      if (command) {
        try {
          
          const permissionResult = await hasPermissionsToUseTool(
            shellTool,
            { command },
            context,
            createAssistantMessage({ content: [] }),
            '',
          )

          if (permissionResult.behavior !== 'allow') {
            logForDebugging(
              `Shell command permission check failed for command in ${slashCommandName}: ${command}. Error: ${permissionResult.message}`,
            )
            throw new MalformedCommandError(
              `Shell command permission check failed for pattern "${match[0]}": ${permissionResult.message || 'Permission denied'}`,
            )
          }

          const { data } = await shellTool.call({ command }, context)
          
          const toolResultBlock = await processToolResultBlock(
            shellTool,
            data,
            randomUUID(),
          )
          
          const output =
            typeof toolResultBlock.content === 'string'
              ? toolResultBlock.content
              : formatBashOutput(data.stdout, data.stderr)
          
          
          
          
          result = result.replace(match[0], () => output)
        } catch (e) {
          if (e instanceof MalformedCommandError) {
            throw e
          }
          formatBashError(e, match[0])
        }
      }
    }),
  )

  return result
}

function formatBashOutput(
  stdout: string,
  stderr: string,
  inline = false,
): string {
  const parts: string[] = []

  if (stdout.trim()) {
    parts.push(stdout.trim())
  }

  if (stderr.trim()) {
    if (inline) {
      parts.push(`[stderr: ${stderr.trim()}]`)
    } else {
      parts.push(`[stderr]\n${stderr.trim()}`)
    }
  }

  return parts.join(inline ? ' ' : '\n')
}

function formatBashError(e: unknown, pattern: string, inline = false): never {
  if (e instanceof ShellError) {
    if (e.interrupted) {
      throw new MalformedCommandError(
        `Shell command interrupted for pattern "${pattern}": [Command interrupted]`,
      )
    }
    const output = formatBashOutput(e.stdout, e.stderr, inline)
    throw new MalformedCommandError(
      `Shell command failed for pattern "${pattern}": ${output}`,
    )
  }

  const message = errorMessage(e)
  const formatted = inline ? `[Error: ${message}]` : `[Error]\n${message}`
  throw new MalformedCommandError(formatted)
}
