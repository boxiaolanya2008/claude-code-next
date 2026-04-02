import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Ultra-fast token streaming hook
 * Displays each API token immediately upon arrival
 * No batching, no delays - pure real-time streaming
 *
 * @example
 * const { displayedText, tokenCount, isStreaming } = useUltraFastTokenStreaming(
 *   fullText,
 *   isStreaming
 * );
 */
export function useUltraFastTokenStreaming(
  fullText: string,
  isStreaming: boolean
) {
  const [displayedText, setDisplayedText] = useState<string>('');
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [isComplete, setIsComplete] = useState<boolean>(false);
  const animationRef = useRef<number | null>(null);

  // Reset when text changes completely
  useEffect(() => {
    setDisplayedText('');
    setTokenCount(0);
    setIsComplete(false);
  }, [fullText]);

  // Main streaming loop
  useEffect(() => {
    if (!isStreaming || !fullText) {
      // When not streaming, show full text immediately
      if (fullText && displayedText !== fullText) {
        setDisplayedText(fullText);
        setTokenCount(fullText.length);
        setIsComplete(true);
      }
      return;
    }

    // Split into character-level tokens (1 char = 1 token for display purposes)
    const tokens = fullText.split('');
    let currentIndex = 0;

    const animate = () => {
      if (currentIndex < tokens.length && isStreaming) {
        // Display next token immediately - no delay
        setDisplayedText(prev => prev + tokens[currentIndex]);
        setTokenCount(currentIndex + 1);
        currentIndex++;

        // Use requestAnimationFrame for smooth 60fps rendering
        // Each token appears in ~16ms (one frame) at worst
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setIsComplete(true);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [fullText, isStreaming, displayedText]);

  return {
    displayedText,
    tokenCount,
    isComplete,
    isStreaming: isStreaming && !isComplete,
    progress: fullText.length > 0 ? tokenCount / fullText.length : 1,
  };
}

/**
 * Token-aware streaming with configurable speed
 * For when you need slightly throttled streaming
 */
export function useTokenStreaming(
  fullText: string,
  isStreaming: boolean,
  options: {
    speed?: number;  // milliseconds per token, default 1
    onComplete?: () => void;
  } = {}
) {
  const { speed = 1, onComplete } = options;

  const [displayedText, setDisplayedText] = useState<string>('');
  const [tokenCount, setTokenCount] = useState<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isStreaming || !fullText) {
      if (fullText && displayedText !== fullText) {
        setDisplayedText(fullText);
        setTokenCount(fullText.length);
        onComplete?.();
      }
      return;
    }

    const tokens = fullText.split('');
    let index = 0;

    const animate = () => {
      if (index < tokens.length && isStreaming) {
        setDisplayedText(prev => prev + tokens[index]);
        setTokenCount(index + 1);
        index++;
        timeoutRef.current = setTimeout(animate, speed);
      } else {
        setIsComplete(true);
        onComplete?.();
      }
    };

    timeoutRef.current = setTimeout(animate, speed);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [fullText, isStreaming, speed, onComplete, displayedText]);

  return {
    displayedText,
    tokenCount,
    isComplete: isStreaming && tokenCount >= fullText.length,
    progress: fullText.length > 0 ? tokenCount / fullText.length : 1,
  };
}

/**
 * Code-specific token streaming with syntax highlighting
 */
export function useCodeTokenStreaming(
  fullCode: string,
  isStreaming: boolean,
  options: {
    speed?: number;
    language?: 'javascript' | 'typescript' | 'python' | 'css' | 'html';
  } = {}
) {
  const { speed = 1, language = 'typescript' } = options;

  const [displayedTokens, setDisplayedTokens] = useState<string[]>([]);
  const [tokenIndex, setTokenIndex] = useState<number>(0);

  useEffect(() => {
    if (!isStreaming) {
      setDisplayedTokens(fullCode.split(''));
      setTokenIndex(fullCode.length);
      return;
    }

    const tokens = fullCode.split('');
    let currentIndex = 0;

    const animate = () => {
      if (currentIndex < tokens.length) {
        setDisplayedTokens(prev => [...prev, tokens[currentIndex]]);
        setTokenIndex(currentIndex + 1);
        currentIndex++;
        setTimeout(animate, speed);
      }
    };

    setTimeout(animate, speed);

    return {
      displayedCode: displayedTokens.join(''),
      tokenCount: tokenIndex,
      isComplete: tokenIndex >= tokens.length,
      progress: tokens.length > 0 ? tokenIndex / tokens.length : 1,
    };
}
