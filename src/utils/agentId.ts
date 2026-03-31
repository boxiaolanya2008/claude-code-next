

export function formatAgentId(agentName: string, teamName: string): string {
  return `${agentName}@${teamName}`
}

/**
 * Parses an agent ID into its components.
 * Returns null if the ID doesn't contain the @ separator.
 */
export function parseAgentId(
  agentId: string,
): { agentName: string; teamName: string } | null {
  const atIndex = agentId.indexOf('@')
  if (atIndex === -1) {
    return null
  }
  return {
    agentName: agentId.slice(0, atIndex),
    teamName: agentId.slice(atIndex + 1),
  }
}

/**
 * Formats a request ID in the format `{requestType}-{timestamp}@{agentId}`.
 */
export function generateRequestId(
  requestType: string,
  agentId: string,
): string {
  const timestamp = Date.now()
  return `${requestType}-${timestamp}@${agentId}`
}

/**
 * Parses a request ID into its components.
 * Returns null if the request ID doesn't match the expected format.
 */
export function parseRequestId(
  requestId: string,
): { requestType: string; timestamp: number; agentId: string } | null {
  const atIndex = requestId.indexOf('@')
  if (atIndex === -1) {
    return null
  }

  const prefix = requestId.slice(0, atIndex)
  const agentId = requestId.slice(atIndex + 1)

  const lastDashIndex = prefix.lastIndexOf('-')
  if (lastDashIndex === -1) {
    return null
  }

  const requestType = prefix.slice(0, lastDashIndex)
  const timestampStr = prefix.slice(lastDashIndex + 1)
  const timestamp = parseInt(timestampStr, 10)

  if (isNaN(timestamp)) {
    return null
  }

  return { requestType, timestamp, agentId }
}
