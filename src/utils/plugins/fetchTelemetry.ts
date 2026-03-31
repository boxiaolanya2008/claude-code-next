

import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS as SafeString,
} from '../../services/analytics/index.js'
import { OFFICIAL_MARKETPLACE_NAME } from './officialMarketplace.js'

export type PluginFetchSource =
  | 'install_counts'
  | 'marketplace_clone'
  | 'marketplace_pull'
  | 'marketplace_url'
  | 'plugin_clone'
  | 'mcpb'

export type PluginFetchOutcome = 'success' | 'failure' | 'cache_hit'

const KNOWN_PUBLIC_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'gist.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
  'dev.azure.com',
  'ssh.dev.azure.com',
  'storage.googleapis.com', 
])

function extractHost(urlOrSpec: string): string {
  let host: string
  const scpMatch = /^[^@/]+@([^:/]+):/.exec(urlOrSpec)
  if (scpMatch) {
    host = scpMatch[1]!
  } else {
    try {
      host = new URL(urlOrSpec).hostname
    } catch {
      return 'unknown'
    }
  }
  const normalized = host.toLowerCase()
  return KNOWN_PUBLIC_HOSTS.has(normalized) ? normalized : 'other'
}

function isOfficialRepo(urlOrSpec: string): boolean {
  return urlOrSpec.includes(`anthropics/${OFFICIAL_MARKETPLACE_NAME}`)
}

export function logPluginFetch(
  source: PluginFetchSource,
  urlOrSpec: string | undefined,
  outcome: PluginFetchOutcome,
  durationMs: number,
  errorKind?: string,
): void {
  
  
  logEvent('tengu_plugin_remote_fetch', {
    source: source as SafeString,
    host: (urlOrSpec ? extractHost(urlOrSpec) : 'unknown') as SafeString,
    is_official: urlOrSpec ? isOfficialRepo(urlOrSpec) : false,
    outcome: outcome as SafeString,
    duration_ms: Math.round(durationMs),
    ...(errorKind && { error_kind: errorKind as SafeString }),
  })
}

export function classifyFetchError(error: unknown): string {
  const msg = String((error as { message?: unknown })?.message ?? error)
  if (
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|Could not resolve host|Connection refused/i.test(
      msg,
    )
  ) {
    return 'dns_or_refused'
  }
  if (/ETIMEDOUT|timed out|timeout/i.test(msg)) return 'timeout'
  if (
    /ECONNRESET|socket hang up|Connection reset by peer|remote end hung up/i.test(
      msg,
    )
  ) {
    return 'conn_reset'
  }
  if (/403|401|authentication|permission denied/i.test(msg)) return 'auth'
  if (/404|not found|repository not found/i.test(msg)) return 'not_found'
  if (/certificate|SSL|TLS|unable to get local issuer/i.test(msg)) return 'tls'
  
  
  
  if (/Invalid response format|Invalid marketplace schema/i.test(msg)) {
    return 'invalid_schema'
  }
  return 'other'
}
