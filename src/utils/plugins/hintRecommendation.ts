

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import {
  type ClaudeCodeHint,
  hasShownHintThisSession,
  setPendingHint,
} from '../claudeCodeHints.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import { isPluginInstalled } from './installedPluginsManager.js'
import { getPluginById } from './marketplaceManager.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from './pluginIdentifier.js'
import { isPluginBlockedByPolicy } from './pluginPolicy.js'

const MAX_SHOWN_PLUGINS = 100

export type PluginHintRecommendation = {
  pluginId: string
  pluginName: string
  marketplaceName: string
  pluginDescription?: string
  sourceCommand: string
}

export function maybeRecordPluginHint(hint: ClaudeCodeHint): void {
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_lapis_finch', false)) return
  if (hasShownHintThisSession()) return

  const state = getGlobalConfig().claudeCodeHints
  if (state?.disabled) return

  const shown = state?.plugin ?? []
  if (shown.length >= MAX_SHOWN_PLUGINS) return

  const pluginId = hint.value
  const { name, marketplace } = parsePluginIdentifier(pluginId)
  if (!name || !marketplace) return
  if (!isOfficialMarketplaceName(marketplace)) return
  if (shown.includes(pluginId)) return
  if (isPluginInstalled(pluginId)) return
  if (isPluginBlockedByPolicy(pluginId)) return

  
  
  if (triedThisSession.has(pluginId)) return
  triedThisSession.add(pluginId)

  setPendingHint(hint)
}

const triedThisSession = new Set<string>()

export function _resetHintRecommendationForTesting(): void {
  triedThisSession.clear()
}

export async function resolvePluginHint(
  hint: ClaudeCodeHint,
): Promise<PluginHintRecommendation | null> {
  const pluginId = hint.value
  const { name, marketplace } = parsePluginIdentifier(pluginId)

  const pluginData = await getPluginById(pluginId)

  logEvent('tengu_plugin_hint_detected', {
    _PROTO_plugin_name: (name ??
      '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    _PROTO_marketplace_name: (marketplace ??
      '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
    result: (pluginData
      ? 'passed'
      : 'not_in_cache') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  if (!pluginData) {
    logForDebugging(
      `[hintRecommendation] ${pluginId} not found in marketplace cache`,
    )
    return null
  }

  return {
    pluginId,
    pluginName: pluginData.entry.name,
    marketplaceName: marketplace ?? '',
    pluginDescription: pluginData.entry.description,
    sourceCommand: hint.sourceCommand,
  }
}

export function markHintPluginShown(pluginId: string): void {
  saveGlobalConfig(current => {
    const existing = current.claudeCodeHints?.plugin ?? []
    if (existing.includes(pluginId)) return current
    return {
      ...current,
      claudeCodeHints: {
        ...current.claudeCodeHints,
        plugin: [...existing, pluginId],
      },
    }
  })
}

export function disableHintRecommendations(): void {
  saveGlobalConfig(current => {
    if (current.claudeCodeHints?.disabled) return current
    return {
      ...current,
      claudeCodeHints: { ...current.claudeCodeHints, disabled: true },
    }
  })
}
