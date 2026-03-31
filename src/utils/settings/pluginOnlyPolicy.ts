import { getSettingsForSource } from './settings.js'
import type { CUSTOMIZATION_SURFACES } from './types.js'

export type CustomizationSurface = (typeof CUSTOMIZATION_SURFACES)[number]

export function isRestrictedToPluginOnly(
  surface: CustomizationSurface,
): boolean {
  const policy =
    getSettingsForSource('policySettings')?.strictPluginOnlyCustomization
  if (policy === true) return true
  if (Array.isArray(policy)) return policy.includes(surface)
  return false
}

const ADMIN_TRUSTED_SOURCES: ReadonlySet<string> = new Set([
  'plugin',
  'policySettings',
  'built-in',
  'builtin',
  'bundled',
])

export function isSourceAdminTrusted(source: string | undefined): boolean {
  return source !== undefined && ADMIN_TRUSTED_SOURCES.has(source)
}
