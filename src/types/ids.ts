

export type SessionId = string & { readonly __brand: 'SessionId' }

/**
 * An agent ID uniquely identifies a subagent within a session.
 * Returned by createAgentId().
 * When present, indicates the context is a subagent (not the main session).
 */
export type AgentId = string & { readonly __brand: 'AgentId' }

/**
 * Cast a raw string to SessionId.
 * Use sparingly - prefer getSessionId() when possible.
 */
export function asSessionId(id: string): SessionId {
  return id as SessionId
}

/**
 * Cast a raw string to AgentId.
 * Use sparingly - prefer createAgentId() when possible.
 */
export function asAgentId(id: string): AgentId {
  return id as AgentId
}

const AGENT_ID_PATTERN = /^a(?:.+-)?[0-9a-f]{16}$/

export function toAgentId(s: string): AgentId | null {
  return AGENT_ID_PATTERN.test(s) ? (s as AgentId) : null
}
