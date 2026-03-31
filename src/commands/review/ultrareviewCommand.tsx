import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.js';
import React from 'react';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js';
import { checkOverageGate, confirmOverage, launchRemoteReview } from './reviewRemote.js';
import { UltrareviewOverageDialog } from './UltrareviewOverageDialog.js';
function contentBlocksToString(blocks: ContentBlockParam[]): string {
  return blocks.map(b => b.type === 'text' ? b.text : '').filter(Boolean).join('\n');
}
async function launchAndDone(args: string, context: Parameters<LocalJSXCommandCall>[1], onDone: LocalJSXCommandOnDone, billingNote: string, signal?: AbortSignal): Promise<void> {
  const result = await launchRemoteReview(args, context, billingNote);
  
  
  
  if (signal?.aborted) return;
  if (result) {
    onDone(contentBlocksToString(result), {
      shouldQuery: true
    });
  } else {
    
    
    
    onDone('Ultrareview failed to launch the remote session. Check that this is a GitHub repo and try again.', {
      display: 'system'
    });
  }
}
export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const gate = await checkOverageGate();
  if (gate.kind === 'not-enabled') {
    onDone('Free ultrareviews used. Enable Extra Usage at https://claude.ai/settings/billing to continue.', {
      display: 'system'
    });
    return null;
  }
  if (gate.kind === 'low-balance') {
    onDone(`Balance too low to launch ultrareview (${gate.available.toFixed(2)} available, $10 minimum). Top up at https://claude.ai/settings/billing`, {
      display: 'system'
    });
    return null;
  }
  if (gate.kind === 'needs-confirm') {
    return <UltrareviewOverageDialog onProceed={async signal => {
      await launchAndDone(args, context, onDone, ' This review bills as Extra Usage.', signal);
      
      
      
      if (!signal.aborted) confirmOverage();
    }} onCancel={() => onDone('Ultrareview cancelled.', {
      display: 'system'
    })} />;
  }

  
  await launchAndDone(args, context, onDone, gate.billingNote);
  return null;
};
