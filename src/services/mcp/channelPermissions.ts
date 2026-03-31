

import { jsonStringify } from '../../utils/slowOperations.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

export function isChannelPermissionRelayEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_harbor_permissions', false)
}

export type ChannelPermissionResponse = {
  behavior: 'allow' | 'deny'
  
  fromServer: string
}

export type ChannelPermissionCallbacks = {
  
  onResponse(
    requestId: string,
    handler: (response: ChannelPermissionResponse) => void,
  ): () => void
  

  resolve(
    requestId: string,
    behavior: 'allow' | 'deny',
    fromServer: string,
  ): boolean
}

export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz'

const ID_AVOID_SUBSTRINGS = [
  'fuck',
  'shit',
  'cunt',
  'cock',
  'dick',
  'twat',
  'piss',
  'crap',
  'bitch',
  'whore',
  'ass',
  'tit',
  'cum',
  'fag',
  'dyke',
  'nig',
  'kike',
  'rape',
  'nazi',
  'damn',
  'poo',
  'pee',
  'wank',
  'anus',
]

function hashToId(input: string): string {
  
  
  
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h = h >>> 0
  let s = ''
  for (let i = 0; i < 5; i++) {
    s += ID_ALPHABET[h % 25]
    h = Math.floor(h / 25)
  }
  return s
}

export function shortRequestId(toolUseID: string): string {
  
  
  
  let candidate = hashToId(toolUseID)
  for (let salt = 0; salt < 10; salt++) {
    if (!ID_AVOID_SUBSTRINGS.some(bad => candidate.includes(bad))) {
      return candidate
    }
    candidate = hashToId(`${toolUseID}:${salt}`)
  }
  return candidate
}

export function truncateForPreview(input: unknown): string {
  try {
    const s = jsonStringify(input)
    return s.length > 200 ? s.slice(0, 200) + '…' : s
  } catch {
    return '(unserializable)'
  }
}

export function filterPermissionRelayClients<
  T extends {
    type: string
    name: string
    capabilities?: { experimental?: Record<string, unknown> }
  },
>(
  clients: readonly T[],
  isInAllowlist: (name: string) => boolean,
): (T & { type: 'connected' })[] {
  return clients.filter(
    (c): c is T & { type: 'connected' } =>
      c.type === 'connected' &&
      isInAllowlist(c.name) &&
      c.capabilities?.experimental?.['claude/channel'] !== undefined &&
      c.capabilities?.experimental?.['claude/channel/permission'] !== undefined,
  )
}

export function createChannelPermissionCallbacks(): ChannelPermissionCallbacks {
  const pending = new Map<
    string,
    (response: ChannelPermissionResponse) => void
  >()

  return {
    onResponse(requestId, handler) {
      
      
      
      
      const key = requestId.toLowerCase()
      pending.set(key, handler)
      return () => {
        pending.delete(key)
      }
    },

    resolve(requestId, behavior, fromServer) {
      const key = requestId.toLowerCase()
      const resolver = pending.get(key)
      if (!resolver) return false
      
      
      
      pending.delete(key)
      resolver({ behavior, fromServer })
      return true
    },
  }
}
