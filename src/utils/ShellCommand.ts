import type { ChildProcess } from 'child_process'
import { stat } from 'fs/promises'
import type { Readable } from 'stream'
import treeKill from 'tree-kill'
import { generateTaskId } from '../Task.js'
import { formatDuration } from './format.js'
import {
  MAX_TASK_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES_DISPLAY,
} from './task/diskOutput.js'
import { TaskOutput } from './task/TaskOutput.js'

export type ExecResult = {
  stdout: string
  stderr: string
  code: number
  interrupted: boolean
  backgroundTaskId?: string
  backgroundedByUser?: boolean
  
  assistantAutoBackgrounded?: boolean
  
  outputFilePath?: string
  
  outputFileSize?: number
  
  outputTaskId?: string
  
  preSpawnError?: string
}

export type ShellCommand = {
  background: (backgroundTaskId: string) => boolean
  result: Promise<ExecResult>
  kill: () => void
  status: 'running' | 'backgrounded' | 'completed' | 'killed'
  

  cleanup: () => void
  onTimeout?: (
    callback: (backgroundFn: (taskId: string) => boolean) => void,
  ) => void
  
  taskOutput: TaskOutput
}

const SIGKILL = 137
const SIGTERM = 143

const SIZE_WATCHDOG_INTERVAL_MS = 5_000

function prependStderr(prefix: string, stderr: string): string {
  return stderr ? `${prefix} ${stderr}` : prefix
}

class StreamWrapper {
  #stream: Readable | null
  #isCleanedUp = false
  #taskOutput: TaskOutput | null
  #isStderr: boolean
  #onData = this.#dataHandler.bind(this)

  constructor(stream: Readable, taskOutput: TaskOutput, isStderr: boolean) {
    this.#stream = stream
    this.#taskOutput = taskOutput
    this.#isStderr = isStderr
    
    stream.setEncoding('utf-8')
    stream.on('data', this.#onData)
  }

  #dataHandler(data: Buffer | string): void {
    const str = typeof data === 'string' ? data : data.toString()

    if (this.#isStderr) {
      this.#taskOutput!.writeStderr(str)
    } else {
      this.#taskOutput!.writeStdout(str)
    }
  }

  cleanup(): void {
    if (this.#isCleanedUp) {
      return
    }
    this.#isCleanedUp = true
    this.#stream!.removeListener('data', this.#onData)
    
    
    this.#stream = null
    this.#taskOutput = null
    this.#onData = () => {}
  }
}

class ShellCommandImpl implements ShellCommand {
  #status: 'running' | 'backgrounded' | 'completed' | 'killed' = 'running'
  #backgroundTaskId: string | undefined
  #stdoutWrapper: StreamWrapper | null
  #stderrWrapper: StreamWrapper | null
  #childProcess: ChildProcess
  #timeoutId: NodeJS.Timeout | null = null
  #sizeWatchdog: NodeJS.Timeout | null = null
  #killedForSize = false
  #maxOutputBytes: number
  #abortSignal: AbortSignal
  #onTimeoutCallback:
    | ((backgroundFn: (taskId: string) => boolean) => void)
    | undefined
  #timeout: number
  #shouldAutoBackground: boolean
  #resultResolver: ((result: ExecResult) => void) | null = null
  #exitCodeResolver: ((code: number) => void) | null = null
  #boundAbortHandler: (() => void) | null = null
  readonly taskOutput: TaskOutput

  static #handleTimeout(self: ShellCommandImpl): void {
    if (self.#shouldAutoBackground && self.#onTimeoutCallback) {
      self.#onTimeoutCallback(self.background.bind(self))
    } else {
      self.#doKill(SIGTERM)
    }
  }

  readonly result: Promise<ExecResult>
  readonly onTimeout?: (
    callback: (backgroundFn: (taskId: string) => boolean) => void,
  ) => void

  constructor(
    childProcess: ChildProcess,
    abortSignal: AbortSignal,
    timeout: number,
    taskOutput: TaskOutput,
    shouldAutoBackground = false,
    maxOutputBytes = MAX_TASK_OUTPUT_BYTES,
  ) {
    this.#childProcess = childProcess
    this.#abortSignal = abortSignal
    this.#timeout = timeout
    this.#shouldAutoBackground = shouldAutoBackground
    this.#maxOutputBytes = maxOutputBytes
    this.taskOutput = taskOutput

    
    
    
    this.#stderrWrapper = childProcess.stderr
      ? new StreamWrapper(childProcess.stderr, taskOutput, true)
      : null
    this.#stdoutWrapper = childProcess.stdout
      ? new StreamWrapper(childProcess.stdout, taskOutput, false)
      : null

    if (shouldAutoBackground) {
      this.onTimeout = (callback): void => {
        this.#onTimeoutCallback = callback
      }
    }

    this.result = this.#createResultPromise()
  }

  get status(): 'running' | 'backgrounded' | 'completed' | 'killed' {
    return this.#status
  }

  #abortHandler(): void {
    
    
    if (this.#abortSignal.reason === 'interrupt') {
      return
    }
    this.kill()
  }

  #exitHandler(code: number | null, signal: NodeJS.Signals | null): void {
    const exitCode =
      code !== null && code !== undefined
        ? code
        : signal === 'SIGTERM'
          ? 144
          : 1
    this.#resolveExitCode(exitCode)
  }

  #errorHandler(): void {
    this.#resolveExitCode(1)
  }

  #resolveExitCode(code: number): void {
    if (this.#exitCodeResolver) {
      this.#exitCodeResolver(code)
      this.#exitCodeResolver = null
    }
  }

  
  
  #cleanupListeners(): void {
    this.#clearSizeWatchdog()
    const timeoutId = this.#timeoutId
    if (timeoutId) {
      clearTimeout(timeoutId)
      this.#timeoutId = null
    }
    const boundAbortHandler = this.#boundAbortHandler
    if (boundAbortHandler) {
      this.#abortSignal.removeEventListener('abort', boundAbortHandler)
      this.#boundAbortHandler = null
    }
  }

  #clearSizeWatchdog(): void {
    if (this.#sizeWatchdog) {
      clearInterval(this.#sizeWatchdog)
      this.#sizeWatchdog = null
    }
  }

  #startSizeWatchdog(): void {
    this.#sizeWatchdog = setInterval(() => {
      void stat(this.taskOutput.path).then(
        s => {
          
          
          if (
            s.size > this.#maxOutputBytes &&
            this.#status === 'backgrounded' &&
            this.#sizeWatchdog !== null
          ) {
            this.#killedForSize = true
            this.#clearSizeWatchdog()
            this.#doKill(SIGKILL)
          }
        },
        () => {
          
        },
      )
    }, SIZE_WATCHDOG_INTERVAL_MS)
    this.#sizeWatchdog.unref()
  }

  #createResultPromise(): Promise<ExecResult> {
    this.#boundAbortHandler = this.#abortHandler.bind(this)
    this.#abortSignal.addEventListener('abort', this.#boundAbortHandler, {
      once: true,
    })

    
    
    
    this.#childProcess.once('exit', this.#exitHandler.bind(this))
    this.#childProcess.once('error', this.#errorHandler.bind(this))

    this.#timeoutId = setTimeout(
      ShellCommandImpl.#handleTimeout,
      this.#timeout,
      this,
    ) as NodeJS.Timeout

    const exitPromise = new Promise<number>(resolve => {
      this.#exitCodeResolver = resolve
    })

    return new Promise<ExecResult>(resolve => {
      this.#resultResolver = resolve
      void exitPromise.then(this.#handleExit.bind(this))
    })
  }

  async #handleExit(code: number): Promise<void> {
    this.#cleanupListeners()
    if (this.#status === 'running' || this.#status === 'backgrounded') {
      this.#status = 'completed'
    }

    const stdout = await this.taskOutput.getStdout()
    const result: ExecResult = {
      code,
      stdout,
      stderr: this.taskOutput.getStderr(),
      interrupted: code === SIGKILL,
      backgroundTaskId: this.#backgroundTaskId,
    }

    if (this.taskOutput.stdoutToFile && !this.#backgroundTaskId) {
      if (this.taskOutput.outputFileRedundant) {
        
        void this.taskOutput.deleteOutputFile()
      } else {
        
        result.outputFilePath = this.taskOutput.path
        result.outputFileSize = this.taskOutput.outputFileSize
        result.outputTaskId = this.taskOutput.taskId
      }
    }

    if (this.#killedForSize) {
      result.stderr = prependStderr(
        `Background command killed: output file exceeded ${MAX_TASK_OUTPUT_BYTES_DISPLAY}`,
        result.stderr,
      )
    } else if (code === SIGTERM) {
      result.stderr = prependStderr(
        `Command timed out after ${formatDuration(this.#timeout)}`,
        result.stderr,
      )
    }

    const resultResolver = this.#resultResolver
    if (resultResolver) {
      this.#resultResolver = null
      resultResolver(result)
    }
  }

  #doKill(code?: number): void {
    this.#status = 'killed'
    if (this.#childProcess.pid) {
      treeKill(this.#childProcess.pid, 'SIGKILL')
    }
    this.#resolveExitCode(code ?? SIGKILL)
  }

  kill(): void {
    this.#doKill()
  }

  background(taskId: string): boolean {
    if (this.#status === 'running') {
      this.#backgroundTaskId = taskId
      this.#status = 'backgrounded'
      this.#cleanupListeners()
      if (this.taskOutput.stdoutToFile) {
        
        
        
        this.#startSizeWatchdog()
      } else {
        
        this.taskOutput.spillToDisk()
      }
      return true
    }
    return false
  }

  cleanup(): void {
    this.#stdoutWrapper?.cleanup()
    this.#stderrWrapper?.cleanup()
    this.taskOutput.clear()
    
    
    
    
    this.#cleanupListeners()
    
    this.#childProcess = null!
    this.#abortSignal = null!
    this.#onTimeoutCallback = undefined
  }
}

export function wrapSpawn(
  childProcess: ChildProcess,
  abortSignal: AbortSignal,
  timeout: number,
  taskOutput: TaskOutput,
  shouldAutoBackground = false,
  maxOutputBytes = MAX_TASK_OUTPUT_BYTES,
): ShellCommand {
  return new ShellCommandImpl(
    childProcess,
    abortSignal,
    timeout,
    taskOutput,
    shouldAutoBackground,
    maxOutputBytes,
  )
}

class AbortedShellCommand implements ShellCommand {
  readonly status = 'killed' as const
  readonly result: Promise<ExecResult>
  readonly taskOutput: TaskOutput

  constructor(opts?: {
    backgroundTaskId?: string
    stderr?: string
    code?: number
  }) {
    this.taskOutput = new TaskOutput(generateTaskId('local_bash'), null)
    this.result = Promise.resolve({
      code: opts?.code ?? 145,
      stdout: '',
      stderr: opts?.stderr ?? 'Command aborted before execution',
      interrupted: true,
      backgroundTaskId: opts?.backgroundTaskId,
    })
  }

  background(): boolean {
    return false
  }

  kill(): void {}

  cleanup(): void {}
}

export function createAbortedCommand(
  backgroundTaskId?: string,
  opts?: { stderr?: string; code?: number },
): ShellCommand {
  return new AbortedShellCommand({
    backgroundTaskId,
    ...opts,
  })
}

export function createFailedCommand(preSpawnError: string): ShellCommand {
  const taskOutput = new TaskOutput(generateTaskId('local_bash'), null)
  return {
    status: 'completed' as const,
    result: Promise.resolve({
      code: 1,
      stdout: '',
      stderr: preSpawnError,
      interrupted: false,
      preSpawnError,
    }),
    taskOutput,
    background(): boolean {
      return false
    },
    kill(): void {},
    cleanup(): void {},
  }
}
