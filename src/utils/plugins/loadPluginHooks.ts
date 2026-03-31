import memoize from 'lodash-es/memoize.js'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import {
  clearRegisteredPluginHooks,
  getRegisteredHooks,
  registerHookCallbacks,
} from '../../bootstrap/state.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { settingsChangeDetector } from '../settings/changeDetector.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import type { PluginHookMatcher } from '../settings/types.js'
import { jsonStringify } from '../slowOperations.js'
import { clearPluginCache, loadAllPluginsCacheOnly } from './pluginLoader.js'

let hotReloadSubscribed = false

let lastPluginSettingsSnapshot: string | undefined

function convertPluginHooksToMatchers(
  plugin: LoadedPlugin,
): Record<HookEvent, PluginHookMatcher[]> {
  const pluginMatchers: Record<HookEvent, PluginHookMatcher[]> = {
    PreToolUse: [],
    PostToolUse: [],
    PostToolUseFailure: [],
    PermissionDenied: [],
    Notification: [],
    UserPromptSubmit: [],
    SessionStart: [],
    SessionEnd: [],
    Stop: [],
    StopFailure: [],
    SubagentStart: [],
    SubagentStop: [],
    PreCompact: [],
    PostCompact: [],
    PermissionRequest: [],
    Setup: [],
    TeammateIdle: [],
    TaskCreated: [],
    TaskCompleted: [],
    Elicitation: [],
    ElicitationResult: [],
    ConfigChange: [],
    WorktreeCreate: [],
    WorktreeRemove: [],
    InstructionsLoaded: [],
    CwdChanged: [],
    FileChanged: [],
  }

  if (!plugin.hooksConfig) {
    return pluginMatchers
  }

  
  for (const [event, matchers] of Object.entries(plugin.hooksConfig)) {
    const hookEvent = event as HookEvent
    if (!pluginMatchers[hookEvent]) {
      continue
    }

    for (const matcher of matchers) {
      if (matcher.hooks.length > 0) {
        pluginMatchers[hookEvent].push({
          matcher: matcher.matcher,
          hooks: matcher.hooks,
          pluginRoot: plugin.path,
          pluginName: plugin.name,
          pluginId: plugin.source,
        })
      }
    }
  }

  return pluginMatchers
}

export const loadPluginHooks = memoize(async (): Promise<void> => {
  const { enabled } = await loadAllPluginsCacheOnly()
  const allPluginHooks: Record<HookEvent, PluginHookMatcher[]> = {
    PreToolUse: [],
    PostToolUse: [],
    PostToolUseFailure: [],
    PermissionDenied: [],
    Notification: [],
    UserPromptSubmit: [],
    SessionStart: [],
    SessionEnd: [],
    Stop: [],
    StopFailure: [],
    SubagentStart: [],
    SubagentStop: [],
    PreCompact: [],
    PostCompact: [],
    PermissionRequest: [],
    Setup: [],
    TeammateIdle: [],
    TaskCreated: [],
    TaskCompleted: [],
    Elicitation: [],
    ElicitationResult: [],
    ConfigChange: [],
    WorktreeCreate: [],
    WorktreeRemove: [],
    InstructionsLoaded: [],
    CwdChanged: [],
    FileChanged: [],
  }

  
  for (const plugin of enabled) {
    if (!plugin.hooksConfig) {
      continue
    }

    logForDebugging(`Loading hooks from plugin: ${plugin.name}`)
    const pluginMatchers = convertPluginHooksToMatchers(plugin)

    
    for (const event of Object.keys(pluginMatchers) as HookEvent[]) {
      allPluginHooks[event].push(...pluginMatchers[event])
    }
  }

  
  
  
  
  
  
  
  
  
  clearRegisteredPluginHooks()
  registerHookCallbacks(allPluginHooks)

  const totalHooks = Object.values(allPluginHooks).reduce(
    (sum, matchers) => sum + matchers.reduce((s, m) => s + m.hooks.length, 0),
    0,
  )
  logForDebugging(
    `Registered ${totalHooks} hooks from ${enabled.length} plugins`,
  )
})

export function clearPluginHookCache(): void {
  
  
  
  
  
  
  loadPluginHooks.cache?.clear?.()
}

export async function pruneRemovedPluginHooks(): Promise<void> {
  
  
  if (!getRegisteredHooks()) return
  const { enabled } = await loadAllPluginsCacheOnly()
  const enabledRoots = new Set(enabled.map(p => p.path))

  
  
  
  const current = getRegisteredHooks()
  if (!current) return

  
  
  
  
  const survivors: Partial<Record<HookEvent, PluginHookMatcher[]>> = {}
  for (const [event, matchers] of Object.entries(current)) {
    const kept = matchers.filter(
      (m): m is PluginHookMatcher =>
        'pluginRoot' in m && enabledRoots.has(m.pluginRoot),
    )
    if (kept.length > 0) survivors[event as HookEvent] = kept
  }

  clearRegisteredPluginHooks()
  registerHookCallbacks(survivors)
}

export function resetHotReloadState(): void {
  hotReloadSubscribed = false
  lastPluginSettingsSnapshot = undefined
}

export function getPluginAffectingSettingsSnapshot(): string {
  const merged = getSettings_DEPRECATED()
  const policy = getSettingsForSource('policySettings')
  
  
  
  const sortKeys = <T extends Record<string, unknown>>(o: T | undefined) =>
    o ? Object.fromEntries(Object.entries(o).sort()) : {}
  return jsonStringify({
    enabledPlugins: sortKeys(merged.enabledPlugins),
    extraKnownMarketplaces: sortKeys(merged.extraKnownMarketplaces),
    strictKnownMarketplaces: policy?.strictKnownMarketplaces ?? [],
    blockedMarketplaces: policy?.blockedMarketplaces ?? [],
  })
}

export function setupPluginHookHotReload(): void {
  if (hotReloadSubscribed) {
    return
  }
  hotReloadSubscribed = true

  
  lastPluginSettingsSnapshot = getPluginAffectingSettingsSnapshot()

  settingsChangeDetector.subscribe(source => {
    if (source === 'policySettings') {
      const newSnapshot = getPluginAffectingSettingsSnapshot()
      if (newSnapshot === lastPluginSettingsSnapshot) {
        logForDebugging(
          'Plugin hooks: skipping reload, plugin-affecting settings unchanged',
        )
        return
      }

      lastPluginSettingsSnapshot = newSnapshot
      logForDebugging(
        'Plugin hooks: reloading due to plugin-affecting settings change',
      )

      
      clearPluginCache('loadPluginHooks: plugin-affecting settings changed')
      clearPluginHookCache()

      
      void loadPluginHooks()
    }
  })
}
