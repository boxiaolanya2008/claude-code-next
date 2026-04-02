import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Text } from '../ink.js';
import { Markdown } from './Markdown.js';

/**
 * Ultra-fast token streaming component with visual effects
 * Displays text with animated cursor and progress bar during streaming
 *
 * Features:
 * - Smooth character-by-character display
 * - Animated cursor (8-frame cycling)
 * - Progress bar showing completion percentage
 * - Auto-hides cursor and progress when complete
 */
type Props = {
  children: string;
  showProgress?: boolean;
  progressColor?: string;
};

// Cursor symbols for animation (8 frames)
const CURSOR_SYMBOLS = ['\u258F', '\u258E', '\u258D', '\u258C', '\u258B', '\u258A', '\u2589', '\u2588'];

export function StreamingTextUltraFast({
  children,
  showProgress = true,
  progressColor = 'cyan',
}: Props): React.ReactNode {
  const text = children ?? '';
  const textLength = text.length;

  // Track if this is the initial render or text has changed significantly
  const [displayText, setDisplayText] = useState<string>('');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [cursorIndex, setCursorIndex] = useState<number>(0);
  const [isComplete, setIsComplete] = useState<boolean>(false);

  // Refs for animation
  const animationRef = useRef<number | null>(null);
  const cursorAnimationRef = useRef<number | null>(null);
  const prevTextRef = useRef<string>('');

  // Reset display when text changes significantly
  useEffect(() => {
    // If text is completely different (not a continuation), reset
    if (text && !text.startsWith(prevTextRef.current)) {
      setDisplayText('');
      setCurrentIndex(0);
      setIsComplete(false);
    }
    prevTextRef.current = text;
  }, [text]);

  // Main streaming animation
  useEffect(() => {
    // Display all text immediately (no artificial delay)
    // The streaming effect comes from the parent updating children prop
    if (text && text !== displayText) {
      setDisplayText(text);
      setCurrentIndex(text.length);

      // Mark as complete if text matches
      if (textLength > 0 && currentIndex >= textLength) {
        setIsComplete(true);
      }
    }

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [text, displayText, textLength, currentIndex]);

  // Cursor animation
  useEffect(() => {
    // Only animate cursor if actively streaming (text is growing)
    if (isComplete || !text) {
      if (cursorAnimationRef.current) {
        cancelAnimationFrame(cursorAnimationRef.current);
        cursorAnimationRef.current = null;
      }
      return;
    }

    const animateCursor = () => {
      setCursorIndex(prev => (prev + 1) % CURSOR_SYMBOLS.length);
      cursorAnimationRef.current = requestAnimationFrame(() => {
        setTimeout(animateCursor, 80);
      });
    };

    cursorAnimationRef.current = requestAnimationFrame(() => {
      setTimeout(animateCursor, 80);
    });

    return () => {
      if (cursorAnimationRef.current) {
        cancelAnimationFrame(cursorAnimationRef.current);
      }
    };
  }, [isComplete, text, textLength]);

  // Calculate progress
  const progress = textLength > 0 ? currentIndex / textLength : 1;
  const progressPercent = Math.floor(progress * 100);
  const progressBarWidth = Math.floor(progress * 20);

  return (
    <Box flexDirection="column" gap={0}>
      <Markdown>{displayText}</Markdown>
      {/* Show animated cursor during streaming */}
      {!isComplete && text && (
        <Text color={progressColor} bold>
          {CURSOR_SYMBOLS[cursorIndex]}
        </Text>
      )}
      {/* Progress bar during streaming */}
      {showProgress && !isComplete && text && textLength > 10 && (
        <Box flexDirection="row" marginTop={0}>
          <Text color={progressColor}>
            {'\u2588'.repeat(progressBarWidth)}
          </Text>
          <Text dimColor>
            {'\u2591'.repeat(20 - progressBarWidth)}
          </Text>
          <Text dimColor> {progressPercent}%</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Simple streaming text without progress bar
 * For cleaner display when progress isn't needed
 */
export function StreamingTextSimple({
  children,
}: {
  children: string;
}): React.ReactNode {
  const [displayText, setDisplayText] = useState<string>('');
  const [cursorIndex, setCursorIndex] = useState<number>(0);
  const [isComplete, setIsComplete] = useState<boolean>(false);
  const cursorAnimationRef = useRef<number | null>(null);

  useEffect(() => {
    if (children && children !== displayText) {
      setDisplayText(children);
      if (children.length > 0 && displayText.length >= children.length) {
        setIsComplete(true);
      }
    }

    return () => {
      if (cursorAnimationRef.current) {
        cancelAnimationFrame(cursorAnimationRef.current);
      }
    };
  }, [children, displayText]);

  useEffect(() => {
    if (isComplete || !children) {
      return;
    }

    const animateCursor = () => {
      setCursorIndex(prev => (prev + 1) % CURSOR_SYMBOLS.length);
    };

    const interval = setInterval(animateCursor, 80);
    return () => clearInterval(interval);
  }, [isComplete, children]);

  return (
    <Box flexDirection="row">
      <Markdown>{displayText}</Markdown>
      {!isComplete && children && (
        <Text color="cyan" bold>
          {CURSOR_SYMBOLS[cursorIndex]}
        </Text>
      )}
    </Box>
  );
}

/**
 * Hook for tracking streaming state
 * Can be used to determine if a message is actively streaming
 */
export function useStreamingState(
  text: string,
  isStreaming: boolean
): {
  isStreaming: boolean;
  progress: number;
  isComplete: boolean;
} {
  const [trackedText, setTrackedText] = useState<string>('');
  const [isComplete, setIsComplete] = useState<boolean>(false);

  useEffect(() => {
    if (isStreaming) {
      setTrackedText(text);
      setIsComplete(false);
    } else if (text && text.length > 0) {
      setTrackedText(text);
      setIsComplete(true);
    }
  }, [text, isStreaming]);

  const progress = text.length > 0 ? trackedText.length / text.length : 1;

  return {
    isStreaming: isStreaming && !isComplete,
    progress,
    isComplete: isComplete || (!isStreaming && text === trackedText),
  };
}
