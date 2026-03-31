

import { isFsInaccessible } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { sleep } from '../../utils/sleep.js'
import { logEvent } from '../analytics/index.js'

const EXTRACTION_WAIT_TIMEOUT_MS = 15000
const EXTRACTION_STALE_THRESHOLD_MS = 60000 

export type SessionMemoryConfig = {
  

  minimumMessageTokensToInit: number
  

  minimumTokensBetweenUpdate: number
  
  toolCallsBetweenUpdates: number
}

export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  minimumMessageTokensToInit: 10000,
  minimumTokensBetweenUpdate: 5000,
  toolCallsBetweenUpdates: 3,
}

let sessionMemoryConfig: SessionMemoryConfig = {
  ...DEFAULT_SESSION_MEMORY_CONFIG,
}

let lastSummarizedMessageId: string | undefined

let extractionStartedAt: number | undefined

let tokensAtLastExtraction = 0

let sessionMemoryInitialized = false

export function getLastSummarizedMessageId(): string | undefined {
  return lastSummarizedMessageId
}

export function setLastSummarizedMessageId(
  messageId: string | undefined,
): void {
  lastSummarizedMessageId = messageId
}

export function markExtractionStarted(): void {
  extractionStartedAt = Date.now()
}

export function markExtractionCompleted(): void {
  extractionStartedAt = undefined
}

export async function waitForSessionMemoryExtraction(): Promise<void> {
  const startTime = Date.now()
  while (extractionStartedAt) {
    const extractionAge = Date.now() - extractionStartedAt
    if (extractionAge > EXTRACTION_STALE_THRESHOLD_MS) {
      
      return
    }

    if (Date.now() - startTime > EXTRACTION_WAIT_TIMEOUT_MS) {
      
      return
    }

    await sleep(1000)
  }
}

export async function getSessionMemoryContent(): Promise<string | null> {
  const fs = getFsImplementation()
  const memoryPath = getSessionMemoryPath()

  try {
    const content = await fs.readFile(memoryPath, { encoding: 'utf-8' })

    logEvent('tengu_session_memory_loaded', {
      content_length: content.length,
    })

    return content
  } catch (e: unknown) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

export function setSessionMemoryConfig(
  config: Partial<SessionMemoryConfig>,
): void {
  sessionMemoryConfig = {
    ...sessionMemoryConfig,
    ...config,
  }
}

export function getSessionMemoryConfig(): SessionMemoryConfig {
  return { ...sessionMemoryConfig }
}

export function recordExtractionTokenCount(currentTokenCount: number): void {
  tokensAtLastExtraction = currentTokenCount
}

export function isSessionMemoryInitialized(): boolean {
  return sessionMemoryInitialized
}

export function markSessionMemoryInitialized(): void {
  sessionMemoryInitialized = true
}

export function hasMetInitializationThreshold(
  currentTokenCount: number,
): boolean {
  return currentTokenCount >= sessionMemoryConfig.minimumMessageTokensToInit
}

export function hasMetUpdateThreshold(currentTokenCount: number): boolean {
  const tokensSinceLastExtraction = currentTokenCount - tokensAtLastExtraction
  return (
    tokensSinceLastExtraction >= sessionMemoryConfig.minimumTokensBetweenUpdate
  )
}

export function getToolCallsBetweenUpdates(): number {
  return sessionMemoryConfig.toolCallsBetweenUpdates
}

export function resetSessionMemoryState(): void {
  sessionMemoryConfig = { ...DEFAULT_SESSION_MEMORY_CONFIG }
  tokensAtLastExtraction = 0
  sessionMemoryInitialized = false
  lastSummarizedMessageId = undefined
  extractionStartedAt = undefined
}
