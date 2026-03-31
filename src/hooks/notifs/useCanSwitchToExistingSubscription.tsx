import * as React from 'react';
import { getOauthProfileFromApiKey } from 'src/services/oauth/getOauthProfile.js';
import { isClaudeAISubscriber } from 'src/utils/auth.js';
import { Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { useStartupNotification } from './useStartupNotification.js';
const MAX_SHOW_COUNT = 3;

export function useCanSwitchToExistingSubscription() {
  useStartupNotification(_temp2);
}

async function _temp2() {
  if ((getGlobalConfig().subscriptionNoticeCount ?? 0) >= MAX_SHOW_COUNT) {
    return null;
  }
  const subscriptionType = await getExistingClaudeSubscription();
  if (subscriptionType === null) {
    return null;
  }
  saveGlobalConfig(_temp);
  logEvent("tengu_switch_to_subscription_notice_shown", {});
  return {
    key: "switch-to-subscription",
    jsx: <Text color="suggestion">Use your existing Claude {subscriptionType} plan with Claude Code Next<Text color="text" dimColor={true}>{" "}· /login to activate</Text></Text>,
    priority: "low"
  };
}
function _temp(current) {
  return {
    ...current,
    subscriptionNoticeCount: (current.subscriptionNoticeCount ?? 0) + 1
  };
}
async function getExistingClaudeSubscription(): Promise<'Max' | 'Pro' | null> {
  
  if (isClaudeAISubscriber()) {
    return null;
  }
  const profile = await getOauthProfileFromApiKey();
  if (!profile) {
    return null;
  }
  if (profile.account.has_claude_max) {
    return 'Max';
  }
  if (profile.account.has_claude_pro) {
    return 'Pro';
  }
  return null;
}
