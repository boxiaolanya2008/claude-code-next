import type { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { randomUUID } from 'crypto';
import * as React from 'react';
import { BashModeProgress } from 'src/components/BashModeProgress.js';
import type { SetToolJSXFn } from 'src/Tool.js';
import { BashTool } from 'src/tools/BashTool/BashTool.js';
import type { AttachmentMessage, SystemMessage, UserMessage } from 'src/types/message.js';
import type { ShellProgress } from 'src/types/tools.js';
import { logEvent } from '../../services/analytics/index.js';
import { errorMessage, ShellError } from '../errors.js';
import { createSyntheticUserCaveatMessage, createUserInterruptionMessage, createUserMessage, prepareUserContent } from '../messages.js';
import { resolveDefaultShell } from '../shell/resolveDefaultShell.js';
import { isPowerShellToolEnabled } from '../shell/shellToolUtils.js';
import { processToolResultBlock } from '../toolResultStorage.js';
import { escapeXml } from '../xml.js';
import type { ProcessUserInputContext } from './processUserInput.js';
export async function processBashCommand(inputString: string, precedingInputBlocks: ContentBlockParam[], attachmentMessages: AttachmentMessage[], context: ProcessUserInputContext, setToolJSX: SetToolJSXFn): Promise<{
  messages: (UserMessage | AttachmentMessage | SystemMessage)[];
  shouldQuery: boolean;
}> {
  
  
  
  
  
  const usePowerShell = isPowerShellToolEnabled() && resolveDefaultShell() === 'powershell';
  logEvent('tengu_input_bash', {
    powershell: usePowerShell
  });
  const userMessage = createUserMessage({
    content: prepareUserContent({
      inputString: `<bash-input>${inputString}</bash-input>`,
      precedingInputBlocks
    })
  });

  
  let jsx: React.ReactNode;

  
  setToolJSX({
    jsx: <BashModeProgress input={inputString} progress={null} verbose={context.options.verbose} />,
    shouldHidePromptInput: false
  });
  try {
    const bashModeContext: ProcessUserInputContext = {
      ...context,
      
      setToolJSX: _ => {
        jsx = _?.jsx;
      }
    };

    
    const onProgress = (progress: {
      data: ShellProgress;
    }) => {
      setToolJSX({
        jsx: <>
            <BashModeProgress input={inputString!} progress={progress.data} verbose={context.options.verbose} />
            {jsx}
          </>,
        shouldHidePromptInput: false,
        showSpinner: false
      });
    };

    
    
    
    
    
    
    type PSMod = typeof import('src/tools/PowerShellTool/PowerShellTool.js');
    let PowerShellTool: PSMod['PowerShellTool'] | null = null;
    if (usePowerShell) {
      
      PowerShellTool = (require('src/tools/PowerShellTool/PowerShellTool.js') as PSMod).PowerShellTool;
      
    }
    const shellTool = PowerShellTool ?? BashTool;
    const response = PowerShellTool ? await PowerShellTool.call({
      command: inputString,
      dangerouslyDisableSandbox: true
    }, bashModeContext, undefined, undefined, onProgress) : await BashTool.call({
      command: inputString,
      dangerouslyDisableSandbox: true
    }, bashModeContext, undefined, undefined, onProgress);
    const data = response.data;
    if (!data) {
      throw new Error('No result received from shell command');
    }
    const stderr = data.stderr;
    
    
    
    
    const mapped = await processToolResultBlock(shellTool, {
      ...data,
      stderr: ''
    }, randomUUID());
    
    
    
    
    const stdout = typeof mapped.content === 'string' ? mapped.content : escapeXml(data.stdout);
    return {
      messages: [createSyntheticUserCaveatMessage(), userMessage, ...attachmentMessages, createUserMessage({
        content: `<bash-stdout>${stdout}</bash-stdout><bash-stderr>${escapeXml(stderr)}</bash-stderr>`
      })],
      shouldQuery: false
    };
  } catch (e) {
    if (e instanceof ShellError) {
      if (e.interrupted) {
        return {
          messages: [createSyntheticUserCaveatMessage(), userMessage, createUserInterruptionMessage({
            toolUse: false
          }), ...attachmentMessages],
          shouldQuery: false
        };
      }
      return {
        messages: [createSyntheticUserCaveatMessage(), userMessage, ...attachmentMessages, createUserMessage({
          content: `<bash-stdout>${escapeXml(e.stdout)}</bash-stdout><bash-stderr>${escapeXml(e.stderr)}</bash-stderr>`
        })],
        shouldQuery: false
      };
    }
    return {
      messages: [createSyntheticUserCaveatMessage(), userMessage, ...attachmentMessages, createUserMessage({
        content: `<bash-stderr>Command failed: ${escapeXml(errorMessage(e))}</bash-stderr>`
      })],
      shouldQuery: false
    };
  } finally {
    setToolJSX(null);
  }
}
