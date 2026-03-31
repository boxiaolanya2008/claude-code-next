import { execa } from 'execa'
import { which } from '../which.js'

export type GhAuthStatus =
  | 'authenticated'
  | 'not_authenticated'
  | 'not_installed'

export async function getGhAuthStatus(): Promise<GhAuthStatus> {
  const ghPath = await which('gh')
  if (!ghPath) {
    return 'not_installed'
  }
  const { exitCode } = await execa('gh', ['auth', 'token'], {
    stdout: 'ignore',
    stderr: 'ignore',
    timeout: 5000,
    reject: false,
  })
  return exitCode === 0 ? 'authenticated' : 'not_authenticated'
}
