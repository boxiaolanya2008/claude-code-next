

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => {
  isError: boolean
  message?: string
}

const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

const GREP_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode >= 2,
  message: exitCode === 1 ? 'No matches found' : undefined,
})

const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  
  ['grep', GREP_SEMANTIC],
  ['rg', GREP_SEMANTIC],

  
  
  ['findstr', GREP_SEMANTIC],

  
  
  
  
  
  
  
  
  
  [
    'robocopy',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 8,
      message:
        exitCode === 0
          ? 'No files copied (already in sync)'
          : exitCode >= 1 && exitCode < 8
            ? exitCode & 1
              ? 'Files copied successfully'
              : 'Robocopy completed (no errors)'
            : undefined,
    }),
  ],
])

function extractBaseCommand(segment: string): string {
  
  
  const stripped = segment.trim().replace(/^[&.]\s+/, '')
  const firstToken = stripped.split(/\s+/)[0] || ''
  
  const unquoted = firstToken.replace(/^["']|["']$/g, '')
  
  const basename = unquoted.split(/[\\/]/).pop() || unquoted
  
  return basename.toLowerCase().replace(/\.exe$/, '')
}

function heuristicallyExtractBaseCommand(command: string): string {
  const segments = command.split(/[;|]/).filter(s => s.trim())
  const last = segments[segments.length - 1] || command
  return extractBaseCommand(last)
}

export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): {
  isError: boolean
  message?: string
} {
  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC
  return semantic(exitCode, stdout, stderr)
}
