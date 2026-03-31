import { saveGlobalConfig } from '../utils/config.js'

export function migrateReplBridgeEnabledToRemoteControlAtStartup(): void {
  saveGlobalConfig(prev => {
    
    
    
    const oldValue = (prev as Record<string, unknown>)['replBridgeEnabled']
    if (oldValue === undefined) return prev
    if (prev.remoteControlAtStartup !== undefined) return prev
    const next = { ...prev, remoteControlAtStartup: Boolean(oldValue) }
    delete (next as Record<string, unknown>)['replBridgeEnabled']
    return next
  })
}
