import { logEvent } from 'src/services/analytics/index.js'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
} from '../utils/config.js'
import { logError } from '../utils/log.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

export function migrateEnableAllProjectMcpServersToSettings(): void {
  const projectConfig = getCurrentProjectConfig()

  
  const hasEnableAll = projectConfig.enableAllProjectMcpServers !== undefined
  const hasEnabledServers =
    projectConfig.enabledMcpjsonServers &&
    projectConfig.enabledMcpjsonServers.length > 0
  const hasDisabledServers =
    projectConfig.disabledMcpjsonServers &&
    projectConfig.disabledMcpjsonServers.length > 0

  if (!hasEnableAll && !hasEnabledServers && !hasDisabledServers) {
    return
  }

  try {
    const existingSettings = getSettingsForSource('localSettings') || {}
    const updates: Partial<{
      enableAllProjectMcpServers: boolean
      enabledMcpjsonServers: string[]
      disabledMcpjsonServers: string[]
    }> = {}
    const fieldsToRemove: Array<
      | 'enableAllProjectMcpServers'
      | 'enabledMcpjsonServers'
      | 'disabledMcpjsonServers'
    > = []

    
    if (
      hasEnableAll &&
      existingSettings.enableAllProjectMcpServers === undefined
    ) {
      updates.enableAllProjectMcpServers =
        projectConfig.enableAllProjectMcpServers
      fieldsToRemove.push('enableAllProjectMcpServers')
    } else if (hasEnableAll) {
      // Already migrated, just mark for removal
      fieldsToRemove.push('enableAllProjectMcpServers')
    }

    // Migrate enabledMcpjsonServers if it exists
    if (hasEnabledServers && projectConfig.enabledMcpjsonServers) {
      const existingEnabledServers =
        existingSettings.enabledMcpjsonServers || []
      
      updates.enabledMcpjsonServers = [
        ...new Set([
          ...existingEnabledServers,
          ...projectConfig.enabledMcpjsonServers,
        ]),
      ]
      fieldsToRemove.push('enabledMcpjsonServers')
    }

    // Migrate disabledMcpjsonServers if it exists
    if (hasDisabledServers && projectConfig.disabledMcpjsonServers) {
      const existingDisabledServers =
        existingSettings.disabledMcpjsonServers || []
      
      updates.disabledMcpjsonServers = [
        ...new Set([
          ...existingDisabledServers,
          ...projectConfig.disabledMcpjsonServers,
        ]),
      ]
      fieldsToRemove.push('disabledMcpjsonServers')
    }

    // Update settings if there are any updates
    if (Object.keys(updates).length > 0) {
      updateSettingsForSource('localSettings', updates)
    }

    // Remove migrated fields from project config
    if (
      fieldsToRemove.includes('enableAllProjectMcpServers') ||
      fieldsToRemove.includes('enabledMcpjsonServers') ||
      fieldsToRemove.includes('disabledMcpjsonServers')
    ) {
      saveCurrentProjectConfig(current => {
        const {
          enableAllProjectMcpServers: _enableAll,
          enabledMcpjsonServers: _enabledServers,
          disabledMcpjsonServers: _disabledServers,
          ...configWithoutFields
        } = current
        return configWithoutFields
      })
    }

    // Log the migration event
    logEvent('tengu_migrate_mcp_approval_fields_success', {
      migratedCount: fieldsToRemove.length,
    })
  } catch (e: unknown) {
    // Log migration failure but don't throw to avoid breaking startup
    logError(e)
    logEvent('tengu_migrate_mcp_approval_fields_error', {})
  }
}
