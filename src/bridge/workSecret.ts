import axios from 'axios'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import type { WorkSecret } from './types.js'

export function decodeWorkSecret(secret: string): WorkSecret {
  const json = Buffer.from(secret, 'base64url').toString('utf-8')
  const parsed: unknown = jsonParse(json)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('version' in parsed) ||
    parsed.version !== 1
  ) {
    throw new Error(
      `Unsupported work secret version: ${parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : 'unknown'}`,
    )
  }
  const obj = parsed as Record<string, unknown>
  if (
    typeof obj.session_ingress_token !== 'string' ||
    obj.session_ingress_token.length === 0
  ) {
    throw new Error(
      'Invalid work secret: missing or empty session_ingress_token',
    )
  }
  if (typeof obj.api_base_url !== 'string') {
    throw new Error('Invalid work secret: missing api_base_url')
  }
  return parsed as WorkSecret
}

export function buildSdkUrl(apiBaseUrl: string, sessionId: string): string {
  const isLocalhost =
    apiBaseUrl.includes('localhost') || apiBaseUrl.includes('127.0.0.1')
  const protocol = isLocalhost ? 'ws' : 'wss'
  const version = isLocalhost ? 'v2' : 'v1'
  const host = apiBaseUrl.replace(/^https?:\/\
  return `${protocol}://${host}/${version}/session_ingress/ws/${sessionId}`
}

export function sameSessionId(a: string, b: string): boolean {
  if (a === b) return true
  
  
  const aBody = a.slice(a.lastIndexOf('_') + 1)
  const bBody = b.slice(b.lastIndexOf('_') + 1)
  
  
  
  
  return aBody.length >= 4 && aBody === bBody
}

export function buildCCRv2SdkUrl(
  apiBaseUrl: string,
  sessionId: string,
): string {
  const base = apiBaseUrl.replace(/\/+$/, '')
  return `${base}/v1/code/sessions/${sessionId}`
}

export async function registerWorker(
  sessionUrl: string,
  accessToken: string,
): Promise<number> {
  const response = await axios.post(
    `${sessionUrl}/worker/register`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      timeout: 10_000,
    },
  )
  
  
  const raw = response.data?.worker_epoch
  const epoch = typeof raw === 'string' ? Number(raw) : raw
  if (
    typeof epoch !== 'number' ||
    !Number.isFinite(epoch) ||
    !Number.isSafeInteger(epoch)
  ) {
    throw new Error(
      `registerWorker: invalid worker_epoch in response: ${jsonStringify(response.data)}`,
    )
  }
  return epoch
}
