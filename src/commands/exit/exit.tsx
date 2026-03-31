import { feature } from "../utils/bundle-mock.ts";
import { spawnSync } from 'child_process';
import sample from 'lodash-es/sample.js';
import * as React from 'react';
import { ExitFlow } from '../../components/ExitFlow.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { isBgSession } from '../../utils/concurrentSessions.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';
import { getCurrentWorktreeSession } from '../../utils/worktree.js';
const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];
function getRandomGoodbyeMessage(): string {
  return sample(GOODBYE_MESSAGES) ?? 'Goodbye!';
}
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  
  
  
  if (feature('BG_SESSIONS') && isBgSession()) {
    onDone();
    spawnSync('tmux', ['detach-client'], {
      stdio: 'ignore'
    });
    return null;
  }
  const showWorktree = getCurrentWorktreeSession() !== null;
  if (showWorktree) {
    return <ExitFlow showWorktree={showWorktree} onDone={onDone} onCancel={() => onDone()} />;
  }
  onDone(getRandomGoodbyeMessage());
  await gracefulShutdown(0, 'prompt_input_exit');
  return null;
}
