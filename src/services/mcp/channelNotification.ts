

import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { type ChannelEntry, getAllowedChannels } from '../../bootstrap/state.js'
import { CHANNEL_TAG } from '../../constants/xml.js'
import {
  getClaudeAIOAuthTokens,
  getSubscriptionType,
} from '../../utils/auth.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { parsePluginIdentifier } from '../../utils/plugins/pluginIdentifier.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'
import { escapeXmlAttr } from '../../utils/xml.js'
import {
  type ChannelAllowlistEntry,
  getChannelAllowlist,
  isChannelsEnabled,
} from './channelAllowlist.js'

export const ChannelMessageNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal('notifications/claude/channel'),
    params: z.object({
      content: z.string(),
      
      
      meta: z.record(z.string(), z.string()).optional(),
    }),
  }),
)

export const CHANNEL_PERMISSION_METHOD =
  'notifications/claude/channel/permission'
export const ChannelPermissionNotificationSchema = lazySchema(() =>
  z.object({
    method: z.literal(CHANNEL_PERMISSION_METHOD),
    params: z.object({
      request_id: z.string(),
      behavior: z.enum(['allow', 'deny']),
    }),
  }),
)

export const CHANNEL_PERMISSION_REQUEST_METHOD =
  'notifications/claude/channel/permission_request'
export type ChannelPermissionRequestParams = {
  request_id: string
  tool_name: string
  description: string
  

  input_preview: string
}

const SAFE_META_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function wrapChannelMessage(
  serverName: string,
  content: string,
  meta?: Record<string, string>,
): string {
  const attrs = Object.entries(meta ?? {})
    .filter(([k]) => SAFE_META_KEY.test(k))
    .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
    .join('')
  return `<${CHANNEL_TAG} source="${escapeXmlAttr(serverName)}"${attrs}>\n${content}\n</${CHANNEL_TAG}>`
}

export function getEffectiveChannelAllowlist(
  sub: ReturnType<typeof getSubscriptionType>,
  orgList: ChannelAllowlistEntry[] | undefined,
): {
  entries: ChannelAllowlistEntry[]
  source: 'org' | 'ledger'
} {
  if ((sub === 'team' || sub === 'enterprise') && orgList) {
    return { entries: orgList, source: 'org' }
  }
  return { entries: getChannelAllowlist(), source: 'ledger' }
}

export type ChannelGateResult =
  | { action: 'register' }
  | {
      action: 'skip'
      kind:
        | 'capability'
        | 'disabled'
        | 'auth'
        | 'policy'
        | 'session'
        | 'marketplace'
        | 'allowlist'
      reason: string
    }

export function findChannelEntry(
  serverName: string,
  channels: readonly ChannelEntry[],
): ChannelEntry | undefined {
  
  
  const parts = serverName.split(':')
  return channels.find(c =>
    c.kind === 'server'
      ? serverName === c.name
      : parts[0] === 'plugin' && parts[1] === c.name,
  )
}

export function gateChannelServer(
  serverName: string,
  capabilities: ServerCapabilities | undefined,
  pluginSource: string | undefined,
): ChannelGateResult {
  
  
  
  
  if (!capabilities?.experimental?.['claude/channel']) {
    return {
      action: 'skip',
      kind: 'capability',
      reason: 'server did not declare claude/channel capability',
    }
  }

  
  
  
  if (!isChannelsEnabled()) {
    return {
      action: 'skip',
      kind: 'disabled',
      reason: 'channels feature is not currently available',
    }
  }

  
  
  
  if (!getClaudeAIOAuthTokens()?.accessToken) {
    return {
      action: 'skip',
      kind: 'auth',
      reason: 'channels requires claude.ai authentication (run /login)',
    }
  }

  
  
  
  
  
  const sub = getSubscriptionType()
  const managed = sub === 'team' || sub === 'enterprise'
  const policy = managed ? getSettingsForSource('policySettings') : undefined
  if (managed && policy?.channelsEnabled !== true) {
    return {
      action: 'skip',
      kind: 'policy',
      reason:
        'channels not enabled by org policy (set channelsEnabled: true in managed settings)',
    }
  }

  
  
  
  const entry = findChannelEntry(serverName, getAllowedChannels())
  if (!entry) {
    return {
      action: 'skip',
      kind: 'session',
      reason: `server ${serverName} not in --channels list for this session`,
    }
  }

  if (entry.kind === 'plugin') {
    
    
    
    
    
    
    
    const actual = pluginSource
      ? parsePluginIdentifier(pluginSource).marketplace
      : undefined
    if (actual !== entry.marketplace) {
      return {
        action: 'skip',
        kind: 'marketplace',
        reason: `you asked for plugin:${entry.name}@${entry.marketplace} but the installed ${entry.name} plugin is from ${actual ?? 'an unknown source'}`,
      }
    }

    
    
    
    
    if (!entry.dev) {
      const { entries, source } = getEffectiveChannelAllowlist(
        sub,
        policy?.allowedChannelPlugins,
      )
      if (
        !entries.some(
          e => e.plugin === entry.name && e.marketplace === entry.marketplace,
        )
      ) {
        return {
          action: 'skip',
          kind: 'allowlist',
          reason:
            source === 'org'
              ? `plugin ${entry.name}@${entry.marketplace} is not on your org's approved channels list (set allowedChannelPlugins in managed settings)`
              : `plugin ${entry.name}@${entry.marketplace} is not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`,
        }
      }
    }
  } else {
    
    
    
    if (!entry.dev) {
      return {
        action: 'skip',
        kind: 'allowlist',
        reason: `server ${entry.name} is not on the approved channels allowlist (use --dangerously-load-development-channels for local dev)`,
      }
    }
  }

  return { action: 'register' }
}
