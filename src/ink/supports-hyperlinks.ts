import supportsHyperlinksLib from 'supports-hyperlinks'

export const ADDITIONAL_HYPERLINK_TERMINALS = [
  'ghostty',
  'Hyper',
  'kitty',
  'alacritty',
  'iTerm.app',
  'iTerm2',
]

type EnvLike = Record<string, string | undefined>

type SupportsHyperlinksOptions = {
  env?: EnvLike
  stdoutSupported?: boolean
}

export function supportsHyperlinks(
  options?: SupportsHyperlinksOptions,
): boolean {
  const stdoutSupported =
    options?.stdoutSupported ?? supportsHyperlinksLib.stdout
  if (stdoutSupported) {
    return true
  }

  const env = options?.env ?? process.env

  
  const termProgram = env['TERM_PROGRAM']
  if (termProgram && ADDITIONAL_HYPERLINK_TERMINALS.includes(termProgram)) {
    return true
  }

  
  
  const lcTerminal = env['LC_TERMINAL']
  if (lcTerminal && ADDITIONAL_HYPERLINK_TERMINALS.includes(lcTerminal)) {
    return true
  }

  
  const term = env['TERM']
  if (term?.includes('kitty')) {
    return true
  }

  return false
}
