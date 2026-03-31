import { feature } from 'bun:bundle';
import * as React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import { ContextVisualization } from '../../components/ContextVisualization.js';
import { microcompactMessages } from '../../services/compact/microCompact.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import type { Message } from '../../types/message.js';
import { analyzeContextUsage } from '../../utils/analyzeContext.js';
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js';
import { renderToAnsiString } from '../../utils/staticRender.js';

function toApiView(messages: Message[]): Message[] {
  let view = getMessagesAfterCompactBoundary(messages);
  if (feature('CONTEXT_COLLAPSE')) {
    
    const {
      projectView
    } = require('../../services/contextCollapse/operations.js') as typeof import('../../services/contextCollapse/operations.js');
    
    view = projectView(view);
  }
  return view;
}
export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  const {
    messages,
    getAppState,
    options: {
      mainLoopModel,
      tools
    }
  } = context;
  const apiView = toApiView(messages);

  
  const {
    messages: compactedMessages
  } = await microcompactMessages(apiView);

  
  const terminalWidth = process.stdout.columns || 80;
  const appState = getAppState();

  
  
  const data = await analyzeContextUsage(compactedMessages, mainLoopModel, async () => appState.toolPermissionContext, tools, appState.agentDefinitions, terminalWidth, context,
  
  undefined,
  
  apiView 
  );

  
  const output = await renderToAnsiString(<ContextVisualization data={data} />);
  onDone(output);
  return null;
}
