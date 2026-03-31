

import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import type { EditableSettingSource } from '../settings/constants.js'
import { getSettingsForSource } from '../settings/settings.js'
import { parsePluginIdentifier } from './pluginIdentifier.js'
import type { PluginId } from './schemas.js'

const INLINE_MARKETPLACE = 'inline'

export function qualifyDependency(
  dep: string,
  declaringPluginId: string,
): string {
  if (parsePluginIdentifier(dep).marketplace) return dep
  const mkt = parsePluginIdentifier(declaringPluginId).marketplace
  if (!mkt || mkt === INLINE_MARKETPLACE) return dep
  return `${dep}@${mkt}`
}

export type DependencyLookupResult = {
  
  dependencies?: string[]
}

export type ResolutionResult =
  | { ok: true; closure: PluginId[] }
  | { ok: false; reason: 'cycle'; chain: PluginId[] }
  | { ok: false; reason: 'not-found'; missing: PluginId; requiredBy: PluginId }
  | {
      ok: false
      reason: 'cross-marketplace'
      dependency: PluginId
      requiredBy: PluginId
    }

export async function resolveDependencyClosure(
  rootId: PluginId,
  lookup: (id: PluginId) => Promise<DependencyLookupResult | null>,
  alreadyEnabled: ReadonlySet<PluginId>,
  allowedCrossMarketplaces: ReadonlySet<string> = new Set(),
): Promise<ResolutionResult> {
  const rootMarketplace = parsePluginIdentifier(rootId).marketplace
  const closure: PluginId[] = []
  const visited = new Set<PluginId>()
  const stack: PluginId[] = []

  async function walk(
    id: PluginId,
    requiredBy: PluginId,
  ): Promise<ResolutionResult | null> {
    
    
    
    
    
    
    
    if (id !== rootId && alreadyEnabled.has(id)) return null
    
    
    
    const idMarketplace = parsePluginIdentifier(id).marketplace
    if (
      idMarketplace !== rootMarketplace &&
      !(idMarketplace && allowedCrossMarketplaces.has(idMarketplace))
    ) {
      return {
        ok: false,
        reason: 'cross-marketplace',
        dependency: id,
        requiredBy,
      }
    }
    if (stack.includes(id)) {
      return { ok: false, reason: 'cycle', chain: [...stack, id] }
    }
    if (visited.has(id)) return null
    visited.add(id)

    const entry = await lookup(id)
    if (!entry) {
      return { ok: false, reason: 'not-found', missing: id, requiredBy }
    }

    stack.push(id)
    for (const rawDep of entry.dependencies ?? []) {
      const dep = qualifyDependency(rawDep, id)
      const err = await walk(dep, id)
      if (err) return err
    }
    stack.pop()

    closure.push(id)
    return null
  }

  const err = await walk(rootId, rootId)
  if (err) return err
  return { ok: true, closure }
}

export function verifyAndDemote(plugins: readonly LoadedPlugin[]): {
  demoted: Set<string>
  errors: PluginError[]
} {
  const known = new Set(plugins.map(p => p.source))
  const enabled = new Set(plugins.filter(p => p.enabled).map(p => p.source))
  
  
  
  
  const knownByName = new Set(
    plugins.map(p => parsePluginIdentifier(p.source).name),
  )
  const enabledByName = new Map<string, number>()
  for (const id of enabled) {
    const n = parsePluginIdentifier(id).name
    enabledByName.set(n, (enabledByName.get(n) ?? 0) + 1)
  }
  const errors: PluginError[] = []

  let changed = true
  while (changed) {
    changed = false
    for (const p of plugins) {
      if (!enabled.has(p.source)) continue
      for (const rawDep of p.manifest.dependencies ?? []) {
        const dep = qualifyDependency(rawDep, p.source)
        
        const isBare = !parsePluginIdentifier(dep).marketplace
        const satisfied = isBare
          ? (enabledByName.get(dep) ?? 0) > 0
          : enabled.has(dep)
        if (!satisfied) {
          enabled.delete(p.source)
          const count = enabledByName.get(p.name) ?? 0
          if (count <= 1) enabledByName.delete(p.name)
          else enabledByName.set(p.name, count - 1)
          errors.push({
            type: 'dependency-unsatisfied',
            source: p.source,
            plugin: p.name,
            dependency: dep,
            reason: (isBare ? knownByName.has(dep) : known.has(dep))
              ? 'not-enabled'
              : 'not-found',
          })
          changed = true
          break
        }
      }
    }
  }

  const demoted = new Set(
    plugins.filter(p => p.enabled && !enabled.has(p.source)).map(p => p.source),
  )
  return { demoted, errors }
}

export function findReverseDependents(
  pluginId: PluginId,
  plugins: readonly LoadedPlugin[],
): string[] {
  const { name: targetName } = parsePluginIdentifier(pluginId)
  return plugins
    .filter(
      p =>
        p.enabled &&
        p.source !== pluginId &&
        (p.manifest.dependencies ?? []).some(d => {
          const qualified = qualifyDependency(d, p.source)
          
          return parsePluginIdentifier(qualified).marketplace
            ? qualified === pluginId
            : qualified === targetName
        }),
    )
    .map(p => p.name)
}

export function getEnabledPluginIdsForScope(
  settingSource: EditableSettingSource,
): Set<PluginId> {
  return new Set(
    Object.entries(getSettingsForSource(settingSource)?.enabledPlugins ?? {})
      .filter(([, v]) => v === true || Array.isArray(v))
      .map(([k]) => k),
  )
}

export function formatDependencyCountSuffix(installedDeps: string[]): string {
  if (installedDeps.length === 0) return ''
  const n = installedDeps.length
  return ` (+ ${n} ${n === 1 ? 'dependency' : 'dependencies'})`
}

export function formatReverseDependentsSuffix(
  rdeps: string[] | undefined,
): string {
  if (!rdeps || rdeps.length === 0) return ''
  return ` — warning: required by ${rdeps.join(', ')}`
}
