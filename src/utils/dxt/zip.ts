import { isAbsolute, normalize } from 'path'
import { logForDebugging } from '../debug.js'
import { isENOENT } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { containsPathTraversal } from '../path.js'

const LIMITS = {
  MAX_FILE_SIZE: 512 * 1024 * 1024, 
  MAX_TOTAL_SIZE: 1024 * 1024 * 1024, 
  MAX_FILE_COUNT: 100000, 
  MAX_COMPRESSION_RATIO: 50, 
  MIN_COMPRESSION_RATIO: 0.5, 
}

type ZipValidationState = {
  fileCount: number
  totalUncompressedSize: number
  compressedSize: number
  errors: string[]
}

type ZipFileMetadata = {
  name: string
  originalSize?: number
}

type FileValidationResult = {
  isValid: boolean
  error?: string
}

export function isPathSafe(filePath: string): boolean {
  if (containsPathTraversal(filePath)) {
    return false
  }

  
  const normalized = normalize(filePath)

  
  if (isAbsolute(normalized)) {
    return false
  }

  return true
}

export function validateZipFile(
  file: ZipFileMetadata,
  state: ZipValidationState,
): FileValidationResult {
  state.fileCount++

  let error: string | undefined

  
  if (state.fileCount > LIMITS.MAX_FILE_COUNT) {
    error = `Archive contains too many files: ${state.fileCount} (max: ${LIMITS.MAX_FILE_COUNT})`
  }

  
  if (!isPathSafe(file.name)) {
    error = `Unsafe file path detected: "${file.name}". Path traversal or absolute paths are not allowed.`
  }

  
  const fileSize = file.originalSize || 0
  if (fileSize > LIMITS.MAX_FILE_SIZE) {
    error = `File "${file.name}" is too large: ${Math.round(fileSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_FILE_SIZE / 1024 / 1024)}MB)`
  }

  
  state.totalUncompressedSize += fileSize

  
  if (state.totalUncompressedSize > LIMITS.MAX_TOTAL_SIZE) {
    error = `Archive total size is too large: ${Math.round(state.totalUncompressedSize / 1024 / 1024)}MB (max: ${Math.round(LIMITS.MAX_TOTAL_SIZE / 1024 / 1024)}MB)`
  }

  
  const currentRatio = state.totalUncompressedSize / state.compressedSize
  if (currentRatio > LIMITS.MAX_COMPRESSION_RATIO) {
    error = `Suspicious compression ratio detected: ${currentRatio.toFixed(1)}:1 (max: ${LIMITS.MAX_COMPRESSION_RATIO}:1). This may be a zip bomb.`
  }

  return error ? { isValid: false, error } : { isValid: true }
}

export async function unzipFile(
  zipData: Buffer,
): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = await import('fflate')
  const compressedSize = zipData.length

  const state: ZipValidationState = {
    fileCount: 0,
    totalUncompressedSize: 0,
    compressedSize: compressedSize,
    errors: [],
  }

  const result = unzipSync(new Uint8Array(zipData), {
    filter: file => {
      const validationResult = validateZipFile(file, state)
      if (!validationResult.isValid) {
        throw new Error(validationResult.error!)
      }
      return true
    },
  })

  logForDebugging(
    `Zip extraction completed: ${state.fileCount} files, ${Math.round(state.totalUncompressedSize / 1024)}KB uncompressed`,
  )

  return result
}

export function parseZipModes(data: Uint8Array): Record<string, number> {
  
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const modes: Record<string, number> = {}

  
  
  
  const minEocd = Math.max(0, buf.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return modes 

  const entryCount = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16) 

  
  
  for (let i = 0; i < entryCount; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) break
    const versionMadeBy = buf.readUInt16LE(off + 4)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const externalAttr = buf.readUInt32LE(off + 38)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)

    
    
    if (versionMadeBy >> 8 === 3) {
      const mode = (externalAttr >>> 16) & 0xffff
      if (mode) modes[name] = mode
    }

    off += 46 + nameLen + extraLen + commentLen
  }

  return modes
}

export async function readAndUnzipFile(
  filePath: string,
): Promise<Record<string, Uint8Array>> {
  const fs = getFsImplementation()

  try {
    const zipData = await fs.readFileBytes(filePath)
    
    
    return await unzipFile(zipData)
  } catch (error) {
    if (isENOENT(error)) {
      throw error
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read or unzip file: ${errorMessage}`)
  }
}
