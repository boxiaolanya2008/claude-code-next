import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { findToolByName, type Tools } from '../Tool.js'
import { extractBashCommentLabel } from '../tools/BashTool/commentLabel.js'
import { BASH_TOOL_NAME } from '../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../tools/FileWriteTool/prompt.js'
import { REPL_TOOL_NAME } from '../tools/REPLTool/constants.js'
import { getReplPrimitiveTools } from '../tools/REPLTool/primitiveTools.js'
import {
  type BranchAction,
  type CommitKind,
  detectGitOperation,
  type PrAction,
} from '../tools/shared/gitOperationTracking.js'
import { TOOL_SEARCH_TOOL_NAME } from '../tools/ToolSearchTool/prompt.js'
import type {
  CollapsedReadSearchGroup,
  CollapsibleMessage,
  RenderableMessage,
  StopHookInfo,
  SystemStopHookSummaryMessage,
} from '../types/message.js'
import { getDisplayPath } from './file.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import {
  isAutoManagedMemoryFile,
  isAutoManagedMemoryPattern,
  isMemoryDirectory,
  isShellCommandTargetingMemory,
} from './memoryFileDetection.js'

const teamMemOps = feature('TEAMMEM')
  ? (require('./teamMemoryOps.js') as typeof import('./teamMemoryOps.js'))
  : null
const SNIP_TOOL_NAME = feature('HISTORY_SNIP')
  ? (
      require('../tools/SnipTool/prompt.js') as typeof import('../tools/SnipTool/prompt.js')
    ).SNIP_TOOL_NAME
  : null

export type SearchOrReadResult = {
  isCollapsible: boolean
  isSearch: boolean
  isRead: boolean
  isList: boolean
  isREPL: boolean
  
  isMemoryWrite: boolean
  

  isAbsorbedSilently: boolean
  
  mcpServerName?: string
  
  isBash?: boolean
}

function getFilePathFromToolInput(toolInput: unknown): string | undefined {
  const input = toolInput as
    | { file_path?: string; path?: string; pattern?: string; glob?: string }
    | undefined
  return input?.file_path ?? input?.path
}

function isMemorySearch(toolInput: unknown): boolean {
  const input = toolInput as
    | { path?: string; pattern?: string; glob?: string; command?: string }
    | undefined
  if (!input) {
    return false
  }
  
  if (input.path) {
    if (isAutoManagedMemoryFile(input.path) || isMemoryDirectory(input.path)) {
      return true
    }
  }
  
  if (input.glob && isAutoManagedMemoryPattern(input.glob)) {
    return true
  }
  
  
  if (input.command && isShellCommandTargetingMemory(input.command)) {
    return true
  }
  return false
}

function isMemoryWriteOrEdit(toolName: string, toolInput: unknown): boolean {
  if (toolName !== FILE_WRITE_TOOL_NAME && toolName !== FILE_EDIT_TOOL_NAME) {
    return false
  }
  const filePath = getFilePathFromToolInput(toolInput)
  return filePath !== undefined && isAutoManagedMemoryFile(filePath)
}

const MAX_HINT_CHARS = 300

function commandAsHint(command: string): string {
  const cleaned =
    '$ ' +
    command
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(l => l !== '')
      .join('\n')
  return cleaned.length > MAX_HINT_CHARS
    ? cleaned.slice(0, MAX_HINT_CHARS - 1) + '…'
    : cleaned
}

export function getToolSearchOrReadInfo(
  toolName: string,
  toolInput: unknown,
  tools: Tools,
): SearchOrReadResult {
  
  
  
  
  if (toolName === REPL_TOOL_NAME) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: true,
      isMemoryWrite: false,
      isAbsorbedSilently: true,
    }
  }

  
  if (isMemoryWriteOrEdit(toolName, toolInput)) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: true,
      isAbsorbedSilently: false,
    }
  }

  
  
  
  if (
    (feature('HISTORY_SNIP') && toolName === SNIP_TOOL_NAME) ||
    (isFullscreenEnvEnabled() && toolName === TOOL_SEARCH_TOOL_NAME)
  ) {
    return {
      isCollapsible: true,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isAbsorbedSilently: true,
    }
  }

  
  
  
  
  const tool =
    findToolByName(tools, toolName) ??
    findToolByName(getReplPrimitiveTools(), toolName)
  if (!tool?.isSearchOrReadCommand) {
    return {
      isCollapsible: false,
      isSearch: false,
      isRead: false,
      isList: false,
      isREPL: false,
      isMemoryWrite: false,
      isAbsorbedSilently: false,
    }
  }
  
  
  
  const result = tool.isSearchOrReadCommand(
    toolInput as { [x: string]: unknown },
  )
  const isList = result.isList ?? false
  const isCollapsible = result.isSearch || result.isRead || isList
  
  
  return {
    isCollapsible:
      isCollapsible ||
      (isFullscreenEnvEnabled() ? toolName === BASH_TOOL_NAME : false),
    isSearch: result.isSearch,
    isRead: result.isRead,
    isList,
    isREPL: false,
    isMemoryWrite: false,
    isAbsorbedSilently: false,
    ...(tool.isMcp && { mcpServerName: tool.mcpInfo?.serverName }),
    isBash: isFullscreenEnvEnabled()
      ? !isCollapsible && toolName === BASH_TOOL_NAME
      : undefined,
  }
}

export function getSearchOrReadFromContent(
  content: { type: string; name?: string; input?: unknown } | undefined,
  tools: Tools,
): {
  isSearch: boolean
  isRead: boolean
  isList: boolean
  isREPL: boolean
  isMemoryWrite: boolean
  isAbsorbedSilently: boolean
  mcpServerName?: string
  isBash?: boolean
} | null {
  if (content?.type === 'tool_use' && content.name) {
    const info = getToolSearchOrReadInfo(content.name, content.input, tools)
    if (info.isCollapsible || info.isREPL) {
      return {
        isSearch: info.isSearch,
        isRead: info.isRead,
        isList: info.isList,
        isREPL: info.isREPL,
        isMemoryWrite: info.isMemoryWrite,
        isAbsorbedSilently: info.isAbsorbedSilently,
        mcpServerName: info.mcpServerName,
        isBash: info.isBash,
      }
    }
  }
  return null
}

function isToolSearchOrRead(
  toolName: string,
  toolInput: unknown,
  tools: Tools,
): boolean {
  return getToolSearchOrReadInfo(toolName, toolInput, tools).isCollapsible
}

function getCollapsibleToolInfo(
  msg: RenderableMessage,
  tools: Tools,
): {
  name: string
  input: unknown
  isSearch: boolean
  isRead: boolean
  isList: boolean
  isREPL: boolean
  isMemoryWrite: boolean
  isAbsorbedSilently: boolean
  mcpServerName?: string
  isBash?: boolean
} | null {
  if (msg.type === 'assistant') {
    const content = msg.message.content[0]
    const info = getSearchOrReadFromContent(content, tools)
    if (info && content?.type === 'tool_use') {
      return { name: content.name, input: content.input, ...info }
    }
  }
  if (msg.type === 'grouped_tool_use') {
    
    const firstContent = msg.messages[0]?.message.content[0]
    const info = getSearchOrReadFromContent(
      firstContent
        ? { type: 'tool_use', name: msg.toolName, input: firstContent.input }
        : undefined,
      tools,
    )
    if (info && firstContent?.type === 'tool_use') {
      return { name: msg.toolName, input: firstContent.input, ...info }
    }
  }
  return null
}

function isTextBreaker(msg: RenderableMessage): boolean {
  if (msg.type === 'assistant') {
    const content = msg.message.content[0]
    if (content?.type === 'text' && content.text.trim().length > 0) {
      return true
    }
  }
  return false
}

function isNonCollapsibleToolUse(
  msg: RenderableMessage,
  tools: Tools,
): boolean {
  if (msg.type === 'assistant') {
    const content = msg.message.content[0]
    if (
      content?.type === 'tool_use' &&
      !isToolSearchOrRead(content.name, content.input, tools)
    ) {
      return true
    }
  }
  if (msg.type === 'grouped_tool_use') {
    const firstContent = msg.messages[0]?.message.content[0]
    if (
      firstContent?.type === 'tool_use' &&
      !isToolSearchOrRead(msg.toolName, firstContent.input, tools)
    ) {
      return true
    }
  }
  return false
}

function isPreToolHookSummary(
  msg: RenderableMessage,
): msg is SystemStopHookSummaryMessage {
  return (
    msg.type === 'system' &&
    msg.subtype === 'stop_hook_summary' &&
    msg.hookLabel === 'PreToolUse'
  )
}

function shouldSkipMessage(msg: RenderableMessage): boolean {
  if (msg.type === 'assistant') {
    const content = msg.message.content[0]
    
    if (content?.type === 'thinking' || content?.type === 'redacted_thinking') {
      return true
    }
  }
  
  if (msg.type === 'attachment') {
    return true
  }
  
  if (msg.type === 'system') {
    return true
  }
  return false
}

function isCollapsibleToolUse(
  msg: RenderableMessage,
  tools: Tools,
): msg is CollapsibleMessage {
  if (msg.type === 'assistant') {
    const content = msg.message.content[0]
    return (
      content?.type === 'tool_use' &&
      isToolSearchOrRead(content.name, content.input, tools)
    )
  }
  if (msg.type === 'grouped_tool_use') {
    const firstContent = msg.messages[0]?.message.content[0]
    return (
      firstContent?.type === 'tool_use' &&
      isToolSearchOrRead(msg.toolName, firstContent.input, tools)
    )
  }
  return false
}

function isCollapsibleToolResult(
  msg: RenderableMessage,
  collapsibleToolUseIds: Set<string>,
): msg is CollapsibleMessage {
  if (msg.type === 'user') {
    const toolResults = msg.message.content.filter(
      (c): c is { type: 'tool_result'; tool_use_id: string } =>
        c.type === 'tool_result',
    )
    
    return (
      toolResults.length > 0 &&
      toolResults.every(r => collapsibleToolUseIds.has(r.tool_use_id))
    )
  }
  return false
}

function getToolUseIdsFromMessage(msg: RenderableMessage): string[] {
  if (msg.type === 'assistant') {
    const content = msg.message.content[0]
    if (content?.type === 'tool_use') {
      return [content.id]
    }
  }
  if (msg.type === 'grouped_tool_use') {
    return msg.messages
      .map(m => {
        const content = m.message.content[0]
        return content.type === 'tool_use' ? content.id : ''
      })
      .filter(Boolean)
  }
  return []
}

export function getToolUseIdsFromCollapsedGroup(
  message: CollapsedReadSearchGroup,
): string[] {
  const ids: string[] = []
  for (const msg of message.messages) {
    ids.push(...getToolUseIdsFromMessage(msg))
  }
  return ids
}

export function hasAnyToolInProgress(
  message: CollapsedReadSearchGroup,
  inProgressToolUseIDs: Set<string>,
): boolean {
  return getToolUseIdsFromCollapsedGroup(message).some(id =>
    inProgressToolUseIDs.has(id),
  )
}

export function getDisplayMessageFromCollapsed(
  message: CollapsedReadSearchGroup,
): Exclude<CollapsibleMessage, { type: 'grouped_tool_use' }> {
  const firstMsg = message.displayMessage
  if (firstMsg.type === 'grouped_tool_use') {
    return firstMsg.displayMessage
  }
  return firstMsg
}

function countToolUses(msg: RenderableMessage): number {
  if (msg.type === 'grouped_tool_use') {
    return msg.messages.length
  }
  return 1
}

function getFilePathsFromReadMessage(msg: RenderableMessage): string[] {
  const paths: string[] = []

  if (msg.type === 'assistant') {
    const content = msg.message.content[0]
    if (content?.type === 'tool_use') {
      const input = content.input as { file_path?: string } | undefined
      if (input?.file_path) {
        paths.push(input.file_path)
      }
    }
  } else if (msg.type === 'grouped_tool_use') {
    for (const m of msg.messages) {
      const content = m.message.content[0]
      if (content?.type === 'tool_use') {
        const input = content.input as { file_path?: string } | undefined
        if (input?.file_path) {
          paths.push(input.file_path)
        }
      }
    }
  }

  return paths
}

function scanBashResultForGitOps(
  msg: CollapsibleMessage,
  group: GroupAccumulator,
): void {
  if (msg.type !== 'user') return
  const out = msg.toolUseResult as
    | { stdout?: string; stderr?: string }
    | undefined
  if (!out?.stdout && !out?.stderr) return
  
  const combined = (out.stdout ?? '') + '\n' + (out.stderr ?? '')
  for (const c of msg.message.content) {
    if (c.type !== 'tool_result') continue
    const command = group.bashCommands?.get(c.tool_use_id)
    if (!command) continue
    const { commit, push, branch, pr } = detectGitOperation(command, combined)
    if (commit) group.commits?.push(commit)
    if (push) group.pushes?.push(push)
    if (branch) group.branches?.push(branch)
    if (pr) group.prs?.push(pr)
    if (commit || push || branch || pr) {
      group.gitOpBashCount = (group.gitOpBashCount ?? 0) + 1
    }
  }
}

type GroupAccumulator = {
  messages: CollapsibleMessage[]
  searchCount: number
  readFilePaths: Set<string>
  
  readOperationCount: number
  
  listCount: number
  toolUseIds: Set<string>
  
  memorySearchCount: number
  memoryReadFilePaths: Set<string>
  memoryWriteCount: number
  
  teamMemorySearchCount?: number
  teamMemoryReadFilePaths?: Set<string>
  teamMemoryWriteCount?: number
  
  nonMemSearchArgs: string[]
  
  latestDisplayHint: string | undefined
  
  mcpCallCount?: number
  mcpServerNames?: Set<string>
  
  bashCount?: number
  
  
  bashCommands?: Map<string, string>
  commits?: { sha: string; kind: CommitKind }[]
  pushes?: { branch: string }[]
  branches?: { ref: string; action: BranchAction }[]
  prs?: { number: number; url?: string; action: PrAction }[]
  gitOpBashCount?: number
  
  hookTotalMs: number
  hookCount: number
  hookInfos: StopHookInfo[]
  
  
  
  relevantMemories?: { path: string; content: string; mtimeMs: number }[]
}

function createEmptyGroup(): GroupAccumulator {
  const group: GroupAccumulator = {
    messages: [],
    searchCount: 0,
    readFilePaths: new Set(),
    readOperationCount: 0,
    listCount: 0,
    toolUseIds: new Set(),
    memorySearchCount: 0,
    memoryReadFilePaths: new Set(),
    memoryWriteCount: 0,
    nonMemSearchArgs: [],
    latestDisplayHint: undefined,
    hookTotalMs: 0,
    hookCount: 0,
    hookInfos: [],
  }
  if (feature('TEAMMEM')) {
    group.teamMemorySearchCount = 0
    group.teamMemoryReadFilePaths = new Set()
    group.teamMemoryWriteCount = 0
  }
  group.mcpCallCount = 0
  group.mcpServerNames = new Set()
  if (isFullscreenEnvEnabled()) {
    group.bashCount = 0
    group.bashCommands = new Map()
    group.commits = []
    group.pushes = []
    group.branches = []
    group.prs = []
    group.gitOpBashCount = 0
  }
  return group
}

function createCollapsedGroup(
  group: GroupAccumulator,
): CollapsedReadSearchGroup {
  const firstMsg = group.messages[0]!
  
  
  
  
  const totalReadCount =
    group.readFilePaths.size > 0
      ? group.readFilePaths.size
      : group.readOperationCount
  
  
  
  
  const toolMemoryReadCount = group.memoryReadFilePaths.size
  const memoryReadCount =
    toolMemoryReadCount + (group.relevantMemories?.length ?? 0)
  
  const teamMemReadPaths = feature('TEAMMEM')
    ? group.teamMemoryReadFilePaths
    : undefined
  const nonMemReadFilePaths = [...group.readFilePaths].filter(
    p =>
      !group.memoryReadFilePaths.has(p) && !(teamMemReadPaths?.has(p) ?? false),
  )
  const teamMemSearchCount = feature('TEAMMEM')
    ? (group.teamMemorySearchCount ?? 0)
    : 0
  const teamMemReadCount = feature('TEAMMEM')
    ? (group.teamMemoryReadFilePaths?.size ?? 0)
    : 0
  const teamMemWriteCount = feature('TEAMMEM')
    ? (group.teamMemoryWriteCount ?? 0)
    : 0
  const result: CollapsedReadSearchGroup = {
    type: 'collapsed_read_search',
    
    searchCount: Math.max(
      0,
      group.searchCount - group.memorySearchCount - teamMemSearchCount,
    ),
    readCount: Math.max(
      0,
      totalReadCount - toolMemoryReadCount - teamMemReadCount,
    ),
    listCount: group.listCount,
    
    
    
    replCount: 0,
    memorySearchCount: group.memorySearchCount,
    memoryReadCount,
    memoryWriteCount: group.memoryWriteCount,
    readFilePaths: nonMemReadFilePaths,
    searchArgs: group.nonMemSearchArgs,
    latestDisplayHint: group.latestDisplayHint,
    messages: group.messages,
    displayMessage: firstMsg,
    uuid: `collapsed-${firstMsg.uuid}` as UUID,
    timestamp: firstMsg.timestamp,
  }
  if (feature('TEAMMEM')) {
    result.teamMemorySearchCount = teamMemSearchCount
    result.teamMemoryReadCount = teamMemReadCount
    result.teamMemoryWriteCount = teamMemWriteCount
  }
  if ((group.mcpCallCount ?? 0) > 0) {
    result.mcpCallCount = group.mcpCallCount
    result.mcpServerNames = [...(group.mcpServerNames ?? [])]
  }
  if (isFullscreenEnvEnabled()) {
    if ((group.bashCount ?? 0) > 0) {
      result.bashCount = group.bashCount
      result.gitOpBashCount = group.gitOpBashCount
    }
    if ((group.commits?.length ?? 0) > 0) result.commits = group.commits
    if ((group.pushes?.length ?? 0) > 0) result.pushes = group.pushes
    if ((group.branches?.length ?? 0) > 0) result.branches = group.branches
    if ((group.prs?.length ?? 0) > 0) result.prs = group.prs
  }
  if (group.hookCount > 0) {
    result.hookTotalMs = group.hookTotalMs
    result.hookCount = group.hookCount
    result.hookInfos = group.hookInfos
  }
  if (group.relevantMemories && group.relevantMemories.length > 0) {
    result.relevantMemories = group.relevantMemories
  }
  return result
}

export function collapseReadSearchGroups(
  messages: RenderableMessage[],
  tools: Tools,
): RenderableMessage[] {
  const result: RenderableMessage[] = []
  let currentGroup = createEmptyGroup()
  let deferredSkippable: RenderableMessage[] = []

  function flushGroup(): void {
    if (currentGroup.messages.length === 0) {
      return
    }
    result.push(createCollapsedGroup(currentGroup))
    for (const deferred of deferredSkippable) {
      result.push(deferred)
    }
    deferredSkippable = []
    currentGroup = createEmptyGroup()
  }

  for (const msg of messages) {
    if (isCollapsibleToolUse(msg, tools)) {
      
      const toolInfo = getCollapsibleToolInfo(msg, tools)!

      if (toolInfo.isMemoryWrite) {
        
        const count = countToolUses(msg)
        if (
          feature('TEAMMEM') &&
          teamMemOps?.isTeamMemoryWriteOrEdit(toolInfo.name, toolInfo.input)
        ) {
          currentGroup.teamMemoryWriteCount =
            (currentGroup.teamMemoryWriteCount ?? 0) + count
        } else {
          currentGroup.memoryWriteCount += count
        }
      } else if (toolInfo.isAbsorbedSilently) {
        
        
        
      } else if (toolInfo.mcpServerName) {
        
        
        const count = countToolUses(msg)
        currentGroup.mcpCallCount = (currentGroup.mcpCallCount ?? 0) + count
        currentGroup.mcpServerNames?.add(toolInfo.mcpServerName)
        const input = toolInfo.input as { query?: string } | undefined
        if (input?.query) {
          currentGroup.latestDisplayHint = `"${input.query}"`
        }
      } else if (isFullscreenEnvEnabled() && toolInfo.isBash) {
        
        
        const count = countToolUses(msg)
        currentGroup.bashCount = (currentGroup.bashCount ?? 0) + count
        const input = toolInfo.input as { command?: string } | undefined
        if (input?.command) {
          
          
          currentGroup.latestDisplayHint =
            extractBashCommentLabel(input.command) ??
            commandAsHint(input.command)
          
          
          for (const id of getToolUseIdsFromMessage(msg)) {
            currentGroup.bashCommands?.set(id, input.command)
          }
        }
      } else if (toolInfo.isList) {
        
        
        currentGroup.listCount += countToolUses(msg)
        const input = toolInfo.input as { command?: string } | undefined
        if (input?.command) {
          currentGroup.latestDisplayHint = commandAsHint(input.command)
        }
      } else if (toolInfo.isSearch) {
        
        const count = countToolUses(msg)
        currentGroup.searchCount += count
        
        if (
          feature('TEAMMEM') &&
          teamMemOps?.isTeamMemorySearch(toolInfo.input)
        ) {
          currentGroup.teamMemorySearchCount =
            (currentGroup.teamMemorySearchCount ?? 0) + count
        } else if (isMemorySearch(toolInfo.input)) {
          currentGroup.memorySearchCount += count
        } else {
          
          const input = toolInfo.input as { pattern?: string } | undefined
          if (input?.pattern) {
            currentGroup.nonMemSearchArgs.push(input.pattern)
            currentGroup.latestDisplayHint = `"${input.pattern}"`
          }
        }
      } else {
        
        const filePaths = getFilePathsFromReadMessage(msg)
        for (const filePath of filePaths) {
          currentGroup.readFilePaths.add(filePath)
          if (feature('TEAMMEM') && teamMemOps?.isTeamMemFile(filePath)) {
            currentGroup.teamMemoryReadFilePaths?.add(filePath)
          } else if (isAutoManagedMemoryFile(filePath)) {
            currentGroup.memoryReadFilePaths.add(filePath)
          } else {
            
            currentGroup.latestDisplayHint = getDisplayPath(filePath)
          }
        }
        
        if (filePaths.length === 0) {
          currentGroup.readOperationCount += countToolUses(msg)
          
          const input = toolInfo.input as { command?: string } | undefined
          if (input?.command) {
            currentGroup.latestDisplayHint = commandAsHint(input.command)
          }
        }
      }

      
      for (const id of getToolUseIdsFromMessage(msg)) {
        currentGroup.toolUseIds.add(id)
      }

      currentGroup.messages.push(msg)
    } else if (isCollapsibleToolResult(msg, currentGroup.toolUseIds)) {
      currentGroup.messages.push(msg)
      
      if (isFullscreenEnvEnabled() && currentGroup.bashCommands?.size) {
        scanBashResultForGitOps(msg, currentGroup)
      }
    } else if (currentGroup.messages.length > 0 && isPreToolHookSummary(msg)) {
      
      currentGroup.hookCount += msg.hookCount
      currentGroup.hookTotalMs +=
        msg.totalDurationMs ??
        msg.hookInfos.reduce((sum, h) => sum + (h.durationMs ?? 0), 0)
      currentGroup.hookInfos.push(...msg.hookInfos)
    } else if (
      currentGroup.messages.length > 0 &&
      msg.type === 'attachment' &&
      msg.attachment.type === 'relevant_memories'
    ) {
      
      
      
      
      
      
      
      currentGroup.relevantMemories ??= []
      currentGroup.relevantMemories.push(...msg.attachment.memories)
    } else if (shouldSkipMessage(msg)) {
      
      
      
      
      
      
      if (
        currentGroup.messages.length > 0 &&
        !(msg.type === 'attachment' && msg.attachment.type === 'nested_memory')
      ) {
        deferredSkippable.push(msg)
      } else {
        result.push(msg)
      }
    } else if (isTextBreaker(msg)) {
      
      flushGroup()
      result.push(msg)
    } else if (isNonCollapsibleToolUse(msg, tools)) {
      
      flushGroup()
      result.push(msg)
    } else {
      
      flushGroup()
      result.push(msg)
    }
  }

  flushGroup()
  return result
}

export function getSearchReadSummaryText(
  searchCount: number,
  readCount: number,
  isActive: boolean,
  replCount: number = 0,
  memoryCounts?: {
    memorySearchCount: number
    memoryReadCount: number
    memoryWriteCount: number
    teamMemorySearchCount?: number
    teamMemoryReadCount?: number
    teamMemoryWriteCount?: number
  },
  listCount: number = 0,
): string {
  const parts: string[] = []

  
  if (memoryCounts) {
    const { memorySearchCount, memoryReadCount, memoryWriteCount } =
      memoryCounts
    if (memoryReadCount > 0) {
      const verb = isActive
        ? parts.length === 0
          ? 'Recalling'
          : 'recalling'
        : parts.length === 0
          ? 'Recalled'
          : 'recalled'
      parts.push(
        `${verb} ${memoryReadCount} ${memoryReadCount === 1 ? 'memory' : 'memories'}`,
      )
    }
    if (memorySearchCount > 0) {
      const verb = isActive
        ? parts.length === 0
          ? 'Searching'
          : 'searching'
        : parts.length === 0
          ? 'Searched'
          : 'searched'
      parts.push(`${verb} memories`)
    }
    if (memoryWriteCount > 0) {
      const verb = isActive
        ? parts.length === 0
          ? 'Writing'
          : 'writing'
        : parts.length === 0
          ? 'Wrote'
          : 'wrote'
      parts.push(
        `${verb} ${memoryWriteCount} ${memoryWriteCount === 1 ? 'memory' : 'memories'}`,
      )
    }
    
    if (feature('TEAMMEM') && teamMemOps) {
      teamMemOps.appendTeamMemorySummaryParts(memoryCounts, isActive, parts)
    }
  }

  if (searchCount > 0) {
    const searchVerb = isActive
      ? parts.length === 0
        ? 'Searching for'
        : 'searching for'
      : parts.length === 0
        ? 'Searched for'
        : 'searched for'
    parts.push(
      `${searchVerb} ${searchCount} ${searchCount === 1 ? 'pattern' : 'patterns'}`,
    )
  }

  if (readCount > 0) {
    const readVerb = isActive
      ? parts.length === 0
        ? 'Reading'
        : 'reading'
      : parts.length === 0
        ? 'Read'
        : 'read'
    parts.push(`${readVerb} ${readCount} ${readCount === 1 ? 'file' : 'files'}`)
  }

  if (listCount > 0) {
    const listVerb = isActive
      ? parts.length === 0
        ? 'Listing'
        : 'listing'
      : parts.length === 0
        ? 'Listed'
        : 'listed'
    parts.push(
      `${listVerb} ${listCount} ${listCount === 1 ? 'directory' : 'directories'}`,
    )
  }

  if (replCount > 0) {
    const replVerb = isActive ? "REPL'ing" : "REPL'd"
    parts.push(`${replVerb} ${replCount} ${replCount === 1 ? 'time' : 'times'}`)
  }

  const text = parts.join(', ')
  return isActive ? `${text}…` : text
}

export function summarizeRecentActivities(
  activities: readonly {
    activityDescription?: string
    isSearch?: boolean
    isRead?: boolean
  }[],
): string | undefined {
  if (activities.length === 0) {
    return undefined
  }
  
  let searchCount = 0
  let readCount = 0
  for (let i = activities.length - 1; i >= 0; i--) {
    const activity = activities[i]!
    if (activity.isSearch) {
      searchCount++
    } else if (activity.isRead) {
      readCount++
    } else {
      break
    }
  }
  const collapsibleCount = searchCount + readCount
  if (collapsibleCount >= 2) {
    return getSearchReadSummaryText(searchCount, readCount, true)
  }
  
  
  for (let i = activities.length - 1; i >= 0; i--) {
    if (activities[i]?.activityDescription) {
      return activities[i]!.activityDescription
    }
  }
  return undefined
}
