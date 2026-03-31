import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { CompactionResult } from '../services/compact/compact.js'
import type { ScopedMcpServerConfig } from '../services/mcp/types.js'
import type { ToolUseContext } from '../Tool.js'
import type { EffortValue } from '../utils/effort.js'
import type { IDEExtensionInstallationStatus, IdeType } from '../utils/ide.js'
import type { SettingSource } from '../utils/settings/constants.js'
import type { HooksSettings } from '../utils/settings/types.js'
import type { ThemeName } from '../utils/theme.js'
import type { LogOption } from './logs.js'
import type { Message } from './message.js'
import type { PluginManifest } from './plugin.js'

export type LocalCommandResult =
  | { type: 'text'; value: string }
  | {
      type: 'compact'
      compactionResult: CompactionResult
      displayText?: string
    }
  | { type: 'skip' } // Skip messages

export type PromptCommand = {
  type: 'prompt'
  progressMessage: string
  contentLength: number 
  argNames?: string[]
  allowedTools?: string[]
  model?: string
  source: SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'
  pluginInfo?: {
    pluginManifest: PluginManifest
    repository: string
  }
  disableNonInteractive?: boolean
  
  hooks?: HooksSettings
  
  skillRoot?: string
  
  
  
  context?: 'inline' | 'fork'
  
  
  agent?: string
  effort?: EffortValue
  
  
  paths?: string[]
  getPromptForCommand(
    args: string,
    context: ToolUseContext,
  ): Promise<ContentBlockParam[]>
}

/**
 * The call signature for a local command implementation.
 */
export type LocalCommandCall = (
  args: string,
  context: LocalJSXCommandContext,
) => Promise<LocalCommandResult>

export type LocalCommandModule = {
  call: LocalCommandCall
}

type LocalCommand = {
  type: 'local'
  supportsNonInteractive: boolean
  load: () => Promise<LocalCommandModule>
}

export type LocalJSXCommandContext = ToolUseContext & {
  canUseTool?: CanUseToolFn
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  options: {
    dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>
    ideInstallationStatus: IDEExtensionInstallationStatus | null
    theme: ThemeName
  }
  onChangeAPIKey: () => void
  onChangeDynamicMcpConfig?: (
    config: Record<string, ScopedMcpServerConfig>,
  ) => void
  onInstallIDEExtension?: (ide: IdeType) => void
  resume?: (
    sessionId: UUID,
    log: LogOption,
    entrypoint: ResumeEntrypoint,
  ) => Promise<void>
}

export type ResumeEntrypoint =
  | 'cli_flag'
  | 'slash_command_picker'
  | 'slash_command_session_id'
  | 'slash_command_title'
  | 'fork'

export type CommandResultDisplay = 'skip' | 'system' | 'user'

export type LocalJSXCommandOnDone = (
  result?: string,
  options?: {
    display?: CommandResultDisplay
    shouldQuery?: boolean
    metaMessages?: string[]
    nextInput?: string
    submitNextInput?: boolean
  },
) => void

/**
 * The call signature for a local JSX command implementation.
 */
export type LocalJSXCommandCall = (
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
) => Promise<React.ReactNode>

export type LocalJSXCommandModule = {
  call: LocalJSXCommandCall
}

type LocalJSXCommand = {
  type: 'local-jsx'
  

  load: () => Promise<LocalJSXCommandModule>
}

/**
 * Declares which auth/provider environments a command is available in.
 *
 * This is separate from `isEnabled()`:
 *   - `availability` = who can use this (auth/provider requirement, static)
 *   - `isEnabled()`  = is this turned on right now (GrowthBook, platform, env vars)
 *
 * Commands without `availability` are available everywhere.
 * Commands with `availability` are only shown if the user matches at least one
 * of the listed auth types. See meetsAvailabilityRequirement() in commands.ts.
 *
 * Example: `availability: ['claude-ai', 'console']` shows the command to
 * claude.ai subscribers and direct Console API key users (api.anthropic.com),
 * but hides it from Bedrock/Vertex/Foundry users and custom base URL users.
 */
export type CommandAvailability =
  // claude.ai OAuth subscriber (Pro/Max/Team/Enterprise via claude.ai)
  | 'claude-ai'
  
  | 'console'

export type CommandBase = {
  availability?: CommandAvailability[]
  description: string
  hasUserSpecifiedDescription?: boolean
  
  isEnabled?: () => boolean
  
  isHidden?: boolean
  name: string
  aliases?: string[]
  isMcp?: boolean
  argumentHint?: string 
  whenToUse?: string 
  version?: string 
  disableModelInvocation?: boolean 
  userInvocable?: boolean 
  loadedFrom?:
    | 'commands_DEPRECATED'
    | 'skills'
    | 'plugin'
    | 'managed'
    | 'bundled'
    | 'mcp' 
  kind?: 'workflow' 
  immediate?: boolean 
  isSensitive?: boolean 
  
  userFacingName?: () => string
}

export type Command = CommandBase &
  (PromptCommand | LocalCommand | LocalJSXCommand)

export function getCommandName(cmd: CommandBase): string {
  return cmd.userFacingName?.() ?? cmd.name
}

/** Resolves whether the command is enabled, defaulting to true. */
export function isCommandEnabled(cmd: CommandBase): boolean {
  return cmd.isEnabled?.() ?? true
}
