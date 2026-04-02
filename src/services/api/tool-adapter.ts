import type OpenAI from 'openai'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Tool, Tools } from '../../Tool.js'
import type { ToolInputJSONSchema } from '../../Tool.js'

/**
 * Converts Anthropic tool format to OpenAI tool format
 */
export function anthropicToolsToOpenAI(
  tools: BetaToolUnion[],
): OpenAI.ChatCompletionTool[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: convertInputSchema(tool.input_schema),
    },
  }))
}

/**
 * Converts Zod-based tool definitions to OpenAI format
 */
export function toolsToOpenAI(tools: Tools): OpenAI.ChatCompletionTool[] {
  return tools.map(tool => {
    const schema = tool.inputJSONSchema || zodToJsonSchema(tool.inputSchema)

    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description.toString(), // May need async call in practice
        parameters: convertInputSchema(schema as ToolInputJSONSchema),
      },
    }
  })
}

/**
 * Convert Anthropic input schema to OpenAI function parameters format
 */
function convertInputSchema(
  schema: ToolInputJSONSchema,
): OpenAI.FunctionParameters {
  // OpenAI expects the full JSON schema
  // We need to ensure it has the required fields
  const result: OpenAI.FunctionParameters = {
    type: 'object',
    properties: {},
  }

  if (schema.properties) {
    result.properties = schema.properties as Record<string, unknown>
  }

  if (schema.required && Array.isArray(schema.required)) {
    result.required = schema.required as string[]
  }

  if (schema.additionalProperties !== undefined) {
    result.additionalProperties = schema.additionalProperties
  }

  // Preserve any other schema properties
  for (const [key, value] of Object.entries(schema)) {
    if (key !== 'type' && key !== 'properties' && key !== 'required') {
      ;(result as Record<string, unknown>)[key] = value
    }
  }

  return result
}

/**
 * Convert OpenAI tool choice to Anthropic tool choice format
 */
export function openAIToolChoiceToAnthropic(
  toolChoice: OpenAI.ChatCompletionToolChoiceOption,
): 'auto' | 'any' | { type: 'tool'; name: string } {
  if (toolChoice === 'none') {
    // Anthropic doesn't have 'none', closest is not sending tools
    return 'auto'
  }

  if (toolChoice === 'required' || toolChoice === 'auto') {
    return toolChoice === 'required' ? 'any' : 'auto'
  }

  // Specific tool
  if (typeof toolChoice === 'object' && toolChoice.type === 'function') {
    return {
      type: 'tool',
      name: toolChoice.function.name,
    }
  }

  return 'auto'
}

/**
 * Convert Anthropic tool choice to OpenAI format
 */
export function anthropicToolChoiceToOpenAI(
  toolChoice: 'auto' | 'any' | { type: 'tool'; name: string },
): OpenAI.ChatCompletionToolChoiceOption {
  if (toolChoice === 'auto') {
    return 'auto'
  }

  if (toolChoice === 'any') {
    return 'required'
  }

  if (typeof toolChoice === 'object' && toolChoice.type === 'tool') {
    return {
      type: 'function',
      function: {
        name: toolChoice.name,
      },
    }
  }

  return 'auto'
}

/**
 * Simple Zod to JSON Schema converter
 * This is a basic implementation - the project already has zodToJsonSchema in utils
 */
function zodToJsonSchema(schema: unknown): ToolInputJSONSchema {
  // If it's already a JSON schema, return it
  if (
    schema &&
    typeof schema === 'object' &&
    'type' in schema &&
    schema.type === 'object'
  ) {
    return schema as ToolInputJSONSchema
  }

  // Default fallback
  return {
    type: 'object',
    properties: {},
  }
}

/**
 * Extract tool name from OpenAI tool call
 */
export function getToolNameFromOpenAI(
  toolCall: OpenAI.ChatCompletionMessageToolCall,
): string {
  return toolCall.function.name
}

/**
 * Parse tool arguments from OpenAI tool call
 */
export function parseToolArguments(
  toolCall: OpenAI.ChatCompletionMessageToolCall,
): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.function.arguments) as Record<string, unknown>
  } catch (error) {
    // If parsing fails, return raw string as a fallback
    return { _raw: toolCall.function.arguments }
  }
}

/**
 * Build OpenAI tool call from Anthropic tool_use
 */
export function buildOpenAIToolCall(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
): OpenAI.ChatCompletionMessageToolCall {
  return {
    id: toolUseId,
    type: 'function',
    function: {
      name: toolName,
      arguments: JSON.stringify(input),
    },
  }
}

/**
 * Build tool result for OpenAI
 */
export function buildOpenAIToolResult(
  toolCallId: string,
  result: unknown,
  isError?: boolean,
): OpenAI.ChatCompletionToolMessageParam {
  let content: string

  if (typeof result === 'string') {
    content = result
  } else if (result === null || result === undefined) {
    content = ''
  } else {
    try {
      content = JSON.stringify(result)
    } catch {
      content = String(result)
    }
  }

  // Truncate if too long (OpenAI has limits)
  const MAX_LENGTH = 100000
  if (content.length > MAX_LENGTH) {
    content = content.substring(0, MAX_LENGTH) + '\n...[truncated]'
  }

  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: isError ? `Error: ${content}` : content,
  }
}

/**
 * Check if a model supports function calling/tools
 */
export function modelSupportsTools(model: string): boolean {
  const unsupportedModels = [
    'gpt-3.5-turbo-instruct',
    'davinci',
    'curie',
    'babbage',
    'ada',
  ]

  const lowerModel = model.toLowerCase()
  return !unsupportedModels.some(m => lowerModel.includes(m))
}

/**
 * Get tool choice for model
 * Some models may have limitations on tool usage
 */
export function getToolChoiceForModel(
  model: string,
  preferredChoice: 'auto' | 'required' | 'none' = 'auto',
): OpenAI.ChatCompletionToolChoiceOption {
  // Check if model supports tools
  if (!modelSupportsTools(model)) {
    return 'none'
  }

  return preferredChoice === 'none' ? 'none' : preferredChoice
}
