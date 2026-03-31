

export type ToolValidationConfig = {
  /** Tools that accept file glob patterns (e.g., *.ts, src/**) */
  filePatternTools: string[]

  
  bashPrefixTools: string[]

  
  customValidation: {
    [toolName: string]: (content: string) => {
      valid: boolean
      error?: string
      suggestion?: string
      examples?: string[]
    }
  }
}

export const TOOL_VALIDATION_CONFIG: ToolValidationConfig = {
  // File pattern tools (accept *.ts, src

