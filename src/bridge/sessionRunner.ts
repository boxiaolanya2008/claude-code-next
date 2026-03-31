import { type ChildProcess, spawn } from 'child_process'
import { createWriteStream, type WriteStream } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { createInterface } from 'readline'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import { debugTruncate } from './debugUtils.js'
import type {
  SessionActivity,
  SessionDoneStatus,
  SessionHandle,
  SessionSpawner,
  SessionSpawnOpts,
} from './types.js'

const MAX_ACTIVITIES = 10
const MAX_STDERR_LINES = 10

export function safeFilenameId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export type PermissionRequest = {
  type: 'control_request'
  request_id: string
  request: {
    
    subtype: 'can_use_tool'
    tool_name: string
    input: Record<string, unknown>
    tool_use_id: string
  }
}

type SessionSpawnerDeps = {
  execPath: string
  

  scriptArgs: string[]
  env: NodeJS.ProcessEnv
  verbose: boolean
  sandbox: boolean
  debugFile?: string
  permissionMode?: string
  onDebug: (msg: string) => void
  onActivity?: (sessionId: string, activity: SessionActivity) => void
  onPermissionRequest?: (
    sessionId: string,
    request: PermissionRequest,
    accessToken: string,
  ) => void
}

const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  MultiEdit: 'Editing',
  Bash: 'Running',
  Glob: 'Searching',
  Grep: 'Searching',
  WebFetch: 'Fetching',
  WebSearch: 'Searching',
  Task: 'Running task',
  FileReadTool: 'Reading',
  FileWriteTool: 'Writing',
  FileEditTool: 'Editing',
  GlobTool: 'Searching',
  GrepTool: 'Searching',
  BashTool: 'Running',
  NotebookEditTool: 'Editing notebook',
  LSP: 'LSP',
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  const verb = TOOL_VERBS[name] ?? name
  const target =
    (input.file_path as string) ??
    (input.filePath as string) ??
    (input.pattern as string) ??
    (input.command as string | undefined)?.slice(0, 60) ??
    (input.url as string) ??
    (input.query as string) ??
    ''
  if (target) {
    return `${verb} ${target}`
  }
  return verb
}

function extractActivities(
  line: string,
  sessionId: string,
  onDebug: (msg: string) => void,
): SessionActivity[] {
  let parsed: unknown
  try {
    parsed = jsonParse(line)
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== 'object') {
    return []
  }

  const msg = parsed as Record<string, unknown>
  const activities: SessionActivity[] = []
  const now = Date.now()

  switch (msg.type) {
    case 'assistant': {
      const message = msg.message as Record<string, unknown> | undefined
      if (!message) break
      const content = message.content
      if (!Array.isArray(content)) break

      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>

        if (b.type === 'tool_use') {
          const name = (b.name as string) ?? 'Tool'
          const input = (b.input as Record<string, unknown>) ?? {}
          const summary = toolSummary(name, input)
          activities.push({
            type: 'tool_start',
            summary,
            timestamp: now,
          })
          onDebug(
            `[bridge:activity] sessionId=${sessionId} tool_use name=${name} ${inputPreview(input)}`,
          )
        } else if (b.type === 'text') {
          const text = (b.text as string) ?? ''
          if (text.length > 0) {
            activities.push({
              type: 'text',
              summary: text.slice(0, 80),
              timestamp: now,
            })
            onDebug(
              `[bridge:activity] sessionId=${sessionId} text "${text.slice(0, 100)}"`,
            )
          }
        }
      }
      break
    }
    case 'result': {
      const subtype = msg.subtype as string | undefined
      if (subtype === 'success') {
        activities.push({
          type: 'result',
          summary: 'Session completed',
          timestamp: now,
        })
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=success`,
        )
      } else if (subtype) {
        const errors = msg.errors as string[] | undefined
        const errorSummary = errors?.[0] ?? `Error: ${subtype}`
        activities.push({
          type: 'error',
          summary: errorSummary,
          timestamp: now,
        })
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=${subtype} error="${errorSummary}"`,
        )
      } else {
        onDebug(
          `[bridge:activity] sessionId=${sessionId} result subtype=undefined`,
        )
      }
      break
    }
    default:
      break
  }

  return activities
}

function extractUserMessageText(
  msg: Record<string, unknown>,
): string | undefined {
  
  
  if (msg.parent_tool_use_id != null || msg.isSynthetic || msg.isReplay)
    return undefined

  const message = msg.message as Record<string, unknown> | undefined
  const content = message?.content
  let text: string | undefined
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === 'text'
      ) {
        text = (block as Record<string, unknown>).text as string | undefined
        break
      }
    }
  }
  text = text?.trim()
  return text ? text : undefined
}

function inputPreview(input: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, val] of Object.entries(input)) {
    if (typeof val === 'string') {
      parts.push(`${key}="${val.slice(0, 100)}"`)
    }
    if (parts.length >= 3) break
  }
  return parts.join(' ')
}

export function createSessionSpawner(deps: SessionSpawnerDeps): SessionSpawner {
  return {
    spawn(opts: SessionSpawnOpts, dir: string): SessionHandle {
      
      
      
      
      const safeId = safeFilenameId(opts.sessionId)
      let debugFile: string | undefined
      if (deps.debugFile) {
        const ext = deps.debugFile.lastIndexOf('.')
        if (ext > 0) {
          debugFile = `${deps.debugFile.slice(0, ext)}-${safeId}${deps.debugFile.slice(ext)}`
        } else {
          debugFile = `${deps.debugFile}-${safeId}`
        }
      } else if (deps.verbose || process.env.USER_TYPE === 'ant') {
        debugFile = join(tmpdir(), 'claude', `bridge-session-${safeId}.log`)
      }

      
      
      let transcriptStream: WriteStream | null = null
      let transcriptPath: string | undefined
      if (deps.debugFile) {
        transcriptPath = join(
          dirname(deps.debugFile),
          `bridge-transcript-${safeId}.jsonl`,
        )
        transcriptStream = createWriteStream(transcriptPath, { flags: 'a' })
        transcriptStream.on('error', err => {
          deps.onDebug(
            `[bridge:session] Transcript write error: ${err.message}`,
          )
          transcriptStream = null
        })
        deps.onDebug(`[bridge:session] Transcript log: ${transcriptPath}`)
      }

      const args = [
        ...deps.scriptArgs,
        '--print',
        '--sdk-url',
        opts.sdkUrl,
        '--session-id',
        opts.sessionId,
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--replay-user-messages',
        ...(deps.verbose ? ['--verbose'] : []),
        ...(debugFile ? ['--debug-file', debugFile] : []),
        ...(deps.permissionMode
          ? ['--permission-mode', deps.permissionMode]
          : []),
      ]

      const env: NodeJS.ProcessEnv = {
        ...deps.env,
        
        
        CLAUDE_CODE_NEXT_OAUTH_TOKEN: undefined,
        CLAUDE_CODE_NEXT_ENVIRONMENT_KIND: 'bridge',
        ...(deps.sandbox && { CLAUDE_CODE_NEXT_FORCE_SANDBOX: '1' }),
        CLAUDE_CODE_NEXT_SESSION_ACCESS_TOKEN: opts.accessToken,
        
        
        CLAUDE_CODE_NEXT_POST_FOR_SESSION_INGRESS_V2: '1',
        

