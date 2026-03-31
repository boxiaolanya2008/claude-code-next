import type { ValidationResult } from 'src/Tool.js'
import { isClaudeSettingsPath } from '../permissions/filesystem.js'
import { validateSettingsFileContent } from './validation.js'

export function validateInputForSettingsFileEdit(
  filePath: string,
  originalContent: string,
  getUpdatedContent: () => string,
): Extract<ValidationResult, { result: false }> | null {
  // Only validate Claude settings files
  if (!isClaudeSettingsPath(filePath)) {
    return null
  }

  // Check if the current file (before edit) conforms to the schema
  const beforeValidation = validateSettingsFileContent(originalContent)

  if (!beforeValidation.isValid) {
    // If the before version is invalid, allow the edit (don't block it)
    return null
  }

  // If the before version is valid, ensure the after version is also valid
  const updatedContent = getUpdatedContent()
  const afterValidation = validateSettingsFileContent(updatedContent)

  if (!afterValidation.isValid) {
    return {
      result: false,
      message: `Claude Code settings.json validation failed after edit:\n${afterValidation.error}\n\nFull schema:\n${afterValidation.fullSchema}\nIMPORTANT: Do not update the env unless explicitly instructed to do so.`,
      errorCode: 10,
    }
  }

  return null
}
