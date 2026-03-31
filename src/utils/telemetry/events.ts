import type { Attributes } from '@opentelemetry/api'
import { getEventLogger, getPromptId } from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'

let eventSequence = 0

let hasWarnedNoEventLogger = false

function isUserPromptLoggingEnabled() {
  return isEnvTruthy(process.env.OTEL_LOG_USER_PROMPTS)
}

export function redactIfDisabled(content: string): string {
  return isUserPromptLoggingEnabled() ? content : '<REDACTED>'
}

export async function logOTelEvent(
  eventName: string,
  metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  const eventLogger = getEventLogger()
  if (!eventLogger) {
    if (!hasWarnedNoEventLogger) {
      hasWarnedNoEventLogger = true
      logForDebugging(
        `[3P telemetry] Event dropped (no event logger initialized): ${eventName}`,
        { level: 'warn' },
      )
    }
    return
  }

  
  if (process.env.NODE_ENV === 'test') {
    return
  }

  const attributes: Attributes = {
    ...getTelemetryAttributes(),
    'event.name': eventName,
    'event.timestamp': new Date().toISOString(),
    'event.sequence': eventSequence++,
  }

  
  const promptId = getPromptId()
  if (promptId) {
    attributes['prompt.id'] = promptId
  }

  
  
  
  const workspaceDir = process.env.CLAUDE_CODE_NEXT_WORKSPACE_HOST_PATHS
  if (workspaceDir) {
    attributes['workspace.host_paths'] = workspaceDir.split('|')
  }

  
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      attributes[key] = value
    }
  }

  
  eventLogger.emit({
    body: `claude_code_next.${eventName}`,
    attributes,
  })
}
