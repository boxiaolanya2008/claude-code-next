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

/**
 * AI-generated session title. Distinct from CustomTitleMessage so that:
 * - User renames (custom-title) always win over AI titles in read preference
 * - reAppendSessionMetadata never re-appends AI titles (they're ephemeral/
 *   regeneratable; re-appending would clobber user renames on resume)
 * - VS Code's onlyIfNoCustomTitle CAS check only matches user titles,
 *   allowing AI to overwrite its own previous AI title but not user titles
 */
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

/**
 * Periodic fork-generated summary of what the agent is currently doing.
 * Written every min(5 steps, 2min) by forking the main thread mid-turn so
 * `claude ps` can show something more useful than the last user prompt
 * (which is often "ok go" or "fix it").
 */
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

/**
 * PR link message stored in session transcript.
 * Links a session to a GitHub pull request for tracking and navigation.
 */
export type PRLinkMessage = {
  type: 'pr-link'
  sessionId: UUID
  prNumber: number
  prUrl: string
  prRepository: string // e.g., "owner/repo"
  timestamp: string // ISO timestamp when linked
}

export type ModeEntry = {
  type: 'mode'
  sessionId: UUID
  mode: 'coordinator' | 'normal'
}

/**
 * Worktree session state persisted to the transcript for resume.
 * Subset of WorktreeSession from utils/worktree.ts — excludes ephemeral
 * fields (creationDurationMs, usedSparsePaths) that are only used for
 * first-run analytics.
 */
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

/**
 * Records whether the session is currently inside a worktree created by
 * EnterWorktree or --worktree. Last-wins: an enter writes the session,
 * an exit writes null. On --resume, restored only if the worktreePath
 * still exists on disk (the /exit dialog may have removed it).
 */
export type WorktreeStateEntry = {
  type: 'worktree-state'
  sessionId: UUID
  worktreeSession: PersistedWorktreeSession | null
}

/**
 * Records content blocks whose in-context representation was replaced with a
 * smaller stub (the full content was persisted elsewhere). Replayed on resume
 * for prompt cache stability. Written once per enforcement pass that replaces
 * at least one block. When agentId is set, the record belongs to a subagent
 * sidechain (AgentTool resume reads these); when absent, it's main-thread
 * (/resume reads these).
 */
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

/**
 * Per-file attribution state tracking Claude's character contributions.
 */
export type FileAttributionState = {
  contentHash: string 
  claudeContribution: number 
  mtime: number 
}

/**
 * Attribution snapshot message stored in session transcript.
 * Tracks character-level contributions by Claude for commit attribution.
 */
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

/**
 * Persisted context-collapse commit. The archived messages themselves are
 * NOT persisted — they're already in the transcript as ordinary user/
 * assistant messages. We only persist enough to reconstruct the splice
 * instruction (boundary uuids) and the summary placeholder (which is NOT
 * in the transcript because it's never yielded to the REPL).
 *
 * On restore, the store reconstructs CommittedCollapse with archived=[];
 * projectView lazily fills the archive the first time it finds the span.
 *
 * Discriminator is obfuscated to match the gate name. sessionStorage.ts
 * isn't feature-gated (it's the generic transcript plumbing used by every
 * entry type), so a descriptive string here would leak into external builds
 * via the appendEntry dispatch / loadTranscriptFile parser even though
 * nothing in an external build ever writes or reads this entry.
 */
export type ContextCollapseCommitEntry = {
  type: 'marble-origami-commit'
  sessionId: UUID
  /** 16-digit collapse ID. Max across entries reseeds the ID counter. */
  collapseId: string
  /** The summary placeholder's uuid — registerSummary() needs it. */
  summaryUuid: string
  
  summaryContent: string
  
  summary: string
  
  firstArchivedUuid: string
  lastArchivedUuid: string
}

/**
 * Snapshot of the staged queue and spawn trigger state. Unlike commits
 * (append-only, replay-all), snapshots are last-wins — only the most
 * recent snapshot entry is applied on restore. Written after every
 * ctx-agent spawn resolves (when staged contents may have changed).
 *
 * Staged boundaries are UUIDs (session-stable), not collapse IDs (which
 * reset with the uuidToId bimap). Restoring a staged span issues fresh
 * collapse IDs for those messages on the next decorate/display, but the
 * span itself resolves correctly.
 */
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
    // Sort by modified date (newest first)
    const modifiedDiff = b.modified.getTime() - a.modified.getTime()
    if (modifiedDiff !== 0) {
      return modifiedDiff
    }

    // If modified dates are equal, sort by created date (newest first)
    return b.created.getTime() - a.created.getTime()
  })
}
