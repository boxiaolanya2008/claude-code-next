

import { join } from 'path'
import type { z } from 'zod/v4'
import { getAdditionalDirectoriesForClaudeMd } from '../../bootstrap/state.js'
import { parseSettingsFile } from '../settings/settings.js'
import type {
  ExtraKnownMarketplaceSchema,
  SettingsJson,
} from '../settings/types.js'

type ExtraKnownMarketplace = z.infer<
  ReturnType<typeof ExtraKnownMarketplaceSchema>
>

const SETTINGS_FILES = ['settings.json', 'settings.local.json'] as const

export function getAddDirEnabledPlugins(): NonNullable<
  SettingsJson['enabledPlugins']
> {
  const result: NonNullable<SettingsJson['enabledPlugins']> = {}
  for (const dir of getAdditionalDirectoriesForClaudeMd()) {
    for (const file of SETTINGS_FILES) {
      const { settings } = parseSettingsFile(join(dir, '.claude', file))
      if (!settings?.enabledPlugins) {
        continue
      }
      Object.assign(result, settings.enabledPlugins)
    }
  }
  return result
}

export function getAddDirExtraMarketplaces(): Record<
  string,
  ExtraKnownMarketplace
> {
  const result: Record<string, ExtraKnownMarketplace> = {}
  for (const dir of getAdditionalDirectoriesForClaudeMd()) {
    for (const file of SETTINGS_FILES) {
      const { settings } = parseSettingsFile(join(dir, '.claude', file))
      if (!settings?.extraKnownMarketplaces) {
        continue
      }
      Object.assign(result, settings.extraKnownMarketplaces)
    }
  }
  return result
}
