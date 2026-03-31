import { feature } from "../utils/bundle-mock.ts";
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import React, { useContext, useMemo } from 'react';
import { getKairosActive, getUserMsgOptIn } from '../../bootstrap/state.js';
import { Box } from '../../ink.js';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js';
import { useAppState } from '../../state/AppState.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { logError } from '../../utils/log.js';
import { countCharInString } from '../../utils/stringUtils.js';
import { MessageActionsSelectedContext } from '../messageActions.js';
import { HighlightedThinkingText } from './HighlightedThinkingText.js';
type Props = {
  addMargin: boolean;
  param: TextBlockParam;
  isTranscriptMode?: boolean;
  timestamp?: string;
};

const MAX_DISPLAY_CHARS = 10_000;
const TRUNCATE_HEAD_CHARS = 2_500;
const TRUNCATE_TAIL_CHARS = 2_500;
export function UserPromptMessage({
  addMargin,
  param: {
    text
  },
  isTranscriptMode,
  timestamp
}: Props): React.ReactNode {
  
  
  
  
  
  
  
  
  
  
  
  
  const isBriefOnly = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  
  useAppState(s => s.isBriefOnly) : false;
  const viewingAgentTaskId = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  
  useAppState(s_0 => s_0.viewingAgentTaskId) : null;
  
  const briefEnvEnabled = feature('KAIROS') || feature('KAIROS_BRIEF') ?
  
  useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_NEXT_BRIEF), []) : false;
  const useBriefLayout = feature('KAIROS') || feature('KAIROS_BRIEF') ? (getKairosActive() || getUserMsgOptIn() && (briefEnvEnabled || getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_brief', false))) && isBriefOnly && !isTranscriptMode && !viewingAgentTaskId : false;

  
  const displayText = useMemo(() => {
    if (text.length <= MAX_DISPLAY_CHARS) return text;
    const head = text.slice(0, TRUNCATE_HEAD_CHARS);
    const tail = text.slice(-TRUNCATE_TAIL_CHARS);
    const hiddenLines = countCharInString(text, '\n', TRUNCATE_HEAD_CHARS) - countCharInString(tail, '\n');
    return `${head}\n… +${hiddenLines} lines …\n${tail}`;
  }, [text]);
  const isSelected = useContext(MessageActionsSelectedContext);
  if (!text) {
    logError(new Error('No content found in user prompt message'));
    return null;
  }
  return <Box flexDirection="column" marginTop={addMargin ? 1 : 0} backgroundColor={isSelected ? 'messageActionsBackground' : useBriefLayout ? undefined : 'userMessageBackground'} paddingRight={useBriefLayout ? 0 : 1}>
      <HighlightedThinkingText text={displayText} useBriefLayout={useBriefLayout} timestamp={useBriefLayout ? timestamp : undefined} />
    </Box>;
}
