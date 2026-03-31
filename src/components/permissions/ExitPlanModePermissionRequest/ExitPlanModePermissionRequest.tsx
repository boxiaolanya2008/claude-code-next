import { feature } from "../utils/bundle-mock.ts";
import type { UUID } from 'crypto';
import figures from 'figures';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from 'src/services/analytics/index.js';
import { useAppState, useAppStateStore, useSetAppState } from 'src/state/AppState.js';
import { getSdkBetas, getSessionId, isSessionPersistenceDisabled, setHasExitedPlanMode, setNeedsAutoModeExitAttachment, setNeedsPlanModeExitAttachment } from '../../../bootstrap/state.js';
import { generateSessionName } from '../../../commands/rename/generateSessionName.js';
import { launchUltraplan } from '../../../commands/ultraplan.js';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import type { AppState } from '../../../state/AppStateStore.js';
import { AGENT_TOOL_NAME } from '../../../tools/AgentTool/constants.js';
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../../../tools/ExitPlanModeTool/constants.js';
import type { AllowedPrompt } from '../../../tools/ExitPlanModeTool/ExitPlanModeV2Tool.js';
import { TEAM_CREATE_TOOL_NAME } from '../../../tools/TeamCreateTool/constants.js';
import { isAgentSwarmsEnabled } from '../../../utils/agentSwarmsEnabled.js';
import { calculateContextPercentages, getContextWindowForModel } from '../../../utils/context.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { getDisplayPath } from '../../../utils/file.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import { logError } from '../../../utils/log.js';
import { enqueuePendingNotification } from '../../../utils/messageQueueManager.js';
import { createUserMessage } from '../../../utils/messages.js';
import { getMainLoopModel, getRuntimeMainLoopModel } from '../../../utils/model/model.js';
import { createPromptRuleContent, isClassifierPermissionsEnabled, PROMPT_PREFIX } from '../../../utils/permissions/bashClassifier.js';
import { type PermissionMode, toExternalPermissionMode } from '../../../utils/permissions/PermissionMode.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { isAutoModeGateEnabled, restoreDangerousPermissions, stripDangerousPermissionsForAutoMode } from '../../../utils/permissions/permissionSetup.js';
import { getPewterLedgerVariant, isPlanModeInterviewPhaseEnabled } from '../../../utils/planModeV2.js';
import { getPlan, getPlanFilePath } from '../../../utils/plans.js';
import { editFileInEditor, editPromptInEditor } from '../../../utils/promptEditor.js';
import { getCurrentSessionTitle, getTranscriptPath, saveAgentName, saveCustomTitle } from '../../../utils/sessionStorage.js';
import { getSettings_DEPRECATED } from '../../../utils/settings/settings.js';
import { type OptionWithDescription, Select } from '../../CustomSelect/index.js';
import { Markdown } from '../../Markdown.js';
import { PermissionDialog } from '../PermissionDialog.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';

const autoModeStateModule = feature('TRANSCRIPT_CLASSIFIER') ? require('../../../utils/permissions/autoModeState.js') as typeof import('../../../utils/permissions/autoModeState.js') : null;
import type { Base64ImageSource, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';

import type { PastedContent } from '../../../utils/config.js';
import type { ImageDimensions } from '../../../utils/imageResizer.js';
import { maybeResizeAndDownsampleImageBlock } from '../../../utils/imageResizer.js';
import { cacheImagePath, storeImage } from '../../../utils/imageStore.js';
type ResponseValue = 'yes-bypass-permissions' | 'yes-accept-edits' | 'yes-accept-edits-keep-context' | 'yes-default-keep-context' | 'yes-resume-auto-mode' | 'yes-auto-clear-context' | 'ultraplan' | 'no';

export function buildPermissionUpdates(mode: PermissionMode, allowedPrompts?: AllowedPrompt[]): PermissionUpdate[] {
  const updates: PermissionUpdate[] = [{
    type: 'setMode',
    mode: toExternalPermissionMode(mode),
    destination: 'session'
  }];

  
  if (isClassifierPermissionsEnabled() && allowedPrompts && allowedPrompts.length > 0) {
    updates.push({
      type: 'addRules',
      rules: allowedPrompts.map(p => ({
        toolName: p.tool,
        ruleContent: createPromptRuleContent(p.prompt)
      })),
      behavior: 'allow',
      destination: 'session'
    });
  }
  return updates;
}

export function autoNameSessionFromPlan(plan: string, setAppState: (updater: (prev: AppState) => AppState) => void, isClearContext: boolean): void {
  if (isSessionPersistenceDisabled() || getSettings_DEPRECATED()?.cleanupPeriodDays === 0) {
    return;
  }
  
  
  
  if (!isClearContext && getCurrentSessionTitle(getSessionId())) return;
  void generateSessionName(
  
  
  
  [createUserMessage({
    content: plan.slice(0, 1000)
  })], new AbortController().signal).then(async name => {
    
    
    
    if (!name || getCurrentSessionTitle(getSessionId())) return;
    const sessionId = getSessionId() as UUID;
    const fullPath = getTranscriptPath();
    await saveCustomTitle(sessionId, name, fullPath, 'auto');
    await saveAgentName(sessionId, name, fullPath, 'auto');
    setAppState(prev => {
      if (prev.standaloneAgentContext?.name === name) return prev;
      return {
        ...prev,
        standaloneAgentContext: {
          ...prev.standaloneAgentContext,
          name
        }
      };
    });
  }).catch(logError);
}
export function ExitPlanModePermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
  setStickyFooter
}: PermissionRequestProps): React.ReactNode {
  const toolPermissionContext = useAppState(s => s.toolPermissionContext);
  const setAppState = useSetAppState();
  const store = useAppStateStore();
  const {
    addNotification
  } = useNotifications();
  
  
  
  const [planFeedback, setPlanFeedback] = useState('');
  const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
  const nextPasteIdRef = useRef(0);
  const showClearContext = useAppState(s => s.settings.showClearContextOnPlanAccept) ?? false;
  const ultraplanSessionUrl = useAppState(s => s.ultraplanSessionUrl);
  const ultraplanLaunching = useAppState(s => s.ultraplanLaunching);
  
  
  
  
  const showUltraplan = feature('ULTRAPLAN') ? !ultraplanSessionUrl && !ultraplanLaunching : false;
  const usage = toolUseConfirm.assistantMessage.message.usage;
  const {
    mode,
    isAutoModeAvailable,
    isBypassPermissionsModeAvailable
  } = toolPermissionContext;
  const options = useMemo(() => buildPlanApprovalOptions({
    showClearContext,
    showUltraplan,
    usedPercent: showClearContext ? getContextUsedPercent(usage, mode) : null,
    isAutoModeAvailable,
    isBypassPermissionsModeAvailable,
    onFeedbackChange: setPlanFeedback
  }), [showClearContext, showUltraplan, usage, mode, isAutoModeAvailable, isBypassPermissionsModeAvailable]);
  function onImagePaste(base64Image: string, mediaType?: string, filename?: string, dimensions?: ImageDimensions, _sourcePath?: string) {
    const pasteId = nextPasteIdRef.current++;
    const newContent: PastedContent = {
      id: pasteId,
      type: 'image',
      content: base64Image,
      mediaType: mediaType || 'image/png',
      filename: filename || 'Pasted image',
      dimensions
    };
    cacheImagePath(newContent);
    void storeImage(newContent);
    setPastedContents(prev => ({
      ...prev,
      [pasteId]: newContent
    }));
  }
  const onRemoveImage = useCallback((id: number) => {
    setPastedContents(prev => {
      const next = {
        ...prev
      };
      delete next[id];
      return next;
    });
  }, []);
  const imageAttachments = Object.values(pastedContents).filter(c => c.type === 'image');
  const hasImages = imageAttachments.length > 0;

  
  
  
  
  const isV2 = toolUseConfirm.tool.name === EXIT_PLAN_MODE_V2_TOOL_NAME;
  const inputPlan = isV2 ? undefined : toolUseConfirm.input.plan as string | undefined;
  const planFilePath = isV2 ? getPlanFilePath() : undefined;

  
  const allowedPrompts = toolUseConfirm.input.allowedPrompts as AllowedPrompt[] | undefined;

  
  const rawPlan = inputPlan ?? getPlan();
  const isEmpty = !rawPlan || rawPlan.trim() === '';

  
  
  
  
  const [planStructureVariant] = useState(() => (getPewterLedgerVariant() ?? undefined) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS);
  const [currentPlan, setCurrentPlan] = useState(() => {
    if (inputPlan) return inputPlan;
    const plan = getPlan();
    return plan ?? 'No plan found. Please write your plan to the plan file first.';
  });
  const [showSaveMessage, setShowSaveMessage] = useState(false);
  
  
  
  const [planEditedLocally, setPlanEditedLocally] = useState(false);

  
  useEffect(() => {
    if (showSaveMessage) {
      const timer = setTimeout(setShowSaveMessage, 5000, false);
      return () => clearTimeout(timer);
    }
  }, [showSaveMessage]);

  
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrl && e.key === 'g') {
      e.preventDefault();
      logEvent('tengu_plan_external_editor_used', {});
      void (async () => {
        if (isV2 && planFilePath) {
          const result = await editFileInEditor(planFilePath);
          if (result.error) {
            addNotification({
              key: 'external-editor-error',
              text: result.error,
              color: 'warning',
              priority: 'high'
            });
          }
          if (result.content !== null) {
            if (result.content !== currentPlan) setPlanEditedLocally(true);
            setCurrentPlan(result.content);
            setShowSaveMessage(true);
          }
        } else {
          const result = await editPromptInEditor(currentPlan);
          if (result.error) {
            addNotification({
              key: 'external-editor-error',
              text: result.error,
              color: 'warning',
              priority: 'high'
            });
          }
          if (result.content !== null && result.content !== currentPlan) {
            setCurrentPlan(result.content);
            setShowSaveMessage(true);
          }
        }
      })();
      return;
    }

    
    if (e.shift && e.key === 'tab') {
      e.preventDefault();
      void handleResponse(showClearContext ? 'yes-accept-edits' : 'yes-accept-edits-keep-context');
      return;
    }
  };
  async function handleResponse(value: ResponseValue): Promise<void> {
    const trimmedFeedback = planFeedback.trim();
    const acceptFeedback = trimmedFeedback || undefined;

    
    
    
    if (value === 'ultraplan') {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: 'ultraplan' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant
      });
      onDone();
      onReject();
      toolUseConfirm.onReject('Plan being refined via Ultraplan — please wait for the result.');
      void launchUltraplan({
        blurb: '',
        seedPlan: currentPlan,
        getAppState: store.getState,
        setAppState: store.setState,
        signal: new AbortController().signal
      }).then(msg => enqueuePendingNotification({
        value: msg,
        mode: 'task-notification'
      })).catch(logError);
      return;
    }

    
    
    
    const updatedInput = isV2 && !planEditedLocally ? {} : {
      plan: currentPlan
    };

    
    
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const goingToAuto = (value === 'yes-resume-auto-mode' || value === 'yes-auto-clear-context') && isAutoModeGateEnabled();
      
      
      
      const autoWasUsedDuringPlan = autoModeStateModule?.isAutoModeActive() ?? false;
      if (value !== 'no' && !goingToAuto && autoWasUsedDuringPlan) {
        autoModeStateModule?.setAutoModeActive(false);
        setNeedsAutoModeExitAttachment(true);
        setAppState(prev => ({
          ...prev,
          toolPermissionContext: {
            ...restoreDangerousPermissions(prev.toolPermissionContext),
            prePlanMode: undefined
          }
        }));
      }
    }

    
    
    
    const isResumeAutoOption = feature('TRANSCRIPT_CLASSIFIER') ? value === 'yes-resume-auto-mode' : false;
    const isKeepContextOption = value === 'yes-accept-edits-keep-context' || value === 'yes-default-keep-context' || isResumeAutoOption;
    if (value !== 'no') {
      autoNameSessionFromPlan(currentPlan, setAppState, !isKeepContextOption);
    }
    if (value !== 'no' && !isKeepContextOption) {
      
      let mode: PermissionMode = 'default';
      if (value === 'yes-bypass-permissions') {
        mode = 'bypassPermissions';
      } else if (value === 'yes-accept-edits') {
        mode = 'acceptEdits';
      } else if (feature('TRANSCRIPT_CLASSIFIER') && value === 'yes-auto-clear-context' && isAutoModeGateEnabled()) {
        
        
        mode = 'auto';
        autoModeStateModule?.setAutoModeActive(true);
      }

      
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        clearContext: true,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });

      
      
      
      const verificationInstruction = undefined === 'true' ? `\n\nIMPORTANT: When you have finished implementing the plan, you MUST call the "VerifyPlanExecution" tool directly (NOT the ${AGENT_TOOL_NAME} tool or an agent) to trigger background verification.` : '';

      
      const transcriptPath = getTranscriptPath();
      const transcriptHint = `\n\nIf you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`;
      const teamHint = isAgentSwarmsEnabled() ? `\n\nIf this plan can be broken down into multiple independent tasks, consider using the ${TEAM_CREATE_TOOL_NAME} tool to create a team and parallelize the work.` : '';
      const feedbackSuffix = acceptFeedback ? `\n\nUser feedback on this plan: ${acceptFeedback}` : '';
      setAppState(prev => ({
        ...prev,
        initialMessage: {
          message: {
            ...createUserMessage({
              content: `Implement the following plan:\n\n${currentPlan}${verificationInstruction}${transcriptHint}${teamHint}${feedbackSuffix}`
            }),
            planContent: currentPlan
          },
          clearContext: true,
          mode,
          allowedPrompts
        }
      }));
      setHasExitedPlanMode(true);
      onDone();
      onReject();
      
      
      toolUseConfirm.onReject();
      return;
    }

    
    
    
    if (feature('TRANSCRIPT_CLASSIFIER') && value === 'yes-resume-auto-mode' && isAutoModeGateEnabled()) {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        clearContext: false,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });
      setHasExitedPlanMode(true);
      setNeedsPlanModeExitAttachment(true);
      autoModeStateModule?.setAutoModeActive(true);
      setAppState(prev => ({
        ...prev,
        toolPermissionContext: stripDangerousPermissionsForAutoMode({
          ...prev.toolPermissionContext,
          mode: 'auto',
          prePlanMode: undefined
        })
      }));
      onDone();
      toolUseConfirm.onAllow(updatedInput, [], acceptFeedback);
      return;
    }

    
    
    
    
    
    const keepContextModes: Record<string, PermissionMode> = {
      'yes-accept-edits-keep-context': toolPermissionContext.isBypassPermissionsModeAvailable ? 'bypassPermissions' : 'acceptEdits',
      'yes-default-keep-context': 'default',
      ...(feature('TRANSCRIPT_CLASSIFIER') ? {
        'yes-resume-auto-mode': 'default' as const
      } : {})
    };
    const keepContextMode = keepContextModes[value];
    if (keepContextMode) {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        clearContext: false,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });
      setHasExitedPlanMode(true);
      setNeedsPlanModeExitAttachment(true);
      onDone();
      toolUseConfirm.onAllow(updatedInput, buildPermissionUpdates(keepContextMode, allowedPrompts), acceptFeedback);
      return;
    }

    
    const standardModes: Record<string, PermissionMode> = {
      'yes-bypass-permissions': 'bypassPermissions',
      'yes-accept-edits': 'acceptEdits'
    };
    const standardMode = standardModes[value];
    if (standardMode) {
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant,
        hasFeedback: !!acceptFeedback
      });
      setHasExitedPlanMode(true);
      setNeedsPlanModeExitAttachment(true);
      onDone();
      toolUseConfirm.onAllow(updatedInput, buildPermissionUpdates(standardMode, allowedPrompts), acceptFeedback);
      return;
    }

    
    if (value === 'no') {
      if (!trimmedFeedback && !hasImages) {
        
        return;
      }
      logEvent('tengu_plan_exit', {
        planLengthChars: currentPlan.length,
        outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
        planStructureVariant
      });

      
      let imageBlocks: ImageBlockParam[] | undefined;
      if (hasImages) {
        imageBlocks = await Promise.all(imageAttachments.map(async img => {
          const block: ImageBlockParam = {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (img.mediaType || 'image/png') as Base64ImageSource['media_type'],
              data: img.content
            }
          };
          const resized = await maybeResizeAndDownsampleImageBlock(block);
          return resized.block;
        }));
      }
      onDone();
      onReject();
      toolUseConfirm.onReject(trimmedFeedback || (hasImages ? '(See attached image)' : undefined), imageBlocks && imageBlocks.length > 0 ? imageBlocks : undefined);
    }
  }
  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;

  
  
  
  
  
  
  const handleResponseRef = useRef(handleResponse);
  handleResponseRef.current = handleResponse;
  const handleCancelRef = useRef<() => void>(undefined);
  handleCancelRef.current = () => {
    logEvent('tengu_plan_exit', {
      planLengthChars: currentPlan.length,
      outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
      planStructureVariant
    });
    onDone();
    onReject();
    toolUseConfirm.onReject();
  };
  const useStickyFooter = !isEmpty && !!setStickyFooter;
  useLayoutEffect(() => {
    if (!useStickyFooter) return;
    setStickyFooter(<Box flexDirection="column" borderStyle="round" borderColor="planMode" borderLeft={false} borderRight={false} borderBottom={false} paddingX={1}>
        <Text dimColor>Would you like to proceed?</Text>
        <Box marginTop={1}>
          <Select options={options} onChange={v => void handleResponseRef.current(v)} onCancel={() => handleCancelRef.current?.()} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} />
        </Box>
        {editorName && <Box flexDirection="row" gap={1} marginTop={1}>
            <Text dimColor>ctrl-g to edit in </Text>
            <Text bold dimColor>
              {editorName}
            </Text>
            {isV2 && planFilePath && <Text dimColor> · {getDisplayPath(planFilePath)}</Text>}
            {showSaveMessage && <>
                <Text dimColor>{' · '}</Text>
                <Text color="success">{figures.tick}Plan saved!</Text>
              </>}
          </Box>}
      </Box>);
    return () => setStickyFooter(null);
    
    
  }, [useStickyFooter, setStickyFooter, options, pastedContents, editorName, isV2, planFilePath, showSaveMessage]);

  
  if (isEmpty) {
    function handleEmptyPlanResponse(value: 'yes' | 'no'): void {
      if (value === 'yes') {
        logEvent('tengu_plan_exit', {
          planLengthChars: 0,
          outcome: 'yes-default' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
          planStructureVariant
        });
        if (feature('TRANSCRIPT_CLASSIFIER')) {
          const autoWasUsedDuringPlan = autoModeStateModule?.isAutoModeActive() ?? false;
          if (autoWasUsedDuringPlan) {
            autoModeStateModule?.setAutoModeActive(false);
            setNeedsAutoModeExitAttachment(true);
            setAppState(prev => ({
              ...prev,
              toolPermissionContext: {
                ...restoreDangerousPermissions(prev.toolPermissionContext),
                prePlanMode: undefined
              }
            }));
          }
        }
        setHasExitedPlanMode(true);
        setNeedsPlanModeExitAttachment(true);
        onDone();
        toolUseConfirm.onAllow({}, [{
          type: 'setMode',
          mode: 'default',
          destination: 'session'
        }]);
      } else {
        logEvent('tengu_plan_exit', {
          planLengthChars: 0,
          outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
          planStructureVariant
        });
        onDone();
        onReject();
        toolUseConfirm.onReject();
      }
    }
    return <PermissionDialog color="planMode" title="Exit plan mode?" workerBadge={workerBadge}>
        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Text>Claude wants to exit plan mode</Text>
          <Box marginTop={1}>
            <Select options={[{
            label: 'Yes',
            value: 'yes' as const
          }, {
            label: 'No',
            value: 'no' as const
          }]} onChange={handleEmptyPlanResponse} onCancel={() => {
            logEvent('tengu_plan_exit', {
              planLengthChars: 0,
              outcome: 'no' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              interviewPhaseEnabled: isPlanModeInterviewPhaseEnabled(),
              planStructureVariant
            });
            onDone();
            onReject();
            toolUseConfirm.onReject();
          }} />
          </Box>
        </Box>
      </PermissionDialog>;
  }
  return <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <PermissionDialog color="planMode" title="Ready to code?" innerPaddingX={0} workerBadge={workerBadge}>
        <Box flexDirection="column" marginTop={1}>
          <Box paddingX={1} flexDirection="column">
            <Text>Here is Claude&apos;s plan:</Text>
          </Box>
          <Box borderColor="subtle" borderStyle="dashed" flexDirection="column" borderLeft={false} borderRight={false} paddingX={1} marginBottom={1}
        
        overflow="hidden">
            <Markdown>{currentPlan}</Markdown>
          </Box>
          <Box flexDirection="column" paddingX={1}>
            <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="tool" />
            {isClassifierPermissionsEnabled() && allowedPrompts && allowedPrompts.length > 0 && <Box flexDirection="column" marginBottom={1}>
                  <Text bold>Requested permissions:</Text>
                  {allowedPrompts.map((p, i) => <Text key={i} dimColor>
                      {'  '}· {p.tool}({PROMPT_PREFIX} {p.prompt})
                    </Text>)}
                </Box>}
            {!useStickyFooter && <>
                <Text dimColor>
                  Claude has written up a plan and is ready to execute. Would
                  you like to proceed?
                </Text>
                <Box marginTop={1}>
                  <Select options={options} onChange={handleResponse} onCancel={() => handleCancelRef.current?.()} onImagePaste={onImagePaste} pastedContents={pastedContents} onRemoveImage={onRemoveImage} />
                </Box>
              </>}
          </Box>
        </Box>
      </PermissionDialog>
      {!useStickyFooter && editorName && <Box flexDirection="row" gap={1} paddingX={1} marginTop={1}>
          <Box>
            <Text dimColor>ctrl-g to edit in </Text>
            <Text bold dimColor>
              {editorName}
            </Text>
            {isV2 && planFilePath && <Text dimColor> · {getDisplayPath(planFilePath)}</Text>}
          </Box>
          {showSaveMessage && <Box>
              <Text dimColor>{' · '}</Text>
              <Text color="success">{figures.tick}Plan saved!</Text>
            </Box>}
        </Box>}
    </Box>;
}

export function buildPlanApprovalOptions({
  showClearContext,
  showUltraplan,
  usedPercent,
  isAutoModeAvailable,
  isBypassPermissionsModeAvailable,
  onFeedbackChange
}: {
  showClearContext: boolean;
  showUltraplan: boolean;
  usedPercent: number | null;
  isAutoModeAvailable: boolean | undefined;
  isBypassPermissionsModeAvailable: boolean | undefined;
  onFeedbackChange: (v: string) => void;
}): OptionWithDescription<ResponseValue>[] {
  const options: OptionWithDescription<ResponseValue>[] = [];
  const usedLabel = usedPercent !== null ? ` (${usedPercent}% used)` : '';
  if (showClearContext) {
    if (feature('TRANSCRIPT_CLASSIFIER') && isAutoModeAvailable) {
      options.push({
        label: `Yes, clear context${usedLabel} and use auto mode`,
        value: 'yes-auto-clear-context'
      });
    } else if (isBypassPermissionsModeAvailable) {
      options.push({
        label: `Yes, clear context${usedLabel} and bypass permissions`,
        value: 'yes-bypass-permissions'
      });
    } else {
      options.push({
        label: `Yes, clear context${usedLabel} and auto-accept edits`,
        value: 'yes-accept-edits'
      });
    }
  }

  
  if (feature('TRANSCRIPT_CLASSIFIER') && isAutoModeAvailable) {
    options.push({
      label: 'Yes, and use auto mode',
      value: 'yes-resume-auto-mode'
    });
  } else if (isBypassPermissionsModeAvailable) {
    options.push({
      label: 'Yes, and bypass permissions',
      value: 'yes-accept-edits-keep-context'
    });
  } else {
    options.push({
      label: 'Yes, auto-accept edits',
      value: 'yes-accept-edits-keep-context'
    });
  }
  options.push({
    label: 'Yes, manually approve edits',
    value: 'yes-default-keep-context'
  });
  if (showUltraplan) {
    options.push({
      label: 'No, refine with Ultraplan on Claude Code Next on the web',
      value: 'ultraplan'
    });
  }
  options.push({
    type: 'input',
    label: 'No, keep planning',
    value: 'no',
    placeholder: 'Tell Claude what to change',
    description: 'shift+tab to approve with this feedback',
    onChange: onFeedbackChange
  });
  return options;
}
function getContextUsedPercent(usage: {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
} | undefined, permissionMode: PermissionMode): number | null {
  if (!usage) return null;
  const runtimeModel = getRuntimeMainLoopModel({
    permissionMode,
    mainLoopModel: getMainLoopModel(),
    exceeds200kTokens: false
  });
  const contextWindowSize = getContextWindowForModel(runtimeModel, getSdkBetas());
  const {
    used
  } = calculateContextPercentages({
    input_tokens: usage.input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0
  }, contextWindowSize);
  return used;
}
