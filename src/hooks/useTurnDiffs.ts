import type { StructuredPatchHunk } from 'diff'
import { useMemo, useRef } from 'react'
import type { FileEditOutput } from '../tools/FileEditTool/types.js'
import type { Output as FileWriteOutput } from '../tools/FileWriteTool/FileWriteTool.js'
import type { Message } from '../types/message.js'

export type TurnFileDiff = {
  filePath: string
  hunks: StructuredPatchHunk[]
  isNewFile: boolean
  linesAdded: number
  linesRemoved: number
}

export type TurnDiff = {
  turnIndex: number
  userPromptPreview: string
  timestamp: string
  files: Map<string, TurnFileDiff>
  stats: {
    filesChanged: number
    linesAdded: number
    linesRemoved: number
  }
}

type FileEditResult = FileEditOutput | FileWriteOutput

type TurnDiffCache = {
  completedTurns: TurnDiff[]
  currentTurn: TurnDiff | null
  lastProcessedIndex: number
  lastTurnIndex: number
}

function isFileEditResult(result: unknown): result is FileEditResult {
  if (!result || typeof result !== 'object') return false
  const r = result as Record<string, unknown>
  
  
  
  const hasFilePath = typeof r.filePath === 'string'
  const hasStructuredPatch =
    Array.isArray(r.structuredPatch) && r.structuredPatch.length > 0
  const isNewFile = r.type === 'create' && typeof r.content === 'string'
  return hasFilePath && (hasStructuredPatch || isNewFile)
}

function isFileWriteOutput(result: FileEditResult): result is FileWriteOutput {
  return (
    'type' in result && (result.type === 'create' || result.type === 'update')
  )
}

function countHunkLines(hunks: StructuredPatchHunk[]): {
  added: number
  removed: number
} {
  let added = 0
  let removed = 0
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

function getUserPromptPreview(message: Message): string {
  if (message.type !== 'user') return ''
  const content = message.message.content
  const text = typeof content === 'string' ? content : ''
  
  if (text.length <= 30) return text
  return text.slice(0, 29) + '…'
}

function computeTurnStats(turn: TurnDiff): void {
  let totalAdded = 0
  let totalRemoved = 0
  for (const file of turn.files.values()) {
    totalAdded += file.linesAdded
    totalRemoved += file.linesRemoved
  }
  turn.stats = {
    filesChanged: turn.files.size,
    linesAdded: totalAdded,
    linesRemoved: totalRemoved,
  }
}

export function useTurnDiffs(messages: Message[]): TurnDiff[] {
  const cache = useRef<TurnDiffCache>({
    completedTurns: [],
    currentTurn: null,
    lastProcessedIndex: 0,
    lastTurnIndex: 0,
  })

  return useMemo(() => {
    const c = cache.current

    
    if (messages.length < c.lastProcessedIndex) {
      c.completedTurns = []
      c.currentTurn = null
      c.lastProcessedIndex = 0
      c.lastTurnIndex = 0
    }

    
    for (let i = c.lastProcessedIndex; i < messages.length; i++) {
      const message = messages[i]
      if (!message || message.type !== 'user') continue

      
      const isToolResult =
        message.toolUseResult ||
        (Array.isArray(message.message.content) &&
          message.message.content[0]?.type === 'tool_result')

      if (!isToolResult && !message.isMeta) {
        
        if (c.currentTurn && c.currentTurn.files.size > 0) {
          computeTurnStats(c.currentTurn)
          c.completedTurns.push(c.currentTurn)
        }

        c.lastTurnIndex++
        c.currentTurn = {
          turnIndex: c.lastTurnIndex,
          userPromptPreview: getUserPromptPreview(message),
          timestamp: message.timestamp,
          files: new Map(),
          stats: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 },
        }
      } else if (c.currentTurn && message.toolUseResult) {
        
        const result = message.toolUseResult
        if (isFileEditResult(result)) {
          const { filePath, structuredPatch } = result
          const isNewFile = 'type' in result && result.type === 'create'

          
          let fileEntry = c.currentTurn.files.get(filePath)
          if (!fileEntry) {
            fileEntry = {
              filePath,
              hunks: [],
              isNewFile,
              linesAdded: 0,
              linesRemoved: 0,
            }
            c.currentTurn.files.set(filePath, fileEntry)
          }

          
          if (
            isNewFile &&
            structuredPatch.length === 0 &&
            isFileWriteOutput(result)
          ) {
            const content = result.content
            const lines = content.split('\n')
            const syntheticHunk: StructuredPatchHunk = {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: lines.length,
              lines: lines.map(l => '+' + l),
            }
            fileEntry.hunks.push(syntheticHunk)
            fileEntry.linesAdded += lines.length
          } else {
            
            fileEntry.hunks.push(...structuredPatch)

            
            const { added, removed } = countHunkLines(structuredPatch)
            fileEntry.linesAdded += added
            fileEntry.linesRemoved += removed
          }

          
          if (isNewFile) {
            fileEntry.isNewFile = true
          }
        }
      }
    }

    c.lastProcessedIndex = messages.length

    
    const result = [...c.completedTurns]
    if (c.currentTurn && c.currentTurn.files.size > 0) {
      
      computeTurnStats(c.currentTurn)
      result.push(c.currentTurn)
    }

    
    return result.reverse()
  }, [messages])
}
