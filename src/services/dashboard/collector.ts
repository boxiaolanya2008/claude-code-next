import { getSessionId } from '../../bootstrap/state.js'
import type { Message } from '../../types.js'
import { getTokenUsage } from '../../utils/tokens.js'
import { getMainLoopModel } from '../../utils/model/model.js'
import {
  initDatabase,
  insertSession,
  updateSession,
  insertTokenUsage,
  getSessionById,
  type SessionRecord,
} from './database.js'
import { broadcastUpdate } from './server.js'

// Re-export database functions for external callers (print.ts)
export { insertTokenUsage, updateSession, getSessionById } from './database.js'

let currentSessionInitialized = false

function notifyUpdate(): void {
  try {
    const result = broadcastUpdate()
    console.log('[Dashboard] Broadcast update sent, clients:', result)
  } catch (error) {
    console.error('[Dashboard] Broadcast error:', error)
  }
}

export function initSessionTracking(model?: string): void {
  if (currentSessionInitialized) return

  try {
    initDatabase()
    const sessionId = getSessionId()

    if (!sessionId) {
      return
    }

    // Use provided model or get the current main loop model
    const currentModel = model || getMainLoopModel()

    const existingSession = getSessionById(sessionId)
    if (!existingSession) {
      const session: SessionRecord = {
        id: sessionId,
        startTime: Date.now(),
        model: currentModel,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        messageCount: 0,
        toolUseCount: 0,
      }
      insertSession(session)
      console.log('[Dashboard] Session initialized:', sessionId, 'model:', currentModel)
      notifyUpdate()
    } else {
      console.log('[Dashboard] Session already exists:', sessionId)
    }

    currentSessionInitialized = true
  } catch (error) {
    console.error('[Dashboard] Failed to initialize session tracking:', error)
  }
}

export function trackMessage(message: Message, model?: string): void {
  if (!currentSessionInitialized) {
    initSessionTracking(model)
  }

  try {
    const sessionId = getSessionId()
    if (!sessionId) return

    // Use provided model or get the current main loop model
    const currentModel = model || getMainLoopModel()

    const usage = getTokenUsage(message)
    if (!usage) return

    const inputTokens = usage.input_tokens || 0
    const outputTokens = usage.output_tokens || 0
    const cacheReadTokens = usage.cache_read_input_tokens || 0
    const cacheCreationTokens = usage.cache_creation_input_tokens || 0

    insertTokenUsage({
      sessionId,
      timestamp: Date.now(),
      model: currentModel,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      messageType: message.type === 'user' ? 'user' : 'assistant',
    })

    const session = getSessionById(sessionId)
    if (session) {
      updateSession(sessionId, {
        totalInputTokens: session.totalInputTokens + inputTokens,
        totalOutputTokens: session.totalOutputTokens + outputTokens,
        totalCacheReadTokens: session.totalCacheReadTokens + cacheReadTokens,
        totalCacheCreationTokens: session.totalCacheCreationTokens + cacheCreationTokens,
        messageCount: session.messageCount + 1,
      })
      console.log('[Dashboard] Message tracked:', {
        sessionId,
        inputTokens,
        outputTokens,
        model: currentModel,
      })
      notifyUpdate()
    } else {
      console.log('[Dashboard] Session not found for tracking:', sessionId)
    }
  } catch (error) {
    console.error('[Dashboard] Failed to track message:', error)
  }
}

export function trackToolUse(): void {
  if (!currentSessionInitialized) return
  
  try {
    const sessionId = getSessionId()
    if (!sessionId) return
    
    const session = getSessionById(sessionId)
    if (session) {
      updateSession(sessionId, {
        toolUseCount: session.toolUseCount + 1,
      })
      notifyUpdate()
    }
  } catch (error) {
    // Silently fail
  }
}

export function endSession(): void {
  if (!currentSessionInitialized) return
  
  try {
    const sessionId = getSessionId()
    if (!sessionId) return
    
    updateSession(sessionId, {
      endTime: Date.now(),
    })
    notifyUpdate()
  } catch (error) {
    // Silently fail
  }
}
