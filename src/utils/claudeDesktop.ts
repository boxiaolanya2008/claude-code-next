import { readdir, readFile, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import {
  type McpServerConfig,
  McpStdioServerConfigSchema,
} from '../services/mcp/types.js'
import { getErrnoCode } from './errors.js'
import { safeParseJSON } from './json.js'
import { logError } from './log.js'
import { getPlatform, SUPPORTED_PLATFORMS } from './platform.js'

export async function getClaudeDesktopConfigPath(): Promise<string> {
  const platform = getPlatform()

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(
      `Unsupported platform: ${platform} - Claude Desktop integration only works on macOS and WSL.`,
    )
  }

  if (platform === 'macos') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    )
  }

  
  const windowsHome = process.env.USERPROFILE
    ? process.env.USERPROFILE.replace(/\\/g, '/') 
    : null

  if (windowsHome) {
    
    const wslPath = windowsHome.replace(/^[A-Z]:/, '')
    const configPath = `/mnt/c${wslPath}/AppData/Roaming/Claude/claude_desktop_config.json`

    
    try {
      await stat(configPath)
      return configPath
    } catch {
      
    }
  }

  
  try {
    
    const usersDir = '/mnt/c/Users'

    try {
      const userDirs = await readdir(usersDir, { withFileTypes: true })

      
      for (const user of userDirs) {
        if (
          user.name === 'Public' ||
          user.name === 'Default' ||
          user.name === 'Default User' ||
          user.name === 'All Users'
        ) {
          continue 
        }

        const potentialConfigPath = join(
          usersDir,
          user.name,
          'AppData',
          'Roaming',
          'Claude',
          'claude_desktop_config.json',
        )

        try {
          await stat(potentialConfigPath)
          return potentialConfigPath
        } catch {
          
        }
      }
    } catch {
      
    }
  } catch (dirError) {
    logError(dirError)
  }

  throw new Error(
    'Could not find Claude Desktop config file in Windows. Make sure Claude Desktop is installed on Windows.',
  )
}

export async function readClaudeDesktopMcpServers(): Promise<
  Record<string, McpServerConfig>
> {
  if (!SUPPORTED_PLATFORMS.includes(getPlatform())) {
    throw new Error(
      'Unsupported platform - Claude Desktop integration only works on macOS and WSL.',
    )
  }
  try {
    const configPath = await getClaudeDesktopConfigPath()

    let configContent: string
    try {
      configContent = await readFile(configPath, { encoding: 'utf8' })
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return {}
      }
      throw e
    }

    const config = safeParseJSON(configContent)

    if (!config || typeof config !== 'object') {
      return {}
    }

    const mcpServers = (config as Record<string, unknown>).mcpServers
    if (!mcpServers || typeof mcpServers !== 'object') {
      return {}
    }

    const servers: Record<string, McpServerConfig> = {}

    for (const [name, serverConfig] of Object.entries(
      mcpServers as Record<string, unknown>,
    )) {
      if (!serverConfig || typeof serverConfig !== 'object') {
        continue
      }

      const result = McpStdioServerConfigSchema().safeParse(serverConfig)

      if (result.success) {
        servers[name] = result.data
      }
    }

    return servers
  } catch (error) {
    logError(error)
    return {}
  }
}
