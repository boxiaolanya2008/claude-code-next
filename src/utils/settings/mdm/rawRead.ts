

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import {
  getMacOSPlistPaths,
  MDM_SUBPROCESS_TIMEOUT_MS,
  PLUTIL_ARGS_PREFIX,
  PLUTIL_PATH,
  WINDOWS_REGISTRY_KEY_PATH_HKCU,
  WINDOWS_REGISTRY_KEY_PATH_HKLM,
  WINDOWS_REGISTRY_VALUE_NAME,
} from './constants.js'

export type RawReadResult = {
  plistStdouts: Array<{ stdout: string; label: string }> | null
  hklmStdout: string | null
  hkcuStdout: string | null
}

let rawReadPromise: Promise<RawReadResult> | null = null

function execFilePromise(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; code: number | null }> {
  return new Promise(resolve => {
    execFile(
      cmd,
      args,
      { encoding: 'utf-8', timeout: MDM_SUBPROCESS_TIMEOUT_MS },
      (err, stdout) => {
        
        resolve({ stdout: stdout ?? '', code: err ? 1 : 0 })
      },
    )
  })
}

export function fireRawRead(): Promise<RawReadResult> {
  return (async (): Promise<RawReadResult> => {
    if (process.platform === 'darwin') {
      const plistPaths = getMacOSPlistPaths()

      const allResults = await Promise.all(
        plistPaths.map(async ({ path, label }) => {
          
          
          
          
          
          
          if (!existsSync(path)) {
            return { stdout: '', label, ok: false }
          }
          const { stdout, code } = await execFilePromise(PLUTIL_PATH, [
            ...PLUTIL_ARGS_PREFIX,
            path,
          ])
          return { stdout, label, ok: code === 0 && !!stdout }
        }),
      )

      
      const winner = allResults.find(r => r.ok)
      return {
        plistStdouts: winner
          ? [{ stdout: winner.stdout, label: winner.label }]
          : [],
        hklmStdout: null,
        hkcuStdout: null,
      }
    }

    if (process.platform === 'win32') {
      const [hklm, hkcu] = await Promise.all([
        execFilePromise('reg', [
          'query',
          WINDOWS_REGISTRY_KEY_PATH_HKLM,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
        ]),
        execFilePromise('reg', [
          'query',
          WINDOWS_REGISTRY_KEY_PATH_HKCU,
          '/v',
          WINDOWS_REGISTRY_VALUE_NAME,
        ]),
      ])
      return {
        plistStdouts: null,
        hklmStdout: hklm.code === 0 ? hklm.stdout : null,
        hkcuStdout: hkcu.code === 0 ? hkcu.stdout : null,
      }
    }

    return { plistStdouts: null, hklmStdout: null, hkcuStdout: null }
  })()
}

export function startMdmRawRead(): void {
  if (rawReadPromise) return
  rawReadPromise = fireRawRead()
}

export function getMdmRawReadPromise(): Promise<RawReadResult> | null {
  return rawReadPromise
}
