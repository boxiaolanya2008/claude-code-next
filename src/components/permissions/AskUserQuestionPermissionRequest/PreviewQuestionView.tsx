import figures from 'figures';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import type { KeyboardEvent } from '../../../ink/events/keyboard-event.js';
import { Box, Text } from '../../../ink.js';
import { useKeybinding, useKeybindings } from '../../../keybindings/useKeybinding.js';
import { useAppState } from '../../../state/AppState.js';
import type { Question } from '../../../tools/AskUserQuestionTool/AskUserQuestionTool.js';
import { getExternalEditor } from '../../../utils/editor.js';
import { toIDEDisplayName } from '../../../utils/ide.js';
import { editPromptInEditor } from '../../../utils/promptEditor.js';
import { Divider } from '../../design-system/Divider.js';
import TextInput from '../../TextInput.js';
import { PermissionRequestTitle } from '../PermissionRequestTitle.js';
import { PreviewBox } from './PreviewBox.js';
import { QuestionNavigationBar } from './QuestionNavigationBar.js';
import type { QuestionState } from './use-multiple-choice-state.js';
type Props = {
  question: Question;
  questions: Question[];
  currentQuestionIndex: number;
  answers: Record<string, string>;
  questionStates: Record<string, QuestionState>;
  hideSubmitTab?: boolean;
  minContentHeight?: number;
  minContentWidth?: number;
  onUpdateQuestionState: (questionText: string, updates: Partial<QuestionState>, isMultiSelect: boolean) => void;
  onAnswer: (questionText: string, label: string | string[], textInput?: string, shouldAdvance?: boolean) => void;
  onTextInputFocus: (isInInput: boolean) => void;
  onCancel: () => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onRespondToClaude: () => void;
  onFinishPlanInterview: () => void;
};

export function PreviewQuestionView({
  question,
  questions,
  currentQuestionIndex,
  answers,
  questionStates,
  hideSubmitTab = false,
  minContentHeight,
  minContentWidth,
  onUpdateQuestionState,
  onAnswer,
  onTextInputFocus,
  onCancel,
  onTabPrev,
  onTabNext,
  onRespondToClaude,
  onFinishPlanInterview
}: Props): React.ReactNode {
  const isInPlanMode = useAppState(s => s.toolPermissionContext.mode) === 'plan';
  const [isFooterFocused, setIsFooterFocused] = useState(false);
  const [footerIndex, setFooterIndex] = useState(0);
  const [isInNotesInput, setIsInNotesInput] = useState(false);
  const [cursorOffset, setCursorOffset] = useState(0);
  const editor = getExternalEditor();
  const editorName = editor ? toIDEDisplayName(editor) : null;
  const questionText = question.question;
  const questionState = questionStates[questionText];

  
  const allOptions = question.options;

  
  const [focusedIndex, setFocusedIndex] = useState(0);

  
  const prevQuestionText = useRef(questionText);
  if (prevQuestionText.current !== questionText) {
    prevQuestionText.current = questionText;
    const selected = questionState?.selectedValue as string | undefined;
    const idx = selected ? allOptions.findIndex(opt => opt.label === selected) : -1;
    setFocusedIndex(idx >= 0 ? idx : 0);
  }
  const focusedOption = allOptions[focusedIndex];
  const selectedValue = questionState?.selectedValue as string | undefined;
  const notesValue = questionState?.textInputValue || '';
  const handleSelectOption = useCallback((index: number) => {
    const option = allOptions[index];
    if (!option) return;
    setFocusedIndex(index);
    onUpdateQuestionState(questionText, {
      selectedValue: option.label
    }, false);
    onAnswer(questionText, option.label);
  }, [allOptions, questionText, onUpdateQuestionState, onAnswer]);
  const handleNavigate = useCallback((direction: 'up' | 'down' | number) => {
    if (isInNotesInput) return;
    let newIndex: number;
    if (typeof direction === 'number') {
      newIndex = direction;
    } else if (direction === 'up') {
      newIndex = focusedIndex > 0 ? focusedIndex - 1 : focusedIndex;
    } else {
      newIndex = focusedIndex < allOptions.length - 1 ? focusedIndex + 1 : focusedIndex;
    }
    if (newIndex >= 0 && newIndex < allOptions.length) {
      setFocusedIndex(newIndex);
    }
  }, [focusedIndex, allOptions.length, isInNotesInput]);

  
  useKeybinding('chat:externalEditor', async () => {
    const currentValue = questionState?.textInputValue || '';
    const result = await editPromptInEditor(currentValue);
    if (result.content !== null && result.content !== currentValue) {
      onUpdateQuestionState(questionText, {
        textInputValue: result.content
      }, false);
    }
  }, {
    context: 'Chat',
    isActive: isInNotesInput && !!editor
  });

  
  
  
  
  
  useKeybindings({
    'tabs:previous': () => onTabPrev?.(),
    'tabs:next': () => onTabNext?.()
  }, {
    context: 'Tabs',
    isActive: !isInNotesInput && !isFooterFocused
  });

  
  
  const handleNotesExit = useCallback(() => {
    setIsInNotesInput(false);
    onTextInputFocus(false);
    if (selectedValue) {
      onAnswer(questionText, selectedValue);
    }
  }, [selectedValue, questionText, onAnswer, onTextInputFocus]);
  const handleDownFromPreview = useCallback(() => {
    setIsFooterFocused(true);
  }, []);
  const handleUpFromFooter = useCallback(() => {
    setIsFooterFocused(false);
  }, []);

  
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isFooterFocused) {
      if (e.key === 'up' || e.ctrl && e.key === 'p') {
        e.preventDefault();
        if (footerIndex === 0) {
          handleUpFromFooter();
        } else {
          setFooterIndex(0);
        }
        return;
      }
      if (e.key === 'down' || e.ctrl && e.key === 'n') {
        e.preventDefault();
        if (isInPlanMode && footerIndex === 0) {
          setFooterIndex(1);
        }
        return;
      }
      if (e.key === 'return') {
        e.preventDefault();
        if (footerIndex === 0) {
          onRespondToClaude();
        } else {
          onFinishPlanInterview();
        }
        return;
      }
      if (e.key === 'escape') {
        e.preventDefault();
        onCancel();
      }
      return;
    }
    if (isInNotesInput) {
      
      if (e.key === 'escape') {
        e.preventDefault();
        handleNotesExit();
      }
      return;
    }

    
    if (e.key === 'up' || e.ctrl && e.key === 'p') {
      e.preventDefault();
      if (focusedIndex > 0) {
        handleNavigate('up');
      }
    } else if (e.key === 'down' || e.ctrl && e.key === 'n') {
      e.preventDefault();
      if (focusedIndex === allOptions.length - 1) {
        
        handleDownFromPreview();
      } else {
        handleNavigate('down');
      }
    } else if (e.key === 'return') {
      e.preventDefault();
      handleSelectOption(focusedIndex);
    } else if (e.key === 'n' && !e.ctrl && !e.meta) {
      
      e.preventDefault();
      setIsInNotesInput(true);
      onTextInputFocus(true);
    } else if (e.key === 'escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key.length === 1 && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx_0 = parseInt(e.key, 10) - 1;
      if (idx_0 < allOptions.length) {
        handleNavigate(idx_0);
      }
    }
  }, [isFooterFocused, footerIndex, isInPlanMode, isInNotesInput, focusedIndex, allOptions.length, handleUpFromFooter, handleDownFromPreview, handleNavigate, handleSelectOption, handleNotesExit, onRespondToClaude, onFinishPlanInterview, onCancel, onTextInputFocus]);
  const previewContent = focusedOption?.preview || null;

  
  const LEFT_PANEL_WIDTH = 30;
  const GAP = 4;
  const {
    columns
  } = useTerminalSize();
  const previewMaxWidth = columns - LEFT_PANEL_WIDTH - GAP;

  
  
  
  
  
  
  
  
  const PREVIEW_OVERHEAD = 11;

  
  
  
  
  const previewMaxLines = useMemo(() => {
    return minContentHeight ? Math.max(1, minContentHeight - PREVIEW_OVERHEAD) : undefined;
  }, [minContentHeight]);
  return <Box flexDirection="column" marginTop={1} tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Divider color="inactive" />
      <Box flexDirection="column" paddingTop={0}>
        <QuestionNavigationBar questions={questions} currentQuestionIndex={currentQuestionIndex} answers={answers} hideSubmitTab={hideSubmitTab} />
        <PermissionRequestTitle title={question.question} color={'text'} />

        <Box flexDirection="column" minHeight={minContentHeight}>
          {}
          <Box marginTop={1} flexDirection="row" gap={4}>
            {}
            <Box flexDirection="column" width={30}>
              {allOptions.map((option_0, index_0) => {
              const isFocused = focusedIndex === index_0;
              const isSelected = selectedValue === option_0.label;
              return <Box key={option_0.label} flexDirection="row">
                    {isFocused ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                    <Text dimColor> {index_0 + 1}.</Text>
                    <Text color={isSelected ? 'success' : isFocused ? 'suggestion' : undefined} bold={isFocused}>
                      {' '}
                      {option_0.label}
                    </Text>
                    {isSelected && <Text color="success"> {figures.tick}</Text>}
                  </Box>;
            })}
            </Box>

            {}
            <Box flexDirection="column" flexGrow={1}>
              <PreviewBox content={previewContent || 'No preview available'} maxLines={previewMaxLines} minWidth={minContentWidth} maxWidth={previewMaxWidth} />
              <Box marginTop={1} flexDirection="row" gap={1}>
                <Text color="suggestion">Notes:</Text>
                {isInNotesInput ? <TextInput value={notesValue} placeholder="Add notes on this design…" onChange={value => {
                onUpdateQuestionState(questionText, {
                  textInputValue: value
                }, false);
              }} onSubmit={handleNotesExit} onExit={handleNotesExit} focus={true} showCursor={true} columns={60} cursorOffset={cursorOffset} onChangeCursorOffset={setCursorOffset} /> : <Text dimColor italic>
                    {notesValue || 'press n to add notes'}
                  </Text>}
              </Box>
            </Box>
          </Box>

          {}
          <Box flexDirection="column" marginTop={1}>
            <Divider color="inactive" />
            <Box flexDirection="row" gap={1}>
              {isFooterFocused && footerIndex === 0 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
              <Text color={isFooterFocused && footerIndex === 0 ? 'suggestion' : undefined}>
                Chat about this
              </Text>
            </Box>
            {isInPlanMode && <Box flexDirection="row" gap={1}>
                {isFooterFocused && footerIndex === 1 ? <Text color="suggestion">{figures.pointer}</Text> : <Text> </Text>}
                <Text color={isFooterFocused && footerIndex === 1 ? 'suggestion' : undefined}>
                  Skip interview and plan immediately
                </Text>
              </Box>}
          </Box>
          <Box marginTop={1}>
            <Text color="inactive" dimColor>
              Enter to select · {figures.arrowUp}/{figures.arrowDown} to
              navigate · n to add notes
              {questions.length > 1 && <> · Tab to switch questions</>}
              {isInNotesInput && editorName && <> · ctrl+g to edit in {editorName}</>}{' '}
              · Esc to cancel
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>;
}
