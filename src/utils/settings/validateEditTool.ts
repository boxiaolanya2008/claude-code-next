import type { ValidationResult } from 'src/Tool.js'
import { isClaudeSettingsPath } from '../permissions/filesystem.js'
import { validateSettingsFileContent } from './validation.js'

export function validateInputForSettingsFileEdit(
  filePath: string,
  originalContent: string,
  getUpdatedContent: () => string,
): Extract<ValidationResult, { result: false }> | null {
  
  if (!isClaudeSettingsPath(filePath)) {
    return null
  }

  
  const beforeValidation = validateSettingsFileContent(originalContent)

  if (!beforeValidation.isValid) {
    
    return null
  }

  
  const updatedContent = getUpdatedContent()
  const afterValidation = validateSettingsFileContent(updatedContent)

  if (!afterValidation.isValid) {
    return {
      result: false,
      message: `Claude Code Next settings.json validation failed after edit:\n${afterValidation.error}\n\nFull schema:\n${afterValidation.fullSchema}\nIMPORTANT: Do not update the env unless explicitly instructed to do so.`,
      errorCode: 10,
    }
  }

  return null
}
