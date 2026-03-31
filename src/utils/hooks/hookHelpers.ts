import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import {
  SYNTHETIC_OUTPUT_TOOL_NAME,
  SyntheticOutputTool,
} from '../../tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { substituteArguments } from '../argumentSubstitution.js'
import { lazySchema } from '../lazySchema.js'
import type { SetAppState } from '../messageQueueManager.js'
import { hasSuccessfulToolCall } from '../messages.js'
import { addFunctionHook } from './sessionHooks.js'

export const hookResponseSchema = lazySchema(() =>
  z.object({
    ok: z.boolean().describe('Whether the condition was met'),
    reason: z
      .string()
      .describe('Reason, if the condition was not met')
      .optional(),
  }),
)

export function addArgumentsToPrompt(
  prompt: string,
  jsonInput: string,
): string {
  return substituteArguments(prompt, jsonInput)
}

/**
 * Create a StructuredOutput tool configured for hook responses.
 * Reusable by agent hooks and background verification.
 */
export function createStructuredOutputTool(): Tool {
  return {
    ...SyntheticOutputTool,
    inputSchema: hookResponseSchema(),
    inputJSONSchema: {
      type: 'object',
      properties: {
        ok: {
          type: 'boolean',
          description: 'Whether the condition was met',
        },
        reason: {
          type: 'string',
          description: 'Reason, if the condition was not met',
        },
      },
      required: ['ok'],
      additionalProperties: false,
    },
    async prompt(): Promise<string> {
      return `Use this tool to return your verification result. You MUST call this tool exactly once at the end of your response.`
    },
  }
}

/**
 * Register a function hook that enforces structured output via SyntheticOutputTool.
 * Used by ask.tsx, execAgentHook.ts, and background verification.
 */
export function registerStructuredOutputEnforcement(
  setAppState: SetAppState,
  sessionId: string,
): void {
  addFunctionHook(
    setAppState,
    sessionId,
    'Stop',
    '', // No matcher - applies to all stops
    messages => hasSuccessfulToolCall(messages, SYNTHETIC_OUTPUT_TOOL_NAME),
    `You MUST call the ${SYNTHETIC_OUTPUT_TOOL_NAME} tool to complete this request. Call this tool now.`,
    { timeout: 5000 },
  )
}
