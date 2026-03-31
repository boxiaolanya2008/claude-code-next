import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { getSessionsSinceLastShown, recordTipShown } from './tipHistory.js'
import { getRelevantTips } from './tipRegistry.js'
import type { Tip, TipContext } from './types.js'

export function selectTipWithLongestTimeSinceShown(
  availableTips: Tip[],
): Tip | undefined {
  if (availableTips.length === 0) {
    return undefined
  }

  if (availableTips.length === 1) {
    return availableTips[0]
  }

  
  
  const tipsWithSessions = availableTips.map(tip => ({
    tip,
    sessions: getSessionsSinceLastShown(tip.id),
  }))

  tipsWithSessions.sort((a, b) => b.sessions - a.sessions)
  return tipsWithSessions[0]?.tip
}

export async function getTipToShowOnSpinner(
  context?: TipContext,
): Promise<Tip | undefined> {
  
  if (getSettings_DEPRECATED().spinnerTipsEnabled === false) {
    return undefined
  }

  const tips = await getRelevantTips(context)
  if (tips.length === 0) {
    return undefined
  }

  return selectTipWithLongestTimeSinceShown(tips)
}

export function recordShownTip(tip: Tip): void {
  
  recordTipShown(tip.id)

  
  logEvent('tengu_tip_shown', {
    tipIdLength:
      tip.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    cooldownSessions: tip.cooldownSessions,
  })
}
