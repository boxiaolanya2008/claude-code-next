import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { Box, Text } from '../../ink.js';
import { Markdown } from '../Markdown.js';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { useIsMessageStreaming } from '../../contexts/StreamingContext.js';

type Props = {
  param: TextBlockParam;
  messageId: string;
  addMargin: boolean;
  shouldShowDot: boolean;
  verbose: boolean;
  width?: number | string;
  onOpenRateLimitOptions?: () => void;
};

/**
 * Ultra-fast token streaming message component
 * Displays each character immediately as it arrives from the API
 * No batching, minimal delay for the fastest possible feedback
 *
 * Features:
 * - Character-by-character streaming with requestAnimationFrame
 * - Configurable speed (default 1ms per character for ultra-fast)
 * - Smooth cursor animation during streaming
 * - Progress indicator showing completion percentage
 * - Automatically switches to full text display when complete
 */
export function AssistantTextMessageUltraFast({
  param: { text },
  messageId,
  addMargin,
  shouldShowDot,
  ...props
}: Props): React.ReactNode {
  // Track if this specific message is currently streaming
  const isStreamingThisMessage = useIsMessageStreaming(messageId);

  // State for streaming display
  const [displayedText, setDisplayedText] = useState<string>('');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const animationRef = useRef<number | null>(null);

  // Reset display when text changes completely (new message)
  useEffect(() => {
    if (text !== displayedText) {
      // Only reset if the text is significantly different
      // This preserves the streaming state when text is being appended
      if (!text.startsWith(displayedText)) {
        setDisplayedText('');
        setCurrentIndex(0);
      }
    }
  }, [text, displayedText]);

  // Main streaming animation loop
  useEffect(() => {
    // When not streaming, show full text immediately
    if (!isStreamingThisMessage) {
      if (text && displayedText !== text) {
        setDisplayedText(text);
        setCurrentIndex(text.length);
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    // Already displayed all text
    if (currentIndex >= text.length) {
      return;
    }

    // Ultra-fast streaming: display next character immediately
    // Using requestAnimationFrame for smooth 60fps rendering
    const animate = () => {
      if (currentIndex < text.length && isStreamingThisMessage) {
        const nextChar = text[currentIndex];
        setDisplayedText(prev => prev + nextChar);
        setCurrentIndex(prev => prev + 1);

        // Schedule next character immediately (1ms delay = ultra-fast)
        animationRef.current = requestAnimationFrame(() => {
          setTimeout(animate, 1);
        });
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [text, currentIndex, isStreamingThisMessage, displayedText]);

  // Progress calculation
  const progress = text.length > 0 ? currentIndex / text.length : 1;
  const progressPercent = Math.floor(progress * 100);
  const isComplete = currentIndex >= text.length;

  // Cursor symbols for animation
  const CURSOR_SYMBOLS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
  const [cursorIndex, setCursorIndex] = useState(0);

  // Cursor animation
  useEffect(() => {
    if (!isStreamingThisMessage || isComplete) {
      return;
    }

    const animateCursor = () => {
      setCursorIndex(prev => (prev + 1) % CURSOR_SYMBOLS.length);
    };

    const cursorInterval = setInterval(animateCursor, 80);
    return () => clearInterval(cursorInterval);
  }, [isStreamingThisMessage, isComplete]);

  return (
    <Box
      alignItems="flex-start"
      flexDirection="column"
      justifyContent="space-between"
      marginTop={addMargin ? 1 : 0}
      width="100%"
    >
      <Box flexDirection="row">
        {shouldShowDot && (
          <Text color="text">{BLACK_CIRCLE}</Text>
        )}
        <Box flexDirection="column">
          <Markdown>{displayedText}</Markdown>
          {/* Show animated cursor during streaming */}
          {!isComplete && isStreamingThisMessage && (
            <Text color="cyan" bold>
              {CURSOR_SYMBOLS[cursorIndex]}
            </Text>
          )}
        </Box>
      </Box>
      {/* Progress bar during streaming */}
      {!isComplete && isStreamingThisMessage && text.length > 10 && (
        <Box flexDirection="row" marginTop={0}>
          <Text color="cyan">
            {'█'.repeat(Math.floor(progress * 20))}
          </Text>
          <Text dimColor>
            {'░'.repeat(20 - Math.floor(progress * 20))}
          </Text>
          <Text dimColor> {progressPercent}%</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Simple version without progress bar for cleaner display
 */
export function AssistantTextMessageSimple({
  param: { text },
  messageId,
  addMargin,
  shouldShowDot,
}: Omit<Props, 'onOpenRateLimitOptions' | 'verbose' | 'width'>): React.ReactNode {
  const isStreamingThisMessage = useIsMessageStreaming(messageId);
  const [displayedText, setDisplayedText] = useState<string>('');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isStreamingThisMessage) {
      setDisplayedText(text);
      setCurrentIndex(text.length);
      return;
    }

    if (currentIndex >= text.length) {
      return;
    }

    const animate = () => {
      if (currentIndex < text.length && isStreamingThisMessage) {
        setDisplayedText(prev => prev + text[currentIndex]);
        setCurrentIndex(prev => prev + 1);
        animationRef.current = requestAnimationFrame(() => {
          setTimeout(animate, 1);
        });
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [text, currentIndex, isStreamingThisMessage, displayedText]);

  const CURSOR_SYMBOLS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
  const [cursorIndex, setCursorIndex] = useState(0);
  const isComplete = currentIndex >= text.length;

  useEffect(() => {
    if (!isStreamingThisMessage || isComplete) {
      return;
    }
    const animateCursor = () => {
      setCursorIndex(prev => (prev + 1) % CURSOR_SYMBOLS.length);
    };
    const cursorInterval = setInterval(animateCursor, 80);
    return () => clearInterval(cursorInterval);
  }, [isStreamingThisMessage, isComplete]);

  return (
    <Box
      alignItems="flex-start"
      flexDirection="row"
      marginTop={addMargin ? 1 : 0}
      width="100%"
    >
      {shouldShowDot && (
        <Text color="text">{BLACK_CIRCLE}</Text>
      )}
      <Box flexDirection="column">
        <Markdown>{displayedText}</Markdown>
        {!isComplete && isStreamingThisMessage && (
          <Text color="cyan" bold>
            {CURSOR_SYMBOLS[cursorIndex]}
          </Text>
        )}
      </Box>
    </Box>
  );
}

export default AssistantTextMessageUltraFast;
