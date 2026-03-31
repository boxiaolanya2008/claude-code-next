import { execFile as execFileCb } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFileCb)

export async function getWorktreePathsPortable(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd, timeout: 5000 },
    )
    if (!stdout) return []
    return stdout
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.slice('worktree '.length).normalize('NFC'))
  } catch {
    return []
  }
}
