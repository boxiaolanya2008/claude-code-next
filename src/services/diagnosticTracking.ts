import figures from 'figures'
import { logError } from 'src/utils/log.js'
import { callIdeRpc } from '../services/mcp/client.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { ClaudeError } from '../utils/errors.js'
import { normalizePathForComparison, pathsEqual } from '../utils/file.js'
import { getConnectedIdeClient } from '../utils/ide.js'
import { jsonParse } from '../utils/slowOperations.js'

class DiagnosticsTrackingError extends ClaudeError {}

const MAX_DIAGNOSTICS_SUMMARY_CHARS = 4000

export interface Diagnostic {
  message: string
  severity: 'Error' | 'Warning' | 'Info' | 'Hint'
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  source?: string
  code?: string
}

export interface DiagnosticFile {
  uri: string
  diagnostics: Diagnostic[]
}

export class DiagnosticTrackingService {
  private static instance: DiagnosticTrackingService | undefined
  private baseline: Map<string, Diagnostic[]> = new Map()

  private initialized = false
  private mcpClient: MCPServerConnection | undefined

  
  private lastProcessedTimestamps: Map<string, number> = new Map()

  
  
  private rightFileDiagnosticsState: Map<string, Diagnostic[]> = new Map()

  static getInstance(): DiagnosticTrackingService {
    if (!DiagnosticTrackingService.instance) {
      DiagnosticTrackingService.instance = new DiagnosticTrackingService()
    }
    return DiagnosticTrackingService.instance
  }

  initialize(mcpClient: MCPServerConnection) {
    if (this.initialized) {
      return
    }

    
    this.mcpClient = mcpClient
    this.initialized = true
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    this.baseline.clear()
    this.rightFileDiagnosticsState.clear()
    this.lastProcessedTimestamps.clear()
  }

  

  reset() {
    this.baseline.clear()
    this.rightFileDiagnosticsState.clear()
    this.lastProcessedTimestamps.clear()
  }

  private normalizeFileUri(fileUri: string): string {
    
    const protocolPrefixes = [
      'file://',
      '_claude_fs_right:',
      '_claude_fs_left:',
    ]

    let normalized = fileUri
    for (const prefix of protocolPrefixes) {
      if (fileUri.startsWith(prefix)) {
        normalized = fileUri.slice(prefix.length)
        break
      }
    }

    
    
    return normalizePathForComparison(normalized)
  }

  

  async ensureFileOpened(fileUri: string): Promise<void> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return
    }

    try {
      
      await callIdeRpc(
        'openFile',
        {
          filePath: fileUri,
          preview: false,
          startText: '',
          endText: '',
          selectToEndOfLine: false,
          makeFrontmost: false,
        },
        this.mcpClient,
      )
    } catch (error) {
      logError(error as Error)
    }
  }

  

  async beforeFileEdited(filePath: string): Promise<void> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return
    }

    const timestamp = Date.now()

    try {
      const result = await callIdeRpc(
        'getDiagnostics',
        { uri: `file://${filePath}` },
        this.mcpClient,
      )
      const diagnosticFile = this.parseDiagnosticResult(result)[0]
      if (diagnosticFile) {
        
        if (
          !pathsEqual(
            this.normalizeFileUri(filePath),
            this.normalizeFileUri(diagnosticFile.uri),
          )
        ) {
          logError(
            new DiagnosticsTrackingError(
              `Diagnostics file path mismatch: expected ${filePath}, got ${diagnosticFile.uri})`,
            ),
          )
          return
        }

        
        const normalizedPath = this.normalizeFileUri(filePath)
        this.baseline.set(normalizedPath, diagnosticFile.diagnostics)
        this.lastProcessedTimestamps.set(normalizedPath, timestamp)
      } else {
        
        const normalizedPath = this.normalizeFileUri(filePath)
        this.baseline.set(normalizedPath, [])
        this.lastProcessedTimestamps.set(normalizedPath, timestamp)
      }
    } catch (_error) {
      
    }
  }

  

  async getNewDiagnostics(): Promise<DiagnosticFile[]> {
    if (
      !this.initialized ||
      !this.mcpClient ||
      this.mcpClient.type !== 'connected'
    ) {
      return []
    }

    
    let allDiagnosticFiles: DiagnosticFile[] = []
    try {
      const result = await callIdeRpc(
        'getDiagnostics',
        {}, 
        this.mcpClient,
      )
      allDiagnosticFiles = this.parseDiagnosticResult(result)
    } catch (_error) {
      
      return []
    }
    const diagnosticsForFileUrisWithBaselines = allDiagnosticFiles
      .filter(file => this.baseline.has(this.normalizeFileUri(file.uri)))
      .filter(file => file.uri.startsWith('file://'))

    const diagnosticsForClaudeFsRightUrisWithBaselinesMap = new Map<
      string,
      DiagnosticFile
    >()
    allDiagnosticFiles
      .filter(file => this.baseline.has(this.normalizeFileUri(file.uri)))
      .filter(file => file.uri.startsWith('_claude_fs_right:'))
      .forEach(file => {
        diagnosticsForClaudeFsRightUrisWithBaselinesMap.set(
          this.normalizeFileUri(file.uri),
          file,
        )
      })

    const newDiagnosticFiles: DiagnosticFile[] = []

    
    for (const file of diagnosticsForFileUrisWithBaselines) {
      const normalizedPath = this.normalizeFileUri(file.uri)
      const baselineDiagnostics = this.baseline.get(normalizedPath) || []

      
      const claudeFsRightFile =
        diagnosticsForClaudeFsRightUrisWithBaselinesMap.get(normalizedPath)

      
      let fileToUse = file

      if (claudeFsRightFile) {
        const previousRightDiagnostics =
          this.rightFileDiagnosticsState.get(normalizedPath)

        
        
        
        if (
          !previousRightDiagnostics ||
          !this.areDiagnosticArraysEqual(
            previousRightDiagnostics,
            claudeFsRightFile.diagnostics,
          )
        ) {
          fileToUse = claudeFsRightFile
        }

        
        this.rightFileDiagnosticsState.set(
          normalizedPath,
          claudeFsRightFile.diagnostics,
        )
      }

      
      const newDiagnostics = fileToUse.diagnostics.filter(
        d => !baselineDiagnostics.some(b => this.areDiagnosticsEqual(d, b)),
      )

      if (newDiagnostics.length > 0) {
        newDiagnosticFiles.push({
          uri: file.uri,
          diagnostics: newDiagnostics,
        })
      }

      
      this.baseline.set(normalizedPath, fileToUse.diagnostics)
    }

    return newDiagnosticFiles
  }

  private parseDiagnosticResult(result: unknown): DiagnosticFile[] {
    if (Array.isArray(result)) {
      const textBlock = result.find(block => block.type === 'text')
      if (textBlock && 'text' in textBlock) {
        const parsed = jsonParse(textBlock.text)
        return parsed
      }
    }
    return []
  }

  private areDiagnosticsEqual(a: Diagnostic, b: Diagnostic): boolean {
    return (
      a.message === b.message &&
      a.severity === b.severity &&
      a.source === b.source &&
      a.code === b.code &&
      a.range.start.line === b.range.start.line &&
      a.range.start.character === b.range.start.character &&
      a.range.end.line === b.range.end.line &&
      a.range.end.character === b.range.end.character
    )
  }

  private areDiagnosticArraysEqual(a: Diagnostic[], b: Diagnostic[]): boolean {
    if (a.length !== b.length) return false

    
    return (
      a.every(diagA =>
        b.some(diagB => this.areDiagnosticsEqual(diagA, diagB)),
      ) &&
      b.every(diagB => a.some(diagA => this.areDiagnosticsEqual(diagA, diagB)))
    )
  }

  

  async handleQueryStart(clients: MCPServerConnection[]): Promise<void> {
    
    if (!this.initialized) {
      
      const connectedIdeClient = getConnectedIdeClient(clients)

      if (connectedIdeClient) {
        this.initialize(connectedIdeClient)
      }
    } else {
      
      this.reset()
    }
  }

  

  static formatDiagnosticsSummary(files: DiagnosticFile[]): string {
    const truncationMarker = '…[truncated]'
    const result = files
      .map(file => {
        const filename = file.uri.split('/').pop() || file.uri
        const diagnostics = file.diagnostics
          .map(d => {
            const severitySymbol = DiagnosticTrackingService.getSeveritySymbol(
              d.severity,
            )

            return `  ${severitySymbol} [Line ${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}${d.code ? ` [${d.code}]` : ''}${d.source ? ` (${d.source})` : ''}`
          })
          .join('\n')

        return `${filename}:\n${diagnostics}`
      })
      .join('\n\n')

    if (result.length > MAX_DIAGNOSTICS_SUMMARY_CHARS) {
      return (
        result.slice(
          0,
          MAX_DIAGNOSTICS_SUMMARY_CHARS - truncationMarker.length,
        ) + truncationMarker
      )
    }
    return result
  }

  

  static getSeveritySymbol(severity: Diagnostic['severity']): string {
    return (
      {
        Error: figures.cross,
        Warning: figures.warning,
        Info: figures.info,
        Hint: figures.star,
      }[severity] || figures.bullet
    )
  }
}

export const diagnosticTracker = DiagnosticTrackingService.getInstance()
