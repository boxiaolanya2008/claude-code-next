import { c as _c } from "react/compiler-runtime";
import { feature } from 'bun:bundle';
import chalk from 'chalk';
import type { UUID } from 'crypto';
import type { RefObject } from 'react';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { every } from 'src/utils/set.js';
import { getIsRemoteMode } from '../bootstrap/state.js';
import type { Command } from '../commands.js';
import { BLACK_CIRCLE } from '../constants/figures.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import { useTerminalNotification } from '../ink/useTerminalNotification.js';
import { Box, Text } from '../ink.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import type { Screen } from '../screens/REPL.js';
import type { Tools } from '../Tool.js';
import { findToolByName } from '../Tool.js';
import type { AgentDefinitionsResult } from '../tools/AgentTool/loadAgentsDir.js';
import type { Message as MessageType, NormalizedMessage, ProgressMessage as ProgressMessageType, RenderableMessage } from '../types/message.js';
import { type AdvisorBlock, isAdvisorBlock } from '../utils/advisor.js';
import { collapseBackgroundBashNotifications } from '../utils/collapseBackgroundBashNotifications.js';
import { collapseHookSummaries } from '../utils/collapseHookSummaries.js';
import { collapseReadSearchGroups } from '../utils/collapseReadSearch.js';
import { collapseTeammateShutdowns } from '../utils/collapseTeammateShutdowns.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { applyGrouping } from '../utils/groupToolUses.js';
import { buildMessageLookups, createAssistantMessage, deriveUUID, getMessagesAfterCompactBoundary, getToolUseID, getToolUseIDs, hasUnresolvedHooksFromLookup, isNotEmptyMessage, normalizeMessages, reorderMessagesInUI, type StreamingThinking, type StreamingToolUse, shouldShowUserMessage } from '../utils/messages.js';
import { plural } from '../utils/stringUtils.js';
import { renderableSearchText } from '../utils/transcriptSearch.js';
import { Divider } from './design-system/Divider.js';
import type { UnseenDivider } from './FullscreenLayout.js';
import { LogoV2 } from './LogoV2/LogoV2.js';
import { StreamingMarkdown } from './Markdown.js';
import { hasContentAfterIndex, MessageRow } from './MessageRow.js';
import { InVirtualListContext, type MessageActionsNav, MessageActionsSelectedContext, type MessageActionsState } from './messageActions.js';
import { AssistantThinkingMessage } from './messages/AssistantThinkingMessage.js';
import { isNullRenderingAttachment } from './messages/nullRenderingAttachments.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import type { ToolUseConfirm } from './permissions/PermissionRequest.js';
import { StatusNotices } from './StatusNotices.js';
import type { JumpHandle } from './VirtualMessageList.js';

const LogoHeader = React.memo(function LogoHeader(t0) {
  const $ = _c(3);
  const {
    agentDefinitions
  } = t0;
  let t1;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = <LogoV2 />;
    $[0] = t1;
  } else {
    t1 = $[0];
  }
  let t2;
  if ($[1] !== agentDefinitions) {
    t2 = <OffscreenFreeze><Box flexDirection="column" gap={1}>{t1}<React.Suspense fallback={null}><StatusNotices agentDefinitions={agentDefinitions} /></React.Suspense></Box></OffscreenFreeze>;
    $[1] = agentDefinitions;
    $[2] = t2;
  } else {
    t2 = $[2];
  }
  return t2;
});

const proactiveModule = feature('PROACTIVE') || feature('KAIROS') ? require('../proactive/index.js') : null;
const BRIEF_TOOL_NAME: string | null = feature('KAIROS') || feature('KAIROS_BRIEF') ? (require('../tools/BriefTool/prompt.js') as typeof import('../tools/BriefTool/prompt.js')).BRIEF_TOOL_NAME : null;
const SEND_USER_FILE_TOOL_NAME: string | null = feature('KAIROS') ? (require('../tools/SendUserFileTool/prompt.js') as typeof import('../tools/SendUserFileTool/prompt.js')).SEND_USER_FILE_TOOL_NAME : null;

import { VirtualMessageList } from './VirtualMessageList.js';

export function filterForBriefTool<T extends {
  type: string;
  subtype?: string;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  message?: {
    content: Array<{
      type: string;
      name?: string;
      tool_use_id?: string;
    }>;
  };
  attachment?: {
    type: string;
    isMeta?: boolean;
    origin?: unknown;
    commandMode?: string;
  };
}>(messages: T[], briefToolNames: string[]): T[] {
  const nameSet = new Set(briefToolNames);
  
  
  const briefToolUseIDs = new Set<string>();
  return messages.filter(msg => {
    
    
    
    
    
    if (msg.type === 'system') return msg.subtype !== 'api_metrics';
    const block = msg.message?.content[0];
    if (msg.type === 'assistant') {
      
      if (msg.isApiErrorMessage) return true;
      
      
      if (block?.type === 'tool_use' && block.name && nameSet.has(block.name)) {
        if ('id' in block) {
          briefToolUseIDs.add((block as {
            id: string;
          }).id);
        }
        return true;
      }
      return false;
    }
    if (msg.type === 'user') {
      if (block?.type === 'tool_result') {
        return block.tool_use_id !== undefined && briefToolUseIDs.has(block.tool_use_id);
      }
      
      return !msg.isMeta;
    }
    if (msg.type === 'attachment') {
      
      
      
      
      
      
      const att = msg.attachment;
      return att?.type === 'queued_command' && att.commandMode === 'prompt' && !att.isMeta && att.origin === undefined;
    }
    return false;
  });
}

export function dropTextInBriefTurns<T extends {
  type: string;
  isMeta?: boolean;
  message?: {
    content: Array<{
      type: string;
      name?: string;
    }>;
  };
}>(messages: T[], briefToolNames: string[]): T[] {
  const nameSet = new Set(briefToolNames);
  
  
  const turnsWithBrief = new Set<number>();
  const textIndexToTurn: number[] = [];
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const block = msg.message?.content[0];
    if (msg.type === 'user' && block?.type !== 'tool_result' && !msg.isMeta) {
      turn++;
      continue;
    }
    if (msg.type === 'assistant') {
      if (block?.type === 'text') {
        textIndexToTurn[i] = turn;
      } else if (block?.type === 'tool_use' && block.name && nameSet.has(block.name)) {
        turnsWithBrief.add(turn);
      }
    }
  }
  if (turnsWithBrief.size === 0) return messages;
  
  return messages.filter((_, i) => {
    const t = textIndexToTurn[i];
    return t === undefined || !turnsWithBrief.has(t);
  });
}
type Props = {
  messages: MessageType[];
  tools: Tools;
  commands: Command[];
  verbose: boolean;
  toolJSX: {
    jsx: React.ReactNode | null;
    shouldHidePromptInput: boolean;
    shouldContinueAnimation?: true;
  } | null;
  toolUseConfirmQueue: ToolUseConfirm[];
  inProgressToolUseIDs: Set<string>;
  isMessageSelectorVisible: boolean;
  conversationId: string;
  screen: Screen;
  streamingToolUses: StreamingToolUse[];
  showAllInTranscript?: boolean;
  agentDefinitions?: AgentDefinitionsResult;
  onOpenRateLimitOptions?: () => void;
  
  hideLogo?: boolean;
  isLoading: boolean;
  
  hidePastThinking?: boolean;
  
  streamingThinking?: StreamingThinking | null;
  
  streamingText?: string | null;
  
  isBriefOnly?: boolean;
  

  unseenDivider?: UnseenDivider;
  
  scrollRef?: RefObject<ScrollBoxHandle | null>;
  
  trackStickyPrompt?: boolean;
  
  jumpRef?: RefObject<JumpHandle | null>;
  
  onSearchMatchesChange?: (count: number, current: number) => void;
  

  scanElement?: (el: import('../ink/dom.js').DOMElement) => import('../ink/render-to-screen.js').MatchPosition[];
  

  setPositions?: (state: {
    positions: import('../ink/render-to-screen.js').MatchPosition[];
    rowOffset: number;
    currentIdx: number;
  } | null) => void;
  

  disableRenderCap?: boolean;
  
  cursor?: MessageActionsState | null;
  setCursor?: (cursor: MessageActionsState | null) => void;
  
  cursorNavRef?: React.Ref<MessageActionsNav>;
  

  renderRange?: readonly [start: number, end: number];
};
const MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE = 30;

const MAX_MESSAGES_WITHOUT_VIRTUALIZATION = 200;
const MESSAGE_CAP_STEP = 50;
export type SliceAnchor = {
  uuid: string;
  idx: number;
} | null;

export function computeSliceStart(collapsed: ReadonlyArray<{
  uuid: string;
}>, anchorRef: {
  current: SliceAnchor;
}, cap = MAX_MESSAGES_WITHOUT_VIRTUALIZATION, step = MESSAGE_CAP_STEP): number {
  const anchor = anchorRef.current;
  const anchorIdx = anchor ? collapsed.findIndex(m => m.uuid === anchor.uuid) : -1;
  
  
  let start = anchorIdx >= 0 ? anchorIdx : anchor ? Math.min(anchor.idx, Math.max(0, collapsed.length - cap)) : 0;
  if (collapsed.length - start > cap + step) {
    start = collapsed.length - cap;
  }
  
  
  const msgAtStart = collapsed[start];
  if (msgAtStart && (anchor?.uuid !== msgAtStart.uuid || anchor.idx !== start)) {
    anchorRef.current = {
      uuid: msgAtStart.uuid,
      idx: start
    };
  } else if (!msgAtStart && anchor) {
    anchorRef.current = null;
  }
  return start;
}
const MessagesImpl = ({
  messages,
  tools,
  commands,
  verbose,
  toolJSX,
  toolUseConfirmQueue,
  inProgressToolUseIDs,
  isMessageSelectorVisible,
  conversationId,
  screen,
  streamingToolUses,
  showAllInTranscript = false,
  agentDefinitions,
  onOpenRateLimitOptions,
  hideLogo = false,
  isLoading,
  hidePastThinking = false,
  streamingThinking,
  streamingText,
  isBriefOnly = false,
  unseenDivider,
  scrollRef,
  trackStickyPrompt,
  jumpRef,
  onSearchMatchesChange,
  scanElement,
  setPositions,
  disableRenderCap = false,
  cursor = null,
  setCursor,
  cursorNavRef,
  renderRange
}: Props): React.ReactNode => {
  const {
    columns
  } = useTerminalSize();
  const toggleShowAllShortcut = useShortcutDisplay('transcript:toggleShowAll', 'Transcript', 'Ctrl+E');
  const normalizedMessages = useMemo(() => normalizeMessages(messages).filter(isNotEmptyMessage), [messages]);

  
  const isStreamingThinkingVisible = useMemo(() => {
    if (!streamingThinking) return false;
    if (streamingThinking.isStreaming) return true;
    if (streamingThinking.streamingEndedAt) {
      return Date.now() - streamingThinking.streamingEndedAt < 30000;
    }
    return false;
  }, [streamingThinking]);

  
  
  
  
  const lastThinkingBlockId = useMemo(() => {
    if (!hidePastThinking) return null;
    
    if (isStreamingThinkingVisible) return 'streaming';
    
    for (let i = normalizedMessages.length - 1; i >= 0; i--) {
      const msg = normalizedMessages[i];
      if (msg?.type === 'assistant') {
        const content = msg.message.content;
        
        for (let j = content.length - 1; j >= 0; j--) {
          if (content[j]?.type === 'thinking') {
            return `${msg.uuid}:${j}`;
          }
        }
      } else if (msg?.type === 'user') {
        const hasToolResult = msg.message.content.some(block => block.type === 'tool_result');
        if (!hasToolResult) {
          
          return 'no-thinking';
        }
      }
    }
    return null;
  }, [normalizedMessages, hidePastThinking, isStreamingThinkingVisible]);

  
  
  const latestBashOutputUUID = useMemo(() => {
    
    for (let i_0 = normalizedMessages.length - 1; i_0 >= 0; i_0--) {
      const msg_0 = normalizedMessages[i_0];
      if (msg_0?.type === 'user') {
        const content_0 = msg_0.message.content;
        
        for (const block_0 of content_0) {
          if (block_0.type === 'text') {
            const text = block_0.text;
            if (text.startsWith('<bash-stdout') || text.startsWith('<bash-stderr')) {
              return msg_0.uuid;
            }
          }
        }
      }
    }
    return null;
  }, [normalizedMessages]);

  
  
  const normalizedToolUseIDs = useMemo(() => getToolUseIDs(normalizedMessages), [normalizedMessages]);
  const streamingToolUsesWithoutInProgress = useMemo(() => streamingToolUses.filter(stu => !inProgressToolUseIDs.has(stu.contentBlock.id) && !normalizedToolUseIDs.has(stu.contentBlock.id)), [streamingToolUses, inProgressToolUseIDs, normalizedToolUseIDs]);
  const syntheticStreamingToolUseMessages = useMemo(() => streamingToolUsesWithoutInProgress.flatMap(streamingToolUse => {
    const msg_1 = createAssistantMessage({
      content: [streamingToolUse.contentBlock]
    });
    
    
    
    
    
    msg_1.uuid = deriveUUID(streamingToolUse.contentBlock.id as UUID, 0);
    return normalizeMessages([msg_1]);
  }), [streamingToolUsesWithoutInProgress]);
  const isTranscriptMode = screen === 'transcript';
  
  const disableVirtualScroll = useMemo(() => isEnvTruthy(process.env.CLAUDE_CODE_NEXT_DISABLE_VIRTUAL_SCROLL), []);
  
  
  
  
  const virtualScrollRuntimeGate = scrollRef != null && !disableVirtualScroll;
  const shouldTruncate = isTranscriptMode && !showAllInTranscript && !virtualScrollRuntimeGate;

  
  
  
  
  const sliceAnchorRef = useRef<SliceAnchor>(null);

  
  
  
  
  
  
  const {
    collapsed: collapsed_0,
    lookups: lookups_0,
    hasTruncatedMessages: hasTruncatedMessages_0,
    hiddenMessageCount: hiddenMessageCount_0
  } = useMemo(() => {
    
    
    
    
    
    
    
    
    
    const compactAwareMessages = verbose || isFullscreenEnvEnabled() ? normalizedMessages : getMessagesAfterCompactBoundary(normalizedMessages, {
      includeSnipped: true
    });
    const messagesToShowNotTruncated = reorderMessagesInUI(compactAwareMessages.filter((msg_2): msg_2 is Exclude<NormalizedMessage, ProgressMessageType> => msg_2.type !== 'progress')
    
    
    
    
    .filter(msg_3 => !isNullRenderingAttachment(msg_3)).filter(_ => shouldShowUserMessage(_, isTranscriptMode)), syntheticStreamingToolUseMessages);
    
    
    
    
    const briefToolNames = [BRIEF_TOOL_NAME, SEND_USER_FILE_TOOL_NAME].filter((n): n is string => n !== null);
    
    
    
    const dropTextToolNames = [BRIEF_TOOL_NAME].filter((n_0): n_0 is string => n_0 !== null);
    const briefFiltered = briefToolNames.length > 0 && !isTranscriptMode ? isBriefOnly ? filterForBriefTool(messagesToShowNotTruncated, briefToolNames) : dropTextToolNames.length > 0 ? dropTextInBriefTurns(messagesToShowNotTruncated, dropTextToolNames) : messagesToShowNotTruncated : messagesToShowNotTruncated;
    const messagesToShow = shouldTruncate ? briefFiltered.slice(-MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE) : briefFiltered;
    const hasTruncatedMessages = shouldTruncate && briefFiltered.length > MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE;
    const {
      messages: groupedMessages
    } = applyGrouping(messagesToShow, tools, verbose);
    const collapsed = collapseBackgroundBashNotifications(collapseHookSummaries(collapseTeammateShutdowns(collapseReadSearchGroups(groupedMessages, tools))), verbose);
    const lookups = buildMessageLookups(normalizedMessages, messagesToShow);
    const hiddenMessageCount = messagesToShowNotTruncated.length - MAX_MESSAGES_TO_SHOW_IN_TRANSCRIPT_MODE;
    return {
      collapsed,
      lookups,
      hasTruncatedMessages,
      hiddenMessageCount
    };
  }, [verbose, normalizedMessages, isTranscriptMode, syntheticStreamingToolUseMessages, shouldTruncate, tools, isBriefOnly]);

  
  const renderableMessages = useMemo(() => {
    
    
    
    
    
    
    
    const capApplies = !virtualScrollRuntimeGate && !disableRenderCap;
    const sliceStart = capApplies ? computeSliceStart(collapsed_0, sliceAnchorRef) : 0;
    return renderRange ? collapsed_0.slice(renderRange[0], renderRange[1]) : sliceStart > 0 ? collapsed_0.slice(sliceStart) : collapsed_0;
  }, [collapsed_0, renderRange, virtualScrollRuntimeGate, disableRenderCap]);
  const streamingToolUseIDs = useMemo(() => new Set(streamingToolUses.map(__0 => __0.contentBlock.id)), [streamingToolUses]);

  
  
  
  const dividerBeforeIndex = useMemo(() => {
    if (!unseenDivider) return -1;
    const prefix = unseenDivider.firstUnseenUuid.slice(0, 24);
    return renderableMessages.findIndex(m => m.uuid.slice(0, 24) === prefix);
  }, [unseenDivider, renderableMessages]);
  const selectedIdx = useMemo(() => {
    if (!cursor) return -1;
    return renderableMessages.findIndex(m_0 => m_0.uuid === cursor.uuid);
  }, [cursor, renderableMessages]);

  
  
  
  
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const onItemClick = useCallback((msg_4: RenderableMessage) => {
    const k = expandKey(msg_4);
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);else next.add(k);
      return next;
    });
  }, []);
  const isItemExpanded = useCallback((msg_5: RenderableMessage) => expandedKeys.size > 0 && expandedKeys.has(expandKey(msg_5)), [expandedKeys]);
  
  
  
  
  
  
  
  const lookupsRef = useRef(lookups_0);
  lookupsRef.current = lookups_0;
  const isItemClickable = useCallback((msg_6: RenderableMessage): boolean => {
    if (msg_6.type === 'collapsed_read_search') return true;
    if (msg_6.type === 'assistant') {
      const b = msg_6.message.content[0] as unknown as AdvisorBlock | undefined;
      return b != null && isAdvisorBlock(b) && b.type === 'advisor_tool_result' && b.content.type === 'advisor_result';
    }
    if (msg_6.type !== 'user') return false;
    const b_0 = msg_6.message.content[0];
    if (b_0?.type !== 'tool_result' || b_0.is_error || !msg_6.toolUseResult) return false;
    const name = lookupsRef.current.toolUseByToolUseID.get(b_0.tool_use_id)?.name;
    const tool = name ? findToolByName(tools, name) : undefined;
    return tool?.isResultTruncated?.(msg_6.toolUseResult as never) ?? false;
  }, [tools]);
  const canAnimate = (!toolJSX || !!toolJSX.shouldContinueAnimation) && !toolUseConfirmQueue.length && !isMessageSelectorVisible;
  const hasToolsInProgress = inProgressToolUseIDs.size > 0;

  
  const {
    progress
  } = useTerminalNotification();
  const prevProgressState = useRef<string | null>(null);
  const progressEnabled = getGlobalConfig().terminalProgressBarEnabled && !getIsRemoteMode() && !(proactiveModule?.isProactiveActive() ?? false);
  useEffect(() => {
    const state = progressEnabled ? hasToolsInProgress ? 'indeterminate' : 'completed' : null;
    if (prevProgressState.current === state) return;
    prevProgressState.current = state;
    progress(state);
  }, [progress, progressEnabled, hasToolsInProgress]);
  useEffect(() => {
    return () => progress(null);
  }, [progress]);
  const messageKey = useCallback((msg_7: RenderableMessage) => `${msg_7.uuid}-${conversationId}`, [conversationId]);
  const renderMessageRow = (msg_8: RenderableMessage, index: number) => {
    const prevType = index > 0 ? renderableMessages[index - 1]?.type : undefined;
    const isUserContinuation = msg_8.type === 'user' && prevType === 'user';
    
    
    
    
    
    const hasContentAfter = msg_8.type === 'collapsed_read_search' && (!!streamingText || hasContentAfterIndex(renderableMessages, index, tools, streamingToolUseIDs));
    const k_0 = messageKey(msg_8);
    const row = <MessageRow key={k_0} message={msg_8} isUserContinuation={isUserContinuation} hasContentAfter={hasContentAfter} tools={tools} commands={commands} verbose={verbose || isItemExpanded(msg_8) || cursor?.expanded === true && index === selectedIdx} inProgressToolUseIDs={inProgressToolUseIDs} streamingToolUseIDs={streamingToolUseIDs} screen={screen} canAnimate={canAnimate} onOpenRateLimitOptions={onOpenRateLimitOptions} lastThinkingBlockId={lastThinkingBlockId} latestBashOutputUUID={latestBashOutputUUID} columns={columns} isLoading={isLoading} lookups={lookups_0} />;

    
    
    const wrapped = <MessageActionsSelectedContext.Provider key={k_0} value={index === selectedIdx}>
        {row}
      </MessageActionsSelectedContext.Provider>;
    if (unseenDivider && index === dividerBeforeIndex) {
      return [<Box key="unseen-divider" marginTop={1}>
          <Divider title={`${unseenDivider.count} new ${plural(unseenDivider.count, 'message')}`} width={columns} color="inactive" />
        </Box>, wrapped];
    }
    return wrapped;
  };

  
  
  
  
  
  
  
  
  
  
  const searchTextCache = useRef(new WeakMap<RenderableMessage, string>());
  const extractSearchText = useCallback((msg_9: RenderableMessage): string => {
    const cached = searchTextCache.current.get(msg_9);
    if (cached !== undefined) return cached;
    let text_0 = renderableSearchText(msg_9);
    
    
    
    if (msg_9.type === 'user' && msg_9.toolUseResult && Array.isArray(msg_9.message.content)) {
      const tr = msg_9.message.content.find(b_1 => b_1.type === 'tool_result');
      if (tr && 'tool_use_id' in tr) {
        const tu = lookups_0.toolUseByToolUseID.get(tr.tool_use_id);
        const tool_0 = tu && findToolByName(tools, tu.name);
        const extracted = tool_0?.extractSearchText?.(msg_9.toolUseResult as never);
        
        
        if (extracted !== undefined) text_0 = extracted;
      }
    }
    
    
    
    
    
    const lowered = text_0.toLowerCase();
    searchTextCache.current.set(msg_9, lowered);
    return lowered;
  }, [tools, lookups_0]);
  return <>
      {}
      {!hideLogo && !(renderRange && renderRange[0] > 0) && <LogoHeader agentDefinitions={agentDefinitions} />}

      {}
      {hasTruncatedMessages_0 && <Divider title={`${toggleShowAllShortcut} to show ${chalk.bold(hiddenMessageCount_0)} previous messages`} width={columns} />}

      {}
      {isTranscriptMode && showAllInTranscript && hiddenMessageCount_0 > 0 &&
    
    
    
    !disableRenderCap && <Divider title={`${toggleShowAllShortcut} to hide ${chalk.bold(hiddenMessageCount_0)} previous messages`} width={columns} />}

      {

}
      {virtualScrollRuntimeGate ? <InVirtualListContext.Provider value={true}>
          <VirtualMessageList messages={renderableMessages} scrollRef={scrollRef} columns={columns} itemKey={messageKey} renderItem={renderMessageRow} onItemClick={onItemClick} isItemClickable={isItemClickable} isItemExpanded={isItemExpanded} trackStickyPrompt={trackStickyPrompt} selectedIndex={selectedIdx >= 0 ? selectedIdx : undefined} cursorNavRef={cursorNavRef} setCursor={setCursor} jumpRef={jumpRef} onSearchMatchesChange={onSearchMatchesChange} scanElement={scanElement} setPositions={setPositions} extractSearchText={extractSearchText} />
        </InVirtualListContext.Provider> : renderableMessages.flatMap(renderMessageRow)}

      {streamingText && !isBriefOnly && <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
          <Box flexDirection="row">
            <Box minWidth={2}>
              <Text color="text">{BLACK_CIRCLE}</Text>
            </Box>
            <Box flexDirection="column">
              <StreamingMarkdown>{streamingText}</StreamingMarkdown>
            </Box>
          </Box>
        </Box>}

      {isStreamingThinkingVisible && streamingThinking && !isBriefOnly && <Box marginTop={1}>
          <AssistantThinkingMessage param={{
        type: 'thinking',
        thinking: streamingThinking.thinking
      }} addMargin={false} isTranscriptMode={true} verbose={verbose} hideInTranscript={false} />
        </Box>}
    </>;
};

function expandKey(msg: RenderableMessage): string {
  return (msg.type === 'assistant' || msg.type === 'user' ? getToolUseID(msg) : null) ?? msg.uuid;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
export const Messages = React.memo(MessagesImpl, (prev, next) => {
  const keys = Object.keys(prev) as (keyof typeof prev)[];
  for (const key of keys) {
    if (key === 'onOpenRateLimitOptions' || key === 'scrollRef' || key === 'trackStickyPrompt' || key === 'setCursor' || key === 'cursorNavRef' || key === 'jumpRef' || key === 'onSearchMatchesChange' || key === 'scanElement' || key === 'setPositions') continue;
    if (prev[key] !== next[key]) {
      if (key === 'streamingToolUses') {
        const p = prev.streamingToolUses;
        const n = next.streamingToolUses;
        if (p.length === n.length && p.every((item, i) => item.contentBlock === n[i]?.contentBlock)) {
          continue;
        }
      }
      if (key === 'inProgressToolUseIDs') {
        if (setsEqual(prev.inProgressToolUseIDs, next.inProgressToolUseIDs)) {
          continue;
        }
      }
      if (key === 'unseenDivider') {
        const p = prev.unseenDivider;
        const n = next.unseenDivider;
        if (p?.firstUnseenUuid === n?.firstUnseenUuid && p?.count === n?.count) {
          continue;
        }
      }
      if (key === 'tools') {
        const p = prev.tools;
        const n = next.tools;
        if (p.length === n.length && p.every((tool, i) => tool.name === n[i]?.name)) {
          continue;
        }
      }
      
      
      return false;
    }
  }
  return true;
});
export function shouldRenderStatically(message: RenderableMessage, streamingToolUseIDs: Set<string>, inProgressToolUseIDs: Set<string>, siblingToolUseIDs: ReadonlySet<string>, screen: Screen, lookups: ReturnType<typeof buildMessageLookups>): boolean {
  if (screen === 'transcript') {
    return true;
  }
  switch (message.type) {
    case 'attachment':
    case 'user':
    case 'assistant':
      {
        if (message.type === 'assistant') {
          const block = message.message.content[0];
          if (block?.type === 'server_tool_use') {
            return lookups.resolvedToolUseIDs.has(block.id);
          }
        }
        const toolUseID = getToolUseID(message);
        if (!toolUseID) {
          return true;
        }
        if (streamingToolUseIDs.has(toolUseID)) {
          return false;
        }
        if (inProgressToolUseIDs.has(toolUseID)) {
          return false;
        }

        
        
        if (hasUnresolvedHooksFromLookup(toolUseID, 'PostToolUse', lookups)) {
          return false;
        }
        return every(siblingToolUseIDs, lookups.resolvedToolUseIDs);
      }
    case 'system':
      {
        
        
        return message.subtype !== 'api_error';
      }
    case 'grouped_tool_use':
      {
        const allResolved = message.messages.every(msg => {
          const content = msg.message.content[0];
          return content?.type === 'tool_use' && lookups.resolvedToolUseIDs.has(content.id);
        });
        return allResolved;
      }
    case 'collapsed_read_search':
      {
        
        
        return false;
      }
  }
}
