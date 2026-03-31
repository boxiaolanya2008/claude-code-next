

export function eagerParseCliFlag(
  flagName: string,
  argv: string[] = process.argv,
): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    
    if (arg?.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1)
    }
    
    if (arg === flagName && i + 1 < argv.length) {
      return argv[i + 1]
    }
  }
  return undefined
}

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
