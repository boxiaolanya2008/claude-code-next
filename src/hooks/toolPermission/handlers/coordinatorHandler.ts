import { feature } from 'bun:bundle'
import type { PendingClassifierCheck } from '../../../types/permissions.js'
import { logError } from '../../../utils/log.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import type { PermissionContext } from '../PermissionContext.js'

type CoordinatorPermissionParams = {
  ctx: PermissionContext
  pendingClassifierCheck?: PendingClassifierCheck | undefined
  updatedInput: Record<string, unknown> | undefined
  suggestions: PermissionUpdate[] | undefined
  permissionMode: string | undefined
}

async function handleCoordinatorPermission(
  params: CoordinatorPermissionParams,
): Promise<PermissionDecision | null> {
  const { ctx, updatedInput, suggestions, permissionMode } = params

  try {
    
    const hookResult = await ctx.runHooks(
      permissionMode,
      suggestions,
      updatedInput,
    )
    if (hookResult) return hookResult

    
    const classifierResult = feature('BASH_CLASSIFIER')
      ? await ctx.tryClassifier?.(params.pendingClassifierCheck, updatedInput)
      : null
    if (classifierResult) {
      return classifierResult
    }
  } catch (error) {
    
    
    
    
    if (error instanceof Error) {
      logError(error)
    } else {
      logError(new Error(`Automated permission check failed: ${String(error)}`))
    }
  }

  
  
  return null
}

export { handleCoordinatorPermission }
export type { CoordinatorPermissionParams }
