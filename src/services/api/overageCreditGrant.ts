import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { getOauthAccountInfo } from '../../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logError } from '../../utils/log.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getOAuthHeaders, prepareApiRequest } from '../../utils/teleport/api.js'

export type OverageCreditGrantInfo = {
  available: boolean
  eligible: boolean
  granted: boolean
  amount_minor_units: number | null
  currency: string | null
}

type CachedGrantEntry = {
  info: OverageCreditGrantInfo
  timestamp: number
}

const CACHE_TTL_MS = 60 * 60 * 1000 

async function fetchOverageCreditGrant(): Promise<OverageCreditGrantInfo | null> {
  try {
    const { accessToken, orgUUID } = await prepareApiRequest()
    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/overage_credit_grant`
    const response = await axios.get<OverageCreditGrantInfo>(url, {
      headers: getOAuthHeaders(accessToken),
    })
    return response.data
  } catch (err) {
    logError(err)
    return null
  }
}

export function getCachedOverageCreditGrant(): OverageCreditGrantInfo | null {
  const orgId = getOauthAccountInfo()?.organizationUuid
  if (!orgId) return null
  const cached = getGlobalConfig().overageCreditGrantCache?.[orgId]
  if (!cached) return null
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null
  return cached.info
}

export function invalidateOverageCreditGrantCache(): void {
  const orgId = getOauthAccountInfo()?.organizationUuid
  if (!orgId) return
  const cache = getGlobalConfig().overageCreditGrantCache
  if (!cache || !(orgId in cache)) return
  saveGlobalConfig(prev => {
    const next = { ...prev.overageCreditGrantCache }
    delete next[orgId]
    return { ...prev, overageCreditGrantCache: next }
  })
}

export async function refreshOverageCreditGrantCache(): Promise<void> {
  if (isEssentialTrafficOnly()) return
  const orgId = getOauthAccountInfo()?.organizationUuid
  if (!orgId) return
  const info = await fetchOverageCreditGrant()
  if (!info) return
  
  
  
  
  saveGlobalConfig(prev => {
    
    
    
    
    const prevCached = prev.overageCreditGrantCache?.[orgId]
    const existing = prevCached?.info
    const dataUnchanged =
      existing &&
      existing.available === info.available &&
      existing.eligible === info.eligible &&
      existing.granted === info.granted &&
      existing.amount_minor_units === info.amount_minor_units &&
      existing.currency === info.currency
    
    if (
      dataUnchanged &&
      prevCached &&
      Date.now() - prevCached.timestamp <= CACHE_TTL_MS
    ) {
      return prev
    }
    const entry: CachedGrantEntry = {
      info: dataUnchanged ? existing : info,
      timestamp: Date.now(),
    }
    return {
      ...prev,
      overageCreditGrantCache: {
        ...prev.overageCreditGrantCache,
        [orgId]: entry,
      },
    }
  })
}

export function formatGrantAmount(info: OverageCreditGrantInfo): string | null {
  if (info.amount_minor_units == null || !info.currency) return null
  
  if (info.currency.toUpperCase() === 'USD') {
    const dollars = info.amount_minor_units / 100
    return Number.isInteger(dollars) ? `${dollars}` : `${dollars.toFixed(2)}`
  }
  return null
}

export type { CachedGrantEntry as OverageCreditGrantCacheEntry }
