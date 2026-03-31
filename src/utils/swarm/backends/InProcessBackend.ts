import type { ToolUseContext } from '../../../Tool.js'
import {
  findTeammateTaskByAgentId,
  requestTeammateShutdown,
} from '../../../tasks/InProcessTeammateTask/InProcessTeammateTask.js'
import { parseAgentId } from '../../../utils/agentId.js'
import { logForDebugging } from '../../../utils/debug.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import {
  createShutdownRequestMessage,
  writeToMailbox,
} from '../../../utils/teammateMailbox.js'
import { startInProcessTeammate } from '../inProcessRunner.js'
import {
  killInProcessTeammate,
  spawnInProcessTeammate,
} from '../spawnInProcess.js'
import type {
  TeammateExecutor,
  TeammateMessage,
  TeammateSpawnConfig,
  TeammateSpawnResult,
} from './types.js'

export class InProcessBackend implements TeammateExecutor {
  readonly type = 'in-process' as const

  

  private context: ToolUseContext | null = null

  

  setContext(context: ToolUseContext): void {
    this.context = context
  }

  

  async isAvailable(): Promise<boolean> {
    return true
  }

  

  async spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult> {
    if (!this.context) {
      logForDebugging(
        `[InProcessBackend] spawn() called without context for ${config.name}`,
      )
      return {
        success: false,
        agentId: `${config.name}@${config.teamName}`,
        error:
          'InProcessBackend not initialized. Call setContext() before spawn().',
      }
    }

    logForDebugging(`[InProcessBackend] spawn() called for ${config.name}`)

    const result = await spawnInProcessTeammate(
      {
        name: config.name,
        teamName: config.teamName,
        prompt: config.prompt,
        color: config.color,
        planModeRequired: config.planModeRequired ?? false,
      },
      this.context,
    )

    
    if (
      result.success &&
      result.taskId &&
      result.teammateContext &&
      result.abortController
    ) {
      
      
      startInProcessTeammate({
        identity: {
          agentId: result.agentId,
          agentName: config.name,
          teamName: config.teamName,
          color: config.color,
          planModeRequired: config.planModeRequired ?? false,
          parentSessionId: result.teammateContext.parentSessionId,
        },
        taskId: result.taskId,
        prompt: config.prompt,
        teammateContext: result.teammateContext,
        
        
        
        toolUseContext: { ...this.context, messages: [] },
        abortController: result.abortController,
        model: config.model,
        systemPrompt: config.systemPrompt,
        systemPromptMode: config.systemPromptMode,
        allowedTools: config.permissions,
        allowPermissionPrompts: config.allowPermissionPrompts,
      })

      logForDebugging(
        `[InProcessBackend] Started agent execution for ${result.agentId}`,
      )
    }

    return {
      success: result.success,
      agentId: result.agentId,
      taskId: result.taskId,
      abortController: result.abortController,
      error: result.error,
    }
  }

  

  async sendMessage(agentId: string, message: TeammateMessage): Promise<void> {
    logForDebugging(
      `[InProcessBackend] sendMessage() to ${agentId}: ${message.text.substring(0, 50)}...`,
    )

    
    
    const parsed = parseAgentId(agentId)
    if (!parsed) {
      logForDebugging(`[InProcessBackend] Invalid agentId format: ${agentId}`)
      throw new Error(
        `Invalid agentId format: ${agentId}. Expected format: agentName@teamName`,
      )
    }

    const { agentName, teamName } = parsed

    
    await writeToMailbox(
      agentName,
      {
        text: message.text,
        from: message.from,
        color: message.color,
        timestamp: message.timestamp ?? new Date().toISOString(),
      },
      teamName,
    )

    logForDebugging(`[InProcessBackend] sendMessage() completed for ${agentId}`)
  }

  

  async terminate(agentId: string, reason?: string): Promise<boolean> {
    logForDebugging(
      `[InProcessBackend] terminate() called for ${agentId}: ${reason}`,
    )

    if (!this.context) {
      logForDebugging(
        `[InProcessBackend] terminate() failed: no context set for ${agentId}`,
      )
      return false
    }

    
    const state = this.context.getAppState()
    const task = findTeammateTaskByAgentId(agentId, state.tasks)

    if (!task) {
      logForDebugging(
        `[InProcessBackend] terminate() failed: task not found for ${agentId}`,
      )
      return false
    }

    
    if (task.shutdownRequested) {
      logForDebugging(
        `[InProcessBackend] terminate(): shutdown already requested for ${agentId}`,
      )
      return true
    }

    
    const requestId = `shutdown-${agentId}-${Date.now()}`

    
    const shutdownRequest = createShutdownRequestMessage({
      requestId,
      from: 'team-lead', 
      reason,
    })

    
    const teammateAgentName = task.identity.agentName
    await writeToMailbox(
      teammateAgentName,
      {
        from: 'team-lead',
        text: jsonStringify(shutdownRequest),
        timestamp: new Date().toISOString(),
      },
      task.identity.teamName,
    )

    
    requestTeammateShutdown(task.id, this.context.setAppState)

    logForDebugging(
      `[InProcessBackend] terminate() sent shutdown request to ${agentId}`,
    )

    return true
  }

  

  async kill(agentId: string): Promise<boolean> {
    logForDebugging(`[InProcessBackend] kill() called for ${agentId}`)

    if (!this.context) {
      logForDebugging(
        `[InProcessBackend] kill() failed: no context set for ${agentId}`,
      )
      return false
    }

    
    const state = this.context.getAppState()
    const task = findTeammateTaskByAgentId(agentId, state.tasks)

    if (!task) {
      logForDebugging(
        `[InProcessBackend] kill() failed: task not found for ${agentId}`,
      )
      return false
    }

    
    const killed = killInProcessTeammate(task.id, this.context.setAppState)

    logForDebugging(
      `[InProcessBackend] kill() ${killed ? 'succeeded' : 'failed'} for ${agentId}`,
    )

    return killed
  }

  

  async isActive(agentId: string): Promise<boolean> {
    logForDebugging(`[InProcessBackend] isActive() called for ${agentId}`)

    if (!this.context) {
      logForDebugging(
        `[InProcessBackend] isActive() failed: no context set for ${agentId}`,
      )
      return false
    }

    
    const state = this.context.getAppState()
    const task = findTeammateTaskByAgentId(agentId, state.tasks)

    if (!task) {
      logForDebugging(
        `[InProcessBackend] isActive(): task not found for ${agentId}`,
      )
      return false
    }

    
    const isRunning = task.status === 'running'
    const isAborted = task.abortController?.signal.aborted ?? true

    const active = isRunning && !isAborted

    logForDebugging(
      `[InProcessBackend] isActive() for ${agentId}: ${active} (running=${isRunning}, aborted=${isAborted})`,
    )

    return active
  }
}

export function createInProcessBackend(): InProcessBackend {
  return new InProcessBackend()
}
