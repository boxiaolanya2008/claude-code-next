import type {
  EditableSettingSource,
  SettingSource,
} from '../settings/constants.js'
import {
  ALLOWED_OFFICIAL_MARKETPLACE_NAMES,
  type PluginScope,
} from './schemas.js'

export type ExtendedPluginScope = PluginScope | 'flag'

export type PersistablePluginScope = Exclude<ExtendedPluginScope, 'flag'>

export const SETTING_SOURCE_TO_SCOPE = {
  policySettings: 'managed',
  userSettings: 'user',
  projectSettings: 'project',
  localSettings: 'local',
  flagSettings: 'flag',
} as const satisfies Record<SettingSource, ExtendedPluginScope>

export type ParsedPluginIdentifier = {
  name: string
  marketplace?: string
}

export function parsePluginIdentifier(plugin: string): ParsedPluginIdentifier {
  if (plugin.includes('@')) {
    const parts = plugin.split('@')
    return { name: parts[0] || '', marketplace: parts[1] }
  }
  return { name: plugin }
}

export function buildPluginId(name: string, marketplace?: string): string {
  return marketplace ? `${name}@${marketplace}` : name
}

export function isOfficialMarketplaceName(
  marketplace: string | undefined,
): boolean {
  return (
    marketplace !== undefined &&
    ALLOWED_OFFICIAL_MARKETPLACE_NAMES.has(marketplace.toLowerCase())
  )
}

const SCOPE_TO_EDITABLE_SOURCE: Record<
  Exclude<PluginScope, 'managed'>,
  EditableSettingSource
> = {
  user: 'userSettings',
  project: 'projectSettings',
  local: 'localSettings',
}

export function scopeToSettingSource(
  scope: PluginScope,
): EditableSettingSource {
  if (scope === 'managed') {
    throw new Error('Cannot install plugins to managed scope')
  }
  return SCOPE_TO_EDITABLE_SOURCE[scope]
}

export function settingSourceToScope(
  source: EditableSettingSource,
): Exclude<PluginScope, 'managed'> {
  return SETTING_SOURCE_TO_SCOPE[source] as Exclude<PluginScope, 'managed'>
}
