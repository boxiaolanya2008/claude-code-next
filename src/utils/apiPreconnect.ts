

import { getOauthConfig } from '../constants/oauth.js'
import { isEnvTruthy } from './envUtils.js'

let fired = false

export function preconnectAnthropicApi(): void {
  if (fired) return
  fired = true

  
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_BEDROCK) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_VERTEX) ||
    isEnvTruthy(process.env.CLAUDE_CODE_NEXT_USE_FOUNDRY)
  ) {
    return
  }
  
  if (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ANTHROPIC_UNIX_SOCKET ||
    process.env.CLAUDE_CODE_NEXT_CLIENT_CERT ||
    process.env.CLAUDE_CODE_NEXT_CLIENT_KEY
  ) {
    return
  }

  
  
  
  const baseUrl =
    process.env.ANTHROPIC_BASE_URL || getOauthConfig().BASE_API_URL

  
  
  
  
  
  void fetch(baseUrl, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {})
}
