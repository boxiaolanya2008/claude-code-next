import axios from 'axios';
import chalk from 'chalk';
import { randomUUID } from 'crypto';
import React from 'react';
import { getOriginalCwd, getSessionId } from 'src/bootstrap/state.js';
import { checkGate_CACHED_OR_BLOCKING } from 'src/services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { isPolicyAllowed } from 'src/services/policyLimits/index.js';
import { z } from 'zod/v4';
import { getTeleportErrors, TeleportError, type TeleportLocalErrorType } from '../components/TeleportError.js';
import { getOauthConfig } from '../constants/oauth.js';
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js';
import type { Root } from '../ink.js';
import { KeybindingSetup } from '../keybindings/KeybindingProviderSetup.js';
import { queryHaiku } from '../services/api/claude.js';
import { getSessionLogsViaOAuth, getTeleportEvents } from '../services/api/sessionIngress.js';
import { getOrganizationUUID } from '../services/oauth/client.js';
import { AppStateProvider } from '../state/AppState.js';
import type { Message, SystemMessage } from '../types/message.js';
import type { PermissionMode } from '../types/permissions.js';
import { checkAndRefreshOAuthTokenIfNeeded, getClaudeAIOAuthTokens } from './auth.js';
import { checkGithubAppInstalled } from './background/remote/preconditions.js';
import { deserializeMessages, type TeleportRemoteResponse } from './conversationRecovery.js';
import { getCwd } from './cwd.js';
import { logForDebugging } from './debug.js';
import { detectCurrentRepositoryWithHost, parseGitHubRepository, parseGitRemote } from './detectRepository.js';
import { isEnvTruthy } from './envUtils.js';
import { TeleportOperationError, toError } from './errors.js';
import { execFileNoThrow } from './execFileNoThrow.js';
import { truncateToWidth } from './format.js';
import { findGitRoot, getDefaultBranch, getIsClean, gitExe } from './git.js';
import { safeParseJSON } from './json.js';
import { logError } from './log.js';
import { createSystemMessage, createUserMessage } from './messages.js';
import { getMainLoopModel } from './model/model.js';
import { isTranscriptMessage } from './sessionStorage.js';
import { getSettings_DEPRECATED } from './settings/settings.js';
import { jsonStringify } from './slowOperations.js';
import { asSystemPrompt } from './systemPromptType.js';
import { fetchSession, type GitRepositoryOutcome, type GitSource, getBranchFromSession, getOAuthHeaders, type SessionResource } from './teleport/api.js';
import { fetchEnvironments } from './teleport/environments.js';
import { createAndUploadGitBundle } from './teleport/gitBundle.js';
export type TeleportResult = {
  messages: Message[];
  branchName: string;
};
export type TeleportProgressStep = 'validating' | 'fetching_logs' | 'fetching_branch' | 'checking_out' | 'done';
export type TeleportProgressCallback = (step: TeleportProgressStep) => void;

function createTeleportResumeSystemMessage(branchError: Error | null): SystemMessage {
  if (branchError === null) {
    return createSystemMessage('Session resumed', 'suggestion');
  }
  const formattedError = branchError instanceof TeleportOperationError ? branchError.formattedMessage : branchError.message;
  return createSystemMessage(`Session resumed without branch: ${formattedError}`, 'warning');
}

function createTeleportResumeUserMessage() {
  return createUserMessage({
    content: `This session is being continued from another machine. Application state may have changed. The updated working directory is ${getOriginalCwd()}`,
    isMeta: true
  });
}
type TeleportToRemoteResponse = {
  id: string;
  title: string;
};
const SESSION_TITLE_AND_BRANCH_PROMPT = `You are coming up with a succinct title and git branch name for a coding session based on the provided description. The title should be clear, concise, and accurately reflect the content of the coding task.
You should keep it short and simple, ideally no more than 6 words. Avoid using jargon or overly technical terms unless absolutely necessary. The title should be easy to understand for anyone reading it.
Use sentence case for the title (capitalize only the first word and proper nouns), not Title Case.

The branch name should be clear, concise, and accurately reflect the content of the coding task.
You should keep it short and simple, ideally no more than 4 words. The branch should always start with "claude/" and should be all lower case, with words separated by dashes.

Return a JSON object with "title" and "branch" fields.

Example 1: {"title": "Fix login button not working on mobile", "branch": "claude/fix-mobile-login-button"}
Example 2: {"title": "Update README with installation instructions", "branch": "claude/update-readme"}
Example 3: {"title": "Improve performance of data processing script", "branch": "claude/improve-data-processing"}

Here is the session description:
<description>{description}</description>
Please generate a title and branch name for this session.`;
type TitleAndBranch = {
  title: string;
  branchName: string;
};

async function generateTitleAndBranch(description: string, signal: AbortSignal): Promise<TitleAndBranch> {
  const fallbackTitle = truncateToWidth(description, 75);
  const fallbackBranch = 'claude/task';
  try {
    const userPrompt = SESSION_TITLE_AND_BRANCH_PROMPT.replace('{description}', description);
    const response = await queryHaiku({
      systemPrompt: asSystemPrompt([]),
      userPrompt,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            title: {
              type: 'string'
            },
            branch: {
              type: 'string'
            }
          },
          required: ['title', 'branch'],
          additionalProperties: false
        }
      },
      signal,
      options: {
        querySource: 'teleport_generate_title',
        agents: [],
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        mcpTools: []
      }
    });

    
    const firstBlock = response.message.content[0];
    if (firstBlock?.type !== 'text') {
      return {
        title: fallbackTitle,
        branchName: fallbackBranch
      };
    }
    const parsed = safeParseJSON(firstBlock.text.trim());
    const parseResult = z.object({
      title: z.string(),
      branch: z.string()
    }).safeParse(parsed);
    if (parseResult.success) {
      return {
        title: parseResult.data.title || fallbackTitle,
        branchName: parseResult.data.branch || fallbackBranch
      };
    }
    return {
      title: fallbackTitle,
      branchName: fallbackBranch
    };
  } catch (error) {
    logError(new Error(`Error generating title and branch: ${error}`));
    return {
      title: fallbackTitle,
      branchName: fallbackBranch
    };
  }
}

export async function validateGitState(): Promise<void> {
  const isClean = await getIsClean({
    ignoreUntracked: true
  });
  if (!isClean) {
    logEvent('tengu_teleport_error_git_not_clean', {});
    const error = new TeleportOperationError('Git working directory is not clean. Please commit or stash your changes before using --teleport.', chalk.red('Error: Git working directory is not clean. Please commit or stash your changes before using --teleport.\n'));
    throw error;
  }
}

async function fetchFromOrigin(branch?: string): Promise<void> {
  const fetchArgs = branch ? ['fetch', 'origin', `${branch}:${branch}`] : ['fetch', 'origin'];
  const {
    code: fetchCode,
    stderr: fetchStderr
  } = await execFileNoThrow(gitExe(), fetchArgs);
  if (fetchCode !== 0) {
    
    
    if (branch && fetchStderr.includes('refspec')) {
      logForDebugging(`Specific branch fetch failed, trying to fetch ref: ${branch}`);
      const {
        code: refFetchCode,
        stderr: refFetchStderr
      } = await execFileNoThrow(gitExe(), ['fetch', 'origin', branch]);
      if (refFetchCode !== 0) {
        logError(new Error(`Failed to fetch from remote origin: ${refFetchStderr}`));
      }
    } else {
      logError(new Error(`Failed to fetch from remote origin: ${fetchStderr}`));
    }
  }
}

async function ensureUpstreamIsSet(branchName: string): Promise<void> {
  
  const {
    code: upstreamCheckCode
  } = await execFileNoThrow(gitExe(), ['rev-parse', '--abbrev-ref', `${branchName}@{upstream}`]);
  if (upstreamCheckCode === 0) {
    
    logForDebugging(`Branch '${branchName}' already has upstream set`);
    return;
  }

  
  const {
    code: remoteCheckCode
  } = await execFileNoThrow(gitExe(), ['rev-parse', '--verify', `origin/${branchName}`]);
  if (remoteCheckCode === 0) {
    
    logForDebugging(`Setting upstream for '${branchName}' to 'origin/${branchName}'`);
    const {
      code: setUpstreamCode,
      stderr: setUpstreamStderr
    } = await execFileNoThrow(gitExe(), ['branch', '--set-upstream-to', `origin/${branchName}`, branchName]);
    if (setUpstreamCode !== 0) {
      logForDebugging(`Failed to set upstream for '${branchName}': ${setUpstreamStderr}`);
      
    } else {
      logForDebugging(`Successfully set upstream for '${branchName}'`);
    }
  } else {
    logForDebugging(`Remote branch 'origin/${branchName}' does not exist, skipping upstream setup`);
  }
}

async function checkoutBranch(branchName: string): Promise<void> {
  
  let {
    code: checkoutCode,
    stderr: checkoutStderr
  } = await execFileNoThrow(gitExe(), ['checkout', branchName]);

  
  if (checkoutCode !== 0) {
    logForDebugging(`Local checkout failed, trying to checkout from origin: ${checkoutStderr}`);

    
    const result = await execFileNoThrow(gitExe(), ['checkout', '-b', branchName, '--track', `origin/${branchName}`]);
    checkoutCode = result.code;
    checkoutStderr = result.stderr;

    
    if (checkoutCode !== 0) {
      logForDebugging(`Remote checkout with -b failed, trying without -b: ${checkoutStderr}`);
      const finalResult = await execFileNoThrow(gitExe(), ['checkout', '--track', `origin/${branchName}`]);
      checkoutCode = finalResult.code;
      checkoutStderr = finalResult.stderr;
    }
  }
  if (checkoutCode !== 0) {
    logEvent('tengu_teleport_error_branch_checkout_failed', {});
    throw new TeleportOperationError(`Failed to checkout branch '${branchName}': ${checkoutStderr}`, chalk.red(`Failed to checkout branch '${branchName}'\n`));
  }

  
  await ensureUpstreamIsSet(branchName);
}

async function getCurrentBranch(): Promise<string> {
  const {
    stdout: currentBranch
  } = await execFileNoThrow(gitExe(), ['branch', '--show-current']);
  return currentBranch.trim();
}

export function processMessagesForTeleportResume(messages: Message[], error: Error | null): Message[] {
  
  const deserializedMessages = deserializeMessages(messages);

  
  const messagesWithTeleportNotice = [...deserializedMessages, createTeleportResumeUserMessage(), createTeleportResumeSystemMessage(error)];
  return messagesWithTeleportNotice;
}

export async function checkOutTeleportedSessionBranch(branch?: string): Promise<{
  branchName: string;
  branchError: Error | null;
}> {
  try {
    const currentBranch = await getCurrentBranch();
    logForDebugging(`Current branch before teleport: '${currentBranch}'`);
    if (branch) {
      logForDebugging(`Switching to branch '${branch}'...`);
      await fetchFromOrigin(branch);
      await checkoutBranch(branch);
      const newBranch = await getCurrentBranch();
      logForDebugging(`Branch after checkout: '${newBranch}'`);
    } else {
      logForDebugging('No branch specified, staying on current branch');
    }
    const branchName = await getCurrentBranch();
    return {
      branchName,
      branchError: null
    };
  } catch (error) {
    const branchName = await getCurrentBranch();
    const branchError = toError(error);
    return {
      branchName,
      branchError
    };
  }
}

export type RepoValidationResult = {
  status: 'match' | 'mismatch' | 'not_in_repo' | 'no_repo_required' | 'error';
  sessionRepo?: string;
  currentRepo?: string | null;
  
  sessionHost?: string;
  
  currentHost?: string;
  errorMessage?: string;
};

export async function validateSessionRepository(sessionData: SessionResource): Promise<RepoValidationResult> {
  const currentParsed = await detectCurrentRepositoryWithHost();
  const currentRepo = currentParsed ? `${currentParsed.owner}/${currentParsed.name}` : null;
  const gitSource = sessionData.session_context.sources.find((source): source is GitSource => source.type === 'git_repository');
  if (!gitSource?.url) {
    
    logForDebugging(currentRepo ? 'Session has no associated repository, proceeding without validation' : 'Session has no repo requirement and not in git directory, proceeding');
    return {
      status: 'no_repo_required'
    };
  }
  const sessionParsed = parseGitRemote(gitSource.url);
  const sessionRepo = sessionParsed ? `${sessionParsed.owner}/${sessionParsed.name}` : parseGitHubRepository(gitSource.url);
  if (!sessionRepo) {
    return {
      status: 'no_repo_required'
    };
  }
  logForDebugging(`Session is for repository: ${sessionRepo}, current repo: ${currentRepo ?? 'none'}`);
  if (!currentRepo) {
    
    return {
      status: 'not_in_repo',
      sessionRepo,
      sessionHost: sessionParsed?.host,
      currentRepo: null
    };
  }

  
  
  
  
  const stripPort = (host: string): string => host.replace(/:\d+$/, '');
  const repoMatch = currentRepo.toLowerCase() === sessionRepo.toLowerCase();
  const hostMatch = !currentParsed || !sessionParsed || stripPort(currentParsed.host.toLowerCase()) === stripPort(sessionParsed.host.toLowerCase());
  if (repoMatch && hostMatch) {
    return {
      status: 'match',
      sessionRepo,
      currentRepo
    };
  }

  
  
  
  return {
    status: 'mismatch',
    sessionRepo,
    currentRepo,
    sessionHost: sessionParsed?.host,
    currentHost: currentParsed?.host
  };
}

export async function teleportResumeCodeSession(sessionId: string, onProgress?: TeleportProgressCallback): Promise<TeleportRemoteResponse> {
  if (!isPolicyAllowed('allow_remote_sessions')) {
    throw new Error("Remote sessions are disabled by your organization's policy.");
  }
  logForDebugging(`Resuming code session ID: ${sessionId}`);
  try {
    const accessToken = getClaudeAIOAuthTokens()?.accessToken;
    if (!accessToken) {
      logEvent('tengu_teleport_resume_error', {
        error_type: 'no_access_token' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      throw new Error('Claude Code Next web sessions require authentication with a Claude.ai account. API key authentication is not sufficient. Please run /login to authenticate, or check your authentication status with /status.');
    }

    
    const orgUUID = await getOrganizationUUID();
    if (!orgUUID) {
      logEvent('tengu_teleport_resume_error', {
        error_type: 'no_org_uuid' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      throw new Error('Unable to get organization UUID for constructing session URL');
    }

    
    onProgress?.('validating');
    const sessionData = await fetchSession(sessionId);
    const repoValidation = await validateSessionRepository(sessionData);
    switch (repoValidation.status) {
      case 'match':
      case 'no_repo_required':
        
        break;
      case 'not_in_repo':
        {
          logEvent('tengu_teleport_error_repo_not_in_git_dir_sessions_api', {
            sessionId: sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          
          const notInRepoDisplay = repoValidation.sessionHost && repoValidation.sessionHost.toLowerCase() !== 'github.com' ? `${repoValidation.sessionHost}/${repoValidation.sessionRepo}` : repoValidation.sessionRepo;
          throw new TeleportOperationError(`You must run claude --teleport ${sessionId} from a checkout of ${notInRepoDisplay}.`, chalk.red(`You must run claude --teleport ${sessionId} from a checkout of ${chalk.bold(notInRepoDisplay)}.\n`));
        }
      case 'mismatch':
        {
          logEvent('tengu_teleport_error_repo_mismatch_sessions_api', {
            sessionId: sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
          });
          
          
          const hostsDiffer = repoValidation.sessionHost && repoValidation.currentHost && repoValidation.sessionHost.replace(/:\d+$/, '').toLowerCase() !== repoValidation.currentHost.replace(/:\d+$/, '').toLowerCase();
          const sessionDisplay = hostsDiffer ? `${repoValidation.sessionHost}/${repoValidation.sessionRepo}` : repoValidation.sessionRepo;
          const currentDisplay = hostsDiffer ? `${repoValidation.currentHost}/${repoValidation.currentRepo}` : repoValidation.currentRepo;
          throw new TeleportOperationError(`You must run claude --teleport ${sessionId} from a checkout of ${sessionDisplay}.\nThis repo is ${currentDisplay}.`, chalk.red(`You must run claude --teleport ${sessionId} from a checkout of ${chalk.bold(sessionDisplay)}.\nThis repo is ${chalk.bold(currentDisplay)}.\n`));
        }
      case 'error':
        throw new TeleportOperationError(repoValidation.errorMessage || 'Failed to validate session repository', chalk.red(`Error: ${repoValidation.errorMessage || 'Failed to validate session repository'}\n`));
      default:
        {
          const _exhaustive: never = repoValidation.status;
          throw new Error(`Unhandled repo validation status: ${_exhaustive}`);
        }
    }
    return await teleportFromSessionsAPI(sessionId, orgUUID, accessToken, onProgress, sessionData);
  } catch (error) {
    if (error instanceof TeleportOperationError) {
      throw error;
    }
    const err = toError(error);
    logError(err);
    logEvent('tengu_teleport_resume_error', {
      error_type: 'resume_session_id_catch' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    throw new TeleportOperationError(err.message, chalk.red(`Error: ${err.message}\n`));
  }
}

async function handleTeleportPrerequisites(root: Root, errorsToIgnore?: Set<TeleportLocalErrorType>): Promise<void> {
  const errors = await getTeleportErrors();
  if (errors.size > 0) {
    
    logEvent('tengu_teleport_errors_detected', {
      error_types: Array.from(errors).join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errors_ignored: Array.from(errorsToIgnore || []).join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });

    
    await new Promise<void>(resolve => {
      root.render(<AppStateProvider>
          <KeybindingSetup>
            <TeleportError errorsToIgnore={errorsToIgnore} onComplete={() => {
            
            logEvent('tengu_teleport_errors_resolved', {
              error_types: Array.from(errors).join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
            });
            void resolve();
          }} />
          </KeybindingSetup>
        </AppStateProvider>);
    });
  }
}

export async function teleportToRemoteWithErrorHandling(root: Root, description: string | null, signal: AbortSignal, branchName?: string): Promise<TeleportToRemoteResponse | null> {
  const errorsToIgnore = new Set<TeleportLocalErrorType>(['needsGitStash']);
  await handleTeleportPrerequisites(root, errorsToIgnore);
  return teleportToRemote({
    initialMessage: description,
    signal,
    branchName,
    onBundleFail: msg => process.stderr.write(`\n${msg}\n`)
  });
}

export async function teleportFromSessionsAPI(sessionId: string, orgUUID: string, accessToken: string, onProgress?: TeleportProgressCallback, sessionData?: SessionResource): Promise<TeleportRemoteResponse> {
  const startTime = Date.now();
  try {
    
    logForDebugging(`[teleport] Starting fetch for session: ${sessionId}`);
    onProgress?.('fetching_logs');
    const logsStartTime = Date.now();
    
    
    
    
    
    let logs = await getTeleportEvents(sessionId, accessToken, orgUUID);
    if (logs === null) {
      logForDebugging('[teleport] v2 endpoint returned null, trying session-ingress');
      logs = await getSessionLogsViaOAuth(sessionId, accessToken, orgUUID);
    }
    logForDebugging(`[teleport] Session logs fetched in ${Date.now() - logsStartTime}ms`);
    if (logs === null) {
      throw new Error('Failed to fetch session logs');
    }

    
    const filterStartTime = Date.now();
    const messages = logs.filter(entry => isTranscriptMessage(entry) && !entry.isSidechain) as Message[];
    logForDebugging(`[teleport] Filtered ${logs.length} entries to ${messages.length} messages in ${Date.now() - filterStartTime}ms`);

    
    onProgress?.('fetching_branch');
    const branch = sessionData ? getBranchFromSession(sessionData) : undefined;
    if (branch) {
      logForDebugging(`[teleport] Found branch: ${branch}`);
    }
    logForDebugging(`[teleport] Total teleportFromSessionsAPI time: ${Date.now() - startTime}ms`);
    return {
      log: messages,
      branch
    };
  } catch (error) {
    const err = toError(error);

    
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      logEvent('tengu_teleport_error_session_not_found_404', {
        sessionId: sessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      throw new TeleportOperationError(`${sessionId} not found.`, `${sessionId} not found.\n${chalk.dim('Run /status in Claude Code Next to check your account.')}`);
    }
    logError(err);
    throw new Error(`Failed to fetch session from Sessions API: ${err.message}`);
  }
}

export type PollRemoteSessionResponse = {
  newEvents: SDKMessage[];
  lastEventId: string | null;
  branch?: string;
  sessionStatus?: 'idle' | 'running' | 'requires_action' | 'archived';
};

export async function pollRemoteSessionEvents(sessionId: string, afterId: string | null = null, opts?: {
  skipMetadata?: boolean;
}): Promise<PollRemoteSessionResponse> {
  const accessToken = getClaudeAIOAuthTokens()?.accessToken;
  if (!accessToken) {
    throw new Error('No access token for polling');
  }
  const orgUUID = await getOrganizationUUID();
  if (!orgUUID) {
    throw new Error('No org UUID for polling');
  }
  const headers = {
    ...getOAuthHeaders(accessToken),
    'anthropic-beta': 'ccr-byoc-2025-07-29',
    'x-organization-uuid': orgUUID
  };
  const eventsUrl = `${getOauthConfig().BASE_API_URL}/v1/sessions/${sessionId}/events`;
  type EventsResponse = {
    data: unknown[];
    has_more: boolean;
    first_id: string | null;
    last_id: string | null;
  };

  
  const MAX_EVENT_PAGES = 50;
  const sdkMessages: SDKMessage[] = [];
  let cursor = afterId;
  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const eventsResponse = await axios.get(eventsUrl, {
      headers,
      params: cursor ? {
        after_id: cursor
      } : undefined,
      timeout: 30000
    });
    if (eventsResponse.status !== 200) {
      throw new Error(`Failed to fetch session events: ${eventsResponse.statusText}`);
    }
    const eventsData: EventsResponse = eventsResponse.data;
    if (!eventsData?.data || !Array.isArray(eventsData.data)) {
      throw new Error('Invalid events response');
    }
    for (const event of eventsData.data) {
      if (event && typeof event === 'object' && 'type' in event) {
        if (event.type === 'env_manager_log' || event.type === 'control_response') {
          continue;
        }
        if ('session_id' in event) {
          sdkMessages.push(event as SDKMessage);
        }
      }
    }
    if (!eventsData.last_id) break;
    cursor = eventsData.last_id;
    if (!eventsData.has_more) break;
  }
  if (opts?.skipMetadata) {
    return {
      newEvents: sdkMessages,
      lastEventId: cursor
    };
  }

  
  let branch: string | undefined;
  let sessionStatus: PollRemoteSessionResponse['sessionStatus'];
  try {
    const sessionData = await fetchSession(sessionId);
    branch = getBranchFromSession(sessionData);
    sessionStatus = sessionData.session_status as PollRemoteSessionResponse['sessionStatus'];
  } catch (e) {
    logForDebugging(`teleport: failed to fetch session ${sessionId} metadata: ${e}`, {
      level: 'debug'
    });
  }
  return {
    newEvents: sdkMessages,
    lastEventId: cursor,
    branch,
    sessionStatus
  };
}

export async function teleportToRemote(options: {
  initialMessage: string | null;
  branchName?: string;
  title?: string;
  

  description?: string;
  model?: string;
  permissionMode?: PermissionMode;
  ultraplan?: boolean;
  signal: AbortSignal;
  useDefaultEnvironment?: boolean;
  

  environmentId?: string;
  

  environmentVariables?: Record<string, string>;
  

  useBundle?: boolean;
  

  onBundleFail?: (message: string) => void;
  

  skipBundle?: boolean;
  

  reuseOutcomeBranch?: string;
  

  githubPr?: {
    owner: string;
    repo: string;
    number: number;
  };
}): Promise<TeleportToRemoteResponse | null> {
  const {
    initialMessage,
    signal
  } = options;
  try {
    
    await checkAndRefreshOAuthTokenIfNeeded();
    const accessToken = getClaudeAIOAuthTokens()?.accessToken;
    if (!accessToken) {
      logError(new Error('No access token found for remote session creation'));
      return null;
    }

    
    const orgUUID = await getOrganizationUUID();
    if (!orgUUID) {
      logError(new Error('Unable to get organization UUID for remote session creation'));
      return null;
    }

    
    
    
    
    
    if (options.environmentId) {
      const url = `${getOauthConfig().BASE_API_URL}/v1/sessions`;
      const headers = {
        ...getOAuthHeaders(accessToken),
        'anthropic-beta': 'ccr-byoc-2025-07-29',
        'x-organization-uuid': orgUUID
      };
      const envVars = {
        CLAUDE_CODE_NEXT_OAUTH_TOKEN: accessToken,
        ...(options.environmentVariables ?? {})
      };

      
      
      
      let gitSource: GitSource | null = null;
      let seedBundleFileId: string | null = null;
      if (options.useBundle) {
        const bundle = await createAndUploadGitBundle({
          oauthToken: accessToken,
          sessionId: getSessionId(),
          baseUrl: getOauthConfig().BASE_API_URL
        }, {
          signal
        });
        if (!bundle.success) {
          logError(new Error(`Bundle upload failed: ${bundle.error}`));
          return null;
        }
        seedBundleFileId = bundle.fileId;
        logEvent('tengu_teleport_bundle_mode', {
          size_bytes: bundle.bundleSizeBytes,
          scope: bundle.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          has_wip: bundle.hasWip,
          reason: 'explicit_env_bundle' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        });
      } else {
        const repoInfo = await detectCurrentRepositoryWithHost();
        if (repoInfo) {
          gitSource = {
            type: 'git_repository',
            url: `https://${repoInfo.host}/${repoInfo.owner}/${repoInfo.name}`,
            revision: options.branchName
          };
        }
      }
      const requestBody = {
        title: options.title || options.description || 'Remote task',
        events: [],
        session_context: {
          sources: gitSource ? [gitSource] : [],
          ...(seedBundleFileId && {
            seed_bundle_file_id: seedBundleFileId
          }),
          outcomes: [],
          environment_variables: envVars
        },
        environment_id: options.environmentId
      };
      logForDebugging(`[teleportToRemote] explicit env ${options.environmentId}, ${Object.keys(envVars).length} env vars, ${seedBundleFileId ? `bundle=${seedBundleFileId}` : `source=${gitSource?.url ?? 'none'}@${options.branchName ?? 'default'}`}`);
      const response = await axios.post(url, requestBody, {
        headers,
        signal
      });
      if (response.status !== 200 && response.status !== 201) {
        logError(new Error(`CreateSession ${response.status}: ${jsonStringify(response.data)}`));
        return null;
      }
      const sessionData = response.data as SessionResource;
      if (!sessionData || typeof sessionData.id !== 'string') {
        logError(new Error(`No session id in response: ${jsonStringify(response.data)}`));
        return null;
      }
      return {
        id: sessionData.id,
        title: sessionData.title || requestBody.title
      };
    }
    let gitSource: GitSource | null = null;
    let gitOutcome: GitRepositoryOutcome | null = null;
    let seedBundleFileId: string | null = null;

    
    
    
    
    
    
    
    
    
    
    
    

    const repoInfo = await detectCurrentRepositoryWithHost();

    
    
    let sessionTitle: string;
    let sessionBranch: string;
    if (options.title && options.reuseOutcomeBranch) {
      sessionTitle = options.title;
      sessionBranch = options.reuseOutcomeBranch;
    } else {
      const generated = await generateTitleAndBranch(options.description || initialMessage || 'Background task', signal);
      sessionTitle = options.title || generated.title;
      sessionBranch = options.reuseOutcomeBranch || generated.branchName;
    }

    
    
    
    
    
    
    let ghViable = false;
    let sourceReason: 'github_preflight_ok' | 'ghes_optimistic' | 'github_preflight_failed' | 'no_github_remote' | 'forced_bundle' | 'no_git_at_all' = 'no_git_at_all';

    
    
    const gitRoot = findGitRoot(getCwd());
    const forceBundle = !options.skipBundle && isEnvTruthy(process.env.CCR_FORCE_BUNDLE);
    const bundleSeedGateOn = !options.skipBundle && gitRoot !== null && (isEnvTruthy(process.env.CCR_ENABLE_BUNDLE) || (await checkGate_CACHED_OR_BLOCKING('tengu_ccr_bundle_seed_enabled')));
    if (repoInfo && !forceBundle) {
      if (repoInfo.host === 'github.com') {
        ghViable = await checkGithubAppInstalled(repoInfo.owner, repoInfo.name, signal);
        sourceReason = ghViable ? 'github_preflight_ok' : 'github_preflight_failed';
      } else {
        ghViable = true;
        sourceReason = 'ghes_optimistic';
      }
    } else if (forceBundle) {
      sourceReason = 'forced_bundle';
    } else if (gitRoot) {
      sourceReason = 'no_github_remote';
    }

    
    
    if (!ghViable && !bundleSeedGateOn && repoInfo) {
      ghViable = true;
    }
    if (ghViable && repoInfo) {
      const {
        host,
        owner,
        name
      } = repoInfo;
      
      const revision = options.branchName ?? (await getDefaultBranch()) ?? undefined;
      logForDebugging(`[teleportToRemote] Git source: ${host}/${owner}/${name}, revision: ${revision ?? 'none'}`);
      gitSource = {
        type: 'git_repository',
        url: `https:}/${owner}/${name}`,
        
        revision,
        ...(options.reuseOutcomeBranch && {
          allow_unrestricted_git_push: true
        })
      };
      
      
      
      
      gitOutcome = {
        type: 'git_repository',
        git_info: {
          type: 'github',
          repo: `${owner}/${name}`,
          branches: [sessionBranch]
        }
      };
    }

    
    
    
    
    
    if (!gitSource && bundleSeedGateOn) {
      logForDebugging(`[teleportToRemote] Bundling (reason: ${sourceReason})`);
      const bundle = await createAndUploadGitBundle({
        oauthToken: accessToken,
        sessionId: getSessionId(),
        baseUrl: getOauthConfig().BASE_API_URL
      }, {
        signal
      });
      if (!bundle.success) {
        logError(new Error(`Bundle upload failed: ${bundle.error}`));
        
        const setup = repoInfo ? '. Please setup GitHub on https:
        let msg: string;
        switch (bundle.failReason) {
          case 'empty_repo':
            msg = 'Repository has no commits — run `git add . && git commit -m "initial"` then retry';
            break;
          case 'too_large':
            msg = `Repo is too large to teleport${setup}`;
            break;
          case 'git_error':
            msg = `Failed to create git bundle (${bundle.error})${setup}`;
            break;
          case undefined:
            msg = `Bundle upload failed: ${bundle.error}${setup}`;
            break;
          default:
            {
              const _exhaustive: never = bundle.failReason;
              void _exhaustive;
              msg = `Bundle upload failed: ${bundle.error}`;
            }
        }
        options.onBundleFail?.(msg);
        return null;
      }
      seedBundleFileId = bundle.fileId;
      logEvent('tengu_teleport_bundle_mode', {
        size_bytes: bundle.bundleSizeBytes,
        scope: bundle.scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        has_wip: bundle.hasWip,
        reason: sourceReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
    }
    logEvent('tengu_teleport_source_decision', {
      reason: sourceReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      path: (gitSource ? 'github' : seedBundleFileId ? 'bundle' : 'empty') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    if (!gitSource && !seedBundleFileId) {
      logForDebugging('[teleportToRemote] No repository detected — session will have an empty sandbox');
    }

    
    let environments = await fetchEnvironments();
    if (!environments || environments.length === 0) {
      logError(new Error('No environments available for session creation'));
      return null;
    }
    logForDebugging(`Available environments: ${environments.map(e => `${e.environment_id} (${e.name}, ${e.kind})`).join(', ')}`);

    
    
    
    
    const settings = getSettings_DEPRECATED();
    const defaultEnvironmentId = options.useDefaultEnvironment ? undefined : settings?.remote?.defaultEnvironmentId;
    let cloudEnv = environments.find(env => env.kind === 'anthropic_cloud');
    
    
    
    
    if (options.useDefaultEnvironment && !cloudEnv) {
      logForDebugging(`No anthropic_cloud in env list (${environments.length} envs); retrying fetchEnvironments`);
      const retried = await fetchEnvironments();
      cloudEnv = retried?.find(env => env.kind === 'anthropic_cloud');
      if (!cloudEnv) {
        logError(new Error(`No anthropic_cloud environment available after retry (got: ${(retried ?? environments).map(e => `${e.name} (${e.kind})`).join(', ')}). Silent byoc fallthrough would launch into a dead env — fail fast instead.`));
        return null;
      }
      if (retried) environments = retried;
    }
    const selectedEnvironment = defaultEnvironmentId && environments.find(env => env.environment_id === defaultEnvironmentId) || cloudEnv || environments.find(env => env.kind !== 'bridge') || environments[0];
    if (!selectedEnvironment) {
      logError(new Error('No environments available for session creation'));
      return null;
    }
    if (defaultEnvironmentId) {
      const matchedDefault = selectedEnvironment.environment_id === defaultEnvironmentId;
      logForDebugging(matchedDefault ? `Using configured default environment: ${defaultEnvironmentId}` : `Configured default environment ${defaultEnvironmentId} not found, using first available`);
    }
    const environmentId = selectedEnvironment.environment_id;
    logForDebugging(`Selected environment: ${environmentId} (${selectedEnvironment.name}, ${selectedEnvironment.kind})`);

    
    const url = `${getOauthConfig().BASE_API_URL}/v1/sessions`;
    const headers = {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID
    };
    const sessionContext = {
      sources: gitSource ? [gitSource] : [],
      ...(seedBundleFileId && {
        seed_bundle_file_id: seedBundleFileId
      }),
      outcomes: gitOutcome ? [gitOutcome] : [],
      model: options.model ?? getMainLoopModel(),
      ...(options.reuseOutcomeBranch && {
        reuse_outcome_branches: true
      }),
      ...(options.githubPr && {
        github_pr: options.githubPr
      })
    };

    
    
    
    
    
    const events: Array<{
      type: 'event';
      data: Record<string, unknown>;
    }> = [];
    if (options.permissionMode) {
      events.push({
        type: 'event',
        data: {
          type: 'control_request',
          request_id: `set-mode-${randomUUID()}`,
          request: {
            subtype: 'set_permission_mode',
            mode: options.permissionMode,
            ultraplan: options.ultraplan
          }
        }
      });
    }
    if (initialMessage) {
      events.push({
        type: 'event',
        data: {
          uuid: randomUUID(),
          session_id: '',
          type: 'user',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: initialMessage
          }
        }
      });
    }
    const requestBody = {
      title: options.ultraplan ? `ultraplan: ${sessionTitle}` : sessionTitle,
      events,
      session_context: sessionContext,
      environment_id: environmentId
    };
    logForDebugging(`Creating session with payload: ${jsonStringify(requestBody, null, 2)}`);

    
    const response = await axios.post(url, requestBody, {
      headers,
      signal
    });
    const isSuccess = response.status === 200 || response.status === 201;
    if (!isSuccess) {
      logError(new Error(`API request failed with status ${response.status}: ${response.statusText}\n\nResponse data: ${jsonStringify(response.data, null, 2)}`));
      return null;
    }

    
    const sessionData = response.data as SessionResource;
    if (!sessionData || typeof sessionData.id !== 'string') {
      logError(new Error(`Cannot determine session ID from API response: ${jsonStringify(response.data)}`));
      return null;
    }
    logForDebugging(`Successfully created remote session: ${sessionData.id}`);
    return {
      id: sessionData.id,
      title: sessionData.title || requestBody.title
    };
  } catch (error) {
    const err = toError(error);
    logError(err);
    return null;
  }
}

export async function archiveRemoteSession(sessionId: string): Promise<void> {
  const accessToken = getClaudeAIOAuthTokens()?.accessToken;
  if (!accessToken) return;
  const orgUUID = await getOrganizationUUID();
  if (!orgUUID) return;
  const headers = {
    ...getOAuthHeaders(accessToken),
    'anthropic-beta': 'ccr-byoc-2025-07-29',
    'x-organization-uuid': orgUUID
  };
  const url = `${getOauthConfig().BASE_API_URL}/v1/sessions/${sessionId}/archive`;
  try {
    const resp = await axios.post(url, {}, {
      headers,
      timeout: 10000,
      validateStatus: s => s < 500
    });
    if (resp.status === 200 || resp.status === 409) {
      logForDebugging(`[archiveRemoteSession] archived ${sessionId}`);
    } else {
      logForDebugging(`[archiveRemoteSession] ${sessionId} failed ${resp.status}: ${jsonStringify(resp.data)}`);
    }
  } catch (err) {
    logError(err);
  }
}
