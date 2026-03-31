

import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'

export const KEYBINDING_CONTEXTS = [
  'Global',
  'Chat',
  'Autocomplete',
  'Confirmation',
  'Help',
  'Transcript',
  'HistorySearch',
  'Task',
  'ThemePicker',
  'Settings',
  'Tabs',
  
  'Attachments',
  'Footer',
  'MessageSelector',
  'DiffDialog',
  'ModelPicker',
  'Select',
  'Plugin',
] as const

export const KEYBINDING_CONTEXT_DESCRIPTIONS: Record<
  (typeof KEYBINDING_CONTEXTS)[number],
  string
> = {
  Global: 'Active everywhere, regardless of focus',
  Chat: 'When the chat input is focused',
  Autocomplete: 'When autocomplete menu is visible',
  Confirmation: 'When a confirmation/permission dialog is shown',
  Help: 'When the help overlay is open',
  Transcript: 'When viewing the transcript',
  HistorySearch: 'When searching command history (ctrl+r)',
  Task: 'When a task/agent is running in the foreground',
  ThemePicker: 'When the theme picker is open',
  Settings: 'When the settings menu is open',
  Tabs: 'When tab navigation is active',
  Attachments: 'When navigating image attachments in a select dialog',
  Footer: 'When footer indicators are focused',
  MessageSelector: 'When the message selector (rewind) is open',
  DiffDialog: 'When the diff dialog is open',
  ModelPicker: 'When the model picker is open',
  Select: 'When a select/list component is focused',
  Plugin: 'When the plugin dialog is open',
}

export const KEYBINDING_ACTIONS = [
  
  'app:interrupt',
  'app:exit',
  'app:toggleTodos',
  'app:toggleTranscript',
  'app:toggleBrief',
  'app:toggleTeammatePreview',
  'app:toggleTerminal',
  'app:redraw',
  'app:globalSearch',
  'app:quickOpen',
  
  'history:search',
  'history:previous',
  'history:next',
  
  'chat:cancel',
  'chat:killAgents',
  'chat:cycleMode',
  'chat:modelPicker',
  'chat:fastMode',
  'chat:thinkingToggle',
  'chat:submit',
  'chat:newline',
  'chat:undo',
  'chat:externalEditor',
  'chat:stash',
  'chat:imagePaste',
  'chat:messageActions',
  
  'autocomplete:accept',
  'autocomplete:dismiss',
  'autocomplete:previous',
  'autocomplete:next',
  
  'confirm:yes',
  'confirm:no',
  'confirm:previous',
  'confirm:next',
  'confirm:nextField',
  'confirm:previousField',
  'confirm:cycleMode',
  'confirm:toggle',
  'confirm:toggleExplanation',
  
  'tabs:next',
  'tabs:previous',
  
  'transcript:toggleShowAll',
  'transcript:exit',
  
  'historySearch:next',
  'historySearch:accept',
  'historySearch:cancel',
  'historySearch:execute',
  
  'task:background',
  
  'theme:toggleSyntaxHighlighting',
  
  'help:dismiss',
  
  'attachments:next',
  'attachments:previous',
  'attachments:remove',
  'attachments:exit',
  
  'footer:up',
  'footer:down',
  'footer:next',
  'footer:previous',
  'footer:openSelected',
  'footer:clearSelection',
  'footer:close',
  
  'messageSelector:up',
  'messageSelector:down',
  'messageSelector:top',
  'messageSelector:bottom',
  'messageSelector:select',
  
  'diff:dismiss',
  'diff:previousSource',
  'diff:nextSource',
  'diff:back',
  'diff:viewDetails',
  'diff:previousFile',
  'diff:nextFile',
  
  'modelPicker:decreaseEffort',
  'modelPicker:increaseEffort',
  
  'select:next',
  'select:previous',
  'select:accept',
  'select:cancel',
  
  'plugin:toggle',
  'plugin:install',
  
  'permission:toggleDebug',
  
  'settings:search',
  'settings:retry',
  'settings:close',
  
  'voice:pushToTalk',
] as const

export const KeybindingBlockSchema = lazySchema(() =>
  z
    .object({
      context: z
        .enum(KEYBINDING_CONTEXTS)
        .describe(
          'UI context where these bindings apply. Global bindings work everywhere.',
        ),
      bindings: z
        .record(
          z
            .string()
            .describe('Keystroke pattern (e.g., "ctrl+k", "shift+tab")'),
          z
            .union([
              z.enum(KEYBINDING_ACTIONS),
              z
                .string()
                .regex(/^command:[a-zA-Z0-9:\-_]+$/)
                .describe(
                  'Command binding (e.g., "command:help", "command:compact"). Executes the slash command as if typed.',
                ),
              z.null().describe('Set to null to unbind a default shortcut'),
            ])
            .describe(
              'Action to trigger, command to invoke, or null to unbind',
            ),
        )
        .describe('Map of keystroke patterns to actions'),
    })
    .describe('A block of keybindings for a specific context'),
)

export const KeybindingsSchema = lazySchema(() =>
  z
    .object({
      $schema: z
        .string()
        .optional()
        .describe('JSON Schema URL for editor validation'),
      $docs: z.string().optional().describe('Documentation URL'),
      bindings: z
        .array(KeybindingBlockSchema())
        .describe('Array of keybinding blocks by context'),
    })
    .describe(
      'Claude Code Next keybindings configuration. Customize keyboard shortcuts by context.',
    ),
)

export type KeybindingsSchemaType = z.infer<
  ReturnType<typeof KeybindingsSchema>
>
