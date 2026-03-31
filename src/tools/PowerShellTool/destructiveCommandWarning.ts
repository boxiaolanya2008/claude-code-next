

type DestructivePattern = {
  pattern: RegExp
  warning: string
}

const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  
  
  
  
  
  
  
  
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Recurse\b[^|;&\n}]*-Force\b/i,
    warning: 'Note: may recursively force-remove files',
  },
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Force\b[^|;&\n}]*-Recurse\b/i,
    warning: 'Note: may recursively force-remove files',
  },
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Recurse\b/i,
    warning: 'Note: may recursively remove files',
  },
  {
    pattern:
      /(?:^|[|;&\n({])\s*(Remove-Item|rm|del|rd|rmdir|ri)\b[^|;&\n}]*-Force\b/i,
    warning: 'Note: may force-remove files',
  },

  
  {
    pattern: /\bClear-Content\b[^|;&\n]*\*/i,
    warning: 'Note: may clear content of multiple files',
  },

  
  {
    pattern: /\bFormat-Volume\b/i,
    warning: 'Note: may format a disk volume',
  },
  {
    pattern: /\bClear-Disk\b/i,
    warning: 'Note: may clear a disk',
  },

  
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    warning: 'Note: may discard uncommitted changes',
  },
  {
    pattern: /\bgit\s+push\b[^|;&\n]*\s+(--force|--force-with-lease|-f)\b/i,
    warning: 'Note: may overwrite remote history',
  },
  {
    pattern:
      /\bgit\s+clean\b(?![^|;&\n]*(?:-[a-zA-Z]*n|--dry-run))[^|;&\n]*-[a-zA-Z]*f/i,
    warning: 'Note: may permanently delete untracked files',
  },
  {
    pattern: /\bgit\s+stash\s+(drop|clear)\b/i,
    warning: 'Note: may permanently remove stashed changes',
  },

  
  {
    pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i,
    warning: 'Note: may drop or truncate database objects',
  },

  
  {
    pattern: /\bStop-Computer\b/i,
    warning: 'Note: will shut down the computer',
  },
  {
    pattern: /\bRestart-Computer\b/i,
    warning: 'Note: will restart the computer',
  },
  {
    pattern: /\bClear-RecycleBin\b/i,
    warning: 'Note: permanently deletes recycled files',
  },
]

export function getDestructiveCommandWarning(command: string): string | null {
  for (const { pattern, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return warning
    }
  }
  return null
}
