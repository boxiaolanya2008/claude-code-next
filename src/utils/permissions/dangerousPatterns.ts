

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
  // Package runners
  'npx',
  'bunx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  // Shells reachable from both (Git Bash / WSL on Windows, native on Unix)
  'bash',
  'sh',
  // Remote arbitrary-command wrapper (native OpenSSH on Win10+)
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
  // Anthropic internal: ant-only tools plus general tools that ant sandbox
  
  
  
  
  ...(process.env.USER_TYPE === 'ant'
    ? [
        'fa run',
        // Cluster code launcher — arbitrary code on the cluster
        'coo',
        // Network/exfil: gh gist create --public, gh api arbitrary HTTP,
        // curl/wget POST. gh api needs its own entry — the matcher is
        
        
        'gh',
        'gh api',
        'curl',
        'wget',
        // git config core.sshCommand / hooks install = arbitrary code
        'git',
        // Cloud resource writes (s3 public buckets, k8s mutations)
        'kubectl',
        'aws',
        'gcloud',
        'gsutil',
      ]
    : []),
]
