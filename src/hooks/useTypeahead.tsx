import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from 'src/context/notifications.js';
import { Text } from 'src/ink.js';
import { logEvent } from 'src/services/analytics/index.js';
import { useDebounceCallback } from 'usehooks-ts';
import { type Command, getCommandName } from '../commands.js';
import { getModeFromInput, getValueFromInput } from '../components/PromptInput/inputModes.js';
import type { SuggestionItem, SuggestionType } from '../components/PromptInput/PromptInputFooterSuggestions.js';
import { useIsModalOverlayActive, useRegisterOverlay } from '../context/overlayContext.js';
import { KeyboardEvent } from '../ink/events/keyboard-event.js';

import { useInput } from '../ink.js';
import { useOptionalKeybindingContext, useRegisterKeybindingContext } from '../keybindings/KeybindingContext.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { useShortcutDisplay } from '../keybindings/useShortcutDisplay.js';
import { useAppState, useAppStateStore } from '../state/AppState.js';
import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js';
import type { InlineGhostText, PromptInputMode } from '../types/textInputTypes.js';
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js';
import { generateProgressiveArgumentHint, parseArguments } from '../utils/argumentSubstitution.js';
import { getShellCompletions, type ShellCompletionType } from '../utils/bash/shellCompletion.js';
import { formatLogMetadata } from '../utils/format.js';
import { getSessionIdFromLog, searchSessionsByCustomTitle } from '../utils/sessionStorage.js';
import { applyCommandSuggestion, findMidInputSlashCommand, generateCommandSuggestions, getBestCommandMatch, isCommandInput } from '../utils/suggestions/commandSuggestions.js';
import { getDirectoryCompletions, getPathCompletions, isPathLikeToken } from '../utils/suggestions/directoryCompletion.js';
import { getShellHistoryCompletion } from '../utils/suggestions/shellHistoryCompletion.js';
import { getSlackChannelSuggestions, hasSlackMcpServer } from '../utils/suggestions/slackChannelSuggestions.js';
import { TEAM_LEAD_NAME } from '../utils/swarm/constants.js';
import { applyFileSuggestion, findLongestCommonPrefix, onIndexBuildComplete, startBackgroundCacheRefresh } from './fileSuggestions.js';
import { generateUnifiedSuggestions } from './unifiedSuggestions.js';

const AT_TOKEN_HEAD_RE = /^@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*/u;
const PATH_CHAR_HEAD_RE = /^[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+/u;
const TOKEN_WITH_AT_RE = /(@[\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+)$/u;
const TOKEN_WITHOUT_AT_RE = /[\p{L}\p{N}\p{M}_\-./\\()[\]~:]+$/u;
const HAS_AT_SYMBOL_RE = /(^|\s)@([\p{L}\p{N}\p{M}_\-./\\()[\]~:]*|"[^"]*"?)$/u;
const HASH_CHANNEL_RE = /(^|\s)#([a-z0-9][a-z0-9_-]*)$/;

function isPathMetadata(metadata: unknown): metadata is {
  type: 'directory' | 'file';
} {
  return typeof metadata === 'object' && metadata !== null && 'type' in metadata && (metadata.type === 'directory' || metadata.type === 'file');
}

function getPreservedSelection(prevSuggestions: SuggestionItem[], prevSelection: number, newSuggestions: SuggestionItem[]): number {
  
  if (newSuggestions.length === 0) {
    return -1;
  }

  
  if (prevSelection < 0) {
    return 0;
  }

  
  const prevSelectedItem = prevSuggestions[prevSelection];
  if (!prevSelectedItem) {
    return 0;
  }

  
  const newIndex = newSuggestions.findIndex(item => item.id === prevSelectedItem.id);

  
  return newIndex >= 0 ? newIndex : 0;
}
function buildResumeInputFromSuggestion(suggestion: SuggestionItem): string {
  const metadata = suggestion.metadata as {
    sessionId: string;
  } | undefined;
  return metadata?.sessionId ? `/resume ${metadata.sessionId}` : `/resume ${suggestion.displayText}`;
}
type Props = {
  onInputChange: (value: string) => void;
  onSubmit: (value: string, isSubmittingSlashCommand?: boolean) => void;
  setCursorOffset: (offset: number) => void;
  input: string;
  cursorOffset: number;
  commands: Command[];
  mode: string;
  agents: AgentDefinition[];
  setSuggestionsState: (f: (previousSuggestionsState: {
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  }) => {
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  }) => void;
  suggestionsState: {
    suggestions: SuggestionItem[];
    selectedSuggestion: number;
    commandArgumentHint?: string;
  };
  suppressSuggestions?: boolean;
  markAccepted: () => void;
  onModeChange?: (mode: PromptInputMode) => void;
};
type UseTypeaheadResult = {
  suggestions: SuggestionItem[];
  selectedSuggestion: number;
  suggestionType: SuggestionType;
  maxColumnWidth?: number;
  commandArgumentHint?: string;
  inlineGhostText?: InlineGhostText;
  handleKeyDown: (e: KeyboardEvent) => void;
};

export function extractSearchToken(completionToken: {
  token: string;
  isQuoted?: boolean;
}): string {
  if (completionToken.isQuoted) {
    
    return completionToken.token.slice(2).replace(/"$/, '');
  } else if (completionToken.token.startsWith('@')) {
    return completionToken.token.substring(1);
  } else {
    return completionToken.token;
  }
}

export function formatReplacementValue(options: {
  displayText: string;
  mode: string;
  hasAtPrefix: boolean;
  needsQuotes: boolean;
  isQuoted?: boolean;
  isComplete: boolean;
}): string {
  const {
    displayText,
    mode,
    hasAtPrefix,
    needsQuotes,
    isQuoted,
    isComplete
  } = options;
  const space = isComplete ? ' ' : '';
  if (isQuoted || needsQuotes) {
    
    return mode === 'bash' ? `"${displayText}"${space}` : `@"${displayText}"${space}`;
  } else if (hasAtPrefix) {
    return mode === 'bash' ? `${displayText}${space}` : `@${displayText}${space}`;
  } else {
    return displayText;
  }
}

export function applyShellSuggestion(suggestion: SuggestionItem, input: string, cursorOffset: number, onInputChange: (value: string) => void, setCursorOffset: (offset: number) => void, completionType: ShellCompletionType | undefined): void {
  const beforeCursor = input.slice(0, cursorOffset);
  const lastSpaceIndex = beforeCursor.lastIndexOf(' ');
  const wordStart = lastSpaceIndex + 1;

  
  let replacementText: string;
  if (completionType === 'variable') {
    replacementText = ' + suggestion.displayText + ' ';
  } else if (completionType === 'command') {
    replacementText = suggestion.displayText + ' ';
  } else {
    replacementText = suggestion.displayText;
  }
  const newInput = input.slice(0, wordStart) + replacementText + input.slice(cursorOffset);
  onInputChange(newInput);
  setCursorOffset(wordStart + replacementText.length);
}
const DM_MEMBER_RE = /(^|\s)@[\w-]*$/;
function applyTriggerSuggestion(suggestion: SuggestionItem, input: string, cursorOffset: number, triggerRe: RegExp, onInputChange: (value: string) => void, setCursorOffset: (offset: number) => void): void {
  const m = input.slice(0, cursorOffset).match(triggerRe);
  if (!m || m.index === undefined) return;
  const prefixStart = m.index + (m[1]?.length ?? 0);
  const before = input.slice(0, prefixStart);
  const newInput = before + suggestion.displayText + ' ' + input.slice(cursorOffset);
  onInputChange(newInput);
  setCursorOffset(before.length + suggestion.displayText.length + 1);
}
let currentShellCompletionAbortController: AbortController | null = null;

async function generateBashSuggestions(input: string, cursorOffset: number): Promise<SuggestionItem[]> {
  try {
    if (currentShellCompletionAbortController) {
      currentShellCompletionAbortController.abort();
    }
    currentShellCompletionAbortController = new AbortController();
    const suggestions = await getShellCompletions(input, cursorOffset, currentShellCompletionAbortController.signal);
    return suggestions;
  } catch {
    
    logEvent('tengu_shell_completion_failed', {});
    return [];
  }
}

export function applyDirectorySuggestion(input: string, suggestionId: string, tokenStartPos: number, tokenLength: number, isDirectory: boolean): {
  newInput: string;
  cursorPos: number;
} {
  const suffix = isDirectory ? '/' : ' ';
  const before = input.slice(0, tokenStartPos);
  const after = input.slice(tokenStartPos + tokenLength);
  
  
  const replacement = '@' + suggestionId + suffix;
  const newInput = before + replacement + after;
  return {
    newInput,
    cursorPos: before.length + replacement.length
  };
}

export function extractCompletionToken(text: string, cursorPos: number, includeAtSymbol = false): {
  token: string;
  startPos: number;
  isQuoted?: boolean;
} | null {
  
  if (!text) return null;

  
  const textBeforeCursor = text.substring(0, cursorPos);

  
  if (includeAtSymbol) {
    const quotedAtRegex = /@"([^"]*)"?$/;
    const quotedMatch = textBeforeCursor.match(quotedAtRegex);
    if (quotedMatch && quotedMatch.index !== undefined) {
      const textAfterCursor = text.substring(cursorPos);
      const afterQuotedMatch = textAfterCursor.match(/^[^"]*"?/);
      const quotedSuffix = afterQuotedMatch ? afterQuotedMatch[0] : '';
      return {
        token: quotedMatch[0] + quotedSuffix,
        startPos: quotedMatch.index,
        isQuoted: true
      };
    }
  }

  if (includeAtSymbol) {
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]!))) {
      const fromAt = textBeforeCursor.substring(atIdx);
      const atHeadMatch = fromAt.match(AT_TOKEN_HEAD_RE);
      if (atHeadMatch && atHeadMatch[0].length === fromAt.length) {
        const textAfterCursor = text.substring(cursorPos);
        const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE);
        const tokenSuffix = afterMatch ? afterMatch[0] : '';
        return {
          token: atHeadMatch[0] + tokenSuffix,
          startPos: atIdx,
          isQuoted: false
        };
      }
    }
  }

  const tokenRegex = includeAtSymbol ? TOKEN_WITH_AT_RE : TOKEN_WITHOUT_AT_RE;
  const match = textBeforeCursor.match(tokenRegex);
  if (!match || match.index === undefined) {
    return null;
  }

  const textAfterCursor = text.substring(cursorPos);
  const afterMatch = textAfterCursor.match(PATH_CHAR_HEAD_RE);
  const tokenSuffix = afterMatch ? afterMatch[0] : '';
  return {
    token: match[0] + tokenSuffix,
    startPos: match.index,
    isQuoted: false
  };
}
function extractCommandNameAndArgs(value: string): {
  commandName: string;
  args: string;
} | null {
  if (isCommandInput(value)) {
    const spaceIndex = value.indexOf(' ');
    if (spaceIndex === -1) return {
      commandName: value.slice(1),
      args: ''
    };
    return {
      commandName: value.slice(1, spaceIndex),
      args: value.slice(spaceIndex + 1)
    };
  }
  return null;
}
function hasCommandWithArguments(isAtEndWithWhitespace: boolean, value: string) {
  return !isAtEndWithWhitespace && value.includes(' ') && !value.endsWith(' ');
}

/**
 * Hook for handling typeahead functionality for both commands and file paths
 */
export function useTypeahead({
  commands,
  onInputChange,
  onSubmit,
  setCursorOffset,
  input,
  cursorOffset,
  mode,
  agents,
  setSuggestionsState,
  suggestionsState: {
    suggestions,
    selectedSuggestion,
    commandArgumentHint
  },
  suppressSuggestions = false,
  markAccepted,
  onModeChange
}: Props): UseTypeaheadResult {
  const {
    addNotification
  } = useNotifications();
  const thinkingToggleShortcut = useShortcutDisplay('chat:thinkingToggle', 'Chat', 'alt+t');
  const [suggestionType, setSuggestionType] = useState<SuggestionType>('none');

  const allCommandsMaxWidth = useMemo(() => {
    const visibleCommands = commands.filter(cmd => !cmd.isHidden);
    if (visibleCommands.length === 0) return undefined;
    const maxLen = Math.max(...visibleCommands.map(cmd => getCommandName(cmd).length));
    return maxLen + 6; // +1 for "/" prefix, +5 for padding
  }, [commands]);
  const [maxColumnWidth, setMaxColumnWidth] = useState<number | undefined>(undefined);
  const mcpResources = useAppState(s => s.mcp.resources);
  const store = useAppStateStore();
  const promptSuggestion = useAppState(s => s.promptSuggestion);
  const isViewingTeammate = useAppState(s => !!s.viewingAgentTaskId);

  const keybindingContext = useOptionalKeybindingContext();

  const [inlineGhostText, setInlineGhostText] = useState<InlineGhostText | undefined>(undefined);

  const syncPromptGhostText = useMemo((): InlineGhostText | undefined => {
    if (mode !== 'prompt' || suppressSuggestions) return undefined;
    const midInputCommand = findMidInputSlashCommand(input, cursorOffset);
    if (!midInputCommand) return undefined;
    const match = getBestCommandMatch(midInputCommand.partialCommand, commands);
    if (!match) return undefined;
    return {
      text: match.suffix,
      fullCommand: match.fullCommand,
      insertPosition: midInputCommand.startPos + 1 + midInputCommand.partialCommand.length
    };
  }, [input, cursorOffset, mode, commands, suppressSuggestions]);

  const effectiveGhostText = suppressSuggestions ? undefined : mode === 'prompt' ? syncPromptGhostText : inlineGhostText;

  const cursorOffsetRef = useRef(cursorOffset);
  cursorOffsetRef.current = cursorOffset;

  const latestSearchTokenRef = useRef<string | null>(null);
  const prevInputRef = useRef('');
  const latestPathTokenRef = useRef('');
  const latestBashInputRef = useRef('');
  const latestSlackTokenRef = useRef('');
  const suggestionsRef = useRef(suggestions);
  suggestionsRef.current = suggestions;
  const dismissedForInputRef = useRef<string | null>(null);

  const clearSuggestions = useCallback(() => {
    setSuggestionsState(() => ({
      commandArgumentHint: undefined,
      suggestions: [],
      selectedSuggestion: -1
    }));
    setSuggestionType('none');
    setMaxColumnWidth(undefined);
    setInlineGhostText(undefined);
  }, [setSuggestionsState]);

  const fetchFileSuggestions = useCallback(async (searchToken: string, isAtSymbol = false): Promise<void> => {
    latestSearchTokenRef.current = searchToken;
    const combinedItems = await generateUnifiedSuggestions(searchToken, mcpResources, agents, isAtSymbol);
    if (latestSearchTokenRef.current !== searchToken) {
      return;
    }
    if (combinedItems.length === 0) {
      setSuggestionsState(() => ({
        commandArgumentHint: undefined,
        suggestions: [],
        selectedSuggestion: -1
      }));
      setSuggestionType('none');
      setMaxColumnWidth(undefined);
      return;
    }
    setSuggestionsState(prev => ({
      commandArgumentHint: undefined,
      suggestions: combinedItems,
      selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, combinedItems)
    }));
    setSuggestionType(combinedItems.length > 0 ? 'file' : 'none');
    setMaxColumnWidth(undefined); // No fixed width for file suggestions
  }, [mcpResources, setSuggestionsState, setSuggestionType, setMaxColumnWidth, agents]);

  
  
  
  
  
  
  
  
  
  
  
  
  
  useEffect(() => {
    if ("production" !== 'test') {
      startBackgroundCacheRefresh();
    }
    return onIndexBuildComplete(() => {
      const token = latestSearchTokenRef.current;
      if (token !== null) {
        latestSearchTokenRef.current = null;
        void fetchFileSuggestions(token, token === '');
      }
    });
  }, [fetchFileSuggestions]);

  
  
  
  
  const debouncedFetchFileSuggestions = useDebounceCallback(fetchFileSuggestions, 50);
  const fetchSlackChannels = useCallback(async (partial: string): Promise<void> => {
    latestSlackTokenRef.current = partial;
    const channels = await getSlackChannelSuggestions(store.getState().mcp.clients, partial);
    if (latestSlackTokenRef.current !== partial) return;
    setSuggestionsState(prev => ({
      commandArgumentHint: undefined,
      suggestions: channels,
      selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, channels)
    }));
    setSuggestionType(channels.length > 0 ? 'slack-channel' : 'none');
    setMaxColumnWidth(undefined);
  },
  
  [setSuggestionsState]);

  
  
  const debouncedFetchSlackChannels = useDebounceCallback(fetchSlackChannels, 150);

  
  
  const updateSuggestions = useCallback(async (value: string, inputCursorOffset?: number): Promise<void> => {
    
    const effectiveCursorOffset = inputCursorOffset ?? cursorOffsetRef.current;
    if (suppressSuggestions) {
      debouncedFetchFileSuggestions.cancel();
      clearSuggestions();
      return;
    }

    
    
    
    
    if (mode === 'prompt') {
      const midInputCommand = findMidInputSlashCommand(value, effectiveCursorOffset);
      if (midInputCommand) {
        const match = getBestCommandMatch(midInputCommand.partialCommand, commands);
        if (match) {
          
          setSuggestionsState(() => ({
            commandArgumentHint: undefined,
            suggestions: [],
            selectedSuggestion: -1
          }));
          setSuggestionType('none');
          setMaxColumnWidth(undefined);
          return;
        }
      }
    }

    
    if (mode === 'bash' && value.trim()) {
      latestBashInputRef.current = value;
      const historyMatch = await getShellHistoryCompletion(value);
      
      if (latestBashInputRef.current !== value) {
        return;
      }
      if (historyMatch) {
        setInlineGhostText({
          text: historyMatch.suffix,
          fullCommand: historyMatch.fullCommand,
          insertPosition: value.length
        });
        
        setSuggestionsState(() => ({
          commandArgumentHint: undefined,
          suggestions: [],
          selectedSuggestion: -1
        }));
        setSuggestionType('none');
        setMaxColumnWidth(undefined);
        return;
      } else {
        
        setInlineGhostText(undefined);
      }
    }

    
    
    
    const atMatch = mode !== 'bash' ? value.substring(0, effectiveCursorOffset).match(/(^|\s)@([\w-]*)$/) : null;
    if (atMatch) {
      const partialName = (atMatch[2] ?? '').toLowerCase();
      
      
      const state = store.getState();
      const members: SuggestionItem[] = [];
      const seen = new Set<string>();
      if (isAgentSwarmsEnabled() && state.teamContext) {
        for (const t of Object.values(state.teamContext.teammates ?? {})) {
          if (t.name === TEAM_LEAD_NAME) continue;
          if (!t.name.toLowerCase().startsWith(partialName)) continue;
          seen.add(t.name);
          members.push({
            id: `dm-${t.name}`,
            displayText: `@${t.name}`,
            description: 'send message'
          });
        }
      }
      for (const [name, agentId] of state.agentNameRegistry) {
        if (seen.has(name)) continue;
        if (!name.toLowerCase().startsWith(partialName)) continue;
        const status = state.tasks[agentId]?.status;
        members.push({
          id: `dm-${name}`,
          displayText: `@${name}`,
          description: status ? `send message · ${status}` : 'send message'
        });
      }
      if (members.length > 0) {
        debouncedFetchFileSuggestions.cancel();
        setSuggestionsState(prev => ({
          commandArgumentHint: undefined,
          suggestions: members,
          selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, members)
        }));
        setSuggestionType('agent');
        setMaxColumnWidth(undefined);
        return;
      }
    }

    
    if (mode === 'prompt') {
      const hashMatch = value.substring(0, effectiveCursorOffset).match(HASH_CHANNEL_RE);
      if (hashMatch && hasSlackMcpServer(store.getState().mcp.clients)) {
        debouncedFetchSlackChannels(hashMatch[2]!);
        return;
      } else if (suggestionType === 'slack-channel') {
        debouncedFetchSlackChannels.cancel();
        clearSuggestions();
      }
    }

    
    
    const hasAtSymbol = value.substring(0, effectiveCursorOffset).match(HAS_AT_SYMBOL_RE);

    
    
    
    
    const isAtEndWithWhitespace = effectiveCursorOffset === value.length && effectiveCursorOffset > 0 && value.length > 0 && value[effectiveCursorOffset - 1] === ' ';

    
    if (mode === 'prompt' && isCommandInput(value) && effectiveCursorOffset > 0) {
      const parsedCommand = extractCommandNameAndArgs(value);
      if (parsedCommand && parsedCommand.commandName === 'add-dir' && parsedCommand.args) {
        const {
          args
        } = parsedCommand;

        
        if (args.match(/\s+$/)) {
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
          return;
        }
        const dirSuggestions = await getDirectoryCompletions(args);
        if (dirSuggestions.length > 0) {
          setSuggestionsState(prev => ({
            suggestions: dirSuggestions,
            selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, dirSuggestions),
            commandArgumentHint: undefined
          }));
          setSuggestionType('directory');
          return;
        }

        
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
        return;
      }

      
      if (parsedCommand && parsedCommand.commandName === 'resume' && parsedCommand.args !== undefined && value.includes(' ')) {
        const {
          args
        } = parsedCommand;

        
        const matches = await searchSessionsByCustomTitle(args, {
          limit: 10
        });
        const suggestions = matches.map(log => {
          const sessionId = getSessionIdFromLog(log);
          return {
            id: `resume-title-${sessionId}`,
            displayText: log.customTitle!,
            description: formatLogMetadata(log),
            metadata: {
              sessionId
            }
          };
        });
        if (suggestions.length > 0) {
          setSuggestionsState(prev => ({
            suggestions,
            selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, suggestions),
            commandArgumentHint: undefined
          }));
          setSuggestionType('custom-title');
          return;
        }

        
        clearSuggestions();
        return;
      }
    }

    
    if (mode === 'prompt' && isCommandInput(value) && effectiveCursorOffset > 0 && !hasCommandWithArguments(isAtEndWithWhitespace, value)) {
      let commandArgumentHint: string | undefined = undefined;
      if (value.length > 1) {
        
        

        
        const spaceIndex = value.indexOf(' ');
        const commandName = spaceIndex === -1 ? value.slice(1) : value.slice(1, spaceIndex);

        
        const hasRealArguments = spaceIndex !== -1 && value.slice(spaceIndex + 1).trim().length > 0;

        
        const hasExactlyOneTrailingSpace = spaceIndex !== -1 && value.length === spaceIndex + 1;

        
        
        if (spaceIndex !== -1) {
          const exactMatch = commands.find(cmd => getCommandName(cmd) === commandName);
          if (exactMatch || hasRealArguments) {
            
            if (exactMatch?.argumentHint && hasExactlyOneTrailingSpace) {
              commandArgumentHint = exactMatch.argumentHint;
            }
            
            else if (exactMatch?.type === 'prompt' && exactMatch.argNames?.length && value.endsWith(' ')) {
              const argsText = value.slice(spaceIndex + 1);
              const typedArgs = parseArguments(argsText);
              commandArgumentHint = generateProgressiveArgumentHint(exactMatch.argNames, typedArgs);
            }
            setSuggestionsState(() => ({
              commandArgumentHint,
              suggestions: [],
              selectedSuggestion: -1
            }));
            setSuggestionType('none');
            setMaxColumnWidth(undefined);
            return;
          }
        }

        
        
      }
      const commandItems = generateCommandSuggestions(value, commands);
      setSuggestionsState(() => ({
        commandArgumentHint,
        suggestions: commandItems,
        selectedSuggestion: commandItems.length > 0 ? 0 : -1
      }));
      setSuggestionType(commandItems.length > 0 ? 'command' : 'none');

      
      if (commandItems.length > 0) {
        setMaxColumnWidth(allCommandsMaxWidth);
      }
      return;
    }
    if (suggestionType === 'command') {
      
      
      
      debouncedFetchFileSuggestions.cancel();
      clearSuggestions();
    } else if (isCommandInput(value) && hasCommandWithArguments(isAtEndWithWhitespace, value)) {
      
      
      setSuggestionsState(prev => prev.commandArgumentHint ? {
        ...prev,
        commandArgumentHint: undefined
      } : prev);
    }
    if (suggestionType === 'custom-title') {
      
      
      clearSuggestions();
    }
    if (suggestionType === 'agent' && suggestionsRef.current.some((s: SuggestionItem) => s.id?.startsWith('dm-'))) {
      
      
      const hasAt = value.substring(0, effectiveCursorOffset).match(/(^|\s)@([\w-]*)$/);
      if (!hasAt) {
        clearSuggestions();
      }
    }

    
    
    if (hasAtSymbol && mode !== 'bash') {
      
      const completionToken = extractCompletionToken(value, effectiveCursorOffset, true);
      if (completionToken && completionToken.token.startsWith('@')) {
        const searchToken = extractSearchToken(completionToken);

        
        
        if (isPathLikeToken(searchToken)) {
          latestPathTokenRef.current = searchToken;
          const pathSuggestions = await getPathCompletions(searchToken, {
            maxResults: 10
          });
          
          if (latestPathTokenRef.current !== searchToken) {
            return;
          }
          if (pathSuggestions.length > 0) {
            setSuggestionsState(prev => ({
              suggestions: pathSuggestions,
              selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, pathSuggestions),
              commandArgumentHint: undefined
            }));
            setSuggestionType('directory');
            return;
          }
        }

        
        
        if (latestSearchTokenRef.current === searchToken) {
          return;
        }
        void debouncedFetchFileSuggestions(searchToken, true);
        return;
      }
    }

    
    if (suggestionType === 'file') {
      const completionToken = extractCompletionToken(value, effectiveCursorOffset, true);
      if (completionToken) {
        const searchToken = extractSearchToken(completionToken);
        
        if (latestSearchTokenRef.current === searchToken) {
          return;
        }
        void debouncedFetchFileSuggestions(searchToken, false);
      } else {
        
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    }

    
    if (suggestionType === 'shell') {
      const inputSnapshot = (suggestionsRef.current[0]?.metadata as {
        inputSnapshot?: string;
      })?.inputSnapshot;
      if (mode !== 'bash' || value !== inputSnapshot) {
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    }
  }, [suggestionType, commands, setSuggestionsState, clearSuggestions, debouncedFetchFileSuggestions, debouncedFetchSlackChannels, mode, suppressSuggestions,
  
  
  allCommandsMaxWidth]);

  
  
  
  
  useEffect(() => {
    
    if (dismissedForInputRef.current === input) {
      return;
    }
    
    
    
    if (prevInputRef.current !== input) {
      prevInputRef.current = input;
      latestSearchTokenRef.current = null;
    }
    
    dismissedForInputRef.current = null;
    void updateSuggestions(input);
  }, [input, updateSuggestions]);

  
  const handleTab = useCallback(async () => {
    
    if (effectiveGhostText) {
      
      if (mode === 'bash') {
        
        onInputChange(effectiveGhostText.fullCommand);
        setCursorOffset(effectiveGhostText.fullCommand.length);
        setInlineGhostText(undefined);
        return;
      }

      
      const midInputCommand = findMidInputSlashCommand(input, cursorOffset);
      if (midInputCommand) {
        
        const before = input.slice(0, midInputCommand.startPos);
        const after = input.slice(midInputCommand.startPos + midInputCommand.token.length);
        const newInput = before + '/' + effectiveGhostText.fullCommand + ' ' + after;
        const newCursorOffset = midInputCommand.startPos + 1 + effectiveGhostText.fullCommand.length + 1;
        onInputChange(newInput);
        setCursorOffset(newCursorOffset);
        return;
      }
    }

    
    if (suggestions.length > 0) {
      
      debouncedFetchFileSuggestions.cancel();
      debouncedFetchSlackChannels.cancel();
      const index = selectedSuggestion === -1 ? 0 : selectedSuggestion;
      const suggestion = suggestions[index];
      if (suggestionType === 'command' && index < suggestions.length) {
        if (suggestion) {
          applyCommandSuggestion(suggestion, false,
          
          commands, onInputChange, setCursorOffset, onSubmit);
          clearSuggestions();
        }
      } else if (suggestionType === 'custom-title' && suggestions.length > 0) {
        
        if (suggestion) {
          const newInput = buildResumeInputFromSuggestion(suggestion);
          onInputChange(newInput);
          setCursorOffset(newInput.length);
          clearSuggestions();
        }
      } else if (suggestionType === 'directory' && suggestions.length > 0) {
        const suggestion = suggestions[index];
        if (suggestion) {
          
          const isInCommandContext = isCommandInput(input);
          let newInput: string;
          if (isInCommandContext) {
            
            const spaceIndex = input.indexOf(' ');
            const commandPart = input.slice(0, spaceIndex + 1); 
            const cmdSuffix = isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory' ? '/' : ' ';
            newInput = commandPart + suggestion.id + cmdSuffix;
            onInputChange(newInput);
            setCursorOffset(newInput.length);
            if (isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory') {
              
              setSuggestionsState(prev => ({
                ...prev,
                commandArgumentHint: undefined
              }));
              void updateSuggestions(newInput, newInput.length);
            } else {
              clearSuggestions();
            }
          } else {
            
            
            const completionTokenWithAt = extractCompletionToken(input, cursorOffset, true);
            const completionToken = completionTokenWithAt ?? extractCompletionToken(input, cursorOffset, false);
            if (completionToken) {
              const isDir = isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory';
              const result = applyDirectorySuggestion(input, suggestion.id, completionToken.startPos, completionToken.token.length, isDir);
              newInput = result.newInput;
              onInputChange(newInput);
              setCursorOffset(result.cursorPos);
              if (isDir) {
                
                setSuggestionsState(prev => ({
                  ...prev,
                  commandArgumentHint: undefined
                }));
                void updateSuggestions(newInput, result.cursorPos);
              } else {
                
                clearSuggestions();
              }
            } else {
              
              
              clearSuggestions();
            }
          }
        }
      } else if (suggestionType === 'shell' && suggestions.length > 0) {
        const suggestion = suggestions[index];
        if (suggestion) {
          const metadata = suggestion.metadata as {
            completionType: ShellCompletionType;
          } | undefined;
          applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
          clearSuggestions();
        }
      } else if (suggestionType === 'agent' && suggestions.length > 0 && suggestions[index]?.id?.startsWith('dm-')) {
        const suggestion = suggestions[index];
        if (suggestion) {
          applyTriggerSuggestion(suggestion, input, cursorOffset, DM_MEMBER_RE, onInputChange, setCursorOffset);
          clearSuggestions();
        }
      } else if (suggestionType === 'slack-channel' && suggestions.length > 0) {
        const suggestion = suggestions[index];
        if (suggestion) {
          applyTriggerSuggestion(suggestion, input, cursorOffset, HASH_CHANNEL_RE, onInputChange, setCursorOffset);
          clearSuggestions();
        }
      } else if (suggestionType === 'file' && suggestions.length > 0) {
        const completionToken = extractCompletionToken(input, cursorOffset, true);
        if (!completionToken) {
          clearSuggestions();
          return;
        }

        
        const commonPrefix = findLongestCommonPrefix(suggestions);

        
        const hasAtPrefix = completionToken.token.startsWith('@');
        
        let effectiveTokenLength: number;
        if (completionToken.isQuoted) {
          
          effectiveTokenLength = completionToken.token.slice(2).replace(/"$/, '').length;
        } else if (hasAtPrefix) {
          effectiveTokenLength = completionToken.token.length - 1;
        } else {
          effectiveTokenLength = completionToken.token.length;
        }

        
        
        if (commonPrefix.length > effectiveTokenLength) {
          const replacementValue = formatReplacementValue({
            displayText: commonPrefix,
            mode,
            hasAtPrefix,
            needsQuotes: false,
            
            isQuoted: completionToken.isQuoted,
            isComplete: false 
          });
          applyFileSuggestion(replacementValue, input, completionToken.token, completionToken.startPos, onInputChange, setCursorOffset);
          
          
          void updateSuggestions(input.replace(completionToken.token, replacementValue), cursorOffset);
        } else if (index < suggestions.length) {
          
          const suggestion = suggestions[index];
          if (suggestion) {
            const needsQuotes = suggestion.displayText.includes(' ');
            const replacementValue = formatReplacementValue({
              displayText: suggestion.displayText,
              mode,
              hasAtPrefix,
              needsQuotes,
              isQuoted: completionToken.isQuoted,
              isComplete: true 
            });
            applyFileSuggestion(replacementValue, input, completionToken.token, completionToken.startPos, onInputChange, setCursorOffset);
            clearSuggestions();
          }
        }
      }
    } else if (input.trim() !== '') {
      let suggestionType: SuggestionType;
      let suggestionItems: SuggestionItem[];
      if (mode === 'bash') {
        suggestionType = 'shell';
        
        const bashSuggestions = await generateBashSuggestions(input, cursorOffset);
        if (bashSuggestions.length === 1) {
          
          const suggestion = bashSuggestions[0];
          if (suggestion) {
            const metadata = suggestion.metadata as {
              completionType: ShellCompletionType;
            } | undefined;
            applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
          }
          suggestionItems = [];
        } else {
          suggestionItems = bashSuggestions;
        }
      } else {
        suggestionType = 'file';
        
        const completionInfo = extractCompletionToken(input, cursorOffset, true);
        if (completionInfo) {
          
          const isAtSymbol = completionInfo.token.startsWith('@');
          const searchToken = isAtSymbol ? completionInfo.token.substring(1) : completionInfo.token;
          suggestionItems = await generateUnifiedSuggestions(searchToken, mcpResources, agents, isAtSymbol);
        } else {
          suggestionItems = [];
        }
      }
      if (suggestionItems.length > 0) {
        
        setSuggestionsState(prev => ({
          commandArgumentHint: undefined,
          suggestions: suggestionItems,
          selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, suggestionItems)
        }));
        setSuggestionType(suggestionType);
        setMaxColumnWidth(undefined);
      }
    }
  }, [suggestions, selectedSuggestion, input, suggestionType, commands, mode, onInputChange, setCursorOffset, onSubmit, clearSuggestions, cursorOffset, updateSuggestions, mcpResources, setSuggestionsState, agents, debouncedFetchFileSuggestions, debouncedFetchSlackChannels, effectiveGhostText]);

  
  const handleEnter = useCallback(() => {
    if (selectedSuggestion < 0 || suggestions.length === 0) return;
    const suggestion = suggestions[selectedSuggestion];
    if (suggestionType === 'command' && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        applyCommandSuggestion(suggestion, true,
        
        commands, onInputChange, setCursorOffset, onSubmit);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'custom-title' && selectedSuggestion < suggestions.length) {
      
      if (suggestion) {
        const newInput = buildResumeInputFromSuggestion(suggestion);
        onInputChange(newInput);
        setCursorOffset(newInput.length);
        onSubmit(newInput, true);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'shell' && selectedSuggestion < suggestions.length) {
      const suggestion = suggestions[selectedSuggestion];
      if (suggestion) {
        const metadata = suggestion.metadata as {
          completionType: ShellCompletionType;
        } | undefined;
        applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'agent' && selectedSuggestion < suggestions.length && suggestion?.id?.startsWith('dm-')) {
      applyTriggerSuggestion(suggestion, input, cursorOffset, DM_MEMBER_RE, onInputChange, setCursorOffset);
      debouncedFetchFileSuggestions.cancel();
      clearSuggestions();
    } else if (suggestionType === 'slack-channel' && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        applyTriggerSuggestion(suggestion, input, cursorOffset, HASH_CHANNEL_RE, onInputChange, setCursorOffset);
        debouncedFetchSlackChannels.cancel();
        clearSuggestions();
      }
    } else if (suggestionType === 'file' && selectedSuggestion < suggestions.length) {
      
      const completionInfo = extractCompletionToken(input, cursorOffset, true);
      if (completionInfo) {
        if (suggestion) {
          const hasAtPrefix = completionInfo.token.startsWith('@');
          const needsQuotes = suggestion.displayText.includes(' ');
          const replacementValue = formatReplacementValue({
            displayText: suggestion.displayText,
            mode,
            hasAtPrefix,
            needsQuotes,
            isQuoted: completionInfo.isQuoted,
            isComplete: true 
          });
          applyFileSuggestion(replacementValue, input, completionInfo.token, completionInfo.startPos, onInputChange, setCursorOffset);
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
        }
      }
    } else if (suggestionType === 'directory' && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        
        
        
        if (isCommandInput(input)) {
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
          return;
        }

        
        const completionTokenWithAt = extractCompletionToken(input, cursorOffset, true);
        const completionToken = completionTokenWithAt ?? extractCompletionToken(input, cursorOffset, false);
        if (completionToken) {
          const isDir = isPathMetadata(suggestion.metadata) && suggestion.metadata.type === 'directory';
          const result = applyDirectorySuggestion(input, suggestion.id, completionToken.startPos, completionToken.token.length, isDir);
          onInputChange(result.newInput);
          setCursorOffset(result.cursorPos);
        }
        
        

        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    }
  }, [suggestions, selectedSuggestion, suggestionType, commands, input, cursorOffset, mode, onInputChange, setCursorOffset, onSubmit, clearSuggestions, debouncedFetchFileSuggestions, debouncedFetchSlackChannels]);

  
  const handleAutocompleteAccept = useCallback(() => {
    void handleTab();
  }, [handleTab]);

  
  const handleAutocompleteDismiss = useCallback(() => {
    debouncedFetchFileSuggestions.cancel();
    debouncedFetchSlackChannels.cancel();
    clearSuggestions();
    
    dismissedForInputRef.current = input;
  }, [debouncedFetchFileSuggestions, debouncedFetchSlackChannels, clearSuggestions, input]);

  
  const handleAutocompletePrevious = useCallback(() => {
    setSuggestionsState(prev => ({
      ...prev,
      selectedSuggestion: prev.selectedSuggestion <= 0 ? suggestions.length - 1 : prev.selectedSuggestion - 1
    }));
  }, [suggestions.length, setSuggestionsState]);

  
  const handleAutocompleteNext = useCallback(() => {
    setSuggestionsState(prev => ({
      ...prev,
      selectedSuggestion: prev.selectedSuggestion >= suggestions.length - 1 ? 0 : prev.selectedSuggestion + 1
    }));
  }, [suggestions.length, setSuggestionsState]);

  
  const autocompleteHandlers = useMemo(() => ({
    'autocomplete:accept': handleAutocompleteAccept,
    'autocomplete:dismiss': handleAutocompleteDismiss,
    'autocomplete:previous': handleAutocompletePrevious,
    'autocomplete:next': handleAutocompleteNext
  }), [handleAutocompleteAccept, handleAutocompleteDismiss, handleAutocompletePrevious, handleAutocompleteNext]);

  
  
  const isAutocompleteActive = suggestions.length > 0 || !!effectiveGhostText;
  const isModalOverlayActive = useIsModalOverlayActive();
  useRegisterOverlay('autocomplete', isAutocompleteActive);
  
  
  useRegisterKeybindingContext('Autocomplete', isAutocompleteActive);

  
  
  useKeybindings(autocompleteHandlers, {
    context: 'Autocomplete',
    isActive: isAutocompleteActive && !isModalOverlayActive
  });
  function acceptSuggestionText(text: string): void {
    const detectedMode = getModeFromInput(text);
    if (detectedMode !== 'prompt' && onModeChange) {
      onModeChange(detectedMode);
      const stripped = getValueFromInput(text);
      onInputChange(stripped);
      setCursorOffset(stripped.length);
    } else {
      onInputChange(text);
      setCursorOffset(text.length);
    }
  }

  
  const handleKeyDown = (e: KeyboardEvent): void => {
    
    if (e.key === 'right' && !isViewingTeammate) {
      const suggestionText = promptSuggestion.text;
      const suggestionShownAt = promptSuggestion.shownAt;
      if (suggestionText && suggestionShownAt > 0 && input === '') {
        markAccepted();
        acceptSuggestionText(suggestionText);
        e.stopImmediatePropagation();
        return;
      }
    }

    
    
    if (e.key === 'tab' && !e.shift) {
      
      if (suggestions.length > 0 || effectiveGhostText) {
        return;
      }
      
      const suggestionText = promptSuggestion.text;
      const suggestionShownAt = promptSuggestion.shownAt;
      if (suggestionText && suggestionShownAt > 0 && input === '' && !isViewingTeammate) {
        e.preventDefault();
        markAccepted();
        acceptSuggestionText(suggestionText);
        return;
      }
      
      if (input.trim() === '') {
        e.preventDefault();
        addNotification({
          key: 'thinking-toggle-hint',
          jsx: <Text dimColor>
              Use {thinkingToggleShortcut} to toggle thinking
            </Text>,
          priority: 'immediate',
          timeoutMs: 3000
        });
      }
      return;
    }

    
    if (suggestions.length === 0) return;

    
    
    const hasPendingChord = keybindingContext?.pendingChord != null;
    if (e.ctrl && e.key === 'n' && !hasPendingChord) {
      e.preventDefault();
      handleAutocompleteNext();
      return;
    }
    if (e.ctrl && e.key === 'p' && !hasPendingChord) {
      e.preventDefault();
      handleAutocompletePrevious();
      return;
    }

    
    
    
    if (e.key === 'return' && !e.shift && !e.meta) {
      e.preventDefault();
      handleEnter();
    }
  };

  
  
  
  
  useInput((_input, _key, event) => {
    const kbEvent = new KeyboardEvent(event.keypress);
    handleKeyDown(kbEvent);
    if (kbEvent.didStopImmediatePropagation()) {
      event.stopImmediatePropagation();
    }
  });
  return {
    suggestions,
    selectedSuggestion,
    suggestionType,
    maxColumnWidth,
    commandArgumentHint,
    inlineGhostText: effectiveGhostText,
    handleKeyDown
  };
}
 + suggestion.displayText +  STR30000 ;
  } else if (completionType ===  STR30001 ) {
    replacementText = suggestion.displayText +  STR30002 ;
  } else {
    replacementText = suggestion.displayText;
  }
  const newInput = input.slice(0, wordStart) + replacementText + input.slice(cursorOffset);
  onInputChange(newInput);
  setCursorOffset(wordStart + replacementText.length);
}
const DM_MEMBER_RE = /(^|\s)@[\w-]*$/;
function applyTriggerSuggestion(suggestion: SuggestionItem, input: string, cursorOffset: number, triggerRe: RegExp, onInputChange: (value: string) => void, setCursorOffset: (offset: number) => void): void {
  const m = input.slice(0, cursorOffset).match(triggerRe);
  if (!m || m.index === undefined) return;
  const prefixStart = m.index + (m[1]?.length ?? 0);
  const before = input.slice(0, prefixStart);
  const newInput = before + suggestion.displayText +  STR30003  + input.slice(cursorOffset);
  onInputChange(newInput);
  setCursorOffset(before.length + suggestion.displayText.length + 1);
}
let currentShellCompletionAbortController: AbortController | null = null;

async function generateBashSuggestions(input: string, cursorOffset: number): Promise<SuggestionItem[]> {
  try {
    if (currentShellCompletionAbortController) {
      currentShellCompletionAbortController.abort();
    }
    currentShellCompletionAbortController = new AbortController();
    const suggestions = await getShellCompletions(input, cursorOffset, currentShellCompletionAbortController.signal);
    return suggestions;
  } catch {
    
    logEvent( STR30004 , {});
    return [];
  }
}

export function applyDirectorySuggestion(input: string, suggestionId: string, tokenStartPos: number, tokenLength: number, isDirectory: boolean): {
  newInput: string;
  cursorPos: number;
} {
  const suffix = isDirectory ?  STR30005  :  STR30006 ;
  const before = input.slice(0, tokenStartPos);
  const after = input.slice(tokenStartPos + tokenLength);
  
  
  const replacement =  STR30007  + suggestionId + suffix;
  const newInput = before + replacement + after;
  return {
    newInput,
    cursorPos: before.length + replacement.length
  };
}

export function extractCompletionToken(text: string, cursorPos: number, includeAtSymbol = false): {
  token: string;
  startPos: number;
  isQuoted?: boolean;
} | null {
  
  if (!text) return null;

  
  const textBeforeCursor = text.substring(0, cursorPos);

  
  if (includeAtSymbol) {
    const quotedAtRegex = /@ STR30008 ]*) STR30009 ]* STR30010 / STR30011 production STR30012 help me /com STR30013 command + single space STR30014  prefix and optional closing  STR30015 $/,  STR30016 ).length;
        } else if (hasAtPrefix) {
          effectiveTokenLength = completionToken.token.length - 1;
        } else {
          effectiveTokenLength = completionToken.token.length;
        }

        
        
        if (commonPrefix.length > effectiveTokenLength) {
          const replacementValue = formatReplacementValue({
            displayText: commonPrefix,
            mode,
            hasAtPrefix,
            needsQuotes: false,
            
            isQuoted: completionToken.isQuoted,
            isComplete: false 
          });
          applyFileSuggestion(replacementValue, input, completionToken.token, completionToken.startPos, onInputChange, setCursorOffset);
          
          
          void updateSuggestions(input.replace(completionToken.token, replacementValue), cursorOffset);
        } else if (index < suggestions.length) {
          
          const suggestion = suggestions[index];
          if (suggestion) {
            const needsQuotes = suggestion.displayText.includes( STR30017 );
            const replacementValue = formatReplacementValue({
              displayText: suggestion.displayText,
              mode,
              hasAtPrefix,
              needsQuotes,
              isQuoted: completionToken.isQuoted,
              isComplete: true 
            });
            applyFileSuggestion(replacementValue, input, completionToken.token, completionToken.startPos, onInputChange, setCursorOffset);
            clearSuggestions();
          }
        }
      }
    } else if (input.trim() !==  STR30018 ) {
      let suggestionType: SuggestionType;
      let suggestionItems: SuggestionItem[];
      if (mode ===  STR30019 ) {
        suggestionType =  STR30020 ;
        
        const bashSuggestions = await generateBashSuggestions(input, cursorOffset);
        if (bashSuggestions.length === 1) {
          
          const suggestion = bashSuggestions[0];
          if (suggestion) {
            const metadata = suggestion.metadata as {
              completionType: ShellCompletionType;
            } | undefined;
            applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
          }
          suggestionItems = [];
        } else {
          suggestionItems = bashSuggestions;
        }
      } else {
        suggestionType =  STR30021 ;
        
        const completionInfo = extractCompletionToken(input, cursorOffset, true);
        if (completionInfo) {
          
          const isAtSymbol = completionInfo.token.startsWith( STR30022 );
          const searchToken = isAtSymbol ? completionInfo.token.substring(1) : completionInfo.token;
          suggestionItems = await generateUnifiedSuggestions(searchToken, mcpResources, agents, isAtSymbol);
        } else {
          suggestionItems = [];
        }
      }
      if (suggestionItems.length > 0) {
        
        setSuggestionsState(prev => ({
          commandArgumentHint: undefined,
          suggestions: suggestionItems,
          selectedSuggestion: getPreservedSelection(prev.suggestions, prev.selectedSuggestion, suggestionItems)
        }));
        setSuggestionType(suggestionType);
        setMaxColumnWidth(undefined);
      }
    }
  }, [suggestions, selectedSuggestion, input, suggestionType, commands, mode, onInputChange, setCursorOffset, onSubmit, clearSuggestions, cursorOffset, updateSuggestions, mcpResources, setSuggestionsState, agents, debouncedFetchFileSuggestions, debouncedFetchSlackChannels, effectiveGhostText]);

  
  const handleEnter = useCallback(() => {
    if (selectedSuggestion < 0 || suggestions.length === 0) return;
    const suggestion = suggestions[selectedSuggestion];
    if (suggestionType ===  STR30023  && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        applyCommandSuggestion(suggestion, true,
        
        commands, onInputChange, setCursorOffset, onSubmit);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType ===  STR30024  && selectedSuggestion < suggestions.length) {
      
      if (suggestion) {
        const newInput = buildResumeInputFromSuggestion(suggestion);
        onInputChange(newInput);
        setCursorOffset(newInput.length);
        onSubmit(newInput, true);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType ===  STR30025  && selectedSuggestion < suggestions.length) {
      const suggestion = suggestions[selectedSuggestion];
      if (suggestion) {
        const metadata = suggestion.metadata as {
          completionType: ShellCompletionType;
        } | undefined;
        applyShellSuggestion(suggestion, input, cursorOffset, onInputChange, setCursorOffset, metadata?.completionType);
        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    } else if (suggestionType ===  STR30026  && selectedSuggestion < suggestions.length && suggestion?.id?.startsWith( STR30027 )) {
      applyTriggerSuggestion(suggestion, input, cursorOffset, DM_MEMBER_RE, onInputChange, setCursorOffset);
      debouncedFetchFileSuggestions.cancel();
      clearSuggestions();
    } else if (suggestionType ===  STR30028  && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        applyTriggerSuggestion(suggestion, input, cursorOffset, HASH_CHANNEL_RE, onInputChange, setCursorOffset);
        debouncedFetchSlackChannels.cancel();
        clearSuggestions();
      }
    } else if (suggestionType ===  STR30029  && selectedSuggestion < suggestions.length) {
      
      const completionInfo = extractCompletionToken(input, cursorOffset, true);
      if (completionInfo) {
        if (suggestion) {
          const hasAtPrefix = completionInfo.token.startsWith( STR30030 );
          const needsQuotes = suggestion.displayText.includes( STR30031 );
          const replacementValue = formatReplacementValue({
            displayText: suggestion.displayText,
            mode,
            hasAtPrefix,
            needsQuotes,
            isQuoted: completionInfo.isQuoted,
            isComplete: true 
          });
          applyFileSuggestion(replacementValue, input, completionInfo.token, completionInfo.startPos, onInputChange, setCursorOffset);
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
        }
      }
    } else if (suggestionType ===  STR30032  && selectedSuggestion < suggestions.length) {
      if (suggestion) {
        
        
        
        if (isCommandInput(input)) {
          debouncedFetchFileSuggestions.cancel();
          clearSuggestions();
          return;
        }

        
        const completionTokenWithAt = extractCompletionToken(input, cursorOffset, true);
        const completionToken = completionTokenWithAt ?? extractCompletionToken(input, cursorOffset, false);
        if (completionToken) {
          const isDir = isPathMetadata(suggestion.metadata) && suggestion.metadata.type ===  STR30033 ;
          const result = applyDirectorySuggestion(input, suggestion.id, completionToken.startPos, completionToken.token.length, isDir);
          onInputChange(result.newInput);
          setCursorOffset(result.cursorPos);
        }
        
        

        debouncedFetchFileSuggestions.cancel();
        clearSuggestions();
      }
    }
  }, [suggestions, selectedSuggestion, suggestionType, commands, input, cursorOffset, mode, onInputChange, setCursorOffset, onSubmit, clearSuggestions, debouncedFetchFileSuggestions, debouncedFetchSlackChannels]);

  
  const handleAutocompleteAccept = useCallback(() => {
    void handleTab();
  }, [handleTab]);

  
  const handleAutocompleteDismiss = useCallback(() => {
    debouncedFetchFileSuggestions.cancel();
    debouncedFetchSlackChannels.cancel();
    clearSuggestions();
    
    dismissedForInputRef.current = input;
  }, [debouncedFetchFileSuggestions, debouncedFetchSlackChannels, clearSuggestions, input]);

  
  const handleAutocompletePrevious = useCallback(() => {
    setSuggestionsState(prev => ({
      ...prev,
      selectedSuggestion: prev.selectedSuggestion <= 0 ? suggestions.length - 1 : prev.selectedSuggestion - 1
    }));
  }, [suggestions.length, setSuggestionsState]);

  
  const handleAutocompleteNext = useCallback(() => {
    setSuggestionsState(prev => ({
      ...prev,
      selectedSuggestion: prev.selectedSuggestion >= suggestions.length - 1 ? 0 : prev.selectedSuggestion + 1
    }));
  }, [suggestions.length, setSuggestionsState]);

  
  const autocompleteHandlers = useMemo(() => ({
     STR30034 : handleAutocompleteAccept,
     STR30035 : handleAutocompleteDismiss,
     STR30036 : handleAutocompletePrevious,
     STR30037 : handleAutocompleteNext
  }), [handleAutocompleteAccept, handleAutocompleteDismiss, handleAutocompletePrevious, handleAutocompleteNext]);

  
  
  const isAutocompleteActive = suggestions.length > 0 || !!effectiveGhostText;
  const isModalOverlayActive = useIsModalOverlayActive();
  useRegisterOverlay( STR30038 , isAutocompleteActive);
  
  
  useRegisterKeybindingContext( STR30039 , isAutocompleteActive);

  
  
  useKeybindings(autocompleteHandlers, {
    context:  STR30040 ,
    isActive: isAutocompleteActive && !isModalOverlayActive
  });
  function acceptSuggestionText(text: string): void {
    const detectedMode = getModeFromInput(text);
    if (detectedMode !==  STR30041  && onModeChange) {
      onModeChange(detectedMode);
      const stripped = getValueFromInput(text);
      onInputChange(stripped);
      setCursorOffset(stripped.length);
    } else {
      onInputChange(text);
      setCursorOffset(text.length);
    }
  }

  
  const handleKeyDown = (e: KeyboardEvent): void => {
    
    if (e.key ===  STR30042  && !isViewingTeammate) {
      const suggestionText = promptSuggestion.text;
      const suggestionShownAt = promptSuggestion.shownAt;
      if (suggestionText && suggestionShownAt > 0 && input ===  STR30043 ) {
        markAccepted();
        acceptSuggestionText(suggestionText);
        e.stopImmediatePropagation();
        return;
      }
    }

    
    
    if (e.key ===  STR30044  && !e.shift) {
      
      if (suggestions.length > 0 || effectiveGhostText) {
        return;
      }
      
      const suggestionText = promptSuggestion.text;
      const suggestionShownAt = promptSuggestion.shownAt;
      if (suggestionText && suggestionShownAt > 0 && input ===  STR30045  && !isViewingTeammate) {
        e.preventDefault();
        markAccepted();
        acceptSuggestionText(suggestionText);
        return;
      }
      
      if (input.trim() ===  STR30046 ) {
        e.preventDefault();
        addNotification({
          key:  STR30047 ,
          jsx: <Text dimColor>
              Use {thinkingToggleShortcut} to toggle thinking
            </Text>,
          priority:  STR30048 ,
          timeoutMs: 3000
        });
      }
      return;
    }

    
    if (suggestions.length === 0) return;

    
    
    const hasPendingChord = keybindingContext?.pendingChord != null;
    if (e.ctrl && e.key ===  STR30049  && !hasPendingChord) {
      e.preventDefault();
      handleAutocompleteNext();
      return;
    }
    if (e.ctrl && e.key ===  STR30050  && !hasPendingChord) {
      e.preventDefault();
      handleAutocompletePrevious();
      return;
    }

    
    
    
    if (e.key ===  STR30051  && !e.shift && !e.meta) {
      e.preventDefault();
      handleEnter();
    }
  };

  
  
  
  
  useInput((_input, _key, event) => {
    const kbEvent = new KeyboardEvent(event.keypress);
    handleKeyDown(kbEvent);
    if (kbEvent.didStopImmediatePropagation()) {
      event.stopImmediatePropagation();
    }
  });
  return {
    suggestions,
    selectedSuggestion,
    suggestionType,
    maxColumnWidth,
    commandArgumentHint,
    inlineGhostText: effectiveGhostText,
    handleKeyDown
  };
}
