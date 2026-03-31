import type { Notification } from 'src/context/notifications.js';
import { type GlobalConfig, getGlobalConfig } from 'src/utils/config.js';
import { useStartupNotification } from './useStartupNotification.js';

const MIGRATIONS: ((c: GlobalConfig) => Notification | undefined)[] = [

c => {
  if (!recent(c.sonnet45To46MigrationTimestamp)) return;
  return {
    key: 'sonnet-46-update',
    text: 'Model updated to Sonnet 4.6',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: 3000
  };
},

c => {
  const isLegacyRemap = Boolean(c.legacyOpusMigrationTimestamp);
  const ts = c.legacyOpusMigrationTimestamp ?? c.opusProMigrationTimestamp;
  if (!recent(ts)) return;
  return {
    key: 'opus-pro-update',
    text: isLegacyRemap ? 'Model updated to Opus 4.6 · Set CLAUDE_CODE_NEXT_DISABLE_LEGACY_MODEL_REMAP=1 to opt out' : 'Model updated to Opus 4.6',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: isLegacyRemap ? 8000 : 3000
  };
}];
export function useModelMigrationNotifications() {
  useStartupNotification(_temp);
}
function _temp() {
  const config = getGlobalConfig();
  const notifs = [];
  for (const migration of MIGRATIONS) {
    const notif = migration(config);
    if (notif) {
      notifs.push(notif);
    }
  }
  return notifs.length > 0 ? notifs : null;
}
function recent(ts: number | undefined): boolean {
  return ts !== undefined && Date.now() - ts < 3000;
}
