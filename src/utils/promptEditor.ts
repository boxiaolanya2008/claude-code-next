import {
  expandPastedTextRefs,
  formatPastedTextRef,
  getPastedTextRefNumLines,
} from '../history.js'
import instances from '../ink/instances.js'
import type { PastedContent } from './config.js'
import { classifyGuiEditor, getExternalEditor } from './editor.js'
import { execSync_DEPRECATED } from './execSyncWrapper.js'
import { getFsImplementation } from './fsOperations.js'
import { toIDEDisplayName } from './ide.js'
import { writeFileSync_DEPRECATED } from './slowOperations.js'
import { generateTempFilePath } from './tempfile.js'

const EDITOR_OVERRIDES: Record<string, string> = {
  code: 'code -w', 
  subl: 'subl --wait', 
}

function isGuiEditor(editor: string): boolean {
  return classifyGuiEditor(editor) !== undefined
}

export type EditorResult = {
  content: string | null
  error?: string
}

export function editFileInEditor(filePath: string): EditorResult {
  const fs = getFsImplementation()
  const inkInstance = instances.get(process.stdout)
  if (!inkInstance) {
    throw new Error('Ink instance not found - cannot pause rendering')
  }

  const editor = getExternalEditor()
  if (!editor) {
    return { content: null }
  }

  try {
    fs.statSync(filePath)
  } catch {
    return { content: null }
  }

  const useAlternateScreen = !isGuiEditor(editor)

  if (useAlternateScreen) {
    
    
    
    
    
    
    inkInstance.enterAlternateScreen()
  } else {
    
    
    inkInstance.pause()
    inkInstance.suspendStdin()
  }

  try {
    
    const editorCommand = EDITOR_OVERRIDES[editor] ?? editor
    execSync_DEPRECATED(`${editorCommand} "${filePath}"`, {
      stdio: 'inherit',
    })

    
    const editedContent = fs.readFileSync(filePath, { encoding: 'utf-8' })
    return { content: editedContent }
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof (err as { status: unknown }).status === 'number'
    ) {
      const status = (err as { status: number }).status
      if (status !== 0) {
        const editorName = toIDEDisplayName(editor)
        return {
          content: null,
          error: `${editorName} exited with code ${status}`,
        }
      }
    }
    return { content: null }
  } finally {
    if (useAlternateScreen) {
      inkInstance.exitAlternateScreen()
    } else {
      inkInstance.resumeStdin()
      inkInstance.resume()
    }
  }
}

function recollapsePastedContent(
  editedPrompt: string,
  originalPrompt: string,
  pastedContents: Record<number, PastedContent>,
): string {
  let collapsed = editedPrompt

  
  for (const [id, content] of Object.entries(pastedContents)) {
    if (content.type === 'text') {
      const pasteId = parseInt(id)
      const contentStr = content.content

      
      const contentIndex = collapsed.indexOf(contentStr)
      if (contentIndex !== -1) {
        
        const numLines = getPastedTextRefNumLines(contentStr)
        const ref = formatPastedTextRef(pasteId, numLines)
        collapsed =
          collapsed.slice(0, contentIndex) +
          ref +
          collapsed.slice(contentIndex + contentStr.length)
      }
    }
  }

  return collapsed
}

export function editPromptInEditor(
  currentPrompt: string,
  pastedContents?: Record<number, PastedContent>,
): EditorResult {
  const fs = getFsImplementation()
  const tempFile = generateTempFilePath()

  try {
    
    const expandedPrompt = pastedContents
      ? expandPastedTextRefs(currentPrompt, pastedContents)
      : currentPrompt

    
    writeFileSync_DEPRECATED(tempFile, expandedPrompt, {
      encoding: 'utf-8',
      flush: true,
    })

    
    const result = editFileInEditor(tempFile)

    if (result.content === null) {
      return result
    }

    
    let finalContent = result.content
    if (finalContent.endsWith('\n') && !finalContent.endsWith('\n\n')) {
      finalContent = finalContent.slice(0, -1)
    }

    
    if (pastedContents) {
      finalContent = recollapsePastedContent(
        finalContent,
        currentPrompt,
        pastedContents,
      )
    }

    return { content: finalContent }
  } finally {
    
    try {
      fs.unlinkSync(tempFile)
    } catch {
      
    }
  }
}
