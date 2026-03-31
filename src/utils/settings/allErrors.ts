

import { getMcpConfigsByScope } from '../../services/mcp/config.js'
import { getSettingsWithErrors } from './settings.js'
import type { SettingsWithErrors } from './validation.js'

export function getSettingsWithAllErrors(): SettingsWithErrors {
  const result = getSettingsWithErrors()
  
  const scopes = ['user', 'project', 'local'] as const
  const mcpErrors = scopes.flatMap(scope => getMcpConfigsByScope(scope).errors)
  return {
    settings: result.settings,
    errors: [...result.errors, ...mcpErrors],
  }
}
