

import axios from 'axios'
import { OAUTH_BETA_HEADER } from '../constants/oauth.js'
import {
  getAnthropicApiKey,
  getClaudeAIOAuthTokens,
  handleOAuth401Error,
  isClaudeAISubscriber,
} from './auth.js'
import { getClaudeCodeUserAgent } from './userAgent.js'
import { getWorkload } from './workloadContext.js'

export function getUserAgent(): string {
  const agentSdkVersion = process.env.CLAUDE_AGENT_SDK_VERSION
    ? `, agent-sdk/${process.env.CLAUDE_AGENT_SDK_VERSION}`
    : ''
  
  
  const clientApp = process.env.CLAUDE_AGENT_SDK_CLIENT_APP
    ? `, client-app/${process.env.CLAUDE_AGENT_SDK_CLIENT_APP}`
    : ''
  
  
  
  
  
  const workload = getWorkload()
  const workloadSuffix = workload ? `, workload/${workload}` : ''
  return `claude-cli/${MACRO.VERSION} (${process.env.USER_TYPE}, ${process.env.CLAUDE_CODE_NEXT_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp}${workloadSuffix})`
}

export function getMCPUserAgent(): string {
  const parts: string[] = []
  if (process.env.CLAUDE_CODE_NEXT_ENTRYPOINT) {
    parts.push(process.env.CLAUDE_CODE_NEXT_ENTRYPOINT)
  }
  if (process.env.CLAUDE_AGENT_SDK_VERSION) {
    parts.push(`agent-sdk/${process.env.CLAUDE_AGENT_SDK_VERSION}`)
  }
  if (process.env.CLAUDE_AGENT_SDK_CLIENT_APP) {
    parts.push(`client-app/${process.env.CLAUDE_AGENT_SDK_CLIENT_APP}`)
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `claude-code-next/${MACRO.VERSION}${suffix}`
}

export function getWebFetchUserAgent(): string {
  return `Claude-User (${getClaudeCodeUserAgent()}; +https://support.anthropic.com/)`
}

export type AuthHeaders = {
  headers: Record<string, string>
  error?: string
}

export function getAuthHeaders(): AuthHeaders {
  if (isClaudeAISubscriber()) {
    const oauthTokens = getClaudeAIOAuthTokens()
    if (!oauthTokens?.accessToken) {
      return {
        headers: {},
        error: 'No OAuth token available',
      }
    }
    return {
      headers: {
        Authorization: `Bearer ${oauthTokens.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    }
  }
  
  
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    return {
      headers: {},
      error: 'No API key available',
    }
  }
  return {
    headers: {
      'x-api-key': apiKey,
    },
  }
}

export async function withOAuth401Retry<T>(
  request: () => Promise<T>,
  opts?: { also403Revoked?: boolean },
): Promise<T> {
  try {
    return await request()
  } catch (err) {
    if (!axios.isAxiosError(err)) throw err
    const status = err.response?.status
    const isAuthError =
      status === 401 ||
      (opts?.also403Revoked &&
        status === 403 &&
        typeof err.response?.data === 'string' &&
        err.response.data.includes('OAuth token has been revoked'))
    if (!isAuthError) throw err
    const failedAccessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!failedAccessToken) throw err
    await handleOAuth401Error(failedAccessToken)
    return await request()
  }
}
