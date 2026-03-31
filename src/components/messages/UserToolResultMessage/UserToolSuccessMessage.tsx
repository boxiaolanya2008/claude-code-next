import { feature } from 'bun:bundle';
import figures from 'figures';
import * as React from 'react';
import { SentryErrorBoundary } from 'src/components/SentryErrorBoundary.js';
import { Box, Text, useTheme } from '../../../ink.js';
import { useAppState } from '../../../state/AppState.js';
import { filterToolProgressMessages, type Tool, type Tools } from '../../../Tool.js';
import type { NormalizedUserMessage, ProgressMessage } from '../../../types/message.js';
import { deleteClassifierApproval, getClassifierApproval, getYoloClassifierApproval } from '../../../utils/classifierApprovals.js';
import type { buildMessageLookups } from '../../../utils/messages.js';
import { MessageResponse } from '../../MessageResponse.js';
import { HookProgressMessage } from '../HookProgressMessage.js';
type Props = {
  message: NormalizedUserMessage;
  lookups: ReturnType<typeof buildMessageLookups>;
  toolUseID: string;
  progressMessagesForMessage: ProgressMessage[];
  style?: 'condensed';
  tool?: Tool;
  tools: Tools;
  verbose: boolean;
  width: number | string;
  isTranscriptMode?: boolean;
};
export function UserToolSuccessMessage({
  message,
  lookups,
  toolUseID,
  progressMessagesForMessage,
  style,
  tool,
  tools,
  verbose,
  width,
  isTranscriptMode
}: Props): React.ReactNode {
  const [theme] = useTheme();
  
  
  
  const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  
  useAppState(s => s.isBriefOnly) : false;

  
  
  const [classifierRule] = React.useState(() => getClassifierApproval(toolUseID));
  const [yoloReason] = React.useState(() => getYoloClassifierApproval(toolUseID));
  React.useEffect(() => {
    deleteClassifierApproval(toolUseID);
  }, [toolUseID]);
  if (!message.toolUseResult || !tool) {
    return null;
  }

  
  
  
  
  const parsedOutput = tool.outputSchema?.safeParse(message.toolUseResult);
  if (parsedOutput && !parsedOutput.success) {
    return null;
  }
  const toolResult = parsedOutput?.data ?? message.toolUseResult;
  const renderedMessage = tool.renderToolResultMessage?.(toolResult as never, filterToolProgressMessages(progressMessagesForMessage), {
    style,
    theme,
    tools,
    verbose,
    isTranscriptMode,
    isBriefOnly,
    input: lookups.toolUseByToolUseID.get(toolUseID)?.input
  }) ?? null;

  
  if (renderedMessage === null) {
    return null;
  }

  
  
  
  
  const rendersAsAssistantText = tool.userFacingName(undefined) === '';
  return <Box flexDirection="column">
      <Box flexDirection="column" width={rendersAsAssistantText ? undefined : width}>
        {renderedMessage}
        {feature('BASH_CLASSIFIER') ? classifierRule && <MessageResponse height={1}>
                <Text dimColor>
                  <Text color="success">{figures.tick}</Text>
                  {' Auto-approved \u00b7 matched '}
                  {`"${classifierRule}"`}
                </Text>
              </MessageResponse> : null}
        {feature('TRANSCRIPT_CLASSIFIER') ? yoloReason && <MessageResponse height={1}>
                <Text dimColor>Allowed by auto mode classifier</Text>
              </MessageResponse> : null}
      </Box>
      <SentryErrorBoundary>
        <HookProgressMessage hookEvent="PostToolUse" lookups={lookups} toolUseID={toolUseID} verbose={verbose} isTranscriptMode={isTranscriptMode} />
      </SentryErrorBoundary>
    </Box>;
}
