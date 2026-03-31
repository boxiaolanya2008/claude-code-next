import axios from 'axios';
import { readFile, stat } from 'fs/promises';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { getLastAPIRequest } from 'src/bootstrap/state.js';
import { logEventTo1P } from 'src/services/analytics/firstPartyEventLogger.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { getLastAssistantMessage, normalizeMessagesForAPI } from 'src/utils/messages.js';
import type { CommandResultDisplay } from '../commands.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Box, Text, useInput } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { queryHaiku } from '../services/api/claude.js';
import { startsWithApiErrorPrefix } from '../services/api/errors.js';
import type { Message } from '../types/message.js';
import { checkAndRefreshOAuthTokenIfNeeded } from '../utils/auth.js';
import { openBrowser } from '../utils/browser.js';
import { logForDebugging } from '../utils/debug.js';
import { env } from '../utils/env.js';
import { type GitRepoState, getGitState, getIsGit } from '../utils/git.js';
import { getAuthHeaders, getUserAgent } from '../utils/http.js';
import { getInMemoryErrors, logError } from '../utils/log.js';
import { isEssentialTrafficOnly } from '../utils/privacyLevel.js';
import { extractTeammateTranscriptsFromTasks, getTranscriptPath, loadAllSubagentTranscriptsFromDisk, MAX_TRANSCRIPT_READ_BYTES } from '../utils/sessionStorage.js';
import { jsonStringify } from '../utils/slowOperations.js';
import { asSystemPrompt } from '../utils/systemPromptType.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Byline } from './design-system/Byline.js';
import { Dialog } from './design-system/Dialog.js';
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js';
import TextInput from './TextInput.js';

const GITHUB_URL_LIMIT = 7250;
const GITHUB_ISSUES_REPO_URL = "external" === 'ant' ? 'https://github.com/anthropics/claude-cli-internal/issues' : 'https://github.com/anthropics/claude-code-next/issues';
type Props = {
  abortSignal: AbortSignal;
  messages: Message[];
  initialDescription?: string;
  onDone(result: string, options?: {
    display?: CommandResultDisplay;
  }): void;
  backgroundTasks?: {
    [taskId: string]: {
      type: string;
      identity?: {
        agentId: string;
      };
      messages?: Message[];
    };
  };
};
type Step = 'userInput' | 'consent' | 'submitting' | 'done';
type FeedbackData = {
  
  latestAssistantMessageId: string | null;
  message_count: number;
  datetime: string;
  description: string;
  platform: string;
  gitRepo: boolean;
  version: string | null;
  transcript: Message[];
  subagentTranscripts?: {
    [agentId: string]: Message[];
  };
  rawTranscriptJsonl?: string;
};

export function redactSensitiveInfo(text: string): string {
  let redacted = text;

  
  
  redacted = redacted.replace(/"(sk-ant[^\s"']{24,})"/g, '"[REDACTED_API_KEY]"');
  
  redacted = redacted.replace(
  
  /(?<![A-Za-z0-9"'])(sk-ant-?[A-Za-z0-9_-]{10,})(?![A-Za-z0-9"'])/g, '[REDACTED_API_KEY]');

  
  redacted = redacted.replace(/AWS key: "(AWS[A-Z0-9]{20,})"/g, 'AWS key: "[REDACTED_AWS_KEY]"');

  
  redacted = redacted.replace(/(AKIA[A-Z0-9]{16})/g, '[REDACTED_AWS_KEY]');

  
  redacted = redacted.replace(
  
  /(?<![A-Za-z0-9])(AIza[A-Za-z0-9_-]{35})(?![A-Za-z0-9])/g, '[REDACTED_GCP_KEY]');

  
  redacted = redacted.replace(
  
  /(?<![A-Za-z0-9])([a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com)(?![A-Za-z0-9])/g, '[REDACTED_GCP_SERVICE_ACCOUNT]');

  
  redacted = redacted.replace(/(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\s)}\]]+/gi, '$1[REDACTED_API_KEY]');

  
  redacted = redacted.replace(/(["']?authorization["']?\s*[:=]\s*["']?(bearer\s+)?)[^"',\s)}\]]+/gi, '$1[REDACTED_TOKEN]');

  
  redacted = redacted.replace(/(AWS[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED_AWS_VALUE]');

  
  redacted = redacted.replace(/(GOOGLE[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED_GCP_VALUE]');

  
  redacted = redacted.replace(/((API[-_]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, '$1[REDACTED]');
  return redacted;
}

function getSanitizedErrorLogs(): Array<{
  error?: string;
  timestamp?: string;
}> {
  
  return getInMemoryErrors().map(errorInfo => {
    
    const errorCopy = {
      ...errorInfo
    } as {
      error?: string;
      timestamp?: string;
    };

    
    if (errorCopy && typeof errorCopy.error === 'string') {
      errorCopy.error = redactSensitiveInfo(errorCopy.error);
    }
    return errorCopy;
  });
}
async function loadRawTranscriptJsonl(): Promise<string | null> {
  try {
    const transcriptPath = getTranscriptPath();
    const {
      size
    } = await stat(transcriptPath);
    if (size > MAX_TRANSCRIPT_READ_BYTES) {
      logForDebugging(`Skipping raw transcript read: file too large (${size} bytes)`, {
        level: 'warn'
      });
      return null;
    }
    return await readFile(transcriptPath, 'utf-8');
  } catch {
    return null;
  }
}
export function Feedback({
  abortSignal,
  messages,
  initialDescription,
  onDone,
  backgroundTasks = {}
}: Props): React.ReactNode {
  const [step, setStep] = useState<Step>('userInput');
  const [cursorOffset, setCursorOffset] = useState(0);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [envInfo, setEnvInfo] = useState<{
    isGit: boolean;
    gitState: GitRepoState | null;
  }>({
    isGit: false,
    gitState: null
  });
  const [title, setTitle] = useState<string | null>(null);
  const textInputColumns = useTerminalSize().columns - 4;
  useEffect(() => {
    async function loadEnvInfo() {
      const isGit = await getIsGit();
      let gitState: GitRepoState | null = null;
      if (isGit) {
        gitState = await getGitState();
      }
      setEnvInfo({
        isGit,
        gitState
      });
    }
    void loadEnvInfo();
  }, []);
  const submitReport = useCallback(async () => {
    setStep('submitting');
    setError(null);
    setFeedbackId(null);

    
    const sanitizedErrors = getSanitizedErrorLogs();

    
    const lastAssistantMessage = getLastAssistantMessage(messages);
    const lastAssistantMessageId = lastAssistantMessage?.requestId ?? null;
    const [diskTranscripts, rawTranscriptJsonl] = await Promise.all([loadAllSubagentTranscriptsFromDisk(), loadRawTranscriptJsonl()]);
    const teammateTranscripts = extractTeammateTranscriptsFromTasks(backgroundTasks);
    const subagentTranscripts = {
      ...diskTranscripts,
      ...teammateTranscripts
    };
    const reportData = {
      latestAssistantMessageId: lastAssistantMessageId,
      message_count: messages.length,
      datetime: new Date().toISOString(),
      description,
      platform: env.platform,
      gitRepo: envInfo.isGit,
      terminal: env.terminal,
      version: MACRO.VERSION,
      transcript: normalizeMessagesForAPI(messages),
      errors: sanitizedErrors,
      lastApiRequest: getLastAPIRequest(),
      ...(Object.keys(subagentTranscripts).length > 0 && {
        subagentTranscripts
      }),
      ...(rawTranscriptJsonl && {
        rawTranscriptJsonl
      })
    };
    const [result, t] = await Promise.all([submitFeedback(reportData, abortSignal), generateTitle(description, abortSignal)]);
    setTitle(t);
    if (result.success) {
      if (result.feedbackId) {
        setFeedbackId(result.feedbackId);
        logEvent('tengu_bug_report_submitted', {
          feedback_id: result.feedbackId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          last_assistant_message_id: lastAssistantMessageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
        
        logEventTo1P('tengu_bug_report_description', {
          feedback_id: result.feedbackId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          description: redactSensitiveInfo(description) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      }
      setStep('done');
    } else {
      if (result.isZdrOrg) {
        setError('Feedback collection is not available for organizations with custom data retention policies.');
      } else {
        setError('Could not submit feedback. Please try again later.');
      }
      
      setStep('userInput');
    }
  }, [description, envInfo.isGit, messages]);

  
  const handleCancel = useCallback(() => {
    
    if (step === 'done') {
      if (error) {
        onDone('Error submitting feedback / bug report', {
          display: 'system'
        });
      } else {
        onDone('Feedback / bug report submitted', {
          display: 'system'
        });
      }
      return;
    }
    onDone('Feedback / bug report cancelled', {
      display: 'system'
    });
  }, [step, error, onDone]);

  
  
  useKeybinding('confirm:no', handleCancel, {
    context: 'Settings',
    isActive: step === 'userInput'
  });
  useInput((input, key) => {
    
    if (step === 'done') {
      if (key.return && title) {
        
        const issueUrl = createGitHubIssueUrl(feedbackId ?? '', title, description, getSanitizedErrorLogs());
        void openBrowser(issueUrl);
      }
      if (error) {
        onDone('Error submitting feedback / bug report', {
          display: 'system'
        });
      } else {
        onDone('Feedback / bug report submitted', {
          display: 'system'
        });
      }
      return;
    }

    
    
    if (error && step !== 'userInput') {
      onDone('Error submitting feedback / bug report', {
        display: 'system'
      });
      return;
    }
    if (step === 'consent' && (key.return || input === ' ')) {
      void submitReport();
    }
  });
  return <Dialog title="Submit Feedback / Bug Report" onCancel={handleCancel} isCancelActive={step !== 'userInput'} inputGuide={exitState => exitState.pending ? <Text>Press {exitState.keyName} again to exit</Text> : step === 'userInput' ? <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="continue" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline> : step === 'consent' ? <Byline>
            <KeyboardShortcutHint shortcut="Enter" action="submit" />
            <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
          </Byline> : null}>
      {step === 'userInput' && <Box flexDirection="column" gap={1}>
          <Text>Describe the issue below:</Text>
          <TextInput value={description} onChange={value => {
        setDescription(value);
        
        if (error) {
          setError(null);
        }
      }} columns={textInputColumns} onSubmit={() => setStep('consent')} onExitMessage={() => onDone('Feedback cancelled', {
        display: 'system'
      })} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} showCursor />
          {error && <Box flexDirection="column" gap={1}>
              <Text color="error">{error}</Text>
              <Text dimColor>
                Edit and press Enter to retry, or Esc to cancel
              </Text>
            </Box>}
        </Box>}

      {step === 'consent' && <Box flexDirection="column">
          <Text>This report will include:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              - Your feedback / bug description:{' '}
              <Text dimColor>{description}</Text>
            </Text>
            <Text>
              - Environment info:{' '}
              <Text dimColor>
                {env.platform}, {env.terminal}, v{MACRO.VERSION}
              </Text>
            </Text>
            {envInfo.gitState && <Text>
                - Git repo metadata:{' '}
                <Text dimColor>
                  {envInfo.gitState.branchName}
                  {envInfo.gitState.commitHash ? `, ${envInfo.gitState.commitHash.slice(0, 7)}` : ''}
                  {envInfo.gitState.remoteUrl ? ` @ ${envInfo.gitState.remoteUrl}` : ''}
                  {!envInfo.gitState.isHeadOnRemote && ', not synced'}
                  {!envInfo.gitState.isClean && ', has local changes'}
                </Text>
              </Text>}
            <Text>- Current session transcript</Text>
          </Box>
          <Box marginTop={1}>
            <Text wrap="wrap" dimColor>
              We will use your feedback to debug related issues or to improve{' '}
              Claude Code Next&apos;s functionality (eg. to reduce the risk of bugs
              occurring in the future).
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text>
              Press <Text bold>Enter</Text> to confirm and submit.
            </Text>
          </Box>
        </Box>}

      {step === 'submitting' && <Box flexDirection="row" gap={1}>
          <Text>Submitting report…</Text>
        </Box>}

      {step === 'done' && <Box flexDirection="column">
          {error ? <Text color="error">{error}</Text> : <Text color="success">Thank you for your report!</Text>}
          {feedbackId && <Text dimColor>Feedback ID: {feedbackId}</Text>}
          <Box marginTop={1}>
            <Text>Press </Text>
            <Text bold>Enter </Text>
            <Text>
              to open your browser and draft a GitHub issue, or any other key to
              close.
            </Text>
          </Box>
        </Box>}
    </Dialog>;
}
export function createGitHubIssueUrl(feedbackId: string, title: string, description: string, errors: Array<{
  error?: string;
  timestamp?: string;
}>): string {
  const sanitizedTitle = redactSensitiveInfo(title);
  const sanitizedDescription = redactSensitiveInfo(description);
  const bodyPrefix = `**Bug Description**\n${sanitizedDescription}\n\n` + `**Environment Info**\n` + `- Platform: ${env.platform}\n` + `- Terminal: ${env.terminal}\n` + `- Version: ${MACRO.VERSION || 'unknown'}\n` + `- Feedback ID: ${feedbackId}\n` + `\n**Errors**\n\`\`\`json\n`;
  const errorSuffix = `\n\`\`\`\n`;
  const errorsJson = jsonStringify(errors);
  const baseUrl = `${GITHUB_ISSUES_REPO_URL}/new?title=${encodeURIComponent(sanitizedTitle)}&labels=user-reported,bug&body=`;
  const truncationNote = `\n**Note:** Content was truncated.\n`;
  const encodedPrefix = encodeURIComponent(bodyPrefix);
  const encodedSuffix = encodeURIComponent(errorSuffix);
  const encodedNote = encodeURIComponent(truncationNote);
  const encodedErrors = encodeURIComponent(errorsJson);

  
  const spaceForErrors = GITHUB_URL_LIMIT - baseUrl.length - encodedPrefix.length - encodedSuffix.length - encodedNote.length;

  
  if (spaceForErrors <= 0) {
    const ellipsis = encodeURIComponent('…');
    const buffer = 50; 
    const maxEncodedLength = GITHUB_URL_LIMIT - baseUrl.length - ellipsis.length - encodedNote.length - buffer;
    const fullBody = bodyPrefix + errorsJson + errorSuffix;
    let encodedFullBody = encodeURIComponent(fullBody);
    if (encodedFullBody.length > maxEncodedLength) {
      encodedFullBody = encodedFullBody.slice(0, maxEncodedLength);
      
      const lastPercent = encodedFullBody.lastIndexOf('%');
      if (lastPercent >= encodedFullBody.length - 2) {
        encodedFullBody = encodedFullBody.slice(0, lastPercent);
      }
    }
    return baseUrl + encodedFullBody + ellipsis + encodedNote;
  }

  
  if (encodedErrors.length <= spaceForErrors) {
    return baseUrl + encodedPrefix + encodedErrors + encodedSuffix;
  }

  
  
  const ellipsis = encodeURIComponent('…');
  const buffer = 50; 
  let truncatedEncodedErrors = encodedErrors.slice(0, spaceForErrors - ellipsis.length - buffer);
  
  const lastPercent = truncatedEncodedErrors.lastIndexOf('%');
  if (lastPercent >= truncatedEncodedErrors.length - 2) {
    truncatedEncodedErrors = truncatedEncodedErrors.slice(0, lastPercent);
  }
  return baseUrl + encodedPrefix + truncatedEncodedErrors + ellipsis + encodedSuffix + encodedNote;
}
async function generateTitle(description: string, abortSignal: AbortSignal): Promise<string> {
  try {
    const response = await queryHaiku({
      systemPrompt: asSystemPrompt(['Generate a concise, technical issue title (max 80 chars) for a public GitHub issue based on this bug report for Claude Code Next.', 'Claude Code Next is an agentic coding CLI based on the Anthropic API.', 'The title should:', '- Include the type of issue [Bug] or [Feature Request] as the first thing in the title', '- Be concise, specific and descriptive of the actual problem', '- Use technical terminology appropriate for a software issue', '- For error messages, extract the key error (e.g., "Missing Tool Result Block" rather than the full message)', '- Be direct and clear for developers to understand the problem', '- If you cannot determine a clear issue, use "Bug Report: [brief description]"', '- Any LLM API errors are from the Anthropic API, not from any other model provider', 'Your response will be directly used as the title of the Github issue, and as such should not contain any other commentary or explaination', 'Examples of good titles include: "[Bug] Auto-Compact triggers to soon", "[Bug] Anthropic API Error: Missing Tool Result Block", "[Bug] Error: Invalid Model Name for Opus"']),
      userPrompt: description,
      signal: abortSignal,
      options: {
        hasAppendSystemPrompt: false,
        toolChoice: undefined,
        isNonInteractiveSession: false,
        agents: [],
        querySource: 'feedback',
        mcpTools: []
      }
    });
    const title = response.message.content[0]?.type === 'text' ? response.message.content[0].text : 'Bug Report';

    
    if (startsWithApiErrorPrefix(title)) {
      return createFallbackTitle(description);
    }
    return title;
  } catch (error) {
    
    logError(error);
    return createFallbackTitle(description);
  }
}
function createFallbackTitle(description: string): string {
  

  
  const firstLine = description.split('\n')[0] || '';

  
  if (firstLine.length <= 60 && firstLine.length > 5) {
    return firstLine;
  }

  
  
  let truncated = firstLine.slice(0, 60);
  if (firstLine.length > 60) {
    
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 30) {
      
      truncated = truncated.slice(0, lastSpace);
    }
    truncated += '...';
  }
  return truncated.length < 10 ? 'Bug Report' : truncated;
}

function sanitizeAndLogError(err: unknown): void {
  if (err instanceof Error) {
    
    const safeError = new Error(redactSensitiveInfo(err.message));

    
    if (err.stack) {
      safeError.stack = redactSensitiveInfo(err.stack);
    }
    logError(safeError);
  } else {
    
    const errorString = redactSensitiveInfo(String(err));
    logError(new Error(errorString));
  }
}
async function submitFeedback(data: FeedbackData, signal?: AbortSignal): Promise<{
  success: boolean;
  feedbackId?: string;
  isZdrOrg?: boolean;
}> {
  if (isEssentialTrafficOnly()) {
    return {
      success: false
    };
  }
  try {
    
    
    await checkAndRefreshOAuthTokenIfNeeded();
    const authResult = getAuthHeaders();
    if (authResult.error) {
      return {
        success: false
      };
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': getUserAgent(),
      ...authResult.headers
    };
    const response = await axios.post('https://api.anthropic.com/api/claude_cli_feedback', {
      content: jsonStringify(data)
    }, {
      headers,
      timeout: 30000,
      
      signal
    });
    if (response.status === 200) {
      const result = response.data;
      if (result?.feedback_id) {
        return {
          success: true,
          feedbackId: result.feedback_id
        };
      }
      sanitizeAndLogError(new Error('Failed to submit feedback: request did not return feedback_id'));
      return {
        success: false
      };
    }
    sanitizeAndLogError(new Error('Failed to submit feedback:' + response.status));
    return {
      success: false
    };
  } catch (err) {
    
    if (axios.isCancel(err)) {
      return {
        success: false
      };
    }
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      const errorData = err.response.data;
      if (errorData?.error?.type === 'permission_error' && errorData?.error?.message?.includes('Custom data retention settings')) {
        sanitizeAndLogError(new Error('Cannot submit feedback because custom data retention settings are enabled'));
        return {
          success: false,
          isZdrOrg: true
        };
      }
    }
    
    sanitizeAndLogError(err);
    return {
      success: false
    };
  }
}
