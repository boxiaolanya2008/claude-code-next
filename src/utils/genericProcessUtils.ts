import {
  execFileNoThrowWithCwd,
  execSyncWithDefaults_DEPRECATED,
} from './execFileNoThrow.js'

export function isProcessRunning(pid: number): boolean {
  if (pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function getAncestorPidsAsync(
  pid: string | number,
  maxDepth = 10,
): Promise<number[]> {
  if (process.platform === 'win32') {
    
    const script = `
      $pid = ${String(pid)}
      $ancestors = @()
      for ($i = 0; $i -lt ${maxDepth}; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
        if (-not $proc -or -not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
        $pid = $proc.ParentProcessId
        $ancestors += $pid
      }
      $ancestors -join ','
    `.trim()

    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 3000 },
    )
    if (result.code !== 0 || !result.stdout?.trim()) {
      return []
    }
    return result.stdout
      .trim()
      .split(',')
      .filter(Boolean)
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p))
  }

  
  
  const script = `pid=${String(pid)}; for i in $(seq 1 ${maxDepth}); do ppid=$(ps -o ppid= -p $pid 2>/dev/null | tr -d ' '); if [ -z "$ppid" ] || [ "$ppid" = "0" ] || [ "$ppid" = "1" ]; then break; fi; echo $ppid; pid=$ppid; done`

  const result = await execFileNoThrowWithCwd('sh', ['-c', script], {
    timeout: 3000,
  })
  if (result.code !== 0 || !result.stdout?.trim()) {
    return []
  }
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(p => parseInt(p, 10))
    .filter(p => !isNaN(p))
}

export function getProcessCommand(pid: string | number): string | null {
  try {
    const pidStr = String(pid)
    const command =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pidStr}\\").CommandLine"`
        : `ps -o command= -p ${pidStr}`

    const result = execSyncWithDefaults_DEPRECATED(command, { timeout: 1000 })
    return result ? result.trim() : null
  } catch {
    return null
  }
}

export async function getAncestorCommandsAsync(
  pid: string | number,
  maxDepth = 10,
): Promise<string[]> {
  if (process.platform === 'win32') {
    
    const script = `
      $currentPid = ${String(pid)}
      $commands = @()
      for ($i = 0; $i -lt ${maxDepth}; $i++) {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$currentPid" -ErrorAction SilentlyContinue
        if (-not $proc) { break }
        if ($proc.CommandLine) { $commands += $proc.CommandLine }
        if (-not $proc.ParentProcessId -or $proc.ParentProcessId -eq 0) { break }
        $currentPid = $proc.ParentProcessId
      }
      $commands -join [char]0
    `.trim()

    const result = await execFileNoThrowWithCwd(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { timeout: 3000 },
    )
    if (result.code !== 0 || !result.stdout?.trim()) {
      return []
    }
    return result.stdout.split('\0').filter(Boolean)
  }

  
  
  const script = `currentpid=${String(pid)}; for i in $(seq 1 ${maxDepth}); do cmd=$(ps -o command= -p $currentpid 2>/dev/null); if [ -n "$cmd" ]; then printf '%s\\0' "$cmd"; fi; ppid=$(ps -o ppid= -p $currentpid 2>/dev/null | tr -d ' '); if [ -z "$ppid" ] || [ "$ppid" = "0" ] || [ "$ppid" = "1" ]; then break; fi; currentpid=$ppid; done`

  const result = await execFileNoThrowWithCwd('sh', ['-c', script], {
    timeout: 3000,
  })
  if (result.code !== 0 || !result.stdout?.trim()) {
    return []
  }
  return result.stdout.split('\0').filter(Boolean)
}

export function getChildPids(pid: string | number): number[] {
  try {
    const pidStr = String(pid)
    const command =
      process.platform === 'win32'
        ? `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ParentProcessId=${pidStr}\\").ProcessId"`
        : `pgrep -P ${pidStr}`

    const result = execSyncWithDefaults_DEPRECATED(command, { timeout: 1000 })
    if (!result) {
      return []
    }
    return result
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p))
  } catch {
    return []
  }
}
