import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile } from 'fs/promises'
import { join } from 'path'
import {
  PDF_MAX_EXTRACT_SIZE,
  PDF_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { errorMessage } from './errors.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { formatFileSize } from './format.js'
import { getFsImplementation } from './fsOperations.js'
import { getToolResultsDir } from './toolResultStorage.js'

export type PDFError = {
  reason:
    | 'empty'
    | 'too_large'
    | 'password_protected'
    | 'corrupted'
    | 'unknown'
    | 'unavailable'
  message: string
}

export type PDFResult<T> =
  | { success: true; data: T }
  | { success: false; error: PDFError }

export async function readPDF(filePath: string): Promise<
  PDFResult<{
    type: 'pdf'
    file: {
      filePath: string
      base64: string
      originalSize: number
    }
  }>
> {
  try {
    const fs = getFsImplementation()
    const stats = await fs.stat(filePath)
    const originalSize = stats.size

    
    if (originalSize === 0) {
      return {
        success: false,
        error: { reason: 'empty', message: `PDF file is empty: ${filePath}` },
      }
    }

    
    
    
    if (originalSize > PDF_TARGET_RAW_SIZE) {
      return {
        success: false,
        error: {
          reason: 'too_large',
          message: `PDF file exceeds maximum allowed size of ${formatFileSize(PDF_TARGET_RAW_SIZE)}.`,
        },
      }
    }

    const fileBuffer = await readFile(filePath)

    
    
    
    
    
    const header = fileBuffer.subarray(0, 5).toString('ascii')
    if (!header.startsWith('%PDF-')) {
      return {
        success: false,
        error: {
          reason: 'corrupted',
          message: `File is not a valid PDF (missing %PDF- header): ${filePath}`,
        },
      }
    }

    const base64 = fileBuffer.toString('base64')

    
    

    return {
      success: true,
      data: {
        type: 'pdf',
        file: {
          filePath,
          base64,
          originalSize,
        },
      },
    }
  } catch (e: unknown) {
    return {
      success: false,
      error: {
        reason: 'unknown',
        message: errorMessage(e),
      },
    }
  }
}

export async function getPDFPageCount(
  filePath: string,
): Promise<number | null> {
  const { code, stdout } = await execFileNoThrow('pdfinfo', [filePath], {
    timeout: 10_000,
    useCwd: false,
  })
  if (code !== 0) {
    return null
  }
  const match = /^Pages:\s+(\d+)/m.exec(stdout)
  if (!match) {
    return null
  }
  const count = parseInt(match[1]!, 10)
  return isNaN(count) ? null : count
}

export type PDFExtractPagesResult = {
  type: 'parts'
  file: {
    filePath: string
    originalSize: number
    count: number
    outputDir: string
  }
}

let pdftoppmAvailable: boolean | undefined

export function resetPdftoppmCache(): void {
  pdftoppmAvailable = undefined
}

export async function isPdftoppmAvailable(): Promise<boolean> {
  if (pdftoppmAvailable !== undefined) return pdftoppmAvailable
  const { code, stderr } = await execFileNoThrow('pdftoppm', ['-v'], {
    timeout: 5000,
    useCwd: false,
  })
  
  pdftoppmAvailable = code === 0 || stderr.length > 0
  return pdftoppmAvailable
}

export async function extractPDFPages(
  filePath: string,
  options?: { firstPage?: number; lastPage?: number },
): Promise<PDFResult<PDFExtractPagesResult>> {
  try {
    const fs = getFsImplementation()
    const stats = await fs.stat(filePath)
    const originalSize = stats.size

    if (originalSize === 0) {
      return {
        success: false,
        error: { reason: 'empty', message: `PDF file is empty: ${filePath}` },
      }
    }

    if (originalSize > PDF_MAX_EXTRACT_SIZE) {
      return {
        success: false,
        error: {
          reason: 'too_large',
          message: `PDF file exceeds maximum allowed size for text extraction (${formatFileSize(PDF_MAX_EXTRACT_SIZE)}).`,
        },
      }
    }

    const available = await isPdftoppmAvailable()
    if (!available) {
      return {
        success: false,
        error: {
          reason: 'unavailable',
          message:
            'pdftoppm is not installed. Install poppler-utils (e.g. `brew install poppler` or `apt-get install poppler-utils`) to enable PDF page rendering.',
        },
      }
    }

    const uuid = randomUUID()
    const outputDir = join(getToolResultsDir(), `pdf-${uuid}`)
    await mkdir(outputDir, { recursive: true })

    
    const prefix = join(outputDir, 'page')
    const args = ['-jpeg', '-r', '100']
    if (options?.firstPage) {
      args.push('-f', String(options.firstPage))
    }
    if (options?.lastPage && options.lastPage !== Infinity) {
      args.push('-l', String(options.lastPage))
    }
    args.push(filePath, prefix)
    const { code, stderr } = await execFileNoThrow('pdftoppm', args, {
      timeout: 120_000,
      useCwd: false,
    })

    if (code !== 0) {
      if (/password/i.test(stderr)) {
        return {
          success: false,
          error: {
            reason: 'password_protected',
            message:
              'PDF is password-protected. Please provide an unprotected version.',
          },
        }
      }
      if (/damaged|corrupt|invalid/i.test(stderr)) {
        return {
          success: false,
          error: {
            reason: 'corrupted',
            message: 'PDF file is corrupted or invalid.',
          },
        }
      }
      return {
        success: false,
        error: { reason: 'unknown', message: `pdftoppm failed: ${stderr}` },
      }
    }

    
    const entries = await readdir(outputDir)
    const imageFiles = entries.filter(f => f.endsWith('.jpg')).sort()
    const pageCount = imageFiles.length

    if (pageCount === 0) {
      return {
        success: false,
        error: {
          reason: 'corrupted',
          message: 'pdftoppm produced no output pages. The PDF may be invalid.',
        },
      }
    }

    const count = imageFiles.length

    return {
      success: true,
      data: {
        type: 'parts',
        file: {
          filePath,
          originalSize,
          outputDir,
          count,
        },
      },
    }
  } catch (e: unknown) {
    return {
      success: false,
      error: {
        reason: 'unknown',
        message: errorMessage(e),
      },
    }
  }
}
