

import { homedir, userInfo } from 'os'
import { join } from 'path'

export const MACOS_PREFERENCE_DOMAIN = 'com.anthropic.claudecode'

export const WINDOWS_REGISTRY_KEY_PATH_HKLM =
  'HKLM\\SOFTWARE\\Policies\\ClaudeCode'
export const WINDOWS_REGISTRY_KEY_PATH_HKCU =
  'HKCU\\SOFTWARE\\Policies\\ClaudeCode'

export const WINDOWS_REGISTRY_VALUE_NAME = 'Settings'

export const PLUTIL_PATH = '/usr/bin/plutil'

export const PLUTIL_ARGS_PREFIX = ['-convert', 'json', '-o', '-', '--'] as const

export const MDM_SUBPROCESS_TIMEOUT_MS = 5000

export function getMacOSPlistPaths(): Array<{ path: string; label: string }> {
  let username = ''
  try {
    username = userInfo().username
  } catch {
    
  }

  const paths: Array<{ path: string; label: string }> = []

  if (username) {
    paths.push({
      path: `/Library/Managed Preferences/${username}/${MACOS_PREFERENCE_DOMAIN}.plist`,
      label: 'per-user managed preferences',
    })
  }

  paths.push({
    path: `/Library/Managed Preferences/${MACOS_PREFERENCE_DOMAIN}.plist`,
    label: 'device-level managed preferences',
  })

  
  if (process.env.USER_TYPE === 'ant') {
    paths.push({
      path: join(
        homedir(),
        'Library',
        'Preferences',
        `${MACOS_PREFERENCE_DOMAIN}.plist`,
      ),
      label: 'user preferences (ant-only)',
    })
  }

  return paths
}
