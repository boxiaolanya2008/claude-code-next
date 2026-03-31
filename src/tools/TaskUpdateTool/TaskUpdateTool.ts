import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { isAgentSwarmsEnabled } from '../../utils/agentSwarmsEnabled.js'
import {
  executeTaskCompletedHooks,
  getTaskCompletedHookMessage,
} from '../../utils/hooks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  blockTask,
  deleteTask,
  getTask,
  getTaskListId,
  isTodoV2Enabled,
  listTasks,
  type TaskStatus,
  TaskStatusSchema,
  updateTask,
} from '../../utils/tasks.js'
import {
  getAgentId,
  getAgentName,
  getTeammateColor,
  getTeamName,
} from '../../utils/teammate.js'
import { writeToMailbox } from '../../utils/teammateMailbox.js'
import { VERIFICATION_AGENT_TYPE } from '../AgentTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const inputSchema = lazySchema(() => {
  
  const TaskUpdateStatusSchema = TaskStatusSchema().or(z.literal('deleted'))

  return z.strictObject({
    taskId: z.string().describe('The ID of the task to update'),
    subject: z.string().optional().describe('New subject for the task'),
    description: z.string().optional().describe('New description for the task'),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
      ),
    status: TaskUpdateStatusSchema.optional().describe(
      'New status for the task',
    ),
    addBlocks: z
      .array(z.string())
      .optional()
      .describe('Task IDs that this task blocks'),
    addBlockedBy: z
      .array(z.string())
      .optional()
      .describe('Task IDs that block this task'),
    owner: z.string().optional().describe('New owner for the task'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Metadata keys to merge into the task. Set a key to null to delete it.',
      ),
  })
})
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    taskId: z.string(),
    updatedFields: z.array(z.string()),
    error: z.string().optional(),
    statusChange: z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .optional(),
    verificationNudgeNeeded: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const TaskUpdateTool = buildTool({
  name: TASK_UPDATE_TOOL_NAME,
  searchHint: 'update a task',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'TaskUpdate'
  },
  shouldDefer: true,
  isEnabled() {
    return isTodoV2Enabled()
  },
  isConcurrencySafe() {
    return true
  },
  toAutoClassifierInput(input) {
    const parts = [input.taskId]
    if (input.status) parts.push(input.status)
    if (input.subject) parts.push(input.subject)
    return parts.join(' ')
  },
  renderToolUseMessage() {
    return null
  },
  async call(
    {
      taskId,
      subject,
      description,
      activeForm,
      status,
      owner,
      addBlocks,
      addBlockedBy,
      metadata,
    },
    context,
  ) {
    const taskListId = getTaskListId()

    
    context.setAppState(prev => {
      if (prev.expandedView === 'tasks') return prev
      return { ...prev, expandedView: 'tasks' as const }
    })

    
    const existingTask = await getTask(taskListId, taskId)
    if (!existingTask) {
      return {
        data: {
          success: false,
          taskId,
          updatedFields: [],
          error: 'Task not found',
        },
      }
    }

    const updatedFields: string[] = []

    
    const updates: {
      subject?: string
      description?: string
      activeForm?: string
      status?: TaskStatus
      owner?: string
      metadata?: Record<string, unknown>
    } = {}
    if (subject !== undefined && subject !== existingTask.subject) {
      updates.subject = subject
      updatedFields.push('subject')
    }
    if (description !== undefined && description !== existingTask.description) {
      updates.description = description
      updatedFields.push('description')
    }
    if (activeForm !== undefined && activeForm !== existingTask.activeForm) {
      updates.activeForm = activeForm
      updatedFields.push('activeForm')
    }
    if (owner !== undefined && owner !== existingTask.owner) {
      updates.owner = owner
      updatedFields.push('owner')
    }
    
    
    
    if (
      isAgentSwarmsEnabled() &&
      status === 'in_progress' &&
      owner === undefined &&
      !existingTask.owner
    ) {
      const agentName = getAgentName()
      if (agentName) {
        updates.owner = agentName
        updatedFields.push('owner')
      }
    }
    if (metadata !== undefined) {
      const merged = { ...(existingTask.metadata ?? {}) }
      for (const [key, value] of Object.entries(metadata)) {
        if (value === null) {
          delete merged[key]
        } else {
          merged[key] = value
        }
      }
      updates.metadata = merged
      updatedFields.push('metadata')
    }
    if (status !== undefined) {
      
      if (status === 'deleted') {
        const deleted = await deleteTask(taskListId, taskId)
        return {
          data: {
            success: deleted,
            taskId,
            updatedFields: deleted ? ['deleted'] : [],
            error: deleted ? undefined : 'Failed to delete task',
            statusChange: deleted
              ? { from: existingTask.status, to: 'deleted' }
              : undefined,
          },
        }
      }

      
      if (status !== existingTask.status) {
        
        if (status === 'completed') {
          const blockingErrors: string[] = []

          const generator = executeTaskCompletedHooks(
            taskId,
            existingTask.subject,
            existingTask.description,
            getAgentName(),
            getTeamName(),
            undefined,
            context?.abortController?.signal,
            undefined,
            context,
          )

          for await (const result of generator) {
            if (result.blockingError) {
              blockingErrors.push(
                getTaskCompletedHookMessage(result.blockingError),
              )
            }
          }

          if (blockingErrors.length > 0) {
            return {
              data: {
                success: false,
                taskId,
                updatedFields: [],
                error: blockingErrors.join('\n'),
              },
            }
          }
        }

        updates.status = status
        updatedFields.push('status')
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateTask(taskListId, taskId, updates)
    }

    
    if (updates.owner && isAgentSwarmsEnabled()) {
      const senderName = getAgentName() || 'team-lead'
      const senderColor = getTeammateColor()
      const assignmentMessage = JSON.stringify({
        type: 'task_assignment',
        taskId,
        subject: existingTask.subject,
        description: existingTask.description,
        assignedBy: senderName,
        timestamp: new Date().toISOString(),
      })
      await writeToMailbox(
        updates.owner,
        {
          from: senderName,
          text: assignmentMessage,
          timestamp: new Date().toISOString(),
          color: senderColor,
        },
        taskListId,
      )
    }

    
    if (addBlocks && addBlocks.length > 0) {
      const newBlocks = addBlocks.filter(
        id => !existingTask.blocks.includes(id),
      )
      for (const blockId of newBlocks) {
        await blockTask(taskListId, taskId, blockId)
      }
      if (newBlocks.length > 0) {
        updatedFields.push('blocks')
      }
    }

    
    if (addBlockedBy && addBlockedBy.length > 0) {
      const newBlockedBy = addBlockedBy.filter(
        id => !existingTask.blockedBy.includes(id),
      )
      for (const blockerId of newBlockedBy) {
        await blockTask(taskListId, blockerId, taskId)
      }
      if (newBlockedBy.length > 0) {
        updatedFields.push('blockedBy')
      }
    }

    
    
    
    
    
    
    
    let verificationNudgeNeeded = false
    if (
      feature('VERIFICATION_AGENT') &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false) &&
      !context.agentId &&
      updates.status === 'completed'
    ) {
      const allTasks = await listTasks(taskListId)
      const allDone = allTasks.every(t => t.status === 'completed')
      if (
        allDone &&
        allTasks.length >= 3 &&
        !allTasks.some(t => /verif/i.test(t.subject))
      ) {
        verificationNudgeNeeded = true
      }
    }

    return {
      data: {
        success: true,
        taskId,
        updatedFields,
        statusChange:
          updates.status !== undefined
            ? { from: existingTask.status, to: updates.status }
            : undefined,
        verificationNudgeNeeded,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    const {
      success,
      taskId,
      updatedFields,
      error,
      statusChange,
      verificationNudgeNeeded,
    } = content as Output
    if (!success) {
      
      
      
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: error || `Task #${taskId} not found`,
      }
    }

    let resultContent = `Updated task #${taskId} ${updatedFields.join(', ')}`

    
    if (
      statusChange?.to === 'completed' &&
      getAgentId() &&
      isAgentSwarmsEnabled()
    ) {
      resultContent +=
        '\n\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.'
    }

    if (verificationNudgeNeeded) {
      resultContent += `\n\nNOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your final summary, spawn the verification agent (subagent_type="${VERIFICATION_AGENT_TYPE}"). You cannot self-assign PARTIAL by listing caveats in your summary — only the verifier issues a verdict.`
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: resultContent,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
