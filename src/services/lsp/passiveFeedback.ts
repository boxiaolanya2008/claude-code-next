import { fileURLToPath } from 'url'
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import type { DiagnosticFile } from '../diagnosticTracking.js'
import { registerPendingLSPDiagnostic } from './LSPDiagnosticRegistry.js'
import type { LSPServerManager } from './LSPServerManager.js'

function mapLSPSeverity(
  lspSeverity: number | undefined,
): 'Error' | 'Warning' | 'Info' | 'Hint' {
  
  
  switch (lspSeverity) {
    case 1:
      return 'Error'
    case 2:
      return 'Warning'
    case 3:
      return 'Info'
    case 4:
      return 'Hint'
    default:
      return 'Error'
  }
}

export function formatDiagnosticsForAttachment(
  params: PublishDiagnosticsParams,
): DiagnosticFile[] {
  
  let uri: string
  try {
    
    uri = params.uri.startsWith('file://')
      ? fileURLToPath(params.uri)
      : params.uri
  } catch (error) {
    const err = toError(error)
    logError(err)
    logForDebugging(
      `Failed to convert URI to file path: ${params.uri}. Error: ${err.message}. Using original URI as fallback.`,
    )
    
    uri = params.uri
  }

  const diagnostics = params.diagnostics.map(
    (diag: {
      message: string
      severity?: number
      range: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      source?: string
      code?: string | number
    }) => ({
      message: diag.message,
      severity: mapLSPSeverity(diag.severity),
      range: {
        start: {
          line: diag.range.start.line,
          character: diag.range.start.character,
        },
        end: {
          line: diag.range.end.line,
          character: diag.range.end.character,
        },
      },
      source: diag.source,
      code:
        diag.code !== undefined && diag.code !== null
          ? String(diag.code)
          : undefined,
    }),
  )

  return [
    {
      uri,
      diagnostics,
    },
  ]
}

export type HandlerRegistrationResult = {
  
  totalServers: number
  
  successCount: number
  
  registrationErrors: Array<{ serverName: string; error: string }>
  
  diagnosticFailures: Map<string, { count: number; lastError: string }>
}

export function registerLSPNotificationHandlers(
  manager: LSPServerManager,
): HandlerRegistrationResult {
  
  const servers = manager.getAllServers()

  
  const registrationErrors: Array<{ serverName: string; error: string }> = []
  let successCount = 0

  
  const diagnosticFailures: Map<string, { count: number; lastError: string }> =
    new Map()

  for (const [serverName, serverInstance] of servers.entries()) {
    try {
      
      if (
        !serverInstance ||
        typeof serverInstance.onNotification !== 'function'
      ) {
        const errorMsg = !serverInstance
          ? 'Server instance is null/undefined'
          : 'Server instance has no onNotification method'

        registrationErrors.push({ serverName, error: errorMsg })

        const err = new Error(`${errorMsg} for ${serverName}`)
        logError(err)
        logForDebugging(
          `Skipping handler registration for ${serverName}: ${errorMsg}`,
        )
        continue 
      }

      
      serverInstance.onNotification(
        'textDocument/publishDiagnostics',
        (params: unknown) => {
          logForDebugging(
            `[PASSIVE DIAGNOSTICS] Handler invoked for ${serverName}! Params type: ${typeof params}`,
          )
          try {
            
            if (
              !params ||
              typeof params !== 'object' ||
              !('uri' in params) ||
              !('diagnostics' in params)
            ) {
              const err = new Error(
                `LSP server ${serverName} sent invalid diagnostic params (missing uri or diagnostics)`,
              )
              logError(err)
              logForDebugging(
                `Invalid diagnostic params from ${serverName}: ${jsonStringify(params)}`,
              )
              return
            }

            const diagnosticParams = params as PublishDiagnosticsParams
            logForDebugging(
              `Received diagnostics from ${serverName}: ${diagnosticParams.diagnostics.length} diagnostic(s) for ${diagnosticParams.uri}`,
            )

            
            const diagnosticFiles =
              formatDiagnosticsForAttachment(diagnosticParams)

            
            const firstFile = diagnosticFiles[0]
            if (
              !firstFile ||
              diagnosticFiles.length === 0 ||
              firstFile.diagnostics.length === 0
            ) {
              logForDebugging(
                `Skipping empty diagnostics from ${serverName} for ${diagnosticParams.uri}`,
              )
              return
            }

            
            
            try {
              registerPendingLSPDiagnostic({
                serverName,
                files: diagnosticFiles,
              })

              logForDebugging(
                `LSP Diagnostics: Registered ${diagnosticFiles.length} diagnostic file(s) from ${serverName} for async delivery`,
              )

              
              diagnosticFailures.delete(serverName)
            } catch (error) {
              const err = toError(error)
              logError(err)
              logForDebugging(
                `Error registering LSP diagnostics from ${serverName}: ` +
                  `URI: ${diagnosticParams.uri}, ` +
                  `Diagnostic count: ${firstFile.diagnostics.length}, ` +
                  `Error: ${err.message}`,
              )

              
              const failures = diagnosticFailures.get(serverName) || {
                count: 0,
                lastError: '',
              }
              failures.count++
              failures.lastError = err.message
              diagnosticFailures.set(serverName, failures)

              if (failures.count >= 3) {
                logForDebugging(
                  `WARNING: LSP diagnostic handler for ${serverName} has failed ${failures.count} times consecutively. ` +
                    `Last error: ${failures.lastError}. ` +
                    `This may indicate a problem with the LSP server or diagnostic processing. ` +
                    `Check logs for details.`,
                )
              }
            }
          } catch (error) {
            
            const err = toError(error)
            logError(err)
            logForDebugging(
              `Unexpected error processing diagnostics from ${serverName}: ${err.message}`,
            )

            
            const failures = diagnosticFailures.get(serverName) || {
              count: 0,
              lastError: '',
            }
            failures.count++
            failures.lastError = err.message
            diagnosticFailures.set(serverName, failures)

            if (failures.count >= 3) {
              logForDebugging(
                `WARNING: LSP diagnostic handler for ${serverName} has failed ${failures.count} times consecutively. ` +
                  `Last error: ${failures.lastError}. ` +
                  `This may indicate a problem with the LSP server or diagnostic processing. ` +
                  `Check logs for details.`,
              )
            }

            
          }
        },
      )

      logForDebugging(`Registered diagnostics handler for ${serverName}`)
      successCount++
    } catch (error) {
      const err = toError(error)

      registrationErrors.push({
        serverName,
        error: err.message,
      })

      logError(err)
      logForDebugging(
        `Failed to register diagnostics handler for ${serverName}: ` +
          `Error: ${err.message}`,
      )
    }
  }

  
  const totalServers = servers.size
  if (registrationErrors.length > 0) {
    const failedServers = registrationErrors
      .map(e => `${e.serverName} (${e.error})`)
      .join(', ')
    
    logError(
      new Error(
        `Failed to register diagnostics for ${registrationErrors.length} LSP server(s): ${failedServers}`,
      ),
    )
    logForDebugging(
      `LSP notification handler registration: ${successCount}/${totalServers} succeeded. ` +
        `Failed servers: ${failedServers}. ` +
        `Diagnostics from failed servers will not be delivered.`,
    )
  } else {
    logForDebugging(
      `LSP notification handlers registered successfully for all ${totalServers} server(s)`,
    )
  }

  
  return {
    totalServers,
    successCount,
    registrationErrors,
    diagnosticFailures,
  }
}
