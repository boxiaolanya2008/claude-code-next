

export type ToolValidationConfig = {
  
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
  

