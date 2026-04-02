import { c as _c } from "react/compiler-runtime";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { Text } from '../ink.js';

/**
 * Streaming text component that displays text with a smooth character-by-character animation.
 * Each token is displayed as it arrives, creating a fluid typing effect with enhanced visual appeal.
 *
 * Features:
 * - Smooth typewriter animation with configurable speed
 * - Punctuation pauses for natural rhythm (., !, ?, : slow down after these)
 * - Color gradient animation for visual appeal
 * - Gradient mode: rainbow/cyan/green/purple/dim
 * - Responsive to streaming state (pauses when not actively streaming)
 */
type Props = {
  readonly children?: string;
  readonly speed?: number;
  readonly gradient?: 'rainbow' | 'cyan' | 'green' | 'purple' | 'dim' | 'none';
  readonly isStreaming?: boolean;
  readonly onAnimationComplete?: () => void;
};

// Animation colors for gradient modes
const GRADIENT_COLORS = {
  rainbow: ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd'],
  cyan: ['#00d2d3', '#54a0ff', '#5f27cd'],
  green: ['#10ac84', '#1dd1a1', '#00d2d3'],
  purple: ['#5f27cd', '#a55eea', '#8854d0'],
  dim: ['gray', 'dimColor', 'gray'],
};

// Typewriter cursor symbols for animation
const CURSOR_SYMBOLS = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

export function StreamingText({
  children,
  speed = 15,
  gradient = 'none',
  isStreaming = true,
  onAnimationComplete,
}: Props): ReactNode {
  const $ = _c(25);

  const [displayText, setDisplayText] = useState<string>('');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [cursorIndex, setCursorIndex] = useState<number>(0);
  const [gradientIndex, setGradientIndex] = useState<number>(0);
  const animationRef = useRef<number | null>(null);
  const cursorAnimationRef = useRef<number | null>(null);

  const text = children ?? '';
  const textLength = text.length;

  // Main typewriter animation effect
  useEffect(() => {
    if (currentIndex >= textLength) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (cursorAnimationRef.current) {
        cancelAnimationFrame(cursorAnimationRef.current);
        cursorAnimationRef.current = null;
      }
      onAnimationComplete?.();
      return;
    }

    const animate = () => {
      if (!isStreaming) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      const nextChar = text[currentIndex];

      // Check for punctuation to add pause
      const punctuationDelay = ['.', '!', '?', ':', ';', '。', '！', '？', '：', '；'].includes(nextChar)
        ? speed * 3
        : speed;

      setCurrentIndex(prev => {
        const newIndex = prev + 1;
        setDisplayText(text.slice(0, newIndex));
        return newIndex;
      });

      animationRef.current = requestAnimationFrame(() => {
        setTimeout(animate, punctuationDelay);
      });
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [currentIndex, text, textLength, isStreaming, speed, onAnimationComplete]);

  // Cursor blink animation
  useEffect(() => {
    if (currentIndex >= textLength) return;

    const animateCursor = () => {
      setCursorIndex(prev => (prev + 1) % CURSOR_SYMBOLS.length);
      cursorAnimationRef.current = requestAnimationFrame(() => {
        setTimeout(animateCursor, 100);
      });
    };

    cursorAnimationRef.current = requestAnimationFrame(animateCursor);

    return () => {
      if (cursorAnimationRef.current) {
        cancelAnimationFrame(cursorAnimationRef.current);
      }
    };
  }, [currentIndex, textLength]);

  // Gradient color animation
  useEffect(() => {
    if (gradient === 'none' || !isStreaming) return;

    const colors = GRADIENT_COLORS[gradient];
    const animateGradient = () => {
      setGradientIndex(prev => (prev + 1) % colors.length);
    };

    const interval = setInterval(animateGradient, 200);
    return () => clearInterval(interval);
  }, [gradient, isStreaming]);

  // Get current color based on gradient mode
  const getCurrentColor = useCallback((): string | undefined => {
    if (gradient === 'none') return undefined;
    const colors = GRADIENT_COLORS[gradient];
    return colors[gradientIndex];
  }, [gradient, gradientIndex]);

  // Check if a character is punctuation (for cursor positioning)
  const isPunctuation = useCallback((char: string): boolean => {
    return ['.', '!', '?', ':', ';', '，', '。', '！', '？', '：', '；', ',', ' '].includes(char);
  }, []);

  // Render character with animation effect
  const renderAnimatedChar = useCallback((char: string, index: number): ReactNode => {
    const isLastChar = index === currentIndex - 1;
    const isPunctuationChar = isPunctuation(char);

    let color = getCurrentColor();
    let dim = false;
    let bold = false;

    // Special styling for different character types
    if (isPunctuationChar && gradient !== 'none') {
      bold = true;
    }

    // Dim effect for characters that haven't been revealed yet
    if (index >= currentIndex) {
      return null;
    }

    // Last character gets cursor animation
    if (isLastChar && isStreaming && currentIndex < textLength) {
      return (
        <Text key={index} bold={bold} color={color} dimColor={dim}>
          {char}
        </Text>
      );
    }

    // Completed characters get stable color
    return (
      <Text key={index} bold={bold} color={color} dimColor={dim}>
        {char}
      </Text>
    );
  }, [currentIndex, getCurrentColor, isPunctuation, isStreaming, textLength]);

  // Handle empty content
  if (!text || textLength === 0) {
    return null;
  }

  // Split text into characters and render with animation
  const chars = text.split('');
  const animatedChars = chars.map((char, index) => renderAnimatedChar(char, index));

  // Add cursor for active streaming
  const cursor = (isStreaming && currentIndex < textLength) ? (
    <Text color={gradient === 'none' ? undefined : getCurrentColor()} bold={true}>
      {CURSOR_SYMBOLS[cursorIndex]}
    </Text>
  ) : null;

  return (
    <Text>
      {animatedChars}
      {cursor}
    </Text>
  );
}

/**
 * Streaming text with progress indicator.
 * Shows a smooth progress bar below the text with gradient animation.
 */
type StreamingTextWithProgressProps = Props & {
  readonly showProgress?: boolean;
  readonly progressColor?: string;
};

export function StreamingTextWithProgress({
  showProgress = true,
  progressColor = '#5f27cd',
  ...props
}: StreamingTextWithProgressProps): ReactNode {
  const text = props.children ?? '';
  const textLength = text.length;

  return (
    <Text flexDirection="column">
      <StreamingText {...props} />
      {showProgress && textLength > 0 && props.isStreaming && (
        <Text>
          {'\n'}
          <Text color={progressColor}>
            {'█'.repeat(Math.floor((props.isStreaming ? 50 : 100) / 10))}
          </Text>
          <Text dimColor>
            {'░'.repeat(10 - Math.floor((props.isStreaming ? 50 : 100) / 10))}
          </Text>
        </Text>
      )}
    </Text>
  );
}

/**
 * Enhanced streaming text with ripple effect.
 * Creates a visual ripple animation from each character as it appears.
 */
type StreamingTextWithRippleProps = Props & {
  readonly rippleColor?: string;
  readonly rippleSize?: number;
};

export function StreamingTextWithRipple({
  rippleColor = '#54a0ff',
  rippleSize = 2,
  ...props
}: StreamingTextWithRippleProps): ReactNode {
  const [ripplePositions, setRipplePositions] = useState<number[]>([]);
  const text = props.children ?? '';

  // Add ripple position when new character appears
  useEffect(() => {
    const currentLength = props.isStreaming ? text.length : 0;
    if (currentLength > ripplePositions.length) {
      setRipplePositions(prev => [...prev, currentLength - 1]);
    }
  }, [text, ripplePositions.length, props.isStreaming]);

  // Clear ripples after animation
  useEffect(() => {
    const interval = setInterval(() => {
      setRipplePositions(prev => prev.filter(pos => {
        const age = text.length - pos;
        return age < rippleSize;
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [text.length, rippleSize]);

  return (
    <Text>
      <StreamingText {...props} />
      {ripplePositions.map(pos => (
        <Text key={`ripple-${pos}`} color={rippleColor} bold>
          {'◦'}
        </Text>
      ))}
    </Text>
  );
}
