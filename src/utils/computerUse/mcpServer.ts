import {
  buildComputerUseTools,
  createComputerUseMcpServer,
} from '@ant/computer-use-mcp'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { homedir } from 'os'

import { shutdownDatadog } from '../../services/analytics/datadog.js'
import { shutdown1PEventLogging } from '../../services/analytics/firstPartyEventLogger.js'
import { initializeAnalyticsSink } from '../../services/analytics/sink.js'
import { enableConfigs } from '../config.js'
import { logForDebugging } from '../debug.js'
import { filterAppsForDescription } from './appNames.js'
import { getChicagoCoordinateMode } from './gates.js'
import { getComputerUseHostAdapter } from './hostAdapter.js'

const APP_ENUM_TIMEOUT_MS = 1000

async function tryGetInstalledAppNames(): Promise<string[] | undefined> {
  const adapter = getComputerUseHostAdapter()
  const enumP = adapter.executor.listInstalledApps()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<undefined>(resolve => {
    timer = setTimeout(resolve, APP_ENUM_TIMEOUT_MS, undefined)
  })
  const installed = await Promise.race([enumP, timeoutP])
    .catch(() => undefined)
    .finally(() => clearTimeout(timer))
  if (!installed) {
    
    void enumP.catch(() => {})
    logForDebugging(
      `[Computer Use MCP] app enumeration exceeded ${APP_ENUM_TIMEOUT_MS}ms or failed; tool description omits list`,
    )
    return undefined
  }
  return filterAppsForDescription(installed, homedir())
}

export async function createComputerUseMcpServerForCli(): Promise<
  ReturnType<typeof createComputerUseMcpServer>
> {
  const adapter = getComputerUseHostAdapter()
  const coordinateMode = getChicagoCoordinateMode()
  const server = createComputerUseMcpServer(adapter, coordinateMode)

  const installedAppNames = await tryGetInstalledAppNames()
  const tools = buildComputerUseTools(
    adapter.executor.capabilities,
    coordinateMode,
    installedAppNames,
  )
  server.setRequestHandler(ListToolsRequestSchema, async () =>
    adapter.isDisabled() ? { tools: [] } : { tools },
  )

  return server
}

export async function runComputerUseMcpServer(): Promise<void> {
  enableConfigs()
  initializeAnalyticsSink()

  const server = await createComputerUseMcpServerForCli()
  const transport = new StdioServerTransport()

  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) return
    exiting = true
    await Promise.all([shutdown1PEventLogging(), shutdownDatadog()])
    
    process.exit(0)
  }
  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())

  logForDebugging('[Computer Use MCP] Starting MCP server')
  await server.connect(transport)
  logForDebugging('[Computer Use MCP] MCP server started')
}
