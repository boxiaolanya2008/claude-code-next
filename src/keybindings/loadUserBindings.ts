

import chokidar, { type FSWatcher } from 'chokidar'
import { readFileSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { logEvent } from '../services/analytics/index.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { errorMessage, isENOENT } from '../utils/errors.js'
import { createSignal } from '../utils/signal.js'
import { jsonParse } from '../utils/slowOperations.js'
import { DEFAULT_BINDINGS } from './defaultBindings.js'
import { parseBindings } from './parser.js'
import type { KeybindingBlock, ParsedBinding } from './types.js'
import {
  checkDuplicateKeysInJson,
  type KeybindingWarning,
  validateBindings,
} from './validate.js'

export function isKeybindingCustomizationEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_keybinding_customization_release',
    false,
  )
}

const FILE_STABILITY_THRESHOLD_MS = 500

const FILE_STABILITY_POLL_INTERVAL_MS = 200

export type KeybindingsLoadResult = {
  bindings: ParsedBinding[]
  warnings: KeybindingWarning[]
}

let watcher: FSWatcher | null = null
let initialized = false
let disposed = false
let cachedBindings: ParsedBinding[] | null = null
let cachedWarnings: KeybindingWarning[] = []
const keybindingsChanged = createSignal<[result: KeybindingsLoadResult]>()

let lastCustomBindingsLogDate: string | null = null

function logCustomBindingsLoadedOncePerDay(userBindingCount: number): void {
  const today = new Date().toISOString().slice(0, 10)
  if (lastCustomBindingsLogDate === today) return
  lastCustomBindingsLogDate = today
  logEvent('tengu_custom_keybindings_loaded', {
    user_binding_count: userBindingCount,
  })
}

function isKeybindingBlock(obj: unknown): obj is KeybindingBlock {
  if (typeof obj !== 'object' || obj === null) return false
  const b = obj as Record<string, unknown>
  return (
    typeof b.context === 'string' &&
    typeof b.bindings === 'object' &&
    b.bindings !== null
  )
}

function isKeybindingBlockArray(arr: unknown): arr is KeybindingBlock[] {
  return Array.isArray(arr) && arr.every(isKeybindingBlock)
}

export function getKeybindingsPath(): string {
  return join(getClaudeConfigHomeDir(), 'keybindings.json')
}

function getDefaultParsedBindings(): ParsedBinding[] {
  return parseBindings(DEFAULT_BINDINGS)
}

export async function loadKeybindings(): Promise<KeybindingsLoadResult> {
  const defaultBindings = getDefaultParsedBindings()

  
  if (!isKeybindingCustomizationEnabled()) {
    return { bindings: defaultBindings, warnings: [] }
  }

  const userPath = getKeybindingsPath()

  try {
    const content = await readFile(userPath, 'utf-8')
    const parsed: unknown = jsonParse(content)

    
    let userBlocks: unknown
    if (typeof parsed === 'object' && parsed !== null && 'bindings' in parsed) {
      userBlocks = (parsed as { bindings: unknown }).bindings
    } else {
      
      const errorMessage = 'keybindings.json must have a "bindings" array'
      const suggestion = 'Use format: { "bindings": [ ... ] }'
      logForDebugging(`[keybindings] Invalid keybindings.json: ${errorMessage}`)
      return {
        bindings: defaultBindings,
        warnings: [
          {
            type: 'parse_error',
            severity: 'error',
            message: errorMessage,
            suggestion,
          },
        ],
      }
    }

    
    if (!isKeybindingBlockArray(userBlocks)) {
      const errorMessage = !Array.isArray(userBlocks)
        ? '"bindings" must be an array'
        : 'keybindings.json contains invalid block structure'
      const suggestion = !Array.isArray(userBlocks)
        ? 'Set "bindings" to an array of keybinding blocks'
        : 'Each block must have "context" (string) and "bindings" (object)'
      logForDebugging(`[keybindings] Invalid keybindings.json: ${errorMessage}`)
      return {
        bindings: defaultBindings,
        warnings: [
          {
            type: 'parse_error',
            severity: 'error',
            message: errorMessage,
            suggestion,
          },
        ],
      }
    }

    const userParsed = parseBindings(userBlocks)
    logForDebugging(
      `[keybindings] Loaded ${userParsed.length} user bindings from ${userPath}`,
    )

    
    const mergedBindings = [...defaultBindings, ...userParsed]

    logCustomBindingsLoadedOncePerDay(userParsed.length)

    
    
    const duplicateKeyWarnings = checkDuplicateKeysInJson(content)
    const warnings = [
      ...duplicateKeyWarnings,
      ...validateBindings(userBlocks, mergedBindings),
    ]

    if (warnings.length > 0) {
      logForDebugging(
        `[keybindings] Found ${warnings.length} validation issue(s)`,
      )
    }

    return { bindings: mergedBindings, warnings }
  } catch (error) {
    
    if (isENOENT(error)) {
      return { bindings: defaultBindings, warnings: [] }
    }

    
    logForDebugging(
      `[keybindings] Error loading ${userPath}: ${errorMessage(error)}`,
    )
    return {
      bindings: defaultBindings,
      warnings: [
        {
          type: 'parse_error',
          severity: 'error',
          message: `Failed to parse keybindings.json: ${errorMessage(error)}`,
        },
      ],
    }
  }
}

export function loadKeybindingsSync(): ParsedBinding[] {
  if (cachedBindings) {
    return cachedBindings
  }

  const result = loadKeybindingsSyncWithWarnings()
  return result.bindings
}

export function loadKeybindingsSyncWithWarnings(): KeybindingsLoadResult {
  if (cachedBindings) {
    return { bindings: cachedBindings, warnings: cachedWarnings }
  }

  const defaultBindings = getDefaultParsedBindings()

  
  if (!isKeybindingCustomizationEnabled()) {
    cachedBindings = defaultBindings
    cachedWarnings = []
    return { bindings: cachedBindings, warnings: cachedWarnings }
  }

  const userPath = getKeybindingsPath()

  try {
    
    const content = readFileSync(userPath, 'utf-8')
    const parsed: unknown = jsonParse(content)

    
    let userBlocks: unknown
    if (typeof parsed === 'object' && parsed !== null && 'bindings' in parsed) {
      userBlocks = (parsed as { bindings: unknown }).bindings
    } else {
      
      cachedBindings = defaultBindings
      cachedWarnings = [
        {
          type: 'parse_error',
          severity: 'error',
          message: 'keybindings.json must have a "bindings" array',
          suggestion: 'Use format: { "bindings": [ ... ] }',
        },
      ]
      return { bindings: cachedBindings, warnings: cachedWarnings }
    }

    
    if (!isKeybindingBlockArray(userBlocks)) {
      const errorMessage = !Array.isArray(userBlocks)
        ? '"bindings" must be an array'
        : 'keybindings.json contains invalid block structure'
      const suggestion = !Array.isArray(userBlocks)
        ? 'Set "bindings" to an array of keybinding blocks'
        : 'Each block must have "context" (string) and "bindings" (object)'
      cachedBindings = defaultBindings
      cachedWarnings = [
        {
          type: 'parse_error',
          severity: 'error',
          message: errorMessage,
          suggestion,
        },
      ]
      return { bindings: cachedBindings, warnings: cachedWarnings }
    }

    const userParsed = parseBindings(userBlocks)
    logForDebugging(
      `[keybindings] Loaded ${userParsed.length} user bindings from ${userPath}`,
    )
    cachedBindings = [...defaultBindings, ...userParsed]

    logCustomBindingsLoadedOncePerDay(userParsed.length)

    
    const duplicateKeyWarnings = checkDuplicateKeysInJson(content)
    cachedWarnings = [
      ...duplicateKeyWarnings,
      ...validateBindings(userBlocks, cachedBindings),
    ]
    if (cachedWarnings.length > 0) {
      logForDebugging(
        `[keybindings] Found ${cachedWarnings.length} validation issue(s)`,
      )
    }

    return { bindings: cachedBindings, warnings: cachedWarnings }
  } catch {
    
    cachedBindings = defaultBindings
    cachedWarnings = []
    return { bindings: cachedBindings, warnings: cachedWarnings }
  }
}

export async function initializeKeybindingWatcher(): Promise<void> {
  if (initialized || disposed) return

  
  if (!isKeybindingCustomizationEnabled()) {
    logForDebugging(
      '[keybindings] Skipping file watcher - user customization disabled',
    )
    return
  }

  const userPath = getKeybindingsPath()
  const watchDir = dirname(userPath)

  
  try {
    const stats = await stat(watchDir)
    if (!stats.isDirectory()) {
      logForDebugging(
        `[keybindings] Not watching: ${watchDir} is not a directory`,
      )
      return
    }
  } catch {
    logForDebugging(`[keybindings] Not watching: ${watchDir} does not exist`)
    return
  }

  
  initialized = true

  logForDebugging(`[keybindings] Watching for changes to ${userPath}`)

  watcher = chokidar.watch(userPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: FILE_STABILITY_THRESHOLD_MS,
      pollInterval: FILE_STABILITY_POLL_INTERVAL_MS,
    },
    ignorePermissionErrors: true,
    usePolling: false,
    atomic: true,
  })

  watcher.on('add', handleChange)
  watcher.on('change', handleChange)
  watcher.on('unlink', handleDelete)

  
  registerCleanup(async () => disposeKeybindingWatcher())
}

export function disposeKeybindingWatcher(): void {
  disposed = true
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  keybindingsChanged.clear()
}

export const subscribeToKeybindingChanges = keybindingsChanged.subscribe

async function handleChange(path: string): Promise<void> {
  logForDebugging(`[keybindings] Detected change to ${path}`)

  try {
    const result = await loadKeybindings()
    cachedBindings = result.bindings
    cachedWarnings = result.warnings

    
    keybindingsChanged.emit(result)
  } catch (error) {
    logForDebugging(`[keybindings] Error reloading: ${errorMessage(error)}`)
  }
}

function handleDelete(path: string): void {
  logForDebugging(`[keybindings] Detected deletion of ${path}`)

  
  const defaultBindings = getDefaultParsedBindings()
  cachedBindings = defaultBindings
  cachedWarnings = []

  keybindingsChanged.emit({ bindings: defaultBindings, warnings: [] })
}

export function getCachedKeybindingWarnings(): KeybindingWarning[] {
  return cachedWarnings
}

export function resetKeybindingLoaderForTesting(): void {
  initialized = false
  disposed = false
  cachedBindings = null
  cachedWarnings = []
  lastCustomBindingsLogDate = null
  if (watcher) {
    void watcher.close()
    watcher = null
  }
  keybindingsChanged.clear()
}
