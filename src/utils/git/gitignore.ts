import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { getCwd } from '../cwd.js'
import { getErrnoCode } from '../errors.js'
import { execFileNoThrowWithCwd } from '../execFileNoThrow.js'
import { dirIsInGitRepo } from '../git.js'
import { logError } from '../log.js'

export async function isPathGitignored(
  filePath: string,
  cwd: string,
): Promise<boolean> {
  const { code } = await execFileNoThrowWithCwd(
    'git',
    ['check-ignore', filePath],
    {
      preserveOutputOnError: false,
      cwd,
    },
  )

  return code === 0
}

export function getGlobalGitignorePath(): string {
  return join(homedir(), '.config', 'git', 'ignore')
}

export async function addFileGlobRuleToGitignore(
  filename: string,
  cwd: string = getCwd(),
): Promise<void> {
  try {
    if (!(await dirIsInGitRepo(cwd))) {
      return
    }

    
    const gitignoreEntry = `**/${filename}`
    
    const testPath = filename.endsWith('/')
      ? `${filename}sample-file.txt`
      : filename
    if (await isPathGitignored(testPath, cwd)) {
      
      return
    }

    
    const globalGitignorePath = getGlobalGitignorePath()

    
    const configGitDir = dirname(globalGitignorePath)
    await mkdir(configGitDir, { recursive: true })

    
    try {
      const content = await readFile(globalGitignorePath, { encoding: 'utf-8' })
      if (content.includes(gitignoreEntry)) {
        return 
      }
      await appendFile(globalGitignorePath, `\n${gitignoreEntry}\n`)
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        
        await writeFile(globalGitignorePath, `${gitignoreEntry}\n`, 'utf-8')
      } else {
        throw e
      }
    }
  } catch (error) {
    logError(error)
  }
}
