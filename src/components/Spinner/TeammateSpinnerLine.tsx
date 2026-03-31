import figures from 'figures';
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { useRef, useState } from 'react';
import { getSpinnerVerbs } from '../../constants/spinnerVerbs.js';
import { TURN_COMPLETION_VERBS } from '../../constants/turnCompletionVerbs.js';
import { useElapsedTime } from '../../hooks/useElapsedTime.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { Box, Text } from '../../ink.js';
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js';
import { summarizeRecentActivities } from '../../utils/collapseReadSearch.js';
import { formatDuration, formatNumber, truncateToWidth } from '../../utils/format.js';
import { toInkColor } from '../../utils/ink.js';
import { TEAMMATE_SELECT_HINT } from './teammateSelectHint.js';
type Props = {
  teammate: InProcessTeammateTaskState;
  isLast: boolean;
  isSelected?: boolean;
  isForegrounded?: boolean;
  allIdle?: boolean;
  showPreview?: boolean;
};

function getMessagePreview(messages: InProcessTeammateTaskState['messages']): string[] {
  if (!messages?.length) return [];
  const allLines: string[] = [];
  const maxLineLength = 80;

  
  for (let i = messages.length - 1; i >= 0 && allLines.length < 3; i--) {
    const msg = messages[i];
    
    if (!msg || msg.type !== 'user' && msg.type !== 'assistant' || !msg.message?.content?.length) {
      continue;
    }
    const content = msg.message.content;
    for (const block of content) {
      if (allLines.length >= 3) break;
      if (!block || typeof block !== 'object') continue;
      if ('type' in block && block.type === 'tool_use' && 'name' in block) {
        
        const input = 'input' in block ? block.input as Record<string, unknown> : null;
        let toolLine = `Using ${block.name}…`;
        if (input) {
          
          const desc = input.description as string | undefined || input.prompt as string | undefined || input.command as string | undefined || input.query as string | undefined || input.pattern as string | undefined;
          if (desc) {
            toolLine = desc.split('\n')[0] ?? toolLine;
          }
        }
        allLines.push(truncateToWidth(toolLine, maxLineLength));
      } else if ('type' in block && block.type === 'text' && 'text' in block) {
        const textLines = (block.text as string).split('\n').filter(l => l.trim());
        
        for (let j = textLines.length - 1; j >= 0 && allLines.length < 3; j--) {
          const line = textLines[j];
          if (!line) continue;
          allLines.push(truncateToWidth(line, maxLineLength));
        }
      }
    }
  }

  
  return allLines.reverse();
}
export function TeammateSpinnerLine({
  teammate,
  isLast,
  isSelected,
  isForegrounded,
  allIdle,
  showPreview
}: Props): React.ReactNode {
  const [randomVerb] = useState(() => teammate.spinnerVerb ?? sample(getSpinnerVerbs()));
  const [pastTenseVerb] = useState(() => teammate.pastTenseVerb ?? sample(TURN_COMPLETION_VERBS));
  const isHighlighted = isSelected || isForegrounded;
  const treeChar = isHighlighted ? isLast ? '╘═' : '╞═' : isLast ? '└─' : '├─';
  const nameColor = toInkColor(teammate.identity.color);
  const {
    columns
  } = useTerminalSize();

  
  const idleStartRef = useRef<number | null>(null);
  
  const frozenDurationRef = useRef<string | null>(null);

  
  if (teammate.isIdle && idleStartRef.current === null) {
    idleStartRef.current = Date.now();
  } else if (!teammate.isIdle) {
    idleStartRef.current = null;
  }

  
  if (!allIdle && frozenDurationRef.current !== null) {
    frozenDurationRef.current = null;
  }

  
  const idleElapsedTime = useElapsedTime(idleStartRef.current ?? Date.now(), teammate.isIdle && !allIdle);

  
  
  if (allIdle && frozenDurationRef.current === null) {
    frozenDurationRef.current = formatDuration(Math.max(0, Date.now() - teammate.startTime - (teammate.totalPausedMs ?? 0)));
  }

  
  const displayTime = allIdle ? frozenDurationRef.current ?? (() => {
    throw new Error(`frozenDurationRef is null for idle teammate ${teammate.identity.agentName}`);
  })() : idleElapsedTime;

  
  
  
  const basePrefix = 8;
  const fullAgentName = `@${teammate.identity.agentName}`;
  const fullNameWidth = stringWidth(fullAgentName);

  
  const toolUseCount = teammate.progress?.toolUseCount ?? 0;
  const tokenCount = teammate.progress?.tokenCount ?? 0;
  const statsText = ` · ${toolUseCount} tool ${toolUseCount === 1 ? 'use' : 'uses'} · ${formatNumber(tokenCount)} tokens`;
  const statsWidth = stringWidth(statsText);
  const selectHintText = ` · ${TEAMMATE_SELECT_HINT}`;
  const selectHintWidth = stringWidth(selectHintText);
  const viewHintText = ' · enter to view';
  const viewHintWidth = stringWidth(viewHintText);

  
  
  
  
  const minActivityWidth = 25;

  
  const spaceWithFullName = columns - basePrefix - fullNameWidth - 2;
  const showName = columns >= 60 && spaceWithFullName >= minActivityWidth;
  const nameWidth = showName ? fullNameWidth + 2 : 0; 
  const availableForActivity = columns - basePrefix - nameWidth;

  
  
  const showViewHint = isSelected && !isForegrounded && availableForActivity > viewHintWidth + statsWidth + minActivityWidth + 5;
  const showSelectHint = isHighlighted && availableForActivity > selectHintWidth + (showViewHint ? viewHintWidth : 0) + statsWidth + minActivityWidth + 5;
  const showStats = availableForActivity > statsWidth + minActivityWidth + 5;

  
  const extrasCost = (showStats ? statsWidth : 0) + (showSelectHint ? selectHintWidth : 0) + (showViewHint ? viewHintWidth : 0);
  const activityMaxWidth = Math.max(minActivityWidth, availableForActivity - extrasCost - 1);

  
  const activityText = (() => {
    const activities = teammate.progress?.recentActivities;
    if (activities && activities.length > 0) {
      const summary = summarizeRecentActivities(activities);
      if (summary) return truncateToWidth(summary, activityMaxWidth);
    }
    const desc = teammate.progress?.lastActivity?.activityDescription;
    if (desc) return truncateToWidth(desc, activityMaxWidth);
    return randomVerb;
  })();

  
  const renderStatus = (): React.ReactNode => {
    if (teammate.shutdownRequested) {
      return <Text dimColor>[stopping]</Text>;
    }
    if (teammate.awaitingPlanApproval) {
      return <Text color="warning">[awaiting approval]</Text>;
    }
    if (teammate.isIdle) {
      if (allIdle) {
        return <Text dimColor>
            {pastTenseVerb} for {displayTime}
          </Text>;
      }
      return <Text dimColor>Idle for {idleElapsedTime}</Text>;
    }
    
    
    if (isHighlighted) {
      return null;
    }
    return <Text dimColor>
        {activityText?.endsWith('…') ? activityText : `${activityText}…`}
      </Text>;
  };

  
  const previewLines = showPreview ? getMessagePreview(teammate.messages) : [];

  
  const previewTreeChar = isLast ? '   ' : '│  ';
  return <Box flexDirection="column">
      <Box paddingLeft={3}>
        {}
        <Text color={isSelected ? 'suggestion' : undefined} bold={isSelected}>
          {isSelected ? figures.pointer : ' '}
        </Text>
        <Text dimColor={!isSelected}>{treeChar} </Text>
        {}
        {showName && <Text color={isSelected ? 'suggestion' : nameColor}>
            @{teammate.identity.agentName}
          </Text>}
        {showName && <Text dimColor={!isSelected}>: </Text>}
        {renderStatus()}
        {}
        {showStats && <Text dimColor>
            {' '}
            · {toolUseCount} tool {toolUseCount === 1 ? 'use' : 'uses'} ·{' '}
            {formatNumber(tokenCount)} tokens
          </Text>}
        {}
        {showSelectHint && <Text dimColor> · {TEAMMATE_SELECT_HINT}</Text>}
        {showViewHint && <Text dimColor> · enter to view</Text>}
      </Box>
      {}
      {previewLines.map((line, idx) => <Box key={idx} paddingLeft={3}>
          <Text dimColor> </Text>
          <Text dimColor>{previewTreeChar} </Text>
          <Text dimColor>{line}</Text>
        </Box>)}
    </Box>;
}
