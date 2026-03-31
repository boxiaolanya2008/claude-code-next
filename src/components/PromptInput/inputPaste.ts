import { getPastedTextRefNumLines } from 'src/history.js'
import type { PastedContent } from 'src/utils/config.js'

const TRUNCATION_THRESHOLD = 10000 
const PREVIEW_LENGTH = 1000 

type TruncatedMessage = {
  truncatedText: string
  placeholderContent: string
}

export function maybeTruncateMessageForInput(
  text: string,
  nextPasteId: number,
): TruncatedMessage {
  
  if (text.length <= TRUNCATION_THRESHOLD) {
    return {
      truncatedText: text,
      placeholderContent: '',
    }
  }

  
  const startLength = Math.floor(PREVIEW_LENGTH / 2)
  const endLength = Math.floor(PREVIEW_LENGTH / 2)

  
  const startText = text.slice(0, startLength)
  const endText = text.slice(-endLength)

  
  const placeholderContent = text.slice(startLength, -endLength)
  const truncatedLines = getPastedTextRefNumLines(placeholderContent)

  
  const placeholderId = nextPasteId
  const placeholderRef = formatTruncatedTextRef(placeholderId, truncatedLines)

  
  const truncatedText = startText + placeholderRef + endText

  return {
    truncatedText,
    placeholderContent,
  }
}

function formatTruncatedTextRef(id: number, numLines: number): string {
  return `[...Truncated text #${id} +${numLines} lines...]`
}

export function maybeTruncateInput(
  input: string,
  pastedContents: Record<number, PastedContent>,
): { newInput: string; newPastedContents: Record<number, PastedContent> } {
  
  const existingIds = Object.keys(pastedContents).map(Number)
  const nextPasteId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1

  
  const { truncatedText, placeholderContent } = maybeTruncateMessageForInput(
    input,
    nextPasteId,
  )

  if (!placeholderContent) {
    return { newInput: input, newPastedContents: pastedContents }
  }

  return {
    newInput: truncatedText,
    newPastedContents: {
      ...pastedContents,
      [nextPasteId]: {
        id: nextPasteId,
        type: 'text',
        content: placeholderContent,
      },
    },
  }
}
