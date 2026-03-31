import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useTheme } from '../../../ink.js';
import { useKeybinding } from '../../../keybindings/useKeybinding.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../../services/analytics/index.js';
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js';
import { getDestructiveCommandWarning } from '../../../tools/PowerShellTool/destructiveCommandWarning.js';
import { PowerShellTool } from '../../../tools/PowerShellTool/PowerShellTool.js';
import { isAllowlistedCommand } from '../../../tools/PowerShellTool/readOnlyValidation.js';
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js';
import { getCompoundCommandPrefixesStatic } from '../../../utils/powershell/staticPrefix.js';
import { Select } from '../../CustomSelect/select.js';
import { type UnaryEvent, usePermissionRequestLogging } from '../hooks.js';
import { PermissionDecisionDebugInfo } from '../PermissionDecisionDebugInfo.js';
import { PermissionDialog } from '../PermissionDialog.js';
import { PermissionExplainerContent, usePermissionExplainerUI } from '../PermissionExplanation.js';
import type { PermissionRequestProps } from '../PermissionRequest.js';
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js';
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js';
import { logUnaryPermissionEvent } from '../utils.js';
import { powershellToolUseOptions } from './powershellToolUseOptions.js';
export function PowerShellPermissionRequest(props: PermissionRequestProps): React.ReactNode {
  const {
    toolUseConfirm,
    toolUseContext,
    onDone,
    onReject,
    workerBadge
  } = props;
  const {
    command,
    description
  } = PowerShellTool.inputSchema.parse(toolUseConfirm.input);
  const [theme] = useTheme();
  const explainerState = usePermissionExplainerUI({
    toolName: toolUseConfirm.tool.name,
    toolInput: toolUseConfirm.input,
    toolDescription: toolUseConfirm.description,
    messages: toolUseContext.messages
  });
  const {
    yesInputMode,
    noInputMode,
    yesFeedbackModeEntered,
    noFeedbackModeEntered,
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    focusedOption,
    handleInputModeToggle,
    handleReject,
    handleFocus
  } = useShellPermissionFeedback({
    toolUseConfirm,
    onDone,
    onReject,
    explainerVisible: explainerState.visible
  });
  const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE('tengu_destructive_command_warning', false) ? getDestructiveCommandWarning(command) : null;
  const [showPermissionDebug, setShowPermissionDebug] = useState(false);

  
  
  
  
  
  
  
  
  
  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(command.includes('\n') ? undefined : command);
  const hasUserEditedPrefix = useRef(false);
  useEffect(() => {
    let cancelled = false;
    
    
    
    
    getCompoundCommandPrefixesStatic(command, element => isAllowlistedCommand(element, element.text)).then(prefixes => {
      if (cancelled || hasUserEditedPrefix.current) return;
      if (prefixes.length > 0) {
        setEditablePrefix(`${prefixes[0]}:*`);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
    
  }, [command]);
  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true;
    setEditablePrefix(value);
  }, []);
  const unaryEvent = useMemo<UnaryEvent>(() => ({
    completion_type: 'tool_use_single',
    language_name: 'none'
  }), []);
  usePermissionRequestLogging(toolUseConfirm, unaryEvent);
  const options = useMemo(() => powershellToolUseOptions({
    suggestions: toolUseConfirm.permissionResult.behavior === 'ask' ? toolUseConfirm.permissionResult.suggestions : undefined,
    onRejectFeedbackChange: setRejectFeedback,
    onAcceptFeedbackChange: setAcceptFeedback,
    yesInputMode,
    noInputMode,
    editablePrefix,
    onEditablePrefixChange
  }), [toolUseConfirm, yesInputMode, noInputMode, editablePrefix, onEditablePrefixChange]);

  
  const handleToggleDebug = useCallback(() => {
    setShowPermissionDebug(prev => !prev);
  }, []);
  useKeybinding('permission:toggleDebug', handleToggleDebug, {
    context: 'Confirmation'
  });
  function onSelect(value: string) {
    
    const optionIndex: Record<string, number> = {
      yes: 1,
      'yes-apply-suggestions': 2,
      'yes-prefix-edited': 2,
      no: 3
    };
    logEvent('tengu_permission_request_option_selected', {
      option_index: optionIndex[value],
      explainer_visible: explainerState.visible
    });
    const toolNameForAnalytics = sanitizeToolNameForAnalytics(toolUseConfirm.tool.name) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    if (value === 'yes-prefix-edited') {
      const trimmedPrefix = (editablePrefix ?? '').trim();
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
      if (!trimmedPrefix) {
        toolUseConfirm.onAllow(toolUseConfirm.input, []);
      } else {
        const prefixUpdates: PermissionUpdate[] = [{
          type: 'addRules',
          rules: [{
            toolName: PowerShellTool.name,
            ruleContent: trimmedPrefix
          }],
          behavior: 'allow',
          destination: 'localSettings'
        }];
        toolUseConfirm.onAllow(toolUseConfirm.input, prefixUpdates);
      }
      onDone();
      return;
    }
    switch (value) {
      case 'yes':
        {
          const trimmedFeedback = acceptFeedback.trim();
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          
          logEvent('tengu_accept_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback,
            instructions_length: trimmedFeedback.length,
            entered_feedback_mode: yesFeedbackModeEntered
          });
          toolUseConfirm.onAllow(toolUseConfirm.input, [], trimmedFeedback || undefined);
          onDone();
          break;
        }
      case 'yes-apply-suggestions':
        {
          logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept');
          
          const permissionUpdates = 'suggestions' in toolUseConfirm.permissionResult ? toolUseConfirm.permissionResult.suggestions || [] : [];
          toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates);
          onDone();
          break;
        }
      case 'no':
        {
          const trimmedFeedback = rejectFeedback.trim();

          
          logEvent('tengu_reject_submitted', {
            toolName: toolNameForAnalytics,
            isMcp: toolUseConfirm.tool.isMcp ?? false,
            has_instructions: !!trimmedFeedback,
            instructions_length: trimmedFeedback.length,
            entered_feedback_mode: noFeedbackModeEntered
          });

          
          handleReject(trimmedFeedback || undefined);
          break;
        }
    }
  }
  return <PermissionDialog workerBadge={workerBadge} title="PowerShell command">
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor={explainerState.visible}>
          {PowerShellTool.renderToolUseMessage({
          command,
          description
        }, {
          theme,
          verbose: true
        } 
        )}
        </Text>
        {!explainerState.visible && <Text dimColor>{toolUseConfirm.description}</Text>}
        <PermissionExplainerContent visible={explainerState.visible} promise={explainerState.promise} />
      </Box>
      {showPermissionDebug ? <>
          <PermissionDecisionDebugInfo permissionResult={toolUseConfirm.permissionResult} toolName="PowerShell" />
          {toolUseContext.options.debug && <Box justifyContent="flex-end" marginTop={1}>
              <Text dimColor>Ctrl-D to hide debug info</Text>
            </Box>}
        </> : <>
          <Box flexDirection="column">
            <PermissionRuleExplanation permissionResult={toolUseConfirm.permissionResult} toolType="command" />
            {destructiveWarning && <Box marginBottom={1}>
                <Text color="warning">{destructiveWarning}</Text>
              </Box>}
            <Text>Do you want to proceed?</Text>
            <Select options={options} inlineDescriptions onChange={onSelect} onCancel={() => handleReject()} onFocus={handleFocus} onInputModeToggle={handleInputModeToggle} />
          </Box>
          <Box justifyContent="space-between" marginTop={1}>
            <Text dimColor>
              Esc to cancel
              {(focusedOption === 'yes' && !yesInputMode || focusedOption === 'no' && !noInputMode) && ' · Tab to amend'}
              {explainerState.enabled && ` · ctrl+e to ${explainerState.visible ? 'hide' : 'explain'}`}
            </Text>
            {toolUseContext.options.debug && <Text dimColor>Ctrl+d to show debug info</Text>}
          </Box>
        </>}
    </PermissionDialog>;
}
