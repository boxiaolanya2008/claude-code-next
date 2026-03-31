import { feature } from "../utils/bundle-mock.ts";
import chalk from 'chalk';
import React, { useMemo, useRef } from 'react';
import { useVoiceState } from '../context/voice.js';
import { useClipboardImageHint } from '../hooks/useClipboardImageHint.js';
import { useSettings } from '../hooks/useSettings.js';
import { useTextInput } from '../hooks/useTextInput.js';
import { Box, color, useAnimationFrame, useTerminalFocus, useTheme } from '../ink.js';
import type { BaseTextInputProps } from '../types/textInputTypes.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { BaseTextInput } from './BaseTextInput.js';
import { hueToRgb } from './Spinner/utils.js';

const BARS = ' \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';

const CURSOR_WAVEFORM_WIDTH = 1;

const SMOOTH = 0.7;

const LEVEL_BOOST = 1.8;

const SILENCE_THRESHOLD = 0.15;
export type Props = BaseTextInputProps & {
  highlights?: TextHighlight[];
};
export default function TextInput(props: Props): React.ReactNode {
  const [theme] = useTheme();
  const isTerminalFocused = useTerminalFocus();
  
  const accessibilityEnabled = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_NEXT_ACCESSIBILITY), []);
  const settings = useSettings();
  const reducedMotion = settings.prefersReducedMotion ?? false;
  const voiceState = feature('VOICE_MODE') ?
  
  useVoiceState(s => s.voiceState) : 'idle' as const;
  const isVoiceRecording = voiceState === 'recording';
  const audioLevels = feature('VOICE_MODE') ?
  
  useVoiceState(s_0 => s_0.voiceAudioLevels) : [];
  const smoothedRef = useRef<number[]>(new Array(CURSOR_WAVEFORM_WIDTH).fill(0));
  const needsAnimation = isVoiceRecording && !reducedMotion;
  const [animRef, animTime] = feature('VOICE_MODE') ?
  
  useAnimationFrame(needsAnimation ? 50 : null) : [() => {}, 0];

  
  useClipboardImageHint(isTerminalFocused, !!props.onImagePaste);

  
  
  
  
  
  const canShowCursor = isTerminalFocused && !accessibilityEnabled;
  let invert: (text: string) => string;
  if (!canShowCursor) {
    invert = (text: string) => text;
  } else if (isVoiceRecording && !reducedMotion) {
    
    const smoothed = smoothedRef.current;
    const raw = audioLevels.length > 0 ? audioLevels[audioLevels.length - 1] ?? 0 : 0;
    const target = Math.min(raw * LEVEL_BOOST, 1);
    smoothed[0] = (smoothed[0] ?? 0) * SMOOTH + target * (1 - SMOOTH);
    const displayLevel = smoothed[0] ?? 0;
    const barIndex = Math.max(1, Math.min(Math.round(displayLevel * (BARS.length - 1)), BARS.length - 1));
    const isSilent = raw < SILENCE_THRESHOLD;
    const hue = animTime / 1000 * 90 % 360;
    const {
      r,
      g,
      b
    } = isSilent ? {
      r: 128,
      g: 128,
      b: 128
    } : hueToRgb(hue);
    invert = () => chalk.rgb(r, g, b)(BARS[barIndex]!);
  } else {
    invert = chalk.inverse;
  }
  const textInputState = useTextInput({
    value: props.value,
    onChange: props.onChange,
    onSubmit: props.onSubmit,
    onExit: props.onExit,
    onExitMessage: props.onExitMessage,
    onHistoryReset: props.onHistoryReset,
    onHistoryUp: props.onHistoryUp,
    onHistoryDown: props.onHistoryDown,
    onClearInput: props.onClearInput,
    focus: props.focus,
    mask: props.mask,
    multiline: props.multiline,
    cursorChar: props.showCursor ? ' ' : '',
    highlightPastedText: props.highlightPastedText,
    invert,
    themeText: color('text', theme),
    columns: props.columns,
    maxVisibleLines: props.maxVisibleLines,
    onImagePaste: props.onImagePaste,
    disableCursorMovementForUpDownKeys: props.disableCursorMovementForUpDownKeys,
    disableEscapeDoublePress: props.disableEscapeDoublePress,
    externalOffset: props.cursorOffset,
    onOffsetChange: props.onChangeCursorOffset,
    inputFilter: props.inputFilter,
    inlineGhostText: props.inlineGhostText,
    dim: chalk.dim
  });
  return <Box ref={animRef}>
      <BaseTextInput inputState={textInputState} terminalFocus={isTerminalFocused} highlights={props.highlights} invert={invert} hidePlaceholderText={isVoiceRecording} {...props} />
    </Box>;
}
