

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { z } from 'zod/v4'
import { TEAMMATE_MESSAGE_TAG } from '../constants/xml.js'
import { PermissionModeSchema } from '../entrypoints/sdk/coreSchemas.js'
import { SEND_MESSAGE_TOOL_NAME } from '../tools/SendMessageTool/constants.js'
import type { Message } from '../types/message.js'
import { generateRequestId } from './agentId.js'
import { count } from './array.js'
import { logForDebugging } from './debug.js'
import { getTeamsDir } from './envUtils.js'
import { getErrnoCode } from './errors.js'
import { lazySchema } from './lazySchema.js'
import * as lockfile from './lockfile.js'
import { logError } from './log.js'
import { jsonParse, jsonStringify } from './slowOperations.js'
import type { BackendType } from './swarm/backends/types.js'
import { TEAM_LEAD_NAME } from './swarm/constants.js'
import { sanitizePathComponent } from './tasks.js'
import { getAgentName, getTeammateColor, getTeamName } from './teammate.js'

const LOCK_OPTIONS = {
  retries: {
    retries: 10,
    minTimeout: 5,
    maxTimeout: 100,
  },
}

export type TeammateMessage = {
  from: string
  text: string
  timestamp: string
  read: boolean
  color?: string 
  summary?: string 
}

export function getInboxPath(agentName: string, teamName?: string): string {
  const team = teamName || getTeamName() || 'default'
  const safeTeam = sanitizePathComponent(team)
  const safeAgentName = sanitizePathComponent(agentName)
  const inboxDir = join(getTeamsDir(), safeTeam, 'inboxes')
  const fullPath = join(inboxDir, `${safeAgentName}.json`)
  logForDebugging(
    `[TeammateMailbox] getInboxPath: agent=${agentName}, team=${team}, fullPath=${fullPath}`,
  )
  return fullPath
}

async function ensureInboxDir(teamName?: string): Promise<void> {
  const team = teamName || getTeamName() || 'default'
  const safeTeam = sanitizePathComponent(team)
  const inboxDir = join(getTeamsDir(), safeTeam, 'inboxes')
  await mkdir(inboxDir, { recursive: true })
  logForDebugging(`[TeammateMailbox] Ensured inbox directory: ${inboxDir}`)
}

export async function readMailbox(
  agentName: string,
  teamName?: string,
): Promise<TeammateMessage[]> {
  const inboxPath = getInboxPath(agentName, teamName)
  logForDebugging(`[TeammateMailbox] readMailbox: path=${inboxPath}`)

  try {
    const content = await readFile(inboxPath, 'utf-8')
    const messages = jsonParse(content) as TeammateMessage[]
    logForDebugging(
      `[TeammateMailbox] readMailbox: read ${messages.length} message(s)`,
    )
    return messages
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      logForDebugging(`[TeammateMailbox] readMailbox: file does not exist`)
      return []
    }
    logForDebugging(`Failed to read inbox for ${agentName}: ${error}`)
    logError(error)
    return []
  }
}

export async function readUnreadMessages(
  agentName: string,
  teamName?: string,
): Promise<TeammateMessage[]> {
  const messages = await readMailbox(agentName, teamName)
  const unread = messages.filter(m => !m.read)
  logForDebugging(
    `[TeammateMailbox] readUnreadMessages: ${unread.length} unread of ${messages.length} total`,
  )
  return unread
}

export async function writeToMailbox(
  recipientName: string,
  message: Omit<TeammateMessage, 'read'>,
  teamName?: string,
): Promise<void> {
  await ensureInboxDir(teamName)

  const inboxPath = getInboxPath(recipientName, teamName)
  const lockFilePath = `${inboxPath}.lock`

  logForDebugging(
    `[TeammateMailbox] writeToMailbox: recipient=${recipientName}, from=${message.from}, path=${inboxPath}`,
  )

  
  try {
    await writeFile(inboxPath, '[]', { encoding: 'utf-8', flag: 'wx' })
    logForDebugging(`[TeammateMailbox] writeToMailbox: created new inbox file`)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code !== 'EEXIST') {
      logForDebugging(
        `[TeammateMailbox] writeToMailbox: failed to create inbox file: ${error}`,
      )
      logError(error)
      return
    }
  }

  let release: (() => Promise<void>) | undefined
  try {
    release = await lockfile.lock(inboxPath, {
      lockfilePath: lockFilePath,
      ...LOCK_OPTIONS,
    })

    
    const messages = await readMailbox(recipientName, teamName)

    const newMessage: TeammateMessage = {
      ...message,
      read: false,
    }

    messages.push(newMessage)

    await writeFile(inboxPath, jsonStringify(messages, null, 2), 'utf-8')
    logForDebugging(
      `[TeammateMailbox] Wrote message to ${recipientName}'s inbox from ${message.from}`,
    )
  } catch (error) {
    logForDebugging(`Failed to write to inbox for ${recipientName}: ${error}`)
    logError(error)
  } finally {
    if (release) {
      await release()
    }
  }
}

export async function markMessageAsReadByIndex(
  agentName: string,
  teamName: string | undefined,
  messageIndex: number,
): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName)
  logForDebugging(
    `[TeammateMailbox] markMessageAsReadByIndex called: agentName=${agentName}, teamName=${teamName}, index=${messageIndex}, path=${inboxPath}`,
  )

  const lockFilePath = `${inboxPath}.lock`

  let release: (() => Promise<void>) | undefined
  try {
    logForDebugging(
      `[TeammateMailbox] markMessageAsReadByIndex: acquiring lock...`,
    )
    release = await lockfile.lock(inboxPath, {
      lockfilePath: lockFilePath,
      ...LOCK_OPTIONS,
    })
    logForDebugging(`[TeammateMailbox] markMessageAsReadByIndex: lock acquired`)

    
    const messages = await readMailbox(agentName, teamName)
    logForDebugging(
      `[TeammateMailbox] markMessageAsReadByIndex: read ${messages.length} messages after lock`,
    )

    if (messageIndex < 0 || messageIndex >= messages.length) {
      logForDebugging(
        `[TeammateMailbox] markMessageAsReadByIndex: index ${messageIndex} out of bounds (${messages.length} messages)`,
      )
      return
    }

    const message = messages[messageIndex]
    if (!message || message.read) {
      logForDebugging(
        `[TeammateMailbox] markMessageAsReadByIndex: message already read or missing`,
      )
      return
    }

    messages[messageIndex] = { ...message, read: true }

    await writeFile(inboxPath, jsonStringify(messages, null, 2), 'utf-8')
    logForDebugging(
      `[TeammateMailbox] markMessageAsReadByIndex: marked message at index ${messageIndex} as read`,
    )
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      logForDebugging(
        `[TeammateMailbox] markMessageAsReadByIndex: file does not exist at ${inboxPath}`,
      )
      return
    }
    logForDebugging(
      `[TeammateMailbox] markMessageAsReadByIndex FAILED for ${agentName}: ${error}`,
    )
    logError(error)
  } finally {
    if (release) {
      await release()
      logForDebugging(
        `[TeammateMailbox] markMessageAsReadByIndex: lock released`,
      )
    }
  }
}

export async function markMessagesAsRead(
  agentName: string,
  teamName?: string,
): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName)
  logForDebugging(
    `[TeammateMailbox] markMessagesAsRead called: agentName=${agentName}, teamName=${teamName}, path=${inboxPath}`,
  )

  const lockFilePath = `${inboxPath}.lock`

  let release: (() => Promise<void>) | undefined
  try {
    logForDebugging(`[TeammateMailbox] markMessagesAsRead: acquiring lock...`)
    release = await lockfile.lock(inboxPath, {
      lockfilePath: lockFilePath,
      ...LOCK_OPTIONS,
    })
    logForDebugging(`[TeammateMailbox] markMessagesAsRead: lock acquired`)

    
    const messages = await readMailbox(agentName, teamName)
    logForDebugging(
      `[TeammateMailbox] markMessagesAsRead: read ${messages.length} messages after lock`,
    )

    if (messages.length === 0) {
      logForDebugging(
        `[TeammateMailbox] markMessagesAsRead: no messages to mark`,
      )
      return
    }

    const unreadCount = count(messages, m => !m.read)
    logForDebugging(
      `[TeammateMailbox] markMessagesAsRead: ${unreadCount} unread of ${messages.length} total`,
    )

    
    for (const m of messages) m.read = true

    await writeFile(inboxPath, jsonStringify(messages, null, 2), 'utf-8')
    logForDebugging(
      `[TeammateMailbox] markMessagesAsRead: WROTE ${unreadCount} message(s) as read to ${inboxPath}`,
    )
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      logForDebugging(
        `[TeammateMailbox] markMessagesAsRead: file does not exist at ${inboxPath}`,
      )
      return
    }
    logForDebugging(
      `[TeammateMailbox] markMessagesAsRead FAILED for ${agentName}: ${error}`,
    )
    logError(error)
  } finally {
    if (release) {
      await release()
      logForDebugging(`[TeammateMailbox] markMessagesAsRead: lock released`)
    }
  }
}

export async function clearMailbox(
  agentName: string,
  teamName?: string,
): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName)

  try {
    
    
    await writeFile(inboxPath, '[]', { encoding: 'utf-8', flag: 'r+' })
    logForDebugging(`[TeammateMailbox] Cleared inbox for ${agentName}`)
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      return
    }
    logForDebugging(`Failed to clear inbox for ${agentName}: ${error}`)
    logError(error)
  }
}

export function formatTeammateMessages(
  messages: Array<{
    from: string
    text: string
    timestamp: string
    color?: string
    summary?: string
  }>,
): string {
  return messages
    .map(m => {
      const colorAttr = m.color ? ` color="${m.color}"` : ''
      const summaryAttr = m.summary ? ` summary="${m.summary}"` : ''
      return `<${TEAMMATE_MESSAGE_TAG} teammate_id="${m.from}"${colorAttr}${summaryAttr}>\n${m.text}\n</${TEAMMATE_MESSAGE_TAG}>`
    })
    .join('\n\n')
}

export type IdleNotificationMessage = {
  type: 'idle_notification'
  from: string
  timestamp: string
  
  idleReason?: 'available' | 'interrupted' | 'failed'
  
  summary?: string
  completedTaskId?: string
  completedStatus?: 'resolved' | 'blocked' | 'failed'
  failureReason?: string
}

export function createIdleNotification(
  agentId: string,
  options?: {
    idleReason?: IdleNotificationMessage['idleReason']
    summary?: string
    completedTaskId?: string
    completedStatus?: 'resolved' | 'blocked' | 'failed'
    failureReason?: string
  },
): IdleNotificationMessage {
  return {
    type: 'idle_notification',
    from: agentId,
    timestamp: new Date().toISOString(),
    idleReason: options?.idleReason,
    summary: options?.summary,
    completedTaskId: options?.completedTaskId,
    completedStatus: options?.completedStatus,
    failureReason: options?.failureReason,
  }
}

export function isIdleNotification(
  messageText: string,
): IdleNotificationMessage | null {
  try {
    const parsed = jsonParse(messageText)
    if (parsed && parsed.type === 'idle_notification') {
      return parsed as IdleNotificationMessage
    }
  } catch {
    
  }
  return null
}

export type PermissionRequestMessage = {
  type: 'permission_request'
  request_id: string
  agent_id: string
  tool_name: string
  tool_use_id: string
  description: string
  input: Record<string, unknown>
  permission_suggestions: unknown[]
}

export type PermissionResponseMessage =
  | {
      type: 'permission_response'
      request_id: string
      subtype: 'success'
      response?: {
        updated_input?: Record<string, unknown>
        permission_updates?: unknown[]
      }
    }
  | {
      type: 'permission_response'
      request_id: string
      subtype: 'error'
      error: string
    }

export function createPermissionRequestMessage(params: {
  request_id: string
  agent_id: string
  tool_name: string
  tool_use_id: string
  description: string
  input: Record<string, unknown>
  permission_suggestions?: unknown[]
}): PermissionRequestMessage {
  return {
    type: 'permission_request',
    request_id: params.request_id,
    agent_id: params.agent_id,
    tool_name: params.tool_name,
    tool_use_id: params.tool_use_id,
    description: params.description,
    input: params.input,
    permission_suggestions: params.permission_suggestions || [],
  }
}

export function createPermissionResponseMessage(params: {
  request_id: string
  subtype: 'success' | 'error'
  error?: string
  updated_input?: Record<string, unknown>
  permission_updates?: unknown[]
}): PermissionResponseMessage {
  if (params.subtype === 'error') {
    return {
      type: 'permission_response',
      request_id: params.request_id,
      subtype: 'error',
      error: params.error || 'Permission denied',
    }
  }
  return {
    type: 'permission_response',
    request_id: params.request_id,
    subtype: 'success',
    response: {
      updated_input: params.updated_input,
      permission_updates: params.permission_updates,
    },
  }
}

export function isPermissionRequest(
  messageText: string,
): PermissionRequestMessage | null {
  try {
    const parsed = jsonParse(messageText)
    if (parsed && parsed.type === 'permission_request') {
      return parsed as PermissionRequestMessage
    }
  } catch {
    
  }
  return null
}

export function isPermissionResponse(
  messageText: string,
): PermissionResponseMessage | null {
  try {
    const parsed = jsonParse(messageText)
    if (parsed && parsed.type === 'permission_response') {
      return parsed as PermissionResponseMessage
    }
  } catch {
    
  }
  return null
}

export type SandboxPermissionRequestMessage = {
  type: 'sandbox_permission_request'
  
  requestId: string
  
  workerId: string
  
  workerName: string
  
  workerColor?: string
  
  hostPattern: {
    host: string
  }
  
  createdAt: number
}

export type SandboxPermissionResponseMessage = {
  type: 'sandbox_permission_response'
  
  requestId: string
  
  host: string
  
  allow: boolean
  
  timestamp: string
}

export function createSandboxPermissionRequestMessage(params: {
  requestId: string
  workerId: string
  workerName: string
  workerColor?: string
  host: string
}): SandboxPermissionRequestMessage {
  return {
    type: 'sandbox_permission_request',
    requestId: params.requestId,
    workerId: params.workerId,
    workerName: params.workerName,
    workerColor: params.workerColor,
    hostPattern: { host: params.host },
    createdAt: Date.now(),
  }
}

export function createSandboxPermissionResponseMessage(params: {
  requestId: string
  host: string
  allow: boolean
}): SandboxPermissionResponseMessage {
  return {
    type: 'sandbox_permission_response',
    requestId: params.requestId,
    host: params.host,
    allow: params.allow,
    timestamp: new Date().toISOString(),
  }
}

export function isSandboxPermissionRequest(
  messageText: string,
): SandboxPermissionRequestMessage | null {
  try {
    const parsed = jsonParse(messageText)
    if (parsed && parsed.type === 'sandbox_permission_request') {
      return parsed as SandboxPermissionRequestMessage
    }
  } catch {
    
  }
  return null
}

export function isSandboxPermissionResponse(
  messageText: string,
): SandboxPermissionResponseMessage | null {
  try {
    const parsed = jsonParse(messageText)
    if (parsed && parsed.type === 'sandbox_permission_response') {
      return parsed as SandboxPermissionResponseMessage
    }
  } catch {
    
  }
  return null
}

export const PlanApprovalRequestMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('plan_approval_request'),
    from: z.string(),
    timestamp: z.string(),
    planFilePath: z.string(),
    planContent: z.string(),
    requestId: z.string(),
  }),
)

export type PlanApprovalRequestMessage = z.infer<
  ReturnType<typeof PlanApprovalRequestMessageSchema>
>

export const PlanApprovalResponseMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('plan_approval_response'),
    requestId: z.string(),
    approved: z.boolean(),
    feedback: z.string().optional(),
    timestamp: z.string(),
    permissionMode: PermissionModeSchema().optional(),
  }),
)

export type PlanApprovalResponseMessage = z.infer<
  ReturnType<typeof PlanApprovalResponseMessageSchema>
>

export const ShutdownRequestMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('shutdown_request'),
    requestId: z.string(),
    from: z.string(),
    reason: z.string().optional(),
    timestamp: z.string(),
  }),
)

export type ShutdownRequestMessage = z.infer<
  ReturnType<typeof ShutdownRequestMessageSchema>
>

export const ShutdownApprovedMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('shutdown_approved'),
    requestId: z.string(),
    from: z.string(),
    timestamp: z.string(),
    paneId: z.string().optional(),
    backendType: z.string().optional(),
  }),
)

export type ShutdownApprovedMessage = z.infer<
  ReturnType<typeof ShutdownApprovedMessageSchema>
>

export const ShutdownRejectedMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('shutdown_rejected'),
    requestId: z.string(),
    from: z.string(),
    reason: z.string(),
    timestamp: z.string(),
  }),
)

export type ShutdownRejectedMessage = z.infer<
  ReturnType<typeof ShutdownRejectedMessageSchema>
>

export function createShutdownRequestMessage(params: {
  requestId: string
  from: string
  reason?: string
}): ShutdownRequestMessage {
  return {
    type: 'shutdown_request',
    requestId: params.requestId,
    from: params.from,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  }
}

export function createShutdownApprovedMessage(params: {
  requestId: string
  from: string
  paneId?: string
  backendType?: BackendType
}): ShutdownApprovedMessage {
  return {
    type: 'shutdown_approved',
    requestId: params.requestId,
    from: params.from,
    timestamp: new Date().toISOString(),
    paneId: params.paneId,
    backendType: params.backendType,
  }
}

export function createShutdownRejectedMessage(params: {
  requestId: string
  from: string
  reason: string
}): ShutdownRejectedMessage {
  return {
    type: 'shutdown_rejected',
    requestId: params.requestId,
    from: params.from,
    reason: params.reason,
    timestamp: new Date().toISOString(),
  }
}

export async function sendShutdownRequestToMailbox(
  targetName: string,
  teamName?: string,
  reason?: string,
): Promise<{ requestId: string; target: string }> {
  const resolvedTeamName = teamName || getTeamName()

  
  const senderName = getAgentName() || TEAM_LEAD_NAME

  
  const requestId = generateRequestId('shutdown', targetName)

  
  const shutdownMessage = createShutdownRequestMessage({
    requestId,
    from: senderName,
    reason,
  })

  await writeToMailbox(
    targetName,
    {
      from: senderName,
      text: jsonStringify(shutdownMessage),
      timestamp: new Date().toISOString(),
      color: getTeammateColor(),
    },
    resolvedTeamName,
  )

  return { requestId, target: targetName }
}

export function isShutdownRequest(
  messageText: string,
): ShutdownRequestMessage | null {
  try {
    const result = ShutdownRequestMessageSchema().safeParse(
      jsonParse(messageText),
    )
    if (result.success) return result.data
  } catch {
    
  }
  return null
}

export function isPlanApprovalRequest(
  messageText: string,
): PlanApprovalRequestMessage | null {
  try {
    const result = PlanApprovalRequestMessageSchema().safeParse(
      jsonParse(messageText),
    )
    if (result.success) return result.data
  } catch {
    
  }
  return null
}

export function isShutdownApproved(
  messageText: string,
): ShutdownApprovedMessage | null {
  try {
    const result = ShutdownApprovedMessageSchema().safeParse(
      jsonParse(messageText),
    )
    if (result.success) return result.data
  } catch {
    
  }
  return null
}

export function isShutdownRejected(
  messageText: string,
): ShutdownRejectedMessage | null {
  try {
    const result = ShutdownRejectedMessageSchema().safeParse(
      jsonParse(messageText),
    )
    if (result.success) return result.data
  } catch {
    
  }
  return null
}

export function isPlanApprovalResponse(
  messageText: string,
): PlanApprovalResponseMessage | null {
  try {
    const result = PlanApprovalResponseMessageSchema().safeParse(
      jsonParse(messageText),
    )
    if (result.success) return result.data
  } catch {
    
  }
  return null
}

export type TaskAssignmentMessage = {
  type: 'task_assignment'
  taskId: string
  subject: string
  description: string
  assignedBy: string
  timestamp: string
}

export function isTaskAssignment(
  messageText: string,
): TaskAssignmentMessage | null {
  try {
    const parsed = jsonParse(messageText)
    if (parsed && parsed.type === 'task_assignment') {
      return parsed as TaskAssignmentMessage
    }
  } catch {
    
  }
  return null
}

export type TeamPermissionUpdateMessage = {
  type: 'team_permission_update'
  
  permissionUpdate: {
    type: 'addRules'
    rules: Array<{ toolName: string; ruleContent?: string }>
    behavior: 'allow' | 'deny' | 'ask'
    destination: 'session'
  }
  
  directoryPath: string
  
  toolName: string
}

export function isTeamPermissionUpdate(
  messageText: string,
): TeamPermissionUpdateMessage | null {
  try {
    const parsed = jsonParse(messageText)
    if (parsed && parsed.type === 'team_permission_update') {
      return parsed as TeamPermissionUpdateMessage
    }
  } catch {
    
  }
  return null
}

export const ModeSetRequestMessageSchema = lazySchema(() =>
  z.object({
    type: z.literal('mode_set_request'),
    mode: PermissionModeSchema(),
    from: z.string(),
  }),
)

export type ModeSetRequestMessage = z.infer<
  ReturnType<typeof ModeSetRequestMessageSchema>
>

export function createModeSetRequestMessage(params: {
  mode: string
  from: string
}): ModeSetRequestMessage {
  return {
    type: 'mode_set_request',
    mode: params.mode as ModeSetRequestMessage['mode'],
    from: params.from,
  }
}

export function isModeSetRequest(
  messageText: string,
): ModeSetRequestMessage | null {
  try {
    const parsed = ModeSetRequestMessageSchema().safeParse(
      jsonParse(messageText),
    )
    if (parsed.success) {
      return parsed.data
    }
  } catch {
    
  }
  return null
}

export function isStructuredProtocolMessage(messageText: string): boolean {
  try {
    const parsed = jsonParse(messageText)
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return false
    }
    const type = (parsed as { type: unknown }).type
    return (
      type === 'permission_request' ||
      type === 'permission_response' ||
      type === 'sandbox_permission_request' ||
      type === 'sandbox_permission_response' ||
      type === 'shutdown_request' ||
      type === 'shutdown_approved' ||
      type === 'team_permission_update' ||
      type === 'mode_set_request' ||
      type === 'plan_approval_request' ||
      type === 'plan_approval_response'
    )
  } catch {
    return false
  }
}

export async function markMessagesAsReadByPredicate(
  agentName: string,
  predicate: (msg: TeammateMessage) => boolean,
  teamName?: string,
): Promise<void> {
  const inboxPath = getInboxPath(agentName, teamName)

  const lockFilePath = `${inboxPath}.lock`
  let release: (() => Promise<void>) | undefined

  try {
    release = await lockfile.lock(inboxPath, {
      lockfilePath: lockFilePath,
      ...LOCK_OPTIONS,
    })

    const messages = await readMailbox(agentName, teamName)
    if (messages.length === 0) {
      return
    }

    const updatedMessages = messages.map(m =>
      !m.read && predicate(m) ? { ...m, read: true } : m,
    )

    await writeFile(inboxPath, jsonStringify(updatedMessages, null, 2), 'utf-8')
  } catch (error) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      return
    }
    logError(error)
  } finally {
    if (release) {
      try {
        await release()
      } catch {
        
      }
    }
  }
}

export function getLastPeerDmSummary(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg) continue

    
    if (msg.type === 'user' && typeof msg.message.content === 'string') {
      break
    }

    if (msg.type !== 'assistant') continue
    for (const block of msg.message.content) {
      if (
        block.type === 'tool_use' &&
        block.name === SEND_MESSAGE_TOOL_NAME &&
        typeof block.input === 'object' &&
        block.input !== null &&
        'to' in block.input &&
        typeof block.input.to === 'string' &&
        block.input.to !== '*' &&
        block.input.to.toLowerCase() !== TEAM_LEAD_NAME.toLowerCase() &&
        'message' in block.input &&
        typeof block.input.message === 'string'
      ) {
        const to = block.input.to
        const summary =
          'summary' in block.input && typeof block.input.summary === 'string'
            ? block.input.summary
            : block.input.message.slice(0, 80)
        return `[to ${to}] ${summary}`
      }
    }
  }
  return undefined
}
