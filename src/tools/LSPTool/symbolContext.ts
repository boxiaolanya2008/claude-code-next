import { logForDebugging } from '../../utils/debug.js'
import { truncate } from '../../utils/format.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { expandPath } from '../../utils/path.js'

const MAX_READ_BYTES = 64 * 1024

export function getSymbolAtPosition(
  filePath: string,
  line: number,
  character: number,
): string | null {
  try {
    const fs = getFsImplementation()
    const absolutePath = expandPath(filePath)

    
    
    
    
    
    const { buffer, bytesRead } = fs.readSync(absolutePath, {
      length: MAX_READ_BYTES,
    })
    const content = buffer.toString('utf-8', 0, bytesRead)
    const lines = content.split('\n')

    if (line < 0 || line >= lines.length) {
      return null
    }
    
    
    if (bytesRead === MAX_READ_BYTES && line === lines.length - 1) {
      return null
    }

    const lineContent = lines[line]
    if (!lineContent || character < 0 || character >= lineContent.length) {
      return null
    }

    
    
    
    
    
    
    
    const symbolPattern = /[\w$'!]+|[+\-*/%&|^~<>=]+/g
    let match: RegExpExecArray | null

    while ((match = symbolPattern.exec(lineContent)) !== null) {
      const start = match.index
      const end = start + match[0].length

      
      if (character >= start && character < end) {
        const symbol = match[0]
        
        return truncate(symbol, 30)
      }
    }

    return null
  } catch (error) {
    
    
    if (error instanceof Error) {
      logForDebugging(
        `Symbol extraction failed for ${filePath}:${line}:${character}: ${error.message}`,
        { level: 'warn' },
      )
    }
    
    return null
  }
}
