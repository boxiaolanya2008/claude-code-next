

import { normalizeNameForMCP } from './normalization.js'

export function mcpInfoFromString(toolString: string): {
  serverName: string
  toolName: string | undefined
} | null {
  const parts = toolString.split('__')
  const [mcpPart, serverName, ...toolNameParts] = parts
  if (mcpPart !== 'mcp' || !serverName) {
    return null
  }
  
  const toolName =
    toolNameParts.length > 0 ? toolNameParts.join('__') : undefined
  return { serverName, toolName }
}

export function getMcpPrefix(serverName: string): string {
  return `mcp__${normalizeNameForMCP(serverName)}__`
}

export function buildMcpToolName(serverName: string, toolName: string): string {
  return `${getMcpPrefix(serverName)}${normalizeNameForMCP(toolName)}`
}

export function getToolNameForPermissionCheck(tool: {
  name: string
  mcpInfo?: { serverName: string; toolName: string }
}): string {
  return tool.mcpInfo
    ? buildMcpToolName(tool.mcpInfo.serverName, tool.mcpInfo.toolName)
    : tool.name
}

export function getMcpDisplayName(
  fullName: string,
  serverName: string,
): string {
  const prefix = `mcp__${normalizeNameForMCP(serverName)}__`
  return fullName.replace(prefix, '')
}

export function extractMcpToolDisplayName(userFacingName: string): string {
  

  
  let withoutSuffix = userFacingName.replace(/\s*\(MCP\)\s*$/, '')

  
  withoutSuffix = withoutSuffix.trim()

  
  const dashIndex = withoutSuffix.indexOf(' - ')
  if (dashIndex !== -1) {
    const displayName = withoutSuffix.substring(dashIndex + 3).trim()
    return displayName
  }

  
  return withoutSuffix
}
