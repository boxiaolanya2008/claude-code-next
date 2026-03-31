

export const MACOS_OPTION_SPECIAL_CHARS = {
  '†': 'alt+t', 
  π: 'alt+p', 
  ø: 'alt+o', 
} as const satisfies Record<string, string>

export function isMacosOptionChar(
  char: string,
): char is keyof typeof MACOS_OPTION_SPECIAL_CHARS {
  return char in MACOS_OPTION_SPECIAL_CHARS
}
