import { createContext, useContext, ReactNode } from 'react';

/**
 * Streaming state context for tracking active message streaming
 * This context provides information about whether the current
 * assistant message is actively being streamed from the API
 */
interface StreamingContextType {
  /**
   * Whether the current message is actively streaming
   * Set to true during content_block_delta events
   * Set to false after content_block_stop
   */
  isStreaming: boolean;

  /**
   * Message UUID that is currently being streamed
   * Used to track which message is streaming
   */
  streamingMessageId: string | null;

  /**
   * Start streaming for a specific message
   */
  startStreaming: (messageId: string) => void;

  /**
   * Stop streaming for the current message
   */
  stopStreaming: () => void;
}

const StreamingContext = createContext<StreamingContextType | undefined>(
  undefined
);

/**
 * Provider component for streaming state
 */
export function StreamingProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [streamingMessageId, setStreamingMessageId] = React.useState<
    string | null
  >(null);

  const startStreaming = React.useCallback((messageId: string) => {
    setStreamingMessageId(messageId);
    setIsStreaming(true);
  }, []);

  const stopStreaming = React.useCallback(() => {
    setIsStreaming(false);
    setStreamingMessageId(null);
  }, []);

  return (
    <StreamingContext.Provider
      value={{ isStreaming, streamingMessageId, startStreaming, stopStreaming }}
    >
      {children}
    </StreamingContext.Provider>
  );
}

/**
 * Hook to access streaming state
 */
export function useStreaming(): StreamingContextType {
  const context = useContext(StreamingContext);
  if (context === undefined) {
    throw new Error('useStreaming must be used within StreamingProvider');
  }
  return context;
}

/**
 * Hook to check if a specific message is currently streaming
 */
export function useIsMessageStreaming(messageId: string): boolean {
  const { isStreaming, streamingMessageId } = useStreaming();
  return isStreaming && streamingMessageId === messageId;
}
