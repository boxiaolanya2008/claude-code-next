

import type { Tool, ToolUseContext } from '../../Tool.js'
import type { BuiltInAgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import { runAgent } from '../../tools/AgentTool/runAgent.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import {
  FileReadTool,
  type Output as FileReadToolOutput,
  registerFileReadListener,
} from '../../tools/FileReadTool/FileReadTool.js'
import { isFsInaccessible } from '../../utils/errors.js'
import { cloneFileStateCache } from '../../utils/fileStateCache.js'
import {
  type REPLHookContext,
  registerPostSamplingHook,
} from '../../utils/hooks/postSamplingHooks.js'
import {
  createUserMessage,
  hasToolCallsInLastAssistantTurn,
} from '../../utils/messages.js'
import { sequential } from '../../utils/sequential.js'
import { buildMagicDocsUpdatePrompt } from './prompts.js'

const MAGIC_DOC_HEADER_PATTERN = /^#\s*MAGIC\s+DOC:\s*(.+)$/im

const ITALICS_PATTERN = /^[_*](.+?)[_*]\s*$/m

type MagicDocInfo = {
  path: string
}

const trackedMagicDocs = new Map<string, MagicDocInfo>()

export function clearTrackedMagicDocs(): void {
  trackedMagicDocs.clear()
}

/**
 * Detect if a file content contains a Magic Doc header
 * Returns an object with title and optional instructions, or null if not a magic doc
 */
export function detectMagicDocHeader(
  content: string,
): { title: string; instructions?: string } | null {
  const match = content.match(MAGIC_DOC_HEADER_PATTERN)
  if (!match || !match[1]) {
    return null
  }

  const title = match[1].trim()

  
  const headerEndIndex = match.index! + match[0].length
  const afterHeader = content.slice(headerEndIndex)
  
  const nextLineMatch = afterHeader.match(/^\s*\n(?:\s*\n)?(.+?)(?:\n|$)/)

  if (nextLineMatch && nextLineMatch[1]) {
    const nextLine = nextLineMatch[1]
    const italicsMatch = nextLine.match(ITALICS_PATTERN)
    if (italicsMatch && italicsMatch[1]) {
      const instructions = italicsMatch[1].trim()
      return {
        title,
        instructions,
      }
    }
  }

  return { title }
}

/**
 * Register a file as a Magic Doc when it's read
 * Only registers once per file path - the hook always reads latest content
 */
export function registerMagicDoc(filePath: string): void {
  // Only register if not already tracked
  if (!trackedMagicDocs.has(filePath)) {
    trackedMagicDocs.set(filePath, {
      path: filePath,
    })
  }
}

/**
 * Create Magic Docs agent definition
 */
function getMagicDocsAgent(): BuiltInAgentDefinition {
  return {
    agentType: 'magic-docs',
    whenToUse: 'Update Magic Docs',
    tools: [FILE_EDIT_TOOL_NAME], // Only allow Edit
    model: 'sonnet',
    source: 'built-in',
    baseDir: 'built-in',
    getSystemPrompt: () => '', // Will use override systemPrompt
  }
}

/**
 * Update a single Magic Doc
 */
async function updateMagicDoc(
  docInfo: MagicDocInfo,
  context: REPLHookContext,
): Promise<void> {
  const { messages, systemPrompt, userContext, systemContext, toolUseContext } =
    context

  
  
  
  const clonedReadFileState = cloneFileStateCache(toolUseContext.readFileState)
  clonedReadFileState.delete(docInfo.path)
  const clonedToolUseContext: ToolUseContext = {
    ...toolUseContext,
    readFileState: clonedReadFileState,
  }

  // Read the document; if deleted or unreadable, remove from tracking
  let currentDoc = ''
  try {
    const result = await FileReadTool.call(
      { file_path: docInfo.path },
      clonedToolUseContext,
    )
    const output = result.data as FileReadToolOutput
    if (output.type === 'text') {
      currentDoc = output.file.content
    }
  } catch (e: unknown) {
    // FileReadTool wraps ENOENT in a plain Error("File does not exist...") with
    
    if (
      isFsInaccessible(e) ||
      (e instanceof Error && e.message.startsWith('File does not exist'))
    ) {
      trackedMagicDocs.delete(docInfo.path)
      return
    }
    throw e
  }

  // Re-detect title and instructions from latest file content
  const detected = detectMagicDocHeader(currentDoc)
  if (!detected) {
    // File no longer has magic doc header, remove from tracking
    trackedMagicDocs.delete(docInfo.path)
    return
  }

  // Build update prompt with latest title and instructions
  const userPrompt = await buildMagicDocsUpdatePrompt(
    currentDoc,
    docInfo.path,
    detected.title,
    detected.instructions,
  )

  
  const canUseTool = async (tool: Tool, input: unknown) => {
    if (
      tool.name === FILE_EDIT_TOOL_NAME &&
      typeof input === 'object' &&
      input !== null &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && filePath === docInfo.path) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }
    return {
      behavior: 'deny' as const,
      message: `only ${FILE_EDIT_TOOL_NAME} is allowed for ${docInfo.path}`,
      decisionReason: {
        type: 'other' as const,
        reason: `only ${FILE_EDIT_TOOL_NAME} is allowed`,
      },
    }
  }

  // Run Magic Docs update using runAgent with forked context
  for await (const _message of runAgent({
    agentDefinition: getMagicDocsAgent(),
    promptMessages: [createUserMessage({ content: userPrompt })],
    toolUseContext: clonedToolUseContext,
    canUseTool,
    isAsync: true,
    forkContextMessages: messages,
    querySource: 'magic_docs',
    override: {
      systemPrompt,
      userContext,
      systemContext,
    },
    availableTools: clonedToolUseContext.options.tools,
  })) {
    // Just consume - let it run to completion
  }
}

/**
 * Magic Docs post-sampling hook that updates all tracked Magic Docs
 */
const updateMagicDocs = sequential(async function (
  context: REPLHookContext,
): Promise<void> {
  const { messages, querySource } = context

  if (querySource !== 'repl_main_thread') {
    return
  }

  // Only update when conversation is idle (no tool calls in last turn)
  const hasToolCalls = hasToolCallsInLastAssistantTurn(messages)
  if (hasToolCalls) {
    return
  }

  const docCount = trackedMagicDocs.size
  if (docCount === 0) {
    return
  }

  for (const docInfo of Array.from(trackedMagicDocs.values())) {
    await updateMagicDoc(docInfo, context)
  }
})

export async function initMagicDocs(): Promise<void> {
  if (process.env.USER_TYPE === 'ant') {
    // Register listener to detect magic docs when files are read
    registerFileReadListener((filePath: string, content: string) => {
      const result = detectMagicDocHeader(content)
      if (result) {
        registerMagicDoc(filePath)
      }
    })

    registerPostSamplingHook(updateMagicDocs)
  }
}
