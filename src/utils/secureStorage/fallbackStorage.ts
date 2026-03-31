import type { SecureStorage, SecureStorageData } from './types.js'

export function createFallbackStorage(
  primary: SecureStorage,
  secondary: SecureStorage,
): SecureStorage {
  return {
    name: `${primary.name}-with-${secondary.name}-fallback`,
    read(): SecureStorageData {
      const result = primary.read()
      if (result !== null && result !== undefined) {
        return result
      }
      return secondary.read() || {}
    },
    async readAsync(): Promise<SecureStorageData | null> {
      const result = await primary.readAsync()
      if (result !== null && result !== undefined) {
        return result
      }
      return (await secondary.readAsync()) || {}
    },
    update(data: SecureStorageData): { success: boolean; warning?: string } {
      // Capture state before update
      const primaryDataBefore = primary.read()

      const result = primary.update(data)

      if (result.success) {
        // Delete secondary when migrating to primary for the first time
        
        
        if (primaryDataBefore === null) {
          secondary.delete()
        }
        return result
      }

      const fallbackResult = secondary.update(data)

      if (fallbackResult.success) {
        // Primary write failed but primary may still hold an *older* valid
        
        
        
        
        
        if (primaryDataBefore !== null) {
          primary.delete()
        }
        return {
          success: true,
          warning: fallbackResult.warning,
        }
      }

      return { success: false }
    },
    delete(): boolean {
      const primarySuccess = primary.delete()
      const secondarySuccess = secondary.delete()

      return primarySuccess || secondarySuccess
    },
  }
}
