

import { jsonStringify } from '../utils/slowOperations.js'
import { DEFAULT_BINDINGS } from './defaultBindings.js'
import {
  NON_REBINDABLE,
  normalizeKeyForComparison,
} from './reservedShortcuts.js'
import type { KeybindingBlock } from './types.js'

function filterReservedShortcuts(blocks: KeybindingBlock[]): KeybindingBlock[] {
  const reservedKeys = new Set(
    NON_REBINDABLE.map(r => normalizeKeyForComparison(r.key)),
  )

  return blocks
    .map(block => {
      const filteredBindings: Record<string, string | null> = {}
      for (const [key, action] of Object.entries(block.bindings)) {
        if (!reservedKeys.has(normalizeKeyForComparison(key))) {
          filteredBindings[key] = action
        }
      }
      return { context: block.context, bindings: filteredBindings }
    })
    .filter(block => Object.keys(block.bindings).length > 0)
}

export function generateKeybindingsTemplate(): string {
  
  const bindings = filterReservedShortcuts(DEFAULT_BINDINGS)

  
  const config = {
    $schema: 'https://www.schemastore.org/claude-code-next-keybindings.json',
    $docs: 'https://code.claude.com/docs/en/keybindings',
    bindings,
  }

  return jsonStringify(config, null, 2) + '\n'
}
