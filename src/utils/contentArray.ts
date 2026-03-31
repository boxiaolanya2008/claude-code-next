

export function insertBlockAfterToolResults(
  content: unknown[],
  block: unknown,
): void {
  
  let lastToolResultIndex = -1
  for (let i = 0; i < content.length; i++) {
    const item = content[i]
    if (
      item &&
      typeof item === 'object' &&
      'type' in item &&
      (item as { type: string }).type === 'tool_result'
    ) {
      lastToolResultIndex = i
    }
  }

  if (lastToolResultIndex >= 0) {
    const insertPos = lastToolResultIndex + 1
    content.splice(insertPos, 0, block)
    
    if (insertPos === content.length - 1) {
      content.push({ type: 'text', text: '.' })
    }
  } else {
    
    const insertIndex = Math.max(0, content.length - 1)
    content.splice(insertIndex, 0, block)
  }
}
