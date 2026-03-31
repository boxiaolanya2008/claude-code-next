

import type { MarketplaceSource } from './schemas.js'

export const OFFICIAL_MARKETPLACE_SOURCE = {
  source: 'github',
  repo: 'anthropics/claude-plugins-official',
} as const satisfies MarketplaceSource

export const OFFICIAL_MARKETPLACE_NAME = 'claude-plugins-official'
