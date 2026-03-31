import { useEffect, useRef } from 'react'
import { logError } from 'src/utils/log.js'
import { z } from 'zod/v4'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import { getConnectedIdeClient } from '../utils/ide.js'
import { lazySchema } from '../utils/lazySchema.js'
export type SelectionPoint = {
  line: number
  character: number
}

export type SelectionData = {
  selection: {
    start: SelectionPoint
    end: SelectionPoint
  } | null
  text?: string
  filePath?: string
}

export type IDESelection = {
  lineCount: number
  lineStart?: number
  text?: string
  filePath?: string
}

// Define the selection changed notification schema
const SelectionChangedSchema = lazySchema(() =>
  z.object({
    method: z.literal('selection_changed'),
    params: z.object({
      selection: z
        .object({
          start: z.object({
            line: z.number(),
            character: z.number(),
          }),
          end: z.object({
            line: z.number(),
            character: z.number(),
          }),
        })
        .nullable()
        .optional(),
      text: z.string().optional(),
      filePath: z.string().optional(),
    }),
  }),
)

export function useIdeSelection(
  mcpClients: MCPServerConnection[],
  onSelect: (selection: IDESelection) => void,
): void {
  const handlersRegistered = useRef(false)
  const currentIDERef = useRef<ConnectedMCPServer | null>(null)

  useEffect(() => {
    // Find the IDE client from the MCP clients list
    const ideClient = getConnectedIdeClient(mcpClients)

    
    
    
    if (currentIDERef.current !== (ideClient ?? null)) {
      handlersRegistered.current = false
      currentIDERef.current = ideClient || null
      
      onSelect({
        lineCount: 0,
        lineStart: undefined,
        text: undefined,
        filePath: undefined,
      })
    }

    // Skip if we've already registered handlers for the current IDE or if there's no IDE client
    if (handlersRegistered.current || !ideClient) {
      return
    }

    // Handler function for selection changes
    const selectionChangeHandler = (data: SelectionData) => {
      if (data.selection?.start && data.selection?.end) {
        const { start, end } = data.selection
        let lineCount = end.line - start.line + 1
        
        
        if (end.character === 0) {
          lineCount--
        }
        const selection = {
          lineCount,
          lineStart: start.line,
          text: data.text,
          filePath: data.filePath,
        }

        onSelect(selection)
      }
    }

    // Register notification handler for selection_changed events
    ideClient.client.setNotificationHandler(
      SelectionChangedSchema(),
      notification => {
        if (currentIDERef.current !== ideClient) {
          return
        }

        try {
          // Get the selection data from the notification params
          const selectionData = notification.params

          
          if (
            selectionData.selection &&
            selectionData.selection.start &&
            selectionData.selection.end
          ) {
            // Handle selection changes
            selectionChangeHandler(selectionData as SelectionData)
          } else if (selectionData.text !== undefined) {
            // Handle empty selection (when text is empty string)
            selectionChangeHandler({
              selection: null,
              text: selectionData.text,
              filePath: selectionData.filePath,
            })
          }
        } catch (error) {
          logError(error as Error)
        }
      },
    )

    
    handlersRegistered.current = true

    
  }, [mcpClients, onSelect])
}
