import { useEffect, useRef } from 'react'
import { useAppStateStore, useSetAppState } from '../state/AppState.js'
import { isTerminalTaskStatus } from '../Task.js'
import {
  findTeammateTaskByAgentId,
  injectUserMessageToTeammate,
} from '../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import { isKairosCronEnabled } from '../tools/ScheduleCronTool/prompt.js'
import type { Message } from '../types/message.js'
import { getCronJitterConfig } from '../utils/cronJitterConfig.js'
import { createCronScheduler } from '../utils/cronScheduler.js'
import { removeCronTasks } from '../utils/cronTasks.js'
import { logForDebugging } from '../utils/debug.js'
import { enqueuePendingNotification } from '../utils/messageQueueManager.js'
import { createScheduledTaskFireMessage } from '../utils/messages.js'
import { WORKLOAD_CRON } from '../utils/workloadContext.js'

type Props = {
  isLoading: boolean
  

  assistantMode?: boolean
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
}

/**
 * REPL wrapper for the cron scheduler. Mounts the scheduler once and tears
 * it down on unmount. Fired prompts go into the command queue as 'later'
 * priority, which the REPL drains via useCommandQueue between turns.
 *
 * Scheduler core (timer, file watcher, fire logic) lives in cronScheduler.ts
 * so SDK/-p mode can share it — see print.ts for the headless wiring.
 */
export function useScheduledTasks({
  isLoading,
  assistantMode = false,
  setMessages,
}: Props): void {
  // Latest-value ref so the scheduler's isLoading() getter doesn't capture
  
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading

  const store = useAppStateStore()
  const setAppState = useSetAppState()

  useEffect(() => {
    // Runtime gate checked here (not at the hook call site) so the hook
    
    
    
    
    // so this guard alone is launch-grain. The mid-session killswitch is
    
    if (!isKairosCronEnabled()) return

    // System-generated — hidden from queue preview and transcript UI.
    
    
    // isMeta is only propagated for plain-text prompts (via
    
    
    
    
    const enqueueForLead = (prompt: string) =>
      enqueuePendingNotification({
        value: prompt,
        mode: 'prompt',
        priority: 'later',
        isMeta: true,
        // Threaded through to cc_workload= in the billing-header
        
        
        
        workload: WORKLOAD_CRON,
      })

    const scheduler = createCronScheduler({
      // Missed-task surfacing (onFire fallback). Teammate crons are always
      
      // which is populated from disk at scheduler startup — this path only
      
      onFire: enqueueForLead,
      // Normal fires receive the full CronTask so we can route by agentId.
      onFireTask: task => {
        if (task.agentId) {
          const teammate = findTeammateTaskByAgentId(
            task.agentId,
            store.getState().tasks,
          )
          if (teammate && !isTerminalTaskStatus(teammate.status)) {
            injectUserMessageToTeammate(teammate.id, task.prompt, setAppState)
            return
          }
          // Teammate is gone — clean up the orphaned cron so it doesn't keep
          // firing into nowhere every tick. One-shots would auto-delete on
          // fire anyway, but recurring crons would loop until auto-expiry.
          logForDebugging(
            `[ScheduledTasks] teammate ${task.agentId} gone, removing orphaned cron ${task.id}`,
          )
          void removeCronTasks([task.id])
          return
        }
        const msg = createScheduledTaskFireMessage(
          `Running scheduled task (${formatCronFireTime(new Date())})`,
        )
        setMessages(prev => [...prev, msg])
        enqueueForLead(task.prompt)
      },
      isLoading: () => isLoadingRef.current,
      assistantMode,
      getJitterConfig: getCronJitterConfig,
      isKilled: () => !isKairosCronEnabled(),
    })
    scheduler.start()
    return () => scheduler.stop()
    // assistantMode is stable for the session lifetime; store/setAppState are
    // stable refs from useSyncExternalStore; setMessages is a stable useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantMode])
}

function formatCronFireTime(d: Date): string {
  return d
    .toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .replace(/,? at |, /, ' ')
    .replace(/ ([AP]M)/, (_, ampm) => ampm.toLowerCase())
}
