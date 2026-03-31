import { mkdirSync, writeFileSync } from 'fs'
import {
  getApiKeyFromFd,
  getOauthTokenFromFd,
  setApiKeyFromFd,
  setOauthTokenFromFd,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { errorMessage, isENOENT } from './errors.js'
import { getFsImplementation } from './fsOperations.js'

const CCR_TOKEN_DIR = '/home/claude/.claude/remote'
export const CCR_OAUTH_TOKEN_PATH = `${CCR_TOKEN_DIR}/.oauth_token`
export const CCR_API_KEY_PATH = `${CCR_TOKEN_DIR}/.api_key`
export const CCR_SESSION_INGRESS_TOKEN_PATH = `${CCR_TOKEN_DIR}/.session_ingress_token`

export function maybePersistTokenForSubprocesses(
  path: string,
  token: string,
  tokenName: string,
): void {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_NEXT_REMOTE)) {
    return
  }
  try {
    
    mkdirSync(CCR_TOKEN_DIR, { recursive: true, mode: 0o700 })
    
    writeFileSync(path, token, { encoding: 'utf8', mode: 0o600 })
    logForDebugging(`Persisted ${tokenName} to ${path} for subprocess access`)
  } catch (error) {
    logForDebugging(
      `Failed to persist ${tokenName} to disk (non-fatal): ${errorMessage(error)}`,
      { level: 'error' },
    )
  }
}

export function readTokenFromWellKnownFile(
  path: string,
  tokenName: string,
): string | null {
  try {
    const fsOps = getFsImplementation()
    
    const token = fsOps.readFileSync(path, { encoding: 'utf8' }).trim()
    if (!token) {
      return null
    }
    logForDebugging(`Read ${tokenName} from well-known file ${path}`)
    return token
  } catch (error) {
    
    
    
    if (!isENOENT(error)) {
      logForDebugging(
        `Failed to read ${tokenName} from ${path}: ${errorMessage(error)}`,
        { level: 'debug' },
      )
    }
    return null
  }
}

function getCredentialFromFd({
  envVar,
  wellKnownPath,
  label,
  getCached,
  setCached,
}: {
  envVar: string
  wellKnownPath: string
  label: string
  getCached: () => string | null | undefined
  setCached: (value: string | null) => void
}): string | null {
  const cached = getCached()
  if (cached !== undefined) {
    return cached
  }

  const fdEnv = process.env[envVar]
  if (!fdEnv) {
    
    
    const fromFile = readTokenFromWellKnownFile(wellKnownPath, label)
    setCached(fromFile)
    return fromFile
  }

  const fd = parseInt(fdEnv, 10)
  if (Number.isNaN(fd)) {
    logForDebugging(
      `${envVar} must be a valid file descriptor number, got: ${fdEnv}`,
      { level: 'error' },
    )
    setCached(null)
    return null
  }

  try {
    
    const fsOps = getFsImplementation()
    const fdPath =
      process.platform === 'darwin' || process.platform === 'freebsd'
        ? `/dev/fd/${fd}`
        : `/proc/self/fd/${fd}`

    
    const token = fsOps.readFileSync(fdPath, { encoding: 'utf8' }).trim()
    if (!token) {
      logForDebugging(`File descriptor contained empty ${label}`, {
        level: 'error',
      })
      setCached(null)
      return null
    }
    logForDebugging(`Successfully read ${label} from file descriptor ${fd}`)
    setCached(token)
    maybePersistTokenForSubprocesses(wellKnownPath, token, label)
    return token
  } catch (error) {
    logForDebugging(
      `Failed to read ${label} from file descriptor ${fd}: ${errorMessage(error)}`,
      { level: 'error' },
    )
    
    
    const fromFile = readTokenFromWellKnownFile(wellKnownPath, label)
    setCached(fromFile)
    return fromFile
  }
}

export function getOAuthTokenFromFileDescriptor(): string | null {
  return getCredentialFromFd({
    envVar: 'CLAUDE_CODE_NEXT_OAUTH_TOKEN_FILE_DESCRIPTOR',
    wellKnownPath: CCR_OAUTH_TOKEN_PATH,
    label: 'OAuth token',
    getCached: getOauthTokenFromFd,
    setCached: setOauthTokenFromFd,
  })
}

export function getApiKeyFromFileDescriptor(): string | null {
  return getCredentialFromFd({
    envVar: 'CLAUDE_CODE_NEXT_API_KEY_FILE_DESCRIPTOR',
    wellKnownPath: CCR_API_KEY_PATH,
    label: 'API key',
    getCached: getApiKeyFromFd,
    setCached: setApiKeyFromFd,
  })
}
