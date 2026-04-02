import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { Box, Text } from '../ink.js';
import { Markdown } from './Markdown.js';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { useStreamingText } from '../hooks/useStreamingText.js';
import type { CliHighlight, getCliHighlightPromise } from '../utils/cliHighlight.js';

type Props = {
  param: TextBlockParam;
  addMargin: boolean;
  shouldShowDot: boolean;
  verbose: boolean;
  width?: number | string;
  isStreaming?: boolean;
  streamingSpeed?: number;
  streamingGradient?: 'rainbow' | 'cyan' | 'green' | 'purple' | 'dim' | 'none';
  onOpenRateLimitOptions?: () => void;
};

// Typewriter cursor symbols for animation
const CURSOR_SYMBOLS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

// Gradient color sequences for different modes
const GRADIENT_COLORS = {
  rainbow: ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd'],
  cyan: ['#00d2d3', '#54a0ff', '#5f27cd'],
  green: ['#10ac84', '#1dd1a1', '#00d2d3'],
  purple: ['#5f27cd', '#a55eea', '#8854d0'],
  dim: ['gray'],
};

/**
 * Enhanced AssistantTextMessage with character-by-character streaming animation
 * Features:
 * - Smooth typewriter effect with configurable speed
 * - Gradient color animation during streaming
 * - Punctuation-aware pauses for natural rhythm
 * - Animated cursor indicator
 * - Progress indicator during streaming
 */
export function AssistantTextMessageStreaming({
  param: { text },
  addMargin,
  shouldShowDot,
  isStreaming = false,
  streamingSpeed = 5,
  streamingGradient = 'cyan',
  ...props
}: Props): React.ReactNode {
  const [cursorIndex, setCursorIndex] = useState(0);
  const [gradientIndex, setGradientIndex] = useState(0);
  const cursorAnimationRef = useRef<NodeJS.Timeout | null>(null);
  const gradientAnimationRef = useRef<NodeJS.Timeout | null>(null);

  // Use streaming text hook
  const { displayedText, isAnimating, progress } = useStreamingText(
    text,
    isStreaming,
    {
      speed: streamingSpeed,
      enableGradient: streamingGradient !== 'none',
      animationType: 'typewriter',
    }
  );

  // Cursor animation
  useEffect(() => {
    if (!isAnimating) {
      if (cursorAnimationRef.current) {
        clearTimeout(cursorAnimationRef.current);
      }
      return;
    }

    const animateCursor = () => {
      setCursorIndex(prev => (prev + 1) % CURSOR_SYMBOLS.length);
      cursorAnimationRef.current = setTimeout(animateCursor, 80);
    };

    cursorAnimationRef.current = setTimeout(animateCursor, 80);

    return () => {
      if (cursorAnimationRef.current) {
        clearTimeout(cursorAnimationRef.current);
      }
    };
  }, [isAnimating]);

  // Gradient animation
  useEffect(() => {
    if (streamingGradient === 'none' || !isAnimating) {
      return;
    }

    const colors = GRADIENT_COLORS[streamingGradient];
    const animateGradient = () => {
      setGradientIndex(prev => (prev + 1) % colors.length);
      gradientAnimationRef.current = setTimeout(animateGradient, 150);
    };

    gradientAnimationRef.current = setTimeout(animateGradient, 150);

    return () => {
      if (gradientAnimationRef.current) {
        clearTimeout(gradientAnimationRef.current);
      }
    };
  }, [streamingGradient, isAnimating]);

  // Get current color
  const getCurrentColor = useCallback((): string | undefined => {
    if (streamingGradient === 'none') return undefined;
    const colors = GRADIENT_COLORS[streamingGradient];
    return colors[gradientIndex];
  }, [streamingGradient, gradientIndex]);

  // Calculate progress bar width
  const progressWidth = Math.floor(progress * 20);

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
          <Text color={getCurrentColor()}>
            {displayedText}
          </Text>
          {isAnimating && isStreaming && (
            <Text color={getCurrentColor()} bold>
              {CURSOR_SYMBOLS[cursorIndex]}
            </Text>
          )}
        </Box>
      </Box>
      {/* Progress bar during streaming */}
      {isAnimating && isStreaming && (
        <Box flexDirection="row" marginTop={0}>
          <Text color={getCurrentColor()}>
            {'█'.repeat(progressWidth)}
          </Text>
          <Text dimColor>
            {'░'.repeat(20 - progressWidth)}
          </Text>
          <Text dimColor> {Math.floor(progress * 100)}%</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Token-level streaming display - shows each token as it arrives
 * This creates the most responsive streaming effect where every API token
 * is displayed immediately without batching
 */
export function AssistantTextMessageTokenStreaming({
  param: { text },
  addMargin,
  shouldShowDot,
  isStreaming = false,
  ...props
}: Props): React.ReactNode {
  // Split text into character-level tokens
  const [tokens, setTokens] = useState<string[]>([]);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const prevTextRef = useRef<string>('');

  // Tokenize text on change
  useEffect(() => {
    if (text !== prevTextRef.current) {
      // Simple character-level tokenization
      // For production, you might want more sophisticated tokenization
      const newTokens = text.split('');
      setTokens(newTokens);
      prevTextRef.current = text;
    }
  }, [text]);

  // Reveal tokens one by one when streaming
  useEffect(() => {
    if (!isStreaming) {
      setVisibleIndex(tokens.length);
      return;
    }

    if (visibleIndex >= tokens.length) {
      return;
    }

    // Reveal next token quickly (every 2ms for fast streaming)
    const timer = setTimeout(() => {
      setVisibleIndex(prev => Math.min(prev + 1, tokens.length));
    }, 2);

    return () => clearTimeout(timer);
  }, [tokens, visibleIndex, isStreaming]);

  const visibleText = tokens.slice(0, visibleIndex).join('');
  const isComplete = visibleIndex >= tokens.length;

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
          <Markdown>{visibleText}</Markdown>
          {!isComplete && isStreaming && (
            <Text color="cyan" bold>
              ▊
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// Export the main streaming component
export default function AssistantTextMessageStreamingMain(props: Props): React.ReactNode {
  // Use token-level streaming for the most responsive effect
  return <AssistantTextMessageTokenStreaming {...props} />;
}
