import React, { useRef } from 'react';
import stripAnsi from 'strip-ansi';
import { Messages } from '../components/Messages.js';
import { KeybindingProvider } from '../keybindings/KeybindingContext.js';
import { loadKeybindingsSyncWithWarnings } from '../keybindings/loadUserBindings.js';
import type { KeybindingContextName } from '../keybindings/types.js';
import { AppStateProvider } from '../state/AppState.js';
import type { Tools } from '../Tool.js';
import type { Message } from '../types/message.js';
import { renderToAnsiString } from './staticRender.js';

function StaticKeybindingProvider({
  children
}: {
  children: React.ReactNode;
}): React.ReactNode {
  const {
    bindings
  } = loadKeybindingsSyncWithWarnings();
  const pendingChordRef = useRef(null);
  const handlerRegistryRef = useRef(new Map());
  const activeContexts = useRef(new Set<KeybindingContextName>()).current;
  return <KeybindingProvider bindings={bindings} pendingChordRef={pendingChordRef} pendingChord={null} setPendingChord={() => {}} activeContexts={activeContexts} registerActiveContext={() => {}} unregisterActiveContext={() => {}} handlerRegistryRef={handlerRegistryRef}>
      {children}
    </KeybindingProvider>;
}

function normalizedUpperBound(m: Message): number {
  if (!('message' in m)) return 1;
  const c = m.message.content;
  return Array.isArray(c) ? c.length : 1;
}

export async function streamRenderedMessages(messages: Message[], tools: Tools, sink: (ansiChunk: string) => void | Promise<void>, {
  columns,
  verbose = false,
  chunkSize = 40,
  onProgress
}: {
  columns?: number;
  verbose?: boolean;
  chunkSize?: number;
  onProgress?: (rendered: number) => void;
} = {}): Promise<void> {
  const renderChunk = (range: readonly [number, number]) => renderToAnsiString(<AppStateProvider>
        <StaticKeybindingProvider>
          <Messages messages={messages} tools={tools} commands={[]} verbose={verbose} toolJSX={null} toolUseConfirmQueue={[]} inProgressToolUseIDs={new Set()} isMessageSelectorVisible={false} conversationId="export" screen="prompt" streamingToolUses={[]} showAllInTranscript={true} isLoading={false} renderRange={range} />
        </StaticKeybindingProvider>
      </AppStateProvider>, columns);

  
  
  
  
  
  let ceiling = chunkSize;
  for (const m of messages) ceiling += normalizedUpperBound(m);
  for (let offset = 0; offset < ceiling; offset += chunkSize) {
    const ansi = await renderChunk([offset, offset + chunkSize]);
    if (stripAnsi(ansi).trim() === '') break;
    await sink(ansi);
    onProgress?.(offset + chunkSize);
  }
}

export async function renderMessagesToPlainText(messages: Message[], tools: Tools = [], columns?: number): Promise<string> {
  const parts: string[] = [];
  await streamRenderedMessages(messages, tools, chunk => void parts.push(stripAnsi(chunk)), {
    columns
  });
  return parts.join('');
}
