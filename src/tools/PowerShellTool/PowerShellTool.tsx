import { feature } from "../utils/bundle-mock.ts";
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { copyFile, stat as fsStat, truncate as fsTruncate, link } from 'fs/promises';
import * as React from 'react';
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js';
import type { AppState } from 'src/state/AppState.js';
import { z } from 'zod/v4';
import { getKairosActive } from '../../bootstrap/state.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
import type { SetToolJSXFn, Tool, ToolCallProgress, ValidationResult } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
import { backgroundExistingForegroundTask, markTaskNotified, registerForeground, spawnShellTask, unregisterForeground } from '../../tasks/LocalShellTask/LocalShellTask.js';
import type { AgentId } from '../../types/ids.js';
import type { AssistantMessage } from '../../types/message.js';
import { extractClaudeCodeHints } from '../../utils/claudeCodeHints.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { errorMessage as getErrorMessage, ShellError } from '../../utils/errors.js';
import { truncate } from '../../utils/format.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { logError } from '../../utils/log.js';
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js';
import { getPlatform } from '../../utils/platform.js';
import { maybeRecordPluginHint } from '../../utils/plugins/hintRecommendation.js';
import { exec } from '../../utils/Shell.js';
import type { ExecResult } from '../../utils/ShellCommand.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { semanticBoolean } from '../../utils/semanticBoolean.js';
import { semanticNumber } from '../../utils/semanticNumber.js';
import { getCachedPowerShellPath } from '../../utils/shell/powershellDetection.js';
import { EndTruncatingAccumulator } from '../../utils/stringUtils.js';
import { getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { TaskOutput } from '../../utils/task/TaskOutput.js';
import { isOutputLineTruncated } from '../../utils/terminal.js';
import { buildLargeToolResultMessage, ensureToolResultsDir, generatePreview, getToolResultPath, PREVIEW_SIZE_BYTES } from '../../utils/toolResultStorage.js';
import { shouldUseSandbox } from '../BashTool/shouldUseSandbox.js';
import { BackgroundHint } from '../BashTool/UI.js';
import { buildImageToolResult, isImageOutput, resetCwdIfOutsideProject, resizeShellImageOutput, stdErrAppendShellResetMessage, stripEmptyLines } from '../BashTool/utils.js';
import { trackGitOperations } from '../shared/gitOperationTracking.js';
import { interpretCommandResult } from './commandSemantics.js';
import { powershellToolHasPermission } from './powershellPermissions.js';
import { getDefaultTimeoutMs, getMaxTimeoutMs, getPrompt } from './prompt.js';
import { hasSyncSecurityConcerns, isReadOnlyCommand, resolveToCanonical } from './readOnlyValidation.js';
import { POWERSHELL_TOOL_NAME } from './toolName.js';
import { renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage, renderToolUseProgressMessage, renderToolUseQueuedMessage } from './UI.js';

const EOL = '\n';

const PS_SEARCH_COMMANDS = new Set(['select-string',

'get-childitem',

'findstr',

'where.exe' 
]);

const PS_READ_COMMANDS = new Set(['get-content',

'get-item',

'test-path',

'resolve-path',

'get-process',

'get-service',

'get-childitem',

'get-location',

'get-filehash',

'get-acl',

'format-hex' 
]);

const PS_SEMANTIC_NEUTRAL_COMMANDS = new Set(['write-output',

'write-host']);

function isSearchOrReadPowerShellCommand(command: string): {
  isSearch: boolean;
  isRead: boolean;
} {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      isSearch: false,
      isRead: false
    };
  }

  
  
  const parts = trimmed.split(/\s*[;|]\s*/).filter(Boolean);
  if (parts.length === 0) {
    return {
      isSearch: false,
      isRead: false
    };
  }
  let hasSearch = false;
  let hasRead = false;
  let hasNonNeutralCommand = false;
  for (const part of parts) {
    const baseCommand = part.trim().split(/\s+/)[0];
    if (!baseCommand) {
      continue;
    }
    const canonical = resolveToCanonical(baseCommand);
    if (PS_SEMANTIC_NEUTRAL_COMMANDS.has(canonical)) {
      continue;
    }
    hasNonNeutralCommand = true;
    const isPartSearch = PS_SEARCH_COMMANDS.has(canonical);
    const isPartRead = PS_READ_COMMANDS.has(canonical);
    if (!isPartSearch && !isPartRead) {
      return {
        isSearch: false,
        isRead: false
      };
    }
    if (isPartSearch) hasSearch = true;
    if (isPartRead) hasRead = true;
  }
  if (!hasNonNeutralCommand) {
    return {
      isSearch: false,
      isRead: false
    };
  }
  return {
    isSearch: hasSearch,
    isRead: hasRead
  };
}

const PROGRESS_THRESHOLD_MS = 2000;
const PROGRESS_INTERVAL_MS = 1000;

const ASSISTANT_BLOCKING_BUDGET_MS = 15_000;

const DISALLOWED_AUTO_BACKGROUND_COMMANDS = ['start-sleep',

'sleep'];

function isAutobackgroundingAllowed(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0];
  if (!firstWord) return true;
  const canonical = resolveToCanonical(firstWord);
  return !DISALLOWED_AUTO_BACKGROUND_COMMANDS.includes(canonical);
}

export function detectBlockedSleepPattern(command: string): string | null {
  
  
  
  
  
  const first = command.trim().split(/[;|&\r\n]/)[0]?.trim() ?? '';
  
  
  const m = /^(?:start-sleep|sleep)(?:\s+-s(?:econds)?)?\s+(\d+)\s*$/i.exec(first);
  if (!m) return null;
  const secs = parseInt(m[1]!, 10);
  if (secs < 2) return null; 

  const rest = command.trim().slice(first.length).replace(/^[\s;|&]+/, '');
  return rest ? `Start-Sleep ${secs} followed by: ${rest}` : `standalone Start-Sleep ${secs}`;
}

const WINDOWS_SANDBOX_POLICY_REFUSAL = 'Enterprise policy requires sandboxing, but sandboxing is not available on native Windows. Shell command execution is blocked on this platform by policy.';
function isWindowsSandboxPolicyViolation(): boolean {
  return getPlatform() === 'windows' && SandboxManager.isSandboxEnabledInSettings() && !SandboxManager.areUnsandboxedCommandsAllowed();
}

const isBackgroundTasksDisabled =

isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_BACKGROUND_TASKS);
const fullInputSchema = lazySchema(() => z.strictObject({
  command: z.string().describe('The PowerShell command to execute'),
  timeout: semanticNumber(z.number().optional()).describe(`Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`),
  description: z.string().optional().describe('Clear, concise description of what this command does in active voice.'),
  run_in_background: semanticBoolean(z.boolean().optional()).describe(`Set to true to run this command in the background. Use Read to read the output later.`),
  dangerouslyDisableSandbox: semanticBoolean(z.boolean().optional()).describe('Set this to true to dangerously override sandbox mode and run commands without sandboxing.')
}));

const inputSchema = lazySchema(() => isBackgroundTasksDisabled ? fullInputSchema().omit({
  run_in_background: true
}) : fullInputSchema());
type InputSchema = ReturnType<typeof inputSchema>;

export type PowerShellToolInput = z.infer<ReturnType<typeof fullInputSchema>>;
const outputSchema = lazySchema(() => z.object({
  stdout: z.string().describe('The standard output of the command'),
  stderr: z.string().describe('The standard error output of the command'),
  interrupted: z.boolean().describe('Whether the command was interrupted'),
  returnCodeInterpretation: z.string().optional().describe('Semantic interpretation for non-error exit codes with special meaning'),
  isImage: z.boolean().optional().describe('Flag to indicate if stdout contains image data'),
  persistedOutputPath: z.string().optional().describe('Path to persisted full output when too large for inline'),
  persistedOutputSize: z.number().optional().describe('Total output size in bytes when persisted'),
  backgroundTaskId: z.string().optional().describe('ID of the background task if command is running in background'),
  backgroundedByUser: z.boolean().optional().describe('True if the user manually backgrounded the command with Ctrl+B'),
  assistantAutoBackgrounded: z.boolean().optional().describe('True if the command was auto-backgrounded by the assistant-mode blocking budget')
}));
type OutputSchema = ReturnType<typeof outputSchema>;
export type Out = z.infer<OutputSchema>;
import type { PowerShellProgress } from '../../types/tools.js';
export type { PowerShellProgress } from '../../types/tools.js';
const COMMON_BACKGROUND_COMMANDS = ['npm', 'yarn', 'pnpm', 'node', 'python', 'python3', 'go', 'cargo', 'make', 'docker', 'terraform', 'webpack', 'vite', 'jest', 'pytest', 'curl', 'Invoke-WebRequest', 'build', 'test', 'serve', 'watch', 'dev'] as const;
function getCommandTypeForLogging(command: string): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  const trimmed = command.trim();
  const firstWord = trimmed.split(/\s+/)[0] || '';
  for (const cmd of COMMON_BACKGROUND_COMMANDS) {
    if (firstWord.toLowerCase() === cmd.toLowerCase()) {
      return cmd as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    }
  }
  return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
}
export const PowerShellTool = buildTool({
  name: POWERSHELL_TOOL_NAME,
  searchHint: 'execute Windows PowerShell commands',
  maxResultSizeChars: 30_000,
  strict: true,
  async description({
    description
  }: Partial<PowerShellToolInput>): Promise<string> {
    return description || 'Run PowerShell command';
  },
  async prompt(): Promise<string> {
    return getPrompt();
  },
  isConcurrencySafe(input: PowerShellToolInput): boolean {
    return this.isReadOnly?.(input) ?? false;
  },
  isSearchOrReadCommand(input: Partial<PowerShellToolInput>): {
    isSearch: boolean;
    isRead: boolean;
  } {
    if (!input.command) {
      return {
        isSearch: false,
        isRead: false
      };
    }
    return isSearchOrReadPowerShellCommand(input.command);
  },
  isReadOnly(input: PowerShellToolInput): boolean {
    
    
    
    
    
    if (hasSyncSecurityConcerns(input.command)) {
      return false;
    }
    
    
    
    
    
    
    return isReadOnlyCommand(input.command);
  },
  toAutoClassifierInput(input) {
    return input.command;
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName(): string {
    return 'PowerShell';
  },
  getToolUseSummary(input: Partial<PowerShellToolInput> | undefined): string | null {
    if (!input?.command) {
      return null;
    }
    const {
      command,
      description
    } = input;
    if (description) {
      return description;
    }
    return truncate(command, TOOL_SUMMARY_MAX_LENGTH);
  },
  getActivityDescription(input: Partial<PowerShellToolInput> | undefined): string {
    if (!input?.command) {
      return 'Running command';
    }
    const desc = input.description ?? truncate(input.command, TOOL_SUMMARY_MAX_LENGTH);
    return `Running ${desc}`;
  },
  isEnabled(): boolean {
    return true;
  },
  async validateInput(input: PowerShellToolInput): Promise<ValidationResult> {
    
    if (isWindowsSandboxPolicyViolation()) {
      return {
        result: false,
        message: WINDOWS_SANDBOX_POLICY_REFUSAL,
        errorCode: 11
      };
    }
    if (feature('MONITOR_TOOL') && !isBackgroundTasksDisabled && !input.run_in_background) {
      const sleepPattern = detectBlockedSleepPattern(input.command);
      if (sleepPattern !== null) {
        return {
          result: false,
          message: `Blocked: ${sleepPattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done. For streaming events (watching logs, polling APIs), use the Monitor tool. If you genuinely need a delay (rate limiting, deliberate pacing), keep it under 2 seconds.`,
          errorCode: 10
        };
      }
    }
    return {
      result: true
    };
  },
  async checkPermissions(input: PowerShellToolInput, context: Parameters<Tool['checkPermissions']>[1]): Promise<PermissionResult> {
    return await powershellToolHasPermission(input, context);
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseQueuedMessage,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  mapToolResultToToolResultBlockParam({
    interrupted,
    stdout,
    stderr,
    isImage,
    persistedOutputPath,
    persistedOutputSize,
    backgroundTaskId,
    backgroundedByUser,
    assistantAutoBackgrounded
  }: Out, toolUseID: string): ToolResultBlockParam {
    
    if (isImage) {
      const block = buildImageToolResult(stdout, toolUseID);
      if (block) return block;
    }
    let processedStdout = stdout;
    if (persistedOutputPath) {
      const trimmed = stdout ? stdout.replace(/^(\s*\n)+/, '').trimEnd() : '';
      const preview = generatePreview(trimmed, PREVIEW_SIZE_BYTES);
      processedStdout = buildLargeToolResultMessage({
        filepath: persistedOutputPath,
        originalSize: persistedOutputSize ?? 0,
        isJson: false,
        preview: preview.preview,
        hasMore: preview.hasMore
      });
    } else if (stdout) {
      processedStdout = stdout.replace(/^(\s*\n)+/, '');
      processedStdout = processedStdout.trimEnd();
    }
    let errorMessage = stderr.trim();
    if (interrupted) {
      if (stderr) errorMessage += EOL;
      errorMessage += '<error>Command was aborted before completion</error>';
    }
    let backgroundInfo = '';
    if (backgroundTaskId) {
      const outputPath = getTaskOutputPath(backgroundTaskId);
      if (assistantAutoBackgrounded) {
        backgroundInfo = `Command exceeded the assistant-mode blocking budget (${ASSISTANT_BLOCKING_BUDGET_MS / 1000}s) and was moved to the background with ID: ${backgroundTaskId}. It is still running — you will be notified when it completes. Output is being written to: ${outputPath}. In assistant mode, delegate long-running work to a subagent or use run_in_background to keep this conversation responsive.`;
      } else if (backgroundedByUser) {
        backgroundInfo = `Command was manually backgrounded by user with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}`;
      } else {
        backgroundInfo = `Command running in background with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}`;
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: [processedStdout, errorMessage, backgroundInfo].filter(Boolean).join('\n'),
      is_error: interrupted
    };
  },
  async call(input: PowerShellToolInput, toolUseContext: Parameters<Tool['call']>[1], _canUseTool?: CanUseToolFn, _parentMessage?: AssistantMessage, onProgress?: ToolCallProgress<PowerShellProgress>): Promise<{
    data: Out;
  }> {
    
    
    
    
    if (isWindowsSandboxPolicyViolation()) {
      throw new Error(WINDOWS_SANDBOX_POLICY_REFUSAL);
    }
    const {
      abortController,
      setAppState,
      setToolJSX
    } = toolUseContext;
    const isMainThread = !toolUseContext.agentId;
    let progressCounter = 0;
    try {
      const commandGenerator = runPowerShellCommand({
        input,
        abortController,
        
        
        setAppState: toolUseContext.setAppStateForTasks ?? setAppState,
        setToolJSX,
        preventCwdChanges: !isMainThread,
        isMainThread,
        toolUseId: toolUseContext.toolUseId,
        agentId: toolUseContext.agentId
      });
      let generatorResult;
      do {
        generatorResult = await commandGenerator.next();
        if (!generatorResult.done && onProgress) {
          const progress = generatorResult.value;
          onProgress({
            toolUseID: `ps-progress-${progressCounter++}`,
            data: {
              type: 'powershell_progress',
              output: progress.output,
              fullOutput: progress.fullOutput,
              elapsedTimeSeconds: progress.elapsedTimeSeconds,
              totalLines: progress.totalLines,
              totalBytes: progress.totalBytes,
              timeoutMs: progress.timeoutMs,
              taskId: progress.taskId
            }
          });
        }
      } while (!generatorResult.done);
      const result = generatorResult.value;

      
      
      
      
      
      
      
      
      
      
      
      
      
      const isPreFlightSentinel = result.code === 0 && !result.stdout && result.stderr && !result.backgroundTaskId;
      if (!isPreFlightSentinel) {
        trackGitOperations(input.command, result.code, result.stdout);
      }

      
      
      
      
      const isInterrupt = result.interrupted && abortController.signal.reason === 'interrupt';

      
      
      
      
      
      
      let stderrForShellReset = '';
      if (isMainThread) {
        const appState = toolUseContext.getAppState();
        if (resetCwdIfOutsideProject(appState.toolPermissionContext)) {
          stderrForShellReset = stdErrAppendShellResetMessage('');
        }
      }

      
      
      
      
      if (result.backgroundTaskId) {
        const bgExtracted = extractClaudeCodeHints(result.stdout || '', input.command);
        if (isMainThread && bgExtracted.hints.length > 0) {
          for (const hint of bgExtracted.hints) maybeRecordPluginHint(hint);
        }
        return {
          data: {
            stdout: bgExtracted.stripped,
            stderr: [result.stderr || '', stderrForShellReset].filter(Boolean).join('\n'),
            interrupted: false,
            backgroundTaskId: result.backgroundTaskId,
            backgroundedByUser: result.backgroundedByUser,
            assistantAutoBackgrounded: result.assistantAutoBackgrounded
          }
        };
      }
      const stdoutAccumulator = new EndTruncatingAccumulator();
      const processedStdout = (result.stdout || '').trimEnd();
      stdoutAccumulator.append(processedStdout + EOL);

      
      
      
      
      const interpretation = interpretCommandResult(input.command, result.code, processedStdout, result.stderr || '');

      
      
      
      

      let stdout = stripEmptyLines(stdoutAccumulator.toString());

      
      
      
      
      
      
      const extracted = extractClaudeCodeHints(stdout, input.command);
      stdout = extracted.stripped;
      if (isMainThread && extracted.hints.length > 0) {
        for (const hint of extracted.hints) maybeRecordPluginHint(hint);
      }

      
      
      
      
      if (result.preSpawnError) {
        throw new Error(result.preSpawnError);
      }
      if (interpretation.isError && !isInterrupt) {
        throw new ShellError(stdout, result.stderr || '', result.code, result.interrupted);
      }

      
      
      
      
      
      
      
      
      
      const MAX_PERSISTED_SIZE = 64 * 1024 * 1024;
      let persistedOutputPath: string | undefined;
      let persistedOutputSize: number | undefined;
      if (result.outputFilePath && result.outputTaskId) {
        try {
          const fileStat = await fsStat(result.outputFilePath);
          persistedOutputSize = fileStat.size;
          await ensureToolResultsDir();
          const dest = getToolResultPath(result.outputTaskId, false);
          if (fileStat.size > MAX_PERSISTED_SIZE) {
            await fsTruncate(result.outputFilePath, MAX_PERSISTED_SIZE);
          }
          try {
            await link(result.outputFilePath, dest);
          } catch {
            await copyFile(result.outputFilePath, dest);
          }
          persistedOutputPath = dest;
        } catch {
          
        }
      }

      
      
      
      let isImage = isImageOutput(stdout);
      let compressedStdout = stdout;
      if (isImage) {
        const resized = await resizeShellImageOutput(stdout, result.outputFilePath, persistedOutputSize);
        if (resized) {
          compressedStdout = resized;
        } else {
          
          
          
          
          isImage = false;
        }
      }
      const finalStderr = [result.stderr || '', stderrForShellReset].filter(Boolean).join('\n');
      logEvent('tengu_powershell_tool_command_executed', {
        command_type: getCommandTypeForLogging(input.command),
        stdout_length: compressedStdout.length,
        stderr_length: finalStderr.length,
        exit_code: result.code,
        interrupted: result.interrupted
      });
      return {
        data: {
          stdout: compressedStdout,
          stderr: finalStderr,
          interrupted: result.interrupted,
          returnCodeInterpretation: interpretation.message,
          isImage,
          persistedOutputPath,
          persistedOutputSize
        }
      };
    } finally {
      if (setToolJSX) setToolJSX(null);
    }
  },
  isResultTruncated(output: Out): boolean {
    return isOutputLineTruncated(output.stdout) || isOutputLineTruncated(output.stderr);
  }
} satisfies ToolDef<InputSchema, Out>);
async function* runPowerShellCommand({
  input,
  abortController,
  setAppState,
  setToolJSX,
  preventCwdChanges,
  isMainThread,
  toolUseId,
  agentId
}: {
  input: PowerShellToolInput;
  abortController: AbortController;
  setAppState: (f: (prev: AppState) => AppState) => void;
  setToolJSX?: SetToolJSXFn;
  preventCwdChanges?: boolean;
  isMainThread?: boolean;
  toolUseId?: string;
  agentId?: AgentId;
}): AsyncGenerator<{
  type: 'progress';
  output: string;
  fullOutput: string;
  elapsedTimeSeconds: number;
  totalLines: number;
  totalBytes: number;
  taskId?: string;
  timeoutMs?: number;
}, ExecResult, void> {
  const {
    command,
    description,
    timeout,
    run_in_background,
    dangerouslyDisableSandbox
  } = input;
  const timeoutMs = Math.min(timeout || getDefaultTimeoutMs(), getMaxTimeoutMs());
  let fullOutput = '';
  let lastProgressOutput = '';
  let lastTotalLines = 0;
  let lastTotalBytes = 0;
  let backgroundShellId: string | undefined = undefined;
  let interruptBackgroundingStarted = false;
  let assistantAutoBackgrounded = false;

  
  
  
  let resolveProgress: (() => void) | null = null;
  function createProgressSignal(): Promise<null> {
    return new Promise<null>(resolve => {
      resolveProgress = () => resolve(null);
    });
  }
  const shouldAutoBackground = !isBackgroundTasksDisabled && isAutobackgroundingAllowed(command);
  const powershellPath = await getCachedPowerShellPath();
  if (!powershellPath) {
    
    
    
    return {
      stdout: '',
      stderr: 'PowerShell is not available on this system.',
      code: 0,
      interrupted: false
    };
  }
  let shellCommand: Awaited<ReturnType<typeof exec>>;
  try {
    shellCommand = await exec(command, abortController.signal, 'powershell', {
      timeout: timeoutMs,
      onProgress(lastLines, allLines, totalLines, totalBytes, isIncomplete) {
        lastProgressOutput = lastLines;
        fullOutput = allLines;
        lastTotalLines = totalLines;
        lastTotalBytes = isIncomplete ? totalBytes : 0;
      },
      preventCwdChanges,
      
      
      
      
      
      
      shouldUseSandbox: getPlatform() === 'windows' ? false : shouldUseSandbox({
        command,
        dangerouslyDisableSandbox
      }),
      shouldAutoBackground
    });
  } catch (e) {
    logError(e);
    
    
    return {
      stdout: '',
      stderr: `Failed to execute PowerShell command: ${getErrorMessage(e)}`,
      code: 0,
      interrupted: false
    };
  }
  const resultPromise = shellCommand.result;

  
  async function spawnBackgroundTask(): Promise<string> {
    const handle = await spawnShellTask({
      command,
      description: description || command,
      shellCommand,
      toolUseId,
      agentId
    }, {
      abortController,
      getAppState: () => {
        throw new Error('getAppState not available in runPowerShellCommand context');
      },
      setAppState
    });
    return handle.taskId;
  }

  
  function startBackgrounding(eventName: string, backgroundFn?: (shellId: string) => void): void {
    
    
    
    
    if (foregroundTaskId) {
      if (!backgroundExistingForegroundTask(foregroundTaskId, shellCommand, description || command, setAppState, toolUseId)) {
        return;
      }
      backgroundShellId = foregroundTaskId;
      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command)
      });
      backgroundFn?.(foregroundTaskId);
      return;
    }

    
    
    void spawnBackgroundTask().then(shellId => {
      backgroundShellId = shellId;

      
      
      
      const resolve = resolveProgress;
      if (resolve) {
        resolveProgress = null;
        resolve();
      }
      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command)
      });
      if (backgroundFn) {
        backgroundFn(shellId);
      }
    });
  }

  
  if (shellCommand.onTimeout && shouldAutoBackground) {
    shellCommand.onTimeout(backgroundFn => {
      startBackgrounding('tengu_powershell_command_timeout_backgrounded', backgroundFn);
    });
  }

  
  
  
  if (feature('KAIROS') && getKairosActive() && isMainThread && !isBackgroundTasksDisabled && run_in_background !== true) {
    setTimeout(() => {
      if (shellCommand.status === 'running' && backgroundShellId === undefined) {
        assistantAutoBackgrounded = true;
        startBackgrounding('tengu_powershell_command_assistant_auto_backgrounded');
      }
    }, ASSISTANT_BLOCKING_BUDGET_MS).unref();
  }

  
  
  
  if (run_in_background === true && !isBackgroundTasksDisabled) {
    const shellId = await spawnBackgroundTask();
    logEvent('tengu_powershell_command_explicitly_backgrounded', {
      command_type: getCommandTypeForLogging(command)
    });
    return {
      stdout: '',
      stderr: '',
      code: 0,
      interrupted: false,
      backgroundTaskId: shellId
    };
  }

  
  TaskOutput.startPolling(shellCommand.taskOutput.taskId);

  
  const startTime = Date.now();
  let nextProgressTime = startTime + PROGRESS_THRESHOLD_MS;
  let foregroundTaskId: string | undefined = undefined;

  
  
  
  try {
    while (true) {
      const now = Date.now();
      const timeUntilNextProgress = Math.max(0, nextProgressTime - now);
      const progressSignal = createProgressSignal();
      const result = await Promise.race([resultPromise, new Promise<null>(resolve => setTimeout(r => r(null), timeUntilNextProgress, resolve).unref()), progressSignal]);
      if (result !== null) {
        
        
        
        
        
        
        
        
        
        if (result.backgroundTaskId !== undefined) {
          markTaskNotified(result.backgroundTaskId, setAppState);
          const fixedResult: ExecResult = {
            ...result,
            backgroundTaskId: undefined
          };
          
          
          const {
            taskOutput
          } = shellCommand;
          if (taskOutput.stdoutToFile && !taskOutput.outputFileRedundant) {
            fixedResult.outputFilePath = taskOutput.path;
            fixedResult.outputFileSize = taskOutput.outputFileSize;
            fixedResult.outputTaskId = taskOutput.taskId;
          }
          
          
          
          
          shellCommand.cleanup();
          return fixedResult;
        }
        
        return result;
      }

      
      if (backgroundShellId) {
        return {
          stdout: interruptBackgroundingStarted ? fullOutput : '',
          stderr: '',
          code: 0,
          interrupted: false,
          backgroundTaskId: backgroundShellId,
          assistantAutoBackgrounded
        };
      }

      
      if (abortController.signal.aborted && abortController.signal.reason === 'interrupt' && !interruptBackgroundingStarted) {
        interruptBackgroundingStarted = true;
        if (!isBackgroundTasksDisabled) {
          startBackgrounding('tengu_powershell_command_interrupt_backgrounded');
          
          
          
          
          continue;
        }
        shellCommand.kill();
      }

      
      if (foregroundTaskId) {
        if (shellCommand.status === 'backgrounded') {
          return {
            stdout: '',
            stderr: '',
            code: 0,
            interrupted: false,
            backgroundTaskId: foregroundTaskId,
            backgroundedByUser: true
          };
        }
      }

      
      const elapsed = Date.now() - startTime;
      const elapsedSeconds = Math.floor(elapsed / 1000);

      
      if (!isBackgroundTasksDisabled && backgroundShellId === undefined && elapsedSeconds >= PROGRESS_THRESHOLD_MS / 1000 && setToolJSX) {
        if (!foregroundTaskId) {
          foregroundTaskId = registerForeground({
            command,
            description: description || command,
            shellCommand,
            agentId
          }, setAppState, toolUseId);
        }
        setToolJSX({
          jsx: <BackgroundHint />,
          shouldHidePromptInput: false,
          shouldContinueAnimation: true,
          showSpinner: true
        });
      }
      yield {
        type: 'progress',
        fullOutput,
        output: lastProgressOutput,
        elapsedTimeSeconds: elapsedSeconds,
        totalLines: lastTotalLines,
        totalBytes: lastTotalBytes,
        taskId: shellCommand.taskOutput.taskId,
        ...(timeout ? {
          timeoutMs
        } : undefined)
      };
      nextProgressTime = Date.now() + PROGRESS_INTERVAL_MS;
    }
  } finally {
    TaskOutput.stopPolling(shellCommand.taskOutput.taskId);
    
    
    
    if (!backgroundShellId && shellCommand.status !== 'backgrounded') {
      if (foregroundTaskId) {
        unregisterForeground(foregroundTaskId, setAppState);
      }
      shellCommand.cleanup();
    }
  }
}
