import { feature } from 'bun:bundle';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNotifications } from '../context/notifications.js';
import { useIsModalOverlayActive } from '../context/overlayContext.js';
import { useGetVoiceState, useSetVoiceState, useVoiceState } from '../context/voice.js';
import { KeyboardEvent } from '../ink/events/keyboard-event.js';

import { useInput } from '../ink.js';
import { useOptionalKeybindingContext } from '../keybindings/KeybindingContext.js';
import { keystrokesEqual } from '../keybindings/resolver.js';
import type { ParsedKeystroke } from '../keybindings/types.js';
import { normalizeFullWidthSpace } from '../utils/stringUtils.js';
import { useVoiceEnabled } from './useVoiceEnabled.js';

const voiceNs: {
  useVoice: typeof import('./useVoice.js').useVoice;
} = feature('VOICE_MODE') ? require('./useVoice.js') : {
  useVoice: ({
    enabled: _e
  }: {
    onTranscript: (t: string) => void;
    enabled: boolean;
  }) => ({
    state: 'idle' as const,
    handleKeyEvent: (_fallbackMs?: number) => {}
  })
};

const RAPID_KEY_GAP_MS = 120;

const MODIFIER_FIRST_PRESS_FALLBACK_MS = 2000;

const HOLD_THRESHOLD = 5;

const WARMUP_THRESHOLD = 2;

function matchesKeyboardEvent(e: KeyboardEvent, target: ParsedKeystroke): boolean {
  
  
  const key = e.key === 'space' ? ' ' : e.key === 'return' ? 'enter' : e.key.toLowerCase();
  if (key !== target.key) return false;
  if (e.ctrl !== target.ctrl) return false;
  if (e.shift !== target.shift) return false;
  
  
  if (e.meta !== (target.alt || target.meta)) return false;
  if (e.superKey !== target.super) return false;
  return true;
}

const DEFAULT_VOICE_KEYSTROKE: ParsedKeystroke = {
  key: ' ',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  super: false
};
type InsertTextHandle = {
  insert: (text: string) => void;
  setInputWithCursor: (value: string, cursor: number) => void;
  cursorOffset: number;
};
type UseVoiceIntegrationArgs = {
  setInputValueRaw: React.Dispatch<React.SetStateAction<string>>;
  inputValueRef: React.RefObject<string>;
  insertTextRef: React.RefObject<InsertTextHandle | null>;
};
type InterimRange = {
  start: number;
  end: number;
};
type StripOpts = {
  
  char?: string;
  
  anchor?: boolean;
  
  
  floor?: number;
};
type UseVoiceIntegrationResult = {
  
  stripTrailing: (maxStrip: number, opts?: StripOpts) => number;
  
  resetAnchor: () => void;
  handleKeyEvent: (fallbackMs?: number) => void;
  interimRange: InterimRange | null;
};
export function useVoiceIntegration({
  setInputValueRaw,
  inputValueRef,
  insertTextRef
}: UseVoiceIntegrationArgs): UseVoiceIntegrationResult {
  const {
    addNotification
  } = useNotifications();

  
  
  
  const voicePrefixRef = useRef<string | null>(null);
  const voiceSuffixRef = useRef<string>('');
  
  
  
  
  
  
  const lastSetInputRef = useRef<string | null>(null);

  
  
  
  
  
  
  
  
  
  
  
  
  const stripTrailing = useCallback((maxStrip: number, {
    char = ' ',
    anchor = false,
    floor = 0
  }: StripOpts = {}) => {
    const prev = inputValueRef.current;
    const offset = insertTextRef.current?.cursorOffset ?? prev.length;
    const beforeCursor = prev.slice(0, offset);
    const afterCursor = prev.slice(offset);
    
    
    
    const scan = char === ' ' ? normalizeFullWidthSpace(beforeCursor) : beforeCursor;
    let trailing = 0;
    while (trailing < scan.length && scan[scan.length - 1 - trailing] === char) {
      trailing++;
    }
    const stripCount = Math.max(0, Math.min(trailing - floor, maxStrip));
    const remaining = trailing - stripCount;
    const stripped = beforeCursor.slice(0, beforeCursor.length - stripCount);
    
    
    
    
    
    
    
    
    
    let gap = '';
    if (anchor) {
      voicePrefixRef.current = stripped;
      voiceSuffixRef.current = afterCursor;
      if (afterCursor.length > 0 && !/^\s/.test(afterCursor)) {
        gap = ' ';
      }
    }
    const newValue = stripped + gap + afterCursor;
    if (anchor) lastSetInputRef.current = newValue;
    if (newValue === prev && stripCount === 0) return remaining;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newValue, stripped.length);
    } else {
      setInputValueRaw(newValue);
    }
    return remaining;
  }, [setInputValueRaw, inputValueRef, insertTextRef]);

  
  
  
  
  
  
  const resetAnchor = useCallback(() => {
    const prefix = voicePrefixRef.current;
    if (prefix === null) return;
    const suffix = voiceSuffixRef.current;
    voicePrefixRef.current = null;
    voiceSuffixRef.current = '';
    const restored = prefix + suffix;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(restored, prefix.length);
    } else {
      setInputValueRaw(restored);
    }
  }, [setInputValueRaw, insertTextRef]);

  
  
  
  
  const voiceEnabled = feature('VOICE_MODE') ? useVoiceEnabled() : false;
  const voiceState = feature('VOICE_MODE') ?
  
  useVoiceState(s => s.voiceState) : 'idle' as const;
  const voiceInterimTranscript = feature('VOICE_MODE') ?
  
  useVoiceState(s_0 => s_0.voiceInterimTranscript) : '';

  
  
  useEffect(() => {
    if (!feature('VOICE_MODE')) return;
    if (voiceState === 'recording' && voicePrefixRef.current === null) {
      const input = inputValueRef.current;
      const offset_0 = insertTextRef.current?.cursorOffset ?? input.length;
      voicePrefixRef.current = input.slice(0, offset_0);
      voiceSuffixRef.current = input.slice(offset_0);
      lastSetInputRef.current = input;
    }
    if (voiceState === 'idle') {
      voicePrefixRef.current = null;
      voiceSuffixRef.current = '';
      lastSetInputRef.current = null;
    }
  }, [voiceState, inputValueRef, insertTextRef]);

  
  
  
  useEffect(() => {
    if (!feature('VOICE_MODE')) return;
    if (voicePrefixRef.current === null) return;
    const prefix_0 = voicePrefixRef.current;
    const suffix_0 = voiceSuffixRef.current;
    
    
    
    
    
    if (inputValueRef.current !== lastSetInputRef.current) return;
    const needsSpace = prefix_0.length > 0 && !/\s$/.test(prefix_0) && voiceInterimTranscript.length > 0;
    
    
    
    const needsTrailingSpace = suffix_0.length > 0 && !/^\s/.test(suffix_0);
    const leadingSpace = needsSpace ? ' ' : '';
    const trailingSpace = needsTrailingSpace ? ' ' : '';
    const newValue_0 = prefix_0 + leadingSpace + voiceInterimTranscript + trailingSpace + suffix_0;
    
    const cursorPos = prefix_0.length + leadingSpace.length + voiceInterimTranscript.length;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newValue_0, cursorPos);
    } else {
      setInputValueRaw(newValue_0);
    }
    lastSetInputRef.current = newValue_0;
  }, [voiceInterimTranscript, setInputValueRaw, inputValueRef, insertTextRef]);
  const handleVoiceTranscript = useCallback((text: string) => {
    if (!feature('VOICE_MODE')) return;
    const prefix_1 = voicePrefixRef.current;
    
    if (prefix_1 === null) return;
    const suffix_1 = voiceSuffixRef.current;
    
    
    
    
    
    
    if (inputValueRef.current !== lastSetInputRef.current) return;
    const needsSpace_0 = prefix_1.length > 0 && !/\s$/.test(prefix_1) && text.length > 0;
    const needsTrailingSpace_0 = suffix_1.length > 0 && !/^\s/.test(suffix_1) && text.length > 0;
    const leadingSpace_0 = needsSpace_0 ? ' ' : '';
    const trailingSpace_0 = needsTrailingSpace_0 ? ' ' : '';
    const newInput = prefix_1 + leadingSpace_0 + text + trailingSpace_0 + suffix_1;
    
    const cursorPos_0 = prefix_1.length + leadingSpace_0.length + text.length;
    if (insertTextRef.current) {
      insertTextRef.current.setInputWithCursor(newInput, cursorPos_0);
    } else {
      setInputValueRaw(newInput);
    }
    lastSetInputRef.current = newInput;
    
    
    voicePrefixRef.current = prefix_1 + leadingSpace_0 + text;
  }, [setInputValueRaw, inputValueRef, insertTextRef]);
  const voice = voiceNs.useVoice({
    onTranscript: handleVoiceTranscript,
    onError: (message: string) => {
      addNotification({
        key: 'voice-error',
        text: message,
        color: 'error',
        priority: 'immediate',
        timeoutMs: 10_000
      });
    },
    enabled: voiceEnabled,
    focusMode: false
  });

  
  
  const interimRange = useMemo((): InterimRange | null => {
    if (!feature('VOICE_MODE')) return null;
    if (voicePrefixRef.current === null) return null;
    if (voiceInterimTranscript.length === 0) return null;
    const prefix_2 = voicePrefixRef.current;
    const needsSpace_1 = prefix_2.length > 0 && !/\s$/.test(prefix_2) && voiceInterimTranscript.length > 0;
    const start = prefix_2.length + (needsSpace_1 ? 1 : 0);
    const end = start + voiceInterimTranscript.length;
    return {
      start,
      end
    };
  }, [voiceInterimTranscript]);
  return {
    stripTrailing,
    resetAnchor,
    handleKeyEvent: voice.handleKeyEvent,
    interimRange
  };
}

export function useVoiceKeybindingHandler({
  voiceHandleKeyEvent,
  stripTrailing,
  resetAnchor,
  isActive
}: {
  voiceHandleKeyEvent: (fallbackMs?: number) => void;
  stripTrailing: (maxStrip: number, opts?: StripOpts) => number;
  resetAnchor: () => void;
  isActive: boolean;
}): {
  handleKeyDown: (e: KeyboardEvent) => void;
} {
  const getVoiceState = useGetVoiceState();
  const setVoiceState = useSetVoiceState();
  const keybindingContext = useOptionalKeybindingContext();
  const isModalOverlayActive = useIsModalOverlayActive();
  
  const voiceEnabled = feature('VOICE_MODE') ? useVoiceEnabled() : false;
  const voiceState = feature('VOICE_MODE') ?
  
  useVoiceState(s => s.voiceState) : 'idle';

  
  
  
  
  
  
  
  
  
  const voiceKeystroke = useMemo((): ParsedKeystroke | null => {
    if (!keybindingContext) return DEFAULT_VOICE_KEYSTROKE;
    let result: ParsedKeystroke | null = null;
    for (const binding of keybindingContext.bindings) {
      if (binding.context !== 'Chat') continue;
      if (binding.chord.length !== 1) continue;
      const ks = binding.chord[0];
      if (!ks) continue;
      if (binding.action === 'voice:pushToTalk') {
        result = ks;
      } else if (result !== null && keystrokesEqual(ks, result)) {
        
        result = null;
      }
    }
    return result;
  }, [keybindingContext]);

  
  
  
  
  
  
  const bareChar = voiceKeystroke !== null && voiceKeystroke.key.length === 1 && !voiceKeystroke.ctrl && !voiceKeystroke.alt && !voiceKeystroke.shift && !voiceKeystroke.meta && !voiceKeystroke.super ? voiceKeystroke.key : null;
  const rapidCountRef = useRef(0);
  
  
  
  
  
  
  
  
  const charsInInputRef = useRef(0);
  
  
  
  const recordingFloorRef = useRef(0);
  
  
  const isHoldActiveRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  
  
  
  
  useEffect(() => {
    if (voiceState !== 'recording') {
      isHoldActiveRef.current = false;
      rapidCountRef.current = 0;
      charsInInputRef.current = 0;
      recordingFloorRef.current = 0;
      setVoiceState(prev => {
        if (!prev.voiceWarmingUp) return prev;
        return {
          ...prev,
          voiceWarmingUp: false
        };
      });
    }
  }, [voiceState, setVoiceState]);
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!voiceEnabled) return;

    
    
    
    
    
    
    
    
    if (!isActive || isModalOverlayActive) return;

    
    
    
    if (voiceKeystroke === null) return;

    
    
    
    
    let repeatCount: number;
    if (bareChar !== null) {
      if (e.ctrl || e.meta || e.shift) return;
      
      
      const normalized = bareChar === ' ' ? normalizeFullWidthSpace(e.key) : e.key;
      
      
      
      if (normalized[0] !== bareChar) return;
      if (normalized.length > 1 && normalized !== bareChar.repeat(normalized.length)) return;
      repeatCount = normalized.length;
    } else {
      if (!matchesKeyboardEvent(e, voiceKeystroke)) return;
      repeatCount = 1;
    }

    
    
    
    
    
    
    
    const currentVoiceState = getVoiceState().voiceState;
    if (isHoldActiveRef.current && currentVoiceState !== 'idle') {
      
      
      
      
      
      e.stopImmediatePropagation();
      if (bareChar !== null) {
        stripTrailing(repeatCount, {
          char: bareChar,
          floor: recordingFloorRef.current
        });
      }
      voiceHandleKeyEvent();
      return;
    }

    
    
    
    
    
    
    if (currentVoiceState !== 'idle') {
      if (bareChar === null) e.stopImmediatePropagation();
      return;
    }
    const countBefore = rapidCountRef.current;
    rapidCountRef.current += repeatCount;

    
    
    
    
    
    
    
    if (bareChar === null || rapidCountRef.current >= HOLD_THRESHOLD) {
      e.stopImmediatePropagation();
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      rapidCountRef.current = 0;
      isHoldActiveRef.current = true;
      setVoiceState(prev_0 => {
        if (!prev_0.voiceWarmingUp) return prev_0;
        return {
          ...prev_0,
          voiceWarmingUp: false
        };
      });
      if (bareChar !== null) {
        
        
        
        
        
        recordingFloorRef.current = stripTrailing(charsInInputRef.current + repeatCount, {
          char: bareChar,
          anchor: true
        });
        charsInInputRef.current = 0;
        voiceHandleKeyEvent();
      } else {
        
        
        
        
        
        stripTrailing(0, {
          anchor: true
        });
        voiceHandleKeyEvent(MODIFIER_FIRST_PRESS_FALLBACK_MS);
      }
      
      
      
      
      
      
      if (getVoiceState().voiceState === 'idle') {
        isHoldActiveRef.current = false;
        resetAnchor();
      }
      return;
    }

    
    
    
    
    
    
    
    
    
    if (countBefore >= WARMUP_THRESHOLD) {
      e.stopImmediatePropagation();
      stripTrailing(repeatCount, {
        char: bareChar,
        floor: charsInInputRef.current
      });
    } else {
      charsInInputRef.current += repeatCount;
    }

    
    if (rapidCountRef.current >= WARMUP_THRESHOLD) {
      setVoiceState(prev_1 => {
        if (prev_1.voiceWarmingUp) return prev_1;
        return {
          ...prev_1,
          voiceWarmingUp: true
        };
      });
    }
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout((resetTimerRef_0, rapidCountRef_0, charsInInputRef_0, setVoiceState_0) => {
      resetTimerRef_0.current = null;
      rapidCountRef_0.current = 0;
      charsInInputRef_0.current = 0;
      setVoiceState_0(prev_2 => {
        if (!prev_2.voiceWarmingUp) return prev_2;
        return {
          ...prev_2,
          voiceWarmingUp: false
        };
      });
    }, RAPID_KEY_GAP_MS, resetTimerRef, rapidCountRef, charsInInputRef, setVoiceState);
  };

  
  
  
  
  useInput((_input, _key, event) => {
    const kbEvent = new KeyboardEvent(event.keypress);
    handleKeyDown(kbEvent);
    
    
    
    if (kbEvent.didStopImmediatePropagation()) {
      event.stopImmediatePropagation();
    }
  }, {
    isActive
  });
  return {
    handleKeyDown
  };
}

export function VoiceKeybindingHandler(props) {
  useVoiceKeybindingHandler(props);
  return null;
}
