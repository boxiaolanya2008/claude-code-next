

export const CROSS_PLATFORM_CODE_EXEC = [
  
  'python',
  'python3',
  'python2',
  'node',
  'deno',
  'tsx',
  'ruby',
  'perl',
  'php',
  'lua',
  
  'npx',
  'bunx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  
  'bash',
  'sh',
  
  'ssh',
] as const

export const DANGEROUS_BASH_PATTERNS: readonly string[] = [
  ...CROSS_PLATFORM_CODE_EXEC,
  'zsh',
  'fish',
  'eval',
  'exec',
  'env',
  'xargs',
  'sudo',
  
  
  
  
  
  ...(process.env.USER_TYPE === 'ant'
    ? [
        'fa run',
        
        'coo',
        
        
        
        
        'gh',
        'gh api',
        'curl',
        'wget',
        
        'git',
        
        'kubectl',
        'aws',
        'gcloud',
        'gsutil',
      ]
    : []),
]
