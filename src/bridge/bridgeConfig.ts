

import { getOauthConfig } from '../constants/oauth.js'
import { getClaudeAIOAuthTokens } from '../utils/auth.js'

export function getBridgeTokenOverride(): string | undefined {
  return (
    (process.env.USER_TYPE === 'ant' &&
      process.env.CLAUDE_BRIDGE_OAUTH_TOKEN) ||
    undefined
  )
}

export function getBridgeBaseUrlOverride(): string | undefined {
  return (
    (process.env.USER_TYPE === 'ant' && process.env.CLAUDE_BRIDGE_BASE_URL) ||
    undefined
  )
}

export function getBridgeAccessToken(): string | undefined {
  return getBridgeTokenOverride() ?? getClaudeAIOAuthTokens()?.accessToken
}

export function getBridgeBaseUrl(): string {
  return getBridgeBaseUrlOverride() ?? getOauthConfig().BASE_API_URL
}
