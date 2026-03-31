import { unlink } from 'fs/promises'
import { CircularBuffer } from '../CircularBuffer.js'
import { logForDebugging } from '../debug.js'
import { readFileRange, tailFile } from '../fsOperations.js'
import { getMaxOutputLength } from '../shell/outputLimits.js'
import { safeJoinLines } from '../stringUtils.js'
import { DiskTaskOutput, getTaskOutputPath } from './diskOutput.js'

const DEFAULT_MAX_MEMORY = 8 * 1024 * 1024 
const POLL_INTERVAL_MS = 1000
const PROGRESS_TAIL_BYTES = 4096

type ProgressCallback = (
  lastLines: string,
  allLines: string,
  totalLines: number,
  totalBytes: number,
  isIncomplete: boolean,
) => void

export class TaskOutput {
  readonly taskId: string
  readonly path: string
  
  readonly stdoutToFile: boolean
  #stdoutBuffer = ''
  #stderrBuffer = ''
  #disk: DiskTaskOutput | null = null
  #recentLines = new CircularBuffer<string>(1000)
  #totalLines = 0
  #totalBytes = 0
  #maxMemory: number
  #onProgress: ProgressCallback | null
  
  #outputFileRedundant = false
  
  #outputFileSize = 0

  

  
  static #registry = new Map<string, TaskOutput>()
  
  static #activePolling = new Map<string, TaskOutput>()
  static #pollInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    taskId: string,
    onProgress: ProgressCallback | null,
    stdoutToFile = false,
    maxMemory: number = DEFAULT_MAX_MEMORY,
  ) {
    this.taskId = taskId
    this.path = getTaskOutputPath(taskId)
    this.stdoutToFile = stdoutToFile
    this.#maxMemory = maxMemory
    this.#onProgress = onProgress

    
    
    if (stdoutToFile && onProgress) {
      TaskOutput.#registry.set(taskId, this)
    }
  }

  

  static startPolling(taskId: string): void {
    const instance = TaskOutput.#registry.get(taskId)
    if (!instance || !instance.#onProgress) {
      return
    }
    TaskOutput.#activePolling.set(taskId, instance)
    if (!TaskOutput.#pollInterval) {
      TaskOutput.#pollInterval = setInterval(TaskOutput.#tick, POLL_INTERVAL_MS)
      TaskOutput.#pollInterval.unref()
    }
  }

  

  static stopPolling(taskId: string): void {
    TaskOutput.#activePolling.delete(taskId)
    if (TaskOutput.#activePolling.size === 0 && TaskOutput.#pollInterval) {
      clearInterval(TaskOutput.#pollInterval)
      TaskOutput.#pollInterval = null
    }
  }

  

  static #tick(): void {
    for (const [, entry] of TaskOutput.#activePolling) {
      if (!entry.#onProgress) {
        continue
      }
      void tailFile(entry.path, PROGRESS_TAIL_BYTES).then(
        ({ content, bytesRead, bytesTotal }) => {
          if (!entry.#onProgress) {
            return
          }
          
          
          
          if (!content) {
            entry.#onProgress('', '', entry.#totalLines, bytesTotal, false)
            return
          }
          
          
          
          let pos = content.length
          let n5 = 0
          let n100 = 0
          let lineCount = 0
          while (pos > 0) {
            pos = content.lastIndexOf('\n', pos - 1)
            lineCount++
            if (lineCount === 5) n5 = pos <= 0 ? 0 : pos + 1
            if (lineCount === 100) n100 = pos <= 0 ? 0 : pos + 1
          }
          
          
          
          const totalLines =
            bytesRead >= bytesTotal
              ? lineCount
              : Math.max(
                  entry.#totalLines,
                  Math.round((bytesTotal / bytesRead) * lineCount),
                )
          entry.#totalLines = totalLines
          entry.#totalBytes = bytesTotal
          entry.#onProgress(
            content.slice(n5),
            content.slice(n100),
            totalLines,
            bytesTotal,
            bytesRead < bytesTotal,
          )
        },
        () => {
          
        },
      )
    }
  }

  
  writeStdout(data: string): void {
    this.#writeBuffered(data, false)
  }

  
  writeStderr(data: string): void {
    this.#writeBuffered(data, true)
  }

  #writeBuffered(data: string, isStderr: boolean): void {
    this.#totalBytes += data.length

    this.#updateProgress(data)

    
    if (this.#disk) {
      this.#disk.append(isStderr ? `[stderr] ${data}` : data)
      return
    }

    
    const totalMem =
      this.#stdoutBuffer.length + this.#stderrBuffer.length + data.length
    if (totalMem > this.#maxMemory) {
      this.#spillToDisk(isStderr ? data : null, isStderr ? null : data)
      return
    }

    if (isStderr) {
      this.#stderrBuffer += data
    } else {
      this.#stdoutBuffer += data
    }
  }

  

  #updateProgress(data: string): void {
    const MAX_PROGRESS_BYTES = 4096
    const MAX_PROGRESS_LINES = 100

    let lineCount = 0
    const lines: string[] = []
    let extractedBytes = 0
    let pos = data.length

    while (pos > 0) {
      const prev = data.lastIndexOf('\n', pos - 1)
      if (prev === -1) {
        break
      }
      lineCount++
      if (
        lines.length < MAX_PROGRESS_LINES &&
        extractedBytes < MAX_PROGRESS_BYTES
      ) {
        const lineLen = pos - prev - 1
        if (lineLen > 0 && lineLen <= MAX_PROGRESS_BYTES - extractedBytes) {
          const line = data.slice(prev + 1, pos)
          if (line.trim()) {
            lines.push(Buffer.from(line).toString())
            extractedBytes += lineLen
          }
        }
      }
      pos = prev
    }

    this.#totalLines += lineCount

    for (let i = lines.length - 1; i >= 0; i--) {
      this.#recentLines.add(lines[i]!)
    }

    if (this.#onProgress && lines.length > 0) {
      const recent = this.#recentLines.getRecent(5)
      this.#onProgress(
        safeJoinLines(recent, '\n'),
        safeJoinLines(this.#recentLines.getRecent(100), '\n'),
        this.#totalLines,
        this.#totalBytes,
        this.#disk !== null,
      )
    }
  }

  #spillToDisk(stderrChunk: string | null, stdoutChunk: string | null): void {
    this.#disk = new DiskTaskOutput(this.taskId)

    
    if (this.#stdoutBuffer) {
      this.#disk.append(this.#stdoutBuffer)
      this.#stdoutBuffer = ''
    }
    if (this.#stderrBuffer) {
      this.#disk.append(`[stderr] ${this.#stderrBuffer}`)
      this.#stderrBuffer = ''
    }

    
    if (stdoutChunk) {
      this.#disk.append(stdoutChunk)
    }
    if (stderrChunk) {
      this.#disk.append(`[stderr] ${stderrChunk}`)
    }
  }

  

  async getStdout(): Promise<string> {
    if (this.stdoutToFile) {
      return this.#readStdoutFromFile()
    }
    
    if (this.#disk) {
      const recent = this.#recentLines.getRecent(5)
      const tail = safeJoinLines(recent, '\n')
      const sizeKB = Math.round(this.#totalBytes / 1024)
      const notice = `\nOutput truncated (${sizeKB}KB total). Full output saved to: ${this.path}`
      return tail ? tail + notice : notice.trimStart()
    }
    return this.#stdoutBuffer
  }

  async #readStdoutFromFile(): Promise<string> {
    const maxBytes = getMaxOutputLength()
    try {
      const result = await readFileRange(this.path, 0, maxBytes)
      if (!result) {
        this.#outputFileRedundant = true
        return ''
      }
      const { content, bytesRead, bytesTotal } = result
      
      
      
      this.#outputFileSize = bytesTotal
      this.#outputFileRedundant = bytesTotal <= bytesRead
      return content
    } catch (err) {
      
      
      
      
      
      
      const code =
        err instanceof Error && 'code' in err ? String(err.code) : 'unknown'
      logForDebugging(
        `TaskOutput.#readStdoutFromFile: failed to read ${this.path} (${code}): ${err}`,
      )
      return `<bash output unavailable: output file ${this.path} could not be read (${code}). This usually means another Claude Code Next process in the same project deleted it during startup cleanup.>`
    }
  }

  
  getStderr(): string {
    if (this.#disk) {
      return ''
    }
    return this.#stderrBuffer
  }

  get isOverflowed(): boolean {
    return this.#disk !== null
  }

  get totalLines(): number {
    return this.#totalLines
  }

  get totalBytes(): number {
    return this.#totalBytes
  }

  

  get outputFileRedundant(): boolean {
    return this.#outputFileRedundant
  }

  
  get outputFileSize(): number {
    return this.#outputFileSize
  }

  
  spillToDisk(): void {
    if (!this.#disk) {
      this.#spillToDisk(null, null)
    }
  }

  async flush(): Promise<void> {
    await this.#disk?.flush()
  }

  
  async deleteOutputFile(): Promise<void> {
    try {
      await unlink(this.path)
    } catch {
      
    }
  }

  clear(): void {
    this.#stdoutBuffer = ''
    this.#stderrBuffer = ''
    this.#recentLines.clear()
    this.#onProgress = null
    this.#disk?.cancel()
    TaskOutput.stopPolling(this.taskId)
    TaskOutput.#registry.delete(this.taskId)
  }
}
