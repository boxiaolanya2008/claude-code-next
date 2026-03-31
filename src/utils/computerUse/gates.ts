import type { CoordinateMode, CuSubGates } from '@ant/computer-use-mcp/types'

import { getDynamicConfig_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { getSubscriptionType } from '../auth.js'
import { isEnvTruthy } from '../envUtils.js'

type ChicagoConfig = CuSubGates & {
  enabled: boolean
  coordinateMode: CoordinateMode
}

const DEFAULTS: ChicagoConfig = {
  enabled: false,
  pixelValidation: false,
  clipboardPasteMultiline: true,
  mouseAnimation: true,
  hideBeforeAction: true,
  autoTargetDisplay: true,
  clipboardGuard: true,
  coordinateMode: 'pixels',
}

function readConfig(): ChicagoConfig {
  return {
    ...DEFAULTS,
    ...getDynamicConfig_CACHED_MAY_BE_STALE<Partial<ChicagoConfig>>(
      'tengu_malort_pedway',
      DEFAULTS,
    ),
  }
}

function hasRequiredSubscription(): boolean {
  if (process.env.USER_TYPE === 'ant') return true
  const tier = getSubscriptionType()
  return tier === 'max' || tier === 'pro'
}

export function getChicagoEnabled(): boolean {
  
  
  
  
  if (
    process.env.USER_TYPE === 'ant' &&
    process.env.MONOREPO_ROOT_DIR &&
    !isEnvTruthy(process.env.ALLOW_ANT_COMPUTER_USE_MCP)
  ) {
    return false
  }
  return hasRequiredSubscription() && readConfig().enabled
}

export function getChicagoSubGates(): CuSubGates {
  const { enabled: _e, coordinateMode: _c, ...subGates } = readConfig()
  return subGates
}

let frozenCoordinateMode: CoordinateMode | undefined
export function getChicagoCoordinateMode(): CoordinateMode {
  frozenCoordinateMode ??= readConfig().coordinateMode
  return frozenCoordinateMode
}
