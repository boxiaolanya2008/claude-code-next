import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import type { Message } from '../types/message.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

export type McpInstructionsDelta = {
  
  addedNames: string[]
  
  addedBlocks: string[]
  removedNames: string[]
}

export type ClientSideInstruction = {
  serverName: string
  block: string
}

export function isMcpInstructionsDeltaEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_NEXT_MCP_INSTR_DELTA)) return true
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_NEXT_MCP_INSTR_DELTA)) return false
  return (
    process.env.USER_TYPE === 'ant' ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_basalt_3kr', false)
  )
}

export function getMcpInstructionsDelta(
  mcpClients: MCPServerConnection[],
  messages: Message[],
  clientSideInstructions: ClientSideInstruction[],
): McpInstructionsDelta | null {
  const announced = new Set<string>()
  let attachmentCount = 0
  let midCount = 0
  for (const msg of messages) {
    if (msg.type !== 'attachment') continue
    attachmentCount++
    if (msg.attachment.type !== 'mcp_instructions_delta') continue
    midCount++
    for (const n of msg.attachment.addedNames) announced.add(n)
    for (const n of msg.attachment.removedNames) announced.delete(n)
  }

  const connected = mcpClients.filter(
    (c): c is ConnectedMCPServer => c.type === 'connected',
  )
  const connectedNames = new Set(connected.map(c => c.name))

  
  
  const blocks = new Map<string, string>()
  for (const c of connected) {
    if (c.instructions) blocks.set(c.name, `## ${c.name}\n${c.instructions}`)
  }
  for (const ci of clientSideInstructions) {
    if (!connectedNames.has(ci.serverName)) continue
    const existing = blocks.get(ci.serverName)
    blocks.set(
      ci.serverName,
      existing
        ? `${existing}\n\n${ci.block}`
        : `## ${ci.serverName}\n${ci.block}`,
    )
  }

  const added: Array<{ name: string; block: string }> = []
  for (const [name, block] of blocks) {
    if (!announced.has(name)) added.push({ name, block })
  }

  
  
  
  
  
  
  const removed: string[] = []
  for (const n of announced) {
    if (!connectedNames.has(n)) removed.push(n)
  }

  if (added.length === 0 && removed.length === 0) return null

  
  
  logEvent('tengu_mcp_instructions_pool_change', {
    addedCount: added.length,
    removedCount: removed.length,
    priorAnnouncedCount: announced.size,
    clientSideCount: clientSideInstructions.length,
    messagesLength: messages.length,
    attachmentCount,
    midCount,
  })

  added.sort((a, b) => a.name.localeCompare(b.name))
  return {
    addedNames: added.map(a => a.name),
    addedBlocks: added.map(a => a.block),
    removedNames: removed.sort(),
  }
}
