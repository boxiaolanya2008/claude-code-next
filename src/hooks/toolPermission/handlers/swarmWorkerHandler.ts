import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { PendingClassifierCheck } from '../../../types/permissions.js'
import { isAgentSwarmsEnabled } from '../../../utils/agentSwarmsEnabled.js'
import { toError } from '../../../utils/errors.js'
import { logError } from '../../../utils/log.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import {
  createPermissionRequest,
  isSwarmWorker,
  sendPermissionRequestViaMailbox,
} from '../../../utils/swarm/permissionSync.js'
import { registerPermissionCallback } from '../../useSwarmPermissionPoller.js'
import type { PermissionContext } from '../PermissionContext.js'
import { createResolveOnce } from '../PermissionContext.js'

type SwarmWorkerPermissionParams = {
  ctx: PermissionContext
  description: string
  pendingClassifierCheck?: PendingClassifierCheck | undefined
  updatedInput: Record<string, unknown> | undefined
  suggestions: PermissionUpdate[] | undefined
}

/**
 * Handles the swarm worker permission flow.
 *
 * When running as a swarm worker:
 * 1. Tries classifier auto-approval for bash commands
 * 2. Forwards the permission request to the leader via mailbox
 * 3. Registers callbacks for when the leader responds
 * 4. Sets the pending indicator while waiting
 *
 * Returns a PermissionDecision if the classifier auto-approves,
 * or a Promise that resolves when the leader responds.
 * Returns null if swarms are not enabled or this is not a swarm worker,
 * so the caller can fall through to interactive handling.
 */
async function handleSwarmWorkerPermission(
  params: SwarmWorkerPermissionParams,
): Promise<PermissionDecision | null> {
  if (!isAgentSwarmsEnabled() || !isSwarmWorker()) {
    return null
  }

  const { ctx, description, updatedInput, suggestions } = params

  
  
  
  const classifierResult = feature('BASH_CLASSIFIER')
    ? await ctx.tryClassifier?.(params.pendingClassifierCheck, updatedInput)
    : null
  if (classifierResult) {
    return classifierResult
  }

  // Forward permission request to the leader via mailbox
  try {
    const clearPendingRequest = (): void =>
      ctx.toolUseContext.setAppState(prev => ({
        ...prev,
        pendingWorkerRequest: null,
      }))

    const decision = await new Promise<PermissionDecision>(resolve => {
      const { resolve: resolveOnce, claim } = createResolveOnce(resolve)

      
      const request = createPermissionRequest({
        toolName: ctx.tool.name,
        toolUseId: ctx.toolUseID,
        input: ctx.input,
        description,
        permissionSuggestions: suggestions,
      })

      
      
      registerPermissionCallback({
        requestId: request.id,
        toolUseId: ctx.toolUseID,
        async onAllow(
          allowedInput: Record<string, unknown> | undefined,
          permissionUpdates: PermissionUpdate[],
          feedback?: string,
          contentBlocks?: ContentBlockParam[],
        ) {
          if (!claim()) return // atomic check-and-mark before await
          clearPendingRequest()

          
          const finalInput =
            allowedInput && Object.keys(allowedInput).length > 0
              ? allowedInput
              : ctx.input

          resolveOnce(
            await ctx.handleUserAllow(
              finalInput,
              permissionUpdates,
              feedback,
              undefined,
              contentBlocks,
            ),
          )
        },
        onReject(feedback?: string, contentBlocks?: ContentBlockParam[]) {
          if (!claim()) return
          clearPendingRequest()

          ctx.logDecision({
            decision: 'reject',
            source: { type: 'user_reject', hasFeedback: !!feedback },
          })

          resolveOnce(ctx.cancelAndAbort(feedback, undefined, contentBlocks))
        },
      })

      
      void sendPermissionRequestViaMailbox(request)

      
      ctx.toolUseContext.setAppState(prev => ({
        ...prev,
        pendingWorkerRequest: {
          toolName: ctx.tool.name,
          toolUseId: ctx.toolUseID,
          description,
        },
      }))

      
      // resolve the promise with a cancel decision so it does not hang.
      ctx.toolUseContext.abortController.signal.addEventListener(
        'abort',
        () => {
          if (!claim()) return
          clearPendingRequest()
          ctx.logCancelled()
          resolveOnce(ctx.cancelAndAbort(undefined, true))
        },
        { once: true },
      )
    })

    return decision
  } catch (error) {
    // If swarm permission submission fails, fall back to local handling
    logError(toError(error))
    
    return null
  }
}

export { handleSwarmWorkerPermission }
export type { SwarmWorkerPermissionParams }
