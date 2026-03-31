import { readFileSync } from 'fs';
import { REMOTE_CONTROL_DISCONNECTED_MSG } from '../bridge/types.js';
import type { Command } from '../commands.js';
import { DIAMOND_OPEN } from '../constants/figures.js';
import { getRemoteSessionUrl } from '../constants/product.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../services/analytics/index.js';
import type { AppState } from '../state/AppStateStore.js';
import { checkRemoteAgentEligibility, formatPreconditionError, RemoteAgentTask, type RemoteAgentTaskState, registerRemoteAgentTask } from '../tasks/RemoteAgentTask/RemoteAgentTask.js';
import type { LocalJSXCommandCall } from '../types/command.js';
import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { logError } from '../utils/log.js';
import { enqueuePendingNotification } from '../utils/messageQueueManager.js';
import { ALL_MODEL_CONFIGS } from '../utils/model/configs.js';
import { updateTaskState } from '../utils/task/framework.js';
import { archiveRemoteSession, teleportToRemote } from '../utils/teleport.js';
import { pollForApprovedExitPlanMode, UltraplanPollError } from '../utils/ultraplan/ccrSession.js';

const ULTRAPLAN_TIMEOUT_MS = 30 * 60 * 1000;
export const CCR_TERMS_URL = 'https://code.claude.com/docs/en/claude-code-next-on-the-web';

function getUltraplanModel(): string {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_ultraplan_model', ALL_MODEL_CONFIGS.opus46.firstParty);
}

const _rawPrompt = require('../utils/ultraplan/prompt.txt');

const DEFAULT_INSTRUCTIONS: string = (typeof _rawPrompt === 'string' ? _rawPrompt : _rawPrompt.default).trimEnd();

const ULTRAPLAN_INSTRUCTIONS: string = "external" === 'ant' && process.env.ULTRAPLAN_PROMPT_FILE ? readFileSync(process.env.ULTRAPLAN_PROMPT_FILE, 'utf8').trimEnd() : DEFAULT_INSTRUCTIONS;

export function buildUltraplanPrompt(blurb: string, seedPlan?: string): string {
  const parts: string[] = [];
  if (seedPlan) {
    parts.push('Here is a draft plan to refine:', '', seedPlan, '');
  }
  parts.push(ULTRAPLAN_INSTRUCTIONS);
  if (blurb) {
    parts.push('', blurb);
  }
  return parts.join('\n');
}
function startDetachedPoll(taskId: string, sessionId: string, url: string, getAppState: () => AppState, setAppState: (f: (prev: AppState) => AppState) => void): void {
  const started = Date.now();
  let failed = false;
  void (async () => {
    try {
      const {
        plan,
        rejectCount,
        executionTarget
      } = await pollForApprovedExitPlanMode(sessionId, ULTRAPLAN_TIMEOUT_MS, phase => {
        if (phase === 'needs_input') logEvent('tengu_ultraplan_awaiting_input', {});
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => {
          if (t.status !== 'running') return t;
          const next = phase === 'running' ? undefined : phase;
          return t.ultraplanPhase === next ? t : {
            ...t,
            ultraplanPhase: next
          };
        });
      }, () => getAppState().tasks?.[taskId]?.status !== 'running');
      logEvent('tengu_ultraplan_approved', {
        duration_ms: Date.now() - started,
        plan_length: plan.length,
        reject_count: rejectCount,
        execution_target: executionTarget as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      if (executionTarget === 'remote') {
        
        
        
        
        
        const task = getAppState().tasks?.[taskId];
        if (task?.status !== 'running') return;
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => t.status !== 'running' ? t : {
          ...t,
          status: 'completed',
          endTime: Date.now()
        });
        setAppState(prev => prev.ultraplanSessionUrl === url ? {
          ...prev,
          ultraplanSessionUrl: undefined
        } : prev);
        enqueuePendingNotification({
          value: [`Ultraplan approved — executing in Claude Code Next on the web. Follow along at: ${url}`, '', 'Results will land as a pull request when the remote session finishes. There is nothing to do here.'].join('\n'),
          mode: 'task-notification'
        });
      } else {
        
        
        
        
        setAppState(prev => {
          const task = prev.tasks?.[taskId];
          if (!task || task.status !== 'running') return prev;
          return {
            ...prev,
            ultraplanPendingChoice: {
              plan,
              sessionId,
              taskId
            }
          };
        });
      }
    } catch (e) {
      
      
      
      const task = getAppState().tasks?.[taskId];
      if (task?.status !== 'running') return;
      failed = true;
      logEvent('tengu_ultraplan_failed', {
        duration_ms: Date.now() - started,
        reason: (e instanceof UltraplanPollError ? e.reason : 'network_or_unknown') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        reject_count: e instanceof UltraplanPollError ? e.rejectCount : undefined
      });
      enqueuePendingNotification({
        value: `Ultraplan failed: ${errorMessage(e)}\n\nSession: ${url}`,
        mode: 'task-notification'
      });
      
      
      void archiveRemoteSession(sessionId).catch(e => logForDebugging(`ultraplan archive failed: ${String(e)}`));
      setAppState(prev =>
      
      
      prev.ultraplanSessionUrl === url ? {
        ...prev,
        ultraplanSessionUrl: undefined
      } : prev);
    } finally {
      
      
      
      
      
      
      if (failed) {
        updateTaskState<RemoteAgentTaskState>(taskId, setAppState, t => t.status !== 'running' ? t : {
          ...t,
          status: 'failed',
          endTime: Date.now()
        });
      }
    }
  })();
}

function buildLaunchMessage(disconnectedBridge?: boolean): string {
  const prefix = disconnectedBridge ? `${REMOTE_CONTROL_DISCONNECTED_MSG} ` : '';
  return `${DIAMOND_OPEN} ultraplan\n${prefix}Starting Claude Code Next on the web…`;
}
function buildSessionReadyMessage(url: string): string {
  return `${DIAMOND_OPEN} ultraplan · Monitor progress in Claude Code Next on the web ${url}\nYou can continue working — when the ${DIAMOND_OPEN} fills, press ↓ to view results`;
}
function buildAlreadyActiveMessage(url: string | undefined): string {
  return url ? `ultraplan: already polling. Open ${url} to check status, or wait for the plan to land here.` : 'ultraplan: already launching. Please wait for the session to start.';
}

export async function stopUltraplan(taskId: string, sessionId: string, setAppState: (f: (prev: AppState) => AppState) => void): Promise<void> {
  
  
  await RemoteAgentTask.kill(taskId, setAppState);
  setAppState(prev => prev.ultraplanSessionUrl || prev.ultraplanPendingChoice || prev.ultraplanLaunching ? {
    ...prev,
    ultraplanSessionUrl: undefined,
    ultraplanPendingChoice: undefined,
    ultraplanLaunching: undefined
  } : prev);
  const url = getRemoteSessionUrl(sessionId, process.env.SESSION_INGRESS_URL);
  enqueuePendingNotification({
    value: `Ultraplan stopped.\n\nSession: ${url}`,
    mode: 'task-notification'
  });
  enqueuePendingNotification({
    value: 'The user stopped the ultraplan session above. Do not respond to the stop notification — wait for their next message.',
    mode: 'task-notification',
    isMeta: true
  });
}

export async function launchUltraplan(opts: {
  blurb: string;
  seedPlan?: string;
  getAppState: () => AppState;
  setAppState: (f: (prev: AppState) => AppState) => void;
  signal: AbortSignal;
  
  disconnectedBridge?: boolean;
  

  onSessionReady?: (msg: string) => void;
}): Promise<string> {
  const {
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    disconnectedBridge,
    onSessionReady
  } = opts;
  const {
    ultraplanSessionUrl: active,
    ultraplanLaunching
  } = getAppState();
  if (active || ultraplanLaunching) {
    logEvent('tengu_ultraplan_create_failed', {
      reason: (active ? 'already_polling' : 'already_launching') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    return buildAlreadyActiveMessage(active);
  }
  if (!blurb && !seedPlan) {
    
    return [
    
    
    'Usage: /ultraplan \\<prompt\\>, or include "ultraplan" anywhere', 'in your prompt', '', 'Advanced multi-agent plan mode with our most powerful model', '(Opus). Runs in Claude Code Next on the web. When the plan is ready,', 'you can execute it in the web session or send it back here.', 'Terminal stays free while the remote plans.', 'Requires /login.', '', `Terms: ${CCR_TERMS_URL}`].join('\n');
  }

  
  
  setAppState(prev => prev.ultraplanLaunching ? prev : {
    ...prev,
    ultraplanLaunching: true
  });
  void launchDetached({
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    onSessionReady
  });
  return buildLaunchMessage(disconnectedBridge);
}
async function launchDetached(opts: {
  blurb: string;
  seedPlan?: string;
  getAppState: () => AppState;
  setAppState: (f: (prev: AppState) => AppState) => void;
  signal: AbortSignal;
  onSessionReady?: (msg: string) => void;
}): Promise<void> {
  const {
    blurb,
    seedPlan,
    getAppState,
    setAppState,
    signal,
    onSessionReady
  } = opts;
  
  
  let sessionId: string | undefined;
  try {
    const model = getUltraplanModel();
    const eligibility = await checkRemoteAgentEligibility();
    if (!eligibility.eligible) {
      logEvent('tengu_ultraplan_create_failed', {
        reason: 'precondition' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        precondition_errors: eligibility.errors.map(e => e.type).join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      const reasons = eligibility.errors.map(formatPreconditionError).join('\n');
      enqueuePendingNotification({
        value: `ultraplan: cannot launch remote session —\n${reasons}`,
        mode: 'task-notification'
      });
      return;
    }
    const prompt = buildUltraplanPrompt(blurb, seedPlan);
    let bundleFailMsg: string | undefined;
    const session = await teleportToRemote({
      initialMessage: prompt,
      description: blurb || 'Refine local plan',
      model,
      permissionMode: 'plan',
      ultraplan: true,
      signal,
      useDefaultEnvironment: true,
      onBundleFail: msg => {
        bundleFailMsg = msg;
      }
    });
    if (!session) {
      logEvent('tengu_ultraplan_create_failed', {
        reason: (bundleFailMsg ? 'bundle_fail' : 'teleport_null') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      enqueuePendingNotification({
        value: `ultraplan: session creation failed${bundleFailMsg ? ` — ${bundleFailMsg}` : ''}. See --debug for details.`,
        mode: 'task-notification'
      });
      return;
    }
    sessionId = session.id;
    const url = getRemoteSessionUrl(session.id, process.env.SESSION_INGRESS_URL);
    setAppState(prev => ({
      ...prev,
      ultraplanSessionUrl: url,
      ultraplanLaunching: undefined
    }));
    onSessionReady?.(buildSessionReadyMessage(url));
    logEvent('tengu_ultraplan_launched', {
      has_seed_plan: Boolean(seedPlan),
      model: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    
    
    const {
      taskId
    } = registerRemoteAgentTask({
      remoteTaskType: 'ultraplan',
      session: {
        id: session.id,
        title: blurb || 'Ultraplan'
      },
      command: blurb,
      context: {
        abortController: new AbortController(),
        getAppState,
        setAppState
      },
      isUltraplan: true
    });
    startDetachedPoll(taskId, session.id, url, getAppState, setAppState);
  } catch (e) {
    logError(e);
    logEvent('tengu_ultraplan_create_failed', {
      reason: 'unexpected_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    enqueuePendingNotification({
      value: `ultraplan: unexpected error — ${errorMessage(e)}`,
      mode: 'task-notification'
    });
    if (sessionId) {
      
      
      void archiveRemoteSession(sessionId).catch(err => logForDebugging('ultraplan: failed to archive orphaned session', err));
      
      
      setAppState(prev => prev.ultraplanSessionUrl ? {
        ...prev,
        ultraplanSessionUrl: undefined
      } : prev);
    }
  } finally {
    
    setAppState(prev => prev.ultraplanLaunching ? {
      ...prev,
      ultraplanLaunching: undefined
    } : prev);
  }
}
const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const blurb = args.trim();

  
  if (!blurb) {
    const msg = await launchUltraplan({
      blurb,
      getAppState: context.getAppState,
      setAppState: context.setAppState,
      signal: context.abortController.signal
    });
    onDone(msg, {
      display: 'system'
    });
    return null;
  }

  
  
  
  const {
    ultraplanSessionUrl: active,
    ultraplanLaunching
  } = context.getAppState();
  if (active || ultraplanLaunching) {
    logEvent('tengu_ultraplan_create_failed', {
      reason: (active ? 'already_polling' : 'already_launching') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
    });
    onDone(buildAlreadyActiveMessage(active), {
      display: 'system'
    });
    return null;
  }

  
  
  
  context.setAppState(prev => ({
    ...prev,
    ultraplanLaunchPending: {
      blurb
    }
  }));
  
  
  onDone(undefined, {
    display: 'skip'
  });
  return null;
};
export default {
  type: 'local-jsx',
  name: 'ultraplan',
  description: `~10–30 min · Claude Code Next on the web drafts an advanced plan you can edit and approve. See ${CCR_TERMS_URL}`,
  argumentHint: '<prompt>',
  isEnabled: () => "external" === 'ant',
  load: () => Promise.resolve({
    call
  })
} satisfies Command;
