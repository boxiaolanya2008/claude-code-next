import type { Tool, ToolUseContext } from 'src/Tool.js'
import z from 'zod/v4'
import { logForDebugging } from '../debug.js'
import { lazySchema } from '../lazySchema.js'
import type {
  PermissionDecision,
  PermissionDecisionReason,
} from './PermissionResult.js'
import {
  applyPermissionUpdates,
  persistPermissionUpdates,
} from './PermissionUpdate.js'
import { permissionUpdateSchema } from './PermissionUpdateSchema.js'

export const inputSchema = lazySchema(() =>
  z.object({
    tool_name: z
      .string()
      .describe('The name of the tool requesting permission'),
    input: z.record(z.string(), z.unknown()).describe('The input for the tool'),
    tool_use_id: z
      .string()
      .optional()
      .describe('The unique tool use request ID'),
  }),
)

export type Input = z.infer<ReturnType<typeof inputSchema>>

const decisionClassificationField = lazySchema(() =>
  z
    .enum(['user_temporary', 'user_permanent', 'user_reject'])
    .optional()
    .catch(undefined),
)

const PermissionAllowResultSchema = lazySchema(() =>
  z.object({
    behavior: z.literal('allow'),
    updatedInput: z.record(z.string(), z.unknown()),
    
    
    updatedPermissions: z
      .array(permissionUpdateSchema())
      .optional()
      .catch(ctx => {
        logForDebugging(
          `Malformed updatedPermissions from SDK host ignored: ${ctx.error.issues[0]?.message ?? 'unknown'}`,
          { level: 'warn' },
        )
        return undefined
      }),
    toolUseID: z.string().optional(),
    decisionClassification: decisionClassificationField(),
  }),
)

const PermissionDenyResultSchema = lazySchema(() =>
  z.object({
    behavior: z.literal('deny'),
    message: z.string(),
    interrupt: z.boolean().optional(),
    toolUseID: z.string().optional(),
    decisionClassification: decisionClassificationField(),
  }),
)

export const outputSchema = lazySchema(() =>
  z.union([PermissionAllowResultSchema(), PermissionDenyResultSchema()]),
)

export type Output = z.infer<ReturnType<typeof outputSchema>>

export function permissionPromptToolResultToPermissionDecision(
  result: Output,
  tool: Tool,
  input: { [key: string]: unknown },
  toolUseContext: ToolUseContext,
): PermissionDecision {
  const decisionReason: PermissionDecisionReason = {
    type: 'permissionPromptTool',
    permissionPromptToolName: tool.name,
    toolResult: result,
  }
  if (result.behavior === 'allow') {
    const updatedPermissions = result.updatedPermissions
    if (updatedPermissions) {
      toolUseContext.setAppState(prev => ({
        ...prev,
        toolPermissionContext: applyPermissionUpdates(
          prev.toolPermissionContext,
          updatedPermissions,
        ),
      }))
      persistPermissionUpdates(updatedPermissions)
    }
    
    
    
    const updatedInput =
      Object.keys(result.updatedInput).length > 0 ? result.updatedInput : input
    return {
      ...result,
      updatedInput,
      decisionReason,
    }
  } else if (result.behavior === 'deny' && result.interrupt) {
    logForDebugging(
      `SDK permission prompt deny+interrupt: tool=${tool.name} message=${result.message}`,
    )
    toolUseContext.abortController.abort()
  }
  return {
    ...result,
    decisionReason,
  }
}
