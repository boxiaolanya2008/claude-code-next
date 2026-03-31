import type { UUID } from 'crypto'
import type { FileHistorySnapshot } from 'src/utils/fileHistory.js'
import type { ContentReplacementRecord } from 'src/utils/toolResultStorage.js'
import type { AgentId } from './ids.js'
import type { Message } from './message.js'
import type { QueueOperationMessage } from './messageQueueTypes.js'

export type SerializedMessage = Message & {
  cwd: string
  userType: string
  entrypoint?: string 
  sessionId: string
  timestamp: string
  version: string
  gitBranch?: string
  slug?: string 
}

export type LogOption = {
  date: string
  messages: SerializedMessage[]
  fullPath?: string
  value: number
  created: Date
  modified: Date
  firstPrompt: string
  messageCount: number
  fileSize?: number 
  isSidechain: boolean
  isLite?: boolean 
  sessionId?: string 
  teamName?: string 
  agentName?: string 
  agentColor?: string 
  agentSetting?: string 
  isTeammate?: boolean 
  leafUuid?: UUID 
  summary?: string 
  customTitle?: string 
  tag?: string 
  fileHistorySnapshots?: FileHistorySnapshot[] 
  attributionSnapshots?: AttributionSnapshotMessage[] 
  contextCollapseCommits?: ContextCollapseCommitEntry[] 
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry 
  gitBranch?: string 
  projectPath?: string 
  prNumber?: number 
  prUrl?: string 
  prRepository?: string 
  mode?: 'coordinator' | 'normal' 
  worktreeSession?: PersistedWorktreeSession | null 
  contentReplacements?: ContentReplacementRecord[] 
}

export type SummaryMessage = {
  type: 'summary'
  leafUuid: UUID
  summary: string
}

export type CustomTitleMessage = {
  type: 'custom-title'
  sessionId: UUID
  customTitle: string
}

export type AiTitleMessage = {
  type: 'ai-title'
  sessionId: UUID
  aiTitle: string
}

export type LastPromptMessage = {
  type: 'last-prompt'
  sessionId: UUID
  lastPrompt: string
}

export type TaskSummaryMessage = {
  type: 'task-summary'
  sessionId: UUID
  summary: string
  timestamp: string
}

export type TagMessage = {
  type: 'tag'
  sessionId: UUID
  tag: string
}

export type AgentNameMessage = {
  type: 'agent-name'
  sessionId: UUID
  agentName: string
}

export type AgentColorMessage = {
  type: 'agent-color'
  sessionId: UUID
  agentColor: string
}

export type AgentSettingMessage = {
  type: 'agent-setting'
  sessionId: UUID
  agentSetting: string
}

export type PRLinkMessage = {
  type: 'pr-link'
  sessionId: UUID
  prNumber: number
  prUrl: string
  prRepository: string 
  timestamp: string 
}

export type ModeEntry = {
  type: 'mode'
  sessionId: UUID
  mode: 'coordinator' | 'normal'
}

export type PersistedWorktreeSession = {
  originalCwd: string
  worktreePath: string
  worktreeName: string
  worktreeBranch?: string
  originalBranch?: string
  originalHeadCommit?: string
  sessionId: string
  tmuxSessionName?: string
  hookBased?: boolean
}

export type WorktreeStateEntry = {
  type: 'worktree-state'
  sessionId: UUID
  worktreeSession: PersistedWorktreeSession | null
}

export type ContentReplacementEntry = {
  type: 'content-replacement'
  sessionId: UUID
  agentId?: AgentId
  replacements: ContentReplacementRecord[]
}

export type FileHistorySnapshotMessage = {
  type: 'file-history-snapshot'
  messageId: UUID
  snapshot: FileHistorySnapshot
  isSnapshotUpdate: boolean
}

export type FileAttributionState = {
  contentHash: string 
  claudeContribution: number 
  mtime: number 
}

export type AttributionSnapshotMessage = {
  type: 'attribution-snapshot'
  messageId: UUID
  surface: string 
  fileStates: Record<string, FileAttributionState>
  promptCount?: number 
  promptCountAtLastCommit?: number 
  permissionPromptCount?: number 
  permissionPromptCountAtLastCommit?: number 
  escapeCount?: number 
  escapeCountAtLastCommit?: number 
}

export type TranscriptMessage = SerializedMessage & {
  parentUuid: UUID | null
  logicalParentUuid?: UUID | null 
  isSidechain: boolean
  gitBranch?: string
  agentId?: string 
  teamName?: string 
  agentName?: string 
  agentColor?: string 
  promptId?: string 
}

export type SpeculationAcceptMessage = {
  type: 'speculation-accept'
  timestamp: string
  timeSavedMs: number
}

export type ContextCollapseCommitEntry = {
  type: 'marble-origami-commit'
  sessionId: UUID
  
  collapseId: string
  
  summaryUuid: string
  
  summaryContent: string
  
  summary: string
  
  firstArchivedUuid: string
  lastArchivedUuid: string
}

export type ContextCollapseSnapshotEntry = {
  type: 'marble-origami-snapshot'
  sessionId: UUID
  staged: Array<{
    startUuid: string
    endUuid: string
    summary: string
    risk: number
    stagedAt: number
  }>
  
  armed: boolean
  lastSpawnTokens: number
}

export type Entry =
  | TranscriptMessage
  | SummaryMessage
  | CustomTitleMessage
  | AiTitleMessage
  | LastPromptMessage
  | TaskSummaryMessage
  | TagMessage
  | AgentNameMessage
  | AgentColorMessage
  | AgentSettingMessage
  | PRLinkMessage
  | FileHistorySnapshotMessage
  | AttributionSnapshotMessage
  | QueueOperationMessage
  | SpeculationAcceptMessage
  | ModeEntry
  | WorktreeStateEntry
  | ContentReplacementEntry
  | ContextCollapseCommitEntry
  | ContextCollapseSnapshotEntry

export function sortLogs(logs: LogOption[]): LogOption[] {
  return logs.sort((a, b) => {
    
    const modifiedDiff = b.modified.getTime() - a.modified.getTime()
    if (modifiedDiff !== 0) {
      return modifiedDiff
    }

    
    return b.created.getTime() - a.created.getTime()
  })
}
