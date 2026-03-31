import { feature } from 'bun:bundle'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { randomUUID } from 'crypto'
import { logForDebugging } from 'src/utils/debug.js'
import { getAllowedChannels } from '../../../bootstrap/state.js'
import type { BridgePermissionCallbacks } from '../../../bridge/bridgePermissionCallbacks.js'
import { getTerminalFocused } from '../../../ink/terminal-focus-state.js'
import {
  CHANNEL_PERMISSION_REQUEST_METHOD,
  type ChannelPermissionRequestParams,
  findChannelEntry,
} from '../../../services/mcp/channelNotification.js'
import type { ChannelPermissionCallbacks } from '../../../services/mcp/channelPermissions.js'
import {
  filterPermissionRelayClients,
  shortRequestId,
  truncateForPreview,
} from '../../../services/mcp/channelPermissions.js'
import { executeAsyncClassifierCheck } from '../../../tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '../../../tools/BashTool/toolName.js'
import {
  clearClassifierChecking,
  setClassifierApproval,
  setClassifierChecking,
  setYoloClassifierApproval,
} from '../../../utils/classifierApprovals.js'
import { errorMessage } from '../../../utils/errors.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import { hasPermissionsToUseTool } from '../../../utils/permissions/permissions.js'
import type { PermissionContext } from '../PermissionContext.js'
import { createResolveOnce } from '../PermissionContext.js'

type InteractivePermissionParams = {
  ctx: PermissionContext
  description: string
  result: PermissionDecision & { behavior: 'ask' }
  awaitAutomatedChecksBeforeDialog: boolean | undefined
  bridgeCallbacks?: BridgePermissionCallbacks
  channelCallbacks?: ChannelPermissionCallbacks
}

function handleInteractivePermission(
  params: InteractivePermissionParams,
  resolve: (decision: PermissionDecision) => void,
): void {
  const {
    ctx,
    description,
    result,
    awaitAutomatedChecksBeforeDialog,
    bridgeCallbacks,
    channelCallbacks,
  } = params

  const { resolve: resolveOnce, isResolved, claim } = createResolveOnce(resolve)
  let userInteracted = false
  let checkmarkTransitionTimer: ReturnType<typeof setTimeout> | undefined
  
  
  let checkmarkAbortHandler: (() => void) | undefined
  const bridgeRequestId = bridgeCallbacks ? randomUUID() : undefined
  
  
  
  
  let channelUnsubscribe: (() => void) | undefined

  const permissionPromptStartTimeMs = Date.now()
  const displayInput = result.updatedInput ?? ctx.input

  function clearClassifierIndicator(): void {
    if (feature('BASH_CLASSIFIER')) {
      ctx.updateQueueItem({ classifierCheckInProgress: false })
    }
  }

  ctx.pushToQueue({
    assistantMessage: ctx.assistantMessage,
    tool: ctx.tool,
    description,
    input: displayInput,
    toolUseContext: ctx.toolUseContext,
    toolUseID: ctx.toolUseID,
    permissionResult: result,
    permissionPromptStartTimeMs,
    ...(feature('BASH_CLASSIFIER')
      ? {
          classifierCheckInProgress:
            !!result.pendingClassifierCheck &&
            !awaitAutomatedChecksBeforeDialog,
        }
      : {}),
    onUserInteraction() {
      
      
      
      
      
      
      const GRACE_PERIOD_MS = 200
      if (Date.now() - permissionPromptStartTimeMs < GRACE_PERIOD_MS) {
        return
      }
      userInteracted = true
      clearClassifierChecking(ctx.toolUseID)
      clearClassifierIndicator()
    },
    onDismissCheckmark() {
      if (checkmarkTransitionTimer) {
        clearTimeout(checkmarkTransitionTimer)
        checkmarkTransitionTimer = undefined
        if (checkmarkAbortHandler) {
          ctx.toolUseContext.abortController.signal.removeEventListener(
            'abort',
            checkmarkAbortHandler,
          )
          checkmarkAbortHandler = undefined
        }
        ctx.removeFromQueue()
      }
    },
    onAbort() {
      if (!claim()) return
      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.sendResponse(bridgeRequestId, {
          behavior: 'deny',
          message: 'User aborted',
        })
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()
      ctx.logCancelled()
      ctx.logDecision(
        { decision: 'reject', source: { type: 'user_abort' } },
        { permissionPromptStartTimeMs },
      )
      resolveOnce(ctx.cancelAndAbort(undefined, true))
    },
    async onAllow(
      updatedInput,
      permissionUpdates: PermissionUpdate[],
      feedback?: string,
      contentBlocks?: ContentBlockParam[],
    ) {
      if (!claim()) return 

      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.sendResponse(bridgeRequestId, {
          behavior: 'allow',
          updatedInput,
          updatedPermissions: permissionUpdates,
        })
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()

      resolveOnce(
        await ctx.handleUserAllow(
          updatedInput,
          permissionUpdates,
          feedback,
          permissionPromptStartTimeMs,
          contentBlocks,
          result.decisionReason,
        ),
      )
    },
    onReject(feedback?: string, contentBlocks?: ContentBlockParam[]) {
      if (!claim()) return

      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.sendResponse(bridgeRequestId, {
          behavior: 'deny',
          message: feedback ?? 'User denied permission',
        })
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()

      ctx.logDecision(
        {
          decision: 'reject',
          source: { type: 'user_reject', hasFeedback: !!feedback },
        },
        { permissionPromptStartTimeMs },
      )
      resolveOnce(ctx.cancelAndAbort(feedback, undefined, contentBlocks))
    },
    async recheckPermission() {
      if (isResolved()) return
      const freshResult = await hasPermissionsToUseTool(
        ctx.tool,
        ctx.input,
        ctx.toolUseContext,
        ctx.assistantMessage,
        ctx.toolUseID,
      )
      if (freshResult.behavior === 'allow') {
        
        
        
        
        
        
        
        
        if (!claim()) return
        if (bridgeCallbacks && bridgeRequestId) {
          bridgeCallbacks.cancelRequest(bridgeRequestId)
        }
        channelUnsubscribe?.()
        ctx.removeFromQueue()
        ctx.logDecision({ decision: 'accept', source: 'config' })
        resolveOnce(ctx.buildAllow(freshResult.updatedInput ?? ctx.input))
      }
    },
  })

  
  
  
  
  
  
  
  
  
  
  if (bridgeCallbacks && bridgeRequestId) {
    bridgeCallbacks.sendRequest(
      bridgeRequestId,
      ctx.tool.name,
      displayInput,
      ctx.toolUseID,
      description,
      result.suggestions,
      result.blockedPath,
    )

    const signal = ctx.toolUseContext.abortController.signal
    const unsubscribe = bridgeCallbacks.onResponse(
      bridgeRequestId,
      response => {
        if (!claim()) return 
        signal.removeEventListener('abort', unsubscribe)
        clearClassifierChecking(ctx.toolUseID)
        clearClassifierIndicator()
        ctx.removeFromQueue()
        channelUnsubscribe?.()

        if (response.behavior === 'allow') {
          if (response.updatedPermissions?.length) {
            void ctx.persistPermissions(response.updatedPermissions)
          }
          ctx.logDecision(
            {
              decision: 'accept',
              source: {
                type: 'user',
                permanent: !!response.updatedPermissions?.length,
              },
            },
            { permissionPromptStartTimeMs },
          )
          resolveOnce(ctx.buildAllow(response.updatedInput ?? displayInput))
        } else {
          ctx.logDecision(
            {
              decision: 'reject',
              source: {
                type: 'user_reject',
                hasFeedback: !!response.message,
              },
            },
            { permissionPromptStartTimeMs },
          )
          resolveOnce(ctx.cancelAndAbort(response.message))
        }
      },
    )

    signal.addEventListener('abort', unsubscribe, { once: true })
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (
    (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
    channelCallbacks &&
    !ctx.tool.requiresUserInteraction?.()
  ) {
    const channelRequestId = shortRequestId(ctx.toolUseID)
    const allowedChannels = getAllowedChannels()
    const channelClients = filterPermissionRelayClients(
      ctx.toolUseContext.getAppState().mcp.clients,
      name => findChannelEntry(name, allowedChannels) !== undefined,
    )

    if (channelClients.length > 0) {
      
      
      
      
      
      const params: ChannelPermissionRequestParams = {
        request_id: channelRequestId,
        tool_name: ctx.tool.name,
        description,
        input_preview: truncateForPreview(displayInput),
      }

      for (const client of channelClients) {
        if (client.type !== 'connected') continue 
        void client.client
          .notification({
            method: CHANNEL_PERMISSION_REQUEST_METHOD,
            params,
          })
          .catch(e => {
            logForDebugging(
              `Channel permission_request failed for ${client.name}: ${errorMessage(e)}`,
              { level: 'error' },
            )
          })
      }

      const channelSignal = ctx.toolUseContext.abortController.signal
      
      
      
      
      
      
      const mapUnsub = channelCallbacks.onResponse(
        channelRequestId,
        response => {
          if (!claim()) return 
          channelUnsubscribe?.() 
          clearClassifierChecking(ctx.toolUseID)
          clearClassifierIndicator()
          ctx.removeFromQueue()
          
          if (bridgeCallbacks && bridgeRequestId) {
            bridgeCallbacks.cancelRequest(bridgeRequestId)
          }

          if (response.behavior === 'allow') {
            ctx.logDecision(
              {
                decision: 'accept',
                source: { type: 'user', permanent: false },
              },
              { permissionPromptStartTimeMs },
            )
            resolveOnce(ctx.buildAllow(displayInput))
          } else {
            ctx.logDecision(
              {
                decision: 'reject',
                source: { type: 'user_reject', hasFeedback: false },
              },
              { permissionPromptStartTimeMs },
            )
            resolveOnce(
              ctx.cancelAndAbort(`Denied via channel ${response.fromServer}`),
            )
          }
        },
      )
      channelUnsubscribe = () => {
        mapUnsub()
        channelSignal.removeEventListener('abort', channelUnsubscribe!)
      }

      channelSignal.addEventListener('abort', channelUnsubscribe, {
        once: true,
      })
    }
  }

  
  if (!awaitAutomatedChecksBeforeDialog) {
    
    
    void (async () => {
      if (isResolved()) return
      const currentAppState = ctx.toolUseContext.getAppState()
      const hookDecision = await ctx.runHooks(
        currentAppState.toolPermissionContext.mode,
        result.suggestions,
        result.updatedInput,
        permissionPromptStartTimeMs,
      )
      if (!hookDecision || !claim()) return
      if (bridgeCallbacks && bridgeRequestId) {
        bridgeCallbacks.cancelRequest(bridgeRequestId)
      }
      channelUnsubscribe?.()
      ctx.removeFromQueue()
      resolveOnce(hookDecision)
    })()
  }

  
  if (
    feature('BASH_CLASSIFIER') &&
    result.pendingClassifierCheck &&
    ctx.tool.name === BASH_TOOL_NAME &&
    !awaitAutomatedChecksBeforeDialog
  ) {
    
    
    
    setClassifierChecking(ctx.toolUseID)
    void executeAsyncClassifierCheck(
      result.pendingClassifierCheck,
      ctx.toolUseContext.abortController.signal,
      ctx.toolUseContext.options.isNonInteractiveSession,
      {
        shouldContinue: () => !isResolved() && !userInteracted,
        onComplete: () => {
          clearClassifierChecking(ctx.toolUseID)
          clearClassifierIndicator()
        },
        onAllow: decisionReason => {
          if (!claim()) return
          if (bridgeCallbacks && bridgeRequestId) {
            bridgeCallbacks.cancelRequest(bridgeRequestId)
          }
          channelUnsubscribe?.()
          clearClassifierChecking(ctx.toolUseID)

          const matchedRule =
            decisionReason.type === 'classifier'
              ? (decisionReason.reason.match(
                  /^Allowed by prompt rule: "(.+)"$/,
                )?.[1] ?? decisionReason.reason)
              : undefined

          
          if (feature('TRANSCRIPT_CLASSIFIER')) {
            ctx.updateQueueItem({
              classifierCheckInProgress: false,
              classifierAutoApproved: true,
              classifierMatchedRule: matchedRule,
            })
          }

          if (
            feature('TRANSCRIPT_CLASSIFIER') &&
            decisionReason.type === 'classifier'
          ) {
            if (decisionReason.classifier === 'auto-mode') {
              setYoloClassifierApproval(ctx.toolUseID, decisionReason.reason)
            } else if (matchedRule) {
              setClassifierApproval(ctx.toolUseID, matchedRule)
            }
          }

          ctx.logDecision(
            { decision: 'accept', source: { type: 'classifier' } },
            { permissionPromptStartTimeMs },
          )
          resolveOnce(ctx.buildAllow(ctx.input, { decisionReason }))

          
          
          
          const signal = ctx.toolUseContext.abortController.signal
          checkmarkAbortHandler = () => {
            if (checkmarkTransitionTimer) {
              clearTimeout(checkmarkTransitionTimer)
              checkmarkTransitionTimer = undefined
              
              
              
              ctx.removeFromQueue()
            }
          }
          const checkmarkMs = getTerminalFocused() ? 3000 : 1000
          checkmarkTransitionTimer = setTimeout(() => {
            checkmarkTransitionTimer = undefined
            if (checkmarkAbortHandler) {
              signal.removeEventListener('abort', checkmarkAbortHandler)
              checkmarkAbortHandler = undefined
            }
            ctx.removeFromQueue()
          }, checkmarkMs)
          signal.addEventListener('abort', checkmarkAbortHandler, {
            once: true,
          })
        },
      },
    ).catch(error => {
      
      
      logForDebugging(`Async classifier check failed: ${errorMessage(error)}`, {
        level: 'error',
      })
    })
  }
}

export { handleInteractivePermission }
export type { InteractivePermissionParams }
