

export type CodeIndexingTool =
  
  | 'sourcegraph'
  | 'hound'
  | 'seagoat'
  | 'bloop'
  | 'gitloop'
  
  | 'cody'
  | 'aider'
  | 'continue'
  | 'github-copilot'
  | 'cursor'
  | 'tabby'
  | 'codeium'
  | 'tabnine'
  | 'augment'
  | 'windsurf'
  | 'aide'
  | 'pieces'
  | 'qodo'
  | 'amazon-q'
  | 'gemini'
  
  | 'claude-context'
  | 'code-index-mcp'
  | 'local-code-search'
  | 'autodev-codebase'
  
  | 'openctx'

const CLI_COMMAND_MAPPING: Record<string, CodeIndexingTool> = {
  
  src: 'sourcegraph',
  cody: 'cody',
  
  aider: 'aider',
  tabby: 'tabby',
  tabnine: 'tabnine',
  augment: 'augment',
  pieces: 'pieces',
  qodo: 'qodo',
  aide: 'aide',
  
  hound: 'hound',
  seagoat: 'seagoat',
  bloop: 'bloop',
  gitloop: 'gitloop',
  
  q: 'amazon-q',
  gemini: 'gemini',
}

const MCP_SERVER_PATTERNS: Array<{
  pattern: RegExp
  tool: CodeIndexingTool
}> = [
  
  { pattern: /^sourcegraph$/i, tool: 'sourcegraph' },
  { pattern: /^cody$/i, tool: 'cody' },
  { pattern: /^openctx$/i, tool: 'openctx' },
  
  { pattern: /^aider$/i, tool: 'aider' },
  { pattern: /^continue$/i, tool: 'continue' },
  { pattern: /^github[-_]?copilot$/i, tool: 'github-copilot' },
  { pattern: /^copilot$/i, tool: 'github-copilot' },
  { pattern: /^cursor$/i, tool: 'cursor' },
  { pattern: /^tabby$/i, tool: 'tabby' },
  { pattern: /^codeium$/i, tool: 'codeium' },
  { pattern: /^tabnine$/i, tool: 'tabnine' },
  { pattern: /^augment[-_]?code$/i, tool: 'augment' },
  { pattern: /^augment$/i, tool: 'augment' },
  { pattern: /^windsurf$/i, tool: 'windsurf' },
  { pattern: /^aide$/i, tool: 'aide' },
  { pattern: /^codestory$/i, tool: 'aide' },
  { pattern: /^pieces$/i, tool: 'pieces' },
  { pattern: /^qodo$/i, tool: 'qodo' },
  { pattern: /^amazon[-_]?q$/i, tool: 'amazon-q' },
  { pattern: /^gemini[-_]?code[-_]?assist$/i, tool: 'gemini' },
  { pattern: /^gemini$/i, tool: 'gemini' },
  
  { pattern: /^hound$/i, tool: 'hound' },
  { pattern: /^seagoat$/i, tool: 'seagoat' },
  { pattern: /^bloop$/i, tool: 'bloop' },
  { pattern: /^gitloop$/i, tool: 'gitloop' },
  
  { pattern: /^claude[-_]?context$/i, tool: 'claude-context' },
  { pattern: /^code[-_]?index[-_]?mcp$/i, tool: 'code-index-mcp' },
  { pattern: /^code[-_]?index$/i, tool: 'code-index-mcp' },
  { pattern: /^local[-_]?code[-_]?search$/i, tool: 'local-code-search' },
  { pattern: /^codebase$/i, tool: 'autodev-codebase' },
  { pattern: /^autodev[-_]?codebase$/i, tool: 'autodev-codebase' },
  { pattern: /^code[-_]?context$/i, tool: 'claude-context' },
]

export function detectCodeIndexingFromCommand(
  command: string,
): CodeIndexingTool | undefined {
  
  const trimmed = command.trim()
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase()

  if (!firstWord) {
    return undefined
  }

  
  if (firstWord === 'npx' || firstWord === 'bunx') {
    const secondWord = trimmed.split(/\s+/)[1]?.toLowerCase()
    if (secondWord && secondWord in CLI_COMMAND_MAPPING) {
      return CLI_COMMAND_MAPPING[secondWord]
    }
  }

  return CLI_COMMAND_MAPPING[firstWord]
}

export function detectCodeIndexingFromMcpTool(
  toolName: string,
): CodeIndexingTool | undefined {
  
  if (!toolName.startsWith('mcp__')) {
    return undefined
  }

  const parts = toolName.split('__')
  if (parts.length < 3) {
    return undefined
  }

  const serverName = parts[1]
  if (!serverName) {
    return undefined
  }

  for (const { pattern, tool } of MCP_SERVER_PATTERNS) {
    if (pattern.test(serverName)) {
      return tool
    }
  }

  return undefined
}

export function detectCodeIndexingFromMcpServerName(
  serverName: string,
): CodeIndexingTool | undefined {
  for (const { pattern, tool } of MCP_SERVER_PATTERNS) {
    if (pattern.test(serverName)) {
      return tool
    }
  }

  return undefined
}
