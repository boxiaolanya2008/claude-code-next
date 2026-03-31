

export function eagerParseCliFlag(
  flagName: string,
  argv: string[] = process.argv,
): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    
    if (arg?.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1)
    }
    // Handle --flag value syntax
    if (arg === flagName && i + 1 < argv.length) {
      return argv[i + 1]
    }
  }
  return undefined
}

/**
 * Handle the standard Unix `--` separator convention in CLI arguments.
 *
 * When using Commander.js with `.passThroughOptions()`, the `--` separator
 * is passed through as a positional argument rather than being consumed.
 * This means when a user runs:
 *   `cmd --opt value name -- subcmd --flag arg`
 *
 * Commander parses it as:
 *   positional1 = "name", positional2 = "--", rest = ["subcmd", "--flag", "arg"]
 *
 * This function corrects the parsing by extracting the actual command from
 * the rest array when the positional is `--`.
 *
 * @param commandOrValue - The parsed positional that may be "--"
 * @param args - The remaining arguments array
 * @returns Object with corrected command and args
 */
export function extractArgsAfterDoubleDash(
  commandOrValue: string,
  args: string[] = [],
): { command: string; args: string[] } {
  if (commandOrValue === '--' && args.length > 0) {
    return {
      command: args[0]!,
      args: args.slice(1),
    }
  }
  return { command: commandOrValue, args }
}
