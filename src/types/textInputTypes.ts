import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { UUID } from 'crypto'
import type React from 'react'
import type { PermissionResult } from '../entrypoints/agentSdkTypes.js'
import type { Key } from '../ink.js'
import type { PastedContent } from '../utils/config.js'
import type { ImageDimensions } from '../utils/imageResizer.js'
import type { TextHighlight } from '../utils/textHighlighting.js'
import type { AgentId } from './ids.js'
import type { AssistantMessage, MessageOrigin } from './message.js'

export type InlineGhostText = {
  /** The ghost text to display (e.g., "mit" for /commit) */
  readonly text: string
  
  readonly fullCommand: string
  
  readonly insertPosition: number
}

/**
 * Base props for text input components
 */
export type BaseTextInputProps = {
  /**
   * Optional callback for handling history navigation on up arrow at start of input
   */
  readonly onHistoryUp?: () => void

  /**
   * Optional callback for handling history navigation on down arrow at end of input
   */
  readonly onHistoryDown?: () => void

  /**
   * Text to display when `value` is empty.
   */
  readonly placeholder?: string

  

  readonly multiline?: boolean

  

  readonly focus?: boolean

  

  readonly mask?: string

  

  readonly showCursor?: boolean

  

  readonly highlightPastedText?: boolean

  

  readonly value: string

  

  readonly onChange: (value: string) => void

  /**
   * Function to call when `Enter` is pressed, where first argument is a value of the input.
   */
  readonly onSubmit?: (value: string) => void

  /**
   * Function to call when Ctrl+C is pressed to exit.
   */
  readonly onExit?: () => void

  /**
   * Optional callback to show exit message
   */
  readonly onExitMessage?: (show: boolean, key?: string) => void

  /**
   * Optional callback to show custom message
   */
  

  /**
   * Optional callback to reset history position
   */
  readonly onHistoryReset?: () => void

  /**
   * Optional callback when input is cleared (e.g., double-escape)
   */
  readonly onClearInput?: () => void

  /**
   * Number of columns to wrap text at
   */
  readonly columns: number

  

  readonly maxVisibleLines?: number

  

  readonly onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void

  /**
   * Optional callback when a large text (over 800 chars) is pasted
   */
  readonly onPaste?: (text: string) => void

  /**
   * Callback when the pasting state changes
   */
  readonly onIsPastingChange?: (isPasting: boolean) => void

  /**
   * Whether to disable cursor movement for up/down arrow keys
   */
  readonly disableCursorMovementForUpDownKeys?: boolean

  

  readonly disableEscapeDoublePress?: boolean

  

  readonly cursorOffset: number

  

  onChangeCursorOffset: (offset: number) => void

  /**
   * Optional hint text to display after command input
   * Used for showing available arguments for commands
   */
  readonly argumentHint?: string

  

  readonly onUndo?: () => void

  /**
   * Whether to render the text with dim color
   */
  readonly dimColor?: boolean

  

  readonly highlights?: TextHighlight[]

  

  readonly placeholderElement?: React.ReactNode

  

  readonly inlineGhostText?: InlineGhostText

  

  readonly inputFilter?: (input: string, key: Key) => string
}

/**
 * Extended props for VimTextInput
 */
export type VimTextInputProps = BaseTextInputProps & {
  /**
   * Initial vim mode to use
   */
  readonly initialMode?: VimMode

  

  readonly onModeChange?: (mode: VimMode) => void
}

/**
 * Vim editor modes
 */
export type VimMode = 'INSERT' | 'NORMAL'

export type BaseInputState = {
  onInput: (input: string, key: Key) => void
  renderedValue: string
  offset: number
  setOffset: (offset: number) => void
  /** Cursor line (0-indexed) within the rendered text, accounting for wrapping. */
  cursorLine: number
  
  cursorColumn: number
  
  viewportCharOffset: number
  
  viewportCharEnd: number

  
  isPasting?: boolean
  pasteState?: {
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }
}

/**
 * State for text input
 */
export type TextInputState = BaseInputState

export type VimInputState = BaseInputState & {
  mode: VimMode
  setMode: (mode: VimMode) => void
}

/**
 * Input modes for the prompt
 */
export type PromptInputMode =
  | 'bash'
  | 'prompt'
  | 'orphaned-permission'
  | 'task-notification'

export type EditablePromptInputMode = Exclude<
  PromptInputMode,
  `${string}-notification`
>

export type QueuePriority = 'now' | 'next' | 'later'

export type QueuedCommand = {
  value: string | Array<ContentBlockParam>
  mode: PromptInputMode
  
  priority?: QueuePriority
  uuid?: UUID
  orphanedPermission?: OrphanedPermission
  
  pastedContents?: Record<number, PastedContent>
  

  preExpansionValue?: string
  

  skipSlashCommands?: boolean
  

  bridgeOrigin?: boolean
  

  isMeta?: boolean
  

  origin?: MessageOrigin
  

  workload?: string
  

  agentId?: AgentId
}

/**
 * Type guard for image PastedContent with non-empty data. Empty-content
 * images (e.g. from a 0-byte file drag) yield empty base64 strings that
 * the API rejects with `image cannot be empty`. Use this at every site
 * that converts PastedContent → ImageBlockParam so the filter and the
 * ID list stay in sync.
 */
export function isValidImagePaste(c: PastedContent): boolean {
  return c.type === 'image' && c.content.length > 0
}

/** Extract image paste IDs from a QueuedCommand's pastedContents. */
export function getImagePasteIds(
  pastedContents: Record<number, PastedContent> | undefined,
): number[] | undefined {
  if (!pastedContents) {
    return undefined
  }
  const ids = Object.values(pastedContents)
    .filter(isValidImagePaste)
    .map(c => c.id)
  return ids.length > 0 ? ids : undefined
}

export type OrphanedPermission = {
  permissionResult: PermissionResult
  assistantMessage: AssistantMessage
}
