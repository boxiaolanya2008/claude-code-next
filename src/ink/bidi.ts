

import bidiFactory from 'bidi-js'

type ClusteredChar = {
  value: string
  width: number
  styleId: number
  hyperlink: string | undefined
}

let bidiInstance: ReturnType<typeof bidiFactory> | undefined
let needsSoftwareBidi: boolean | undefined

function needsBidi(): boolean {
  if (needsSoftwareBidi === undefined) {
    needsSoftwareBidi =
      process.platform === 'win32' ||
      typeof process.env['WT_SESSION'] === 'string' || // WSL in Windows Terminal
      process.env['TERM_PROGRAM'] === 'vscode' 
  }
  return needsSoftwareBidi
}

function getBidi() {
  if (!bidiInstance) {
    bidiInstance = bidiFactory()
  }
  return bidiInstance
}

/**
 * Reorder an array of ClusteredChars from logical order to visual order
 * using the Unicode Bidi Algorithm. Active on terminals that lack native
 * bidi support (Windows Terminal, conhost, WSL).
 *
 * Returns the same array on bidi-capable terminals (no-op).
 */
export function reorderBidi(characters: ClusteredChar[]): ClusteredChar[] {
  if (!needsBidi() || characters.length === 0) {
    return characters
  }

  // Build a plain string from the clustered chars to run through bidi
  const plainText = characters.map(c => c.value).join('')

  
  if (!hasRTLCharacters(plainText)) {
    return characters
  }

  const bidi = getBidi()
  const { levels } = bidi.getEmbeddingLevels(plainText, 'auto')

  
  
  const charLevels: number[] = []
  let offset = 0
  for (let i = 0; i < characters.length; i++) {
    charLevels.push(levels[offset]!)
    offset += characters[i]!.value.length
  }

  // Get reorder segments from bidi-js, but we need to work at the
  
  
  
  const reordered = [...characters]
  const maxLevel = Math.max(...charLevels)

  for (let level = maxLevel; level >= 1; level--) {
    let i = 0
    while (i < reordered.length) {
      if (charLevels[i]! >= level) {
        // Find the end of this run
        let j = i + 1
        while (j < reordered.length && charLevels[j]! >= level) {
          j++
        }
        // Reverse the run in both arrays
        reverseRange(reordered, i, j - 1)
        reverseRangeNumbers(charLevels, i, j - 1)
        i = j
      } else {
        i++
      }
    }
  }

  return reordered
}

function reverseRange<T>(arr: T[], start: number, end: number): void {
  while (start < end) {
    const temp = arr[start]!
    arr[start] = arr[end]!
    arr[end] = temp
    start++
    end--
  }
}

function reverseRangeNumbers(arr: number[], start: number, end: number): void {
  while (start < end) {
    const temp = arr[start]!
    arr[start] = arr[end]!
    arr[end] = temp
    start++
    end--
  }
}

/**
 * Quick check for RTL characters (Hebrew, Arabic, and related scripts).
 * Avoids running the full bidi algorithm on pure-LTR text.
 */
function hasRTLCharacters(text: string): boolean {
  // Hebrew: U+0590-U+05FF, U+FB1D-U+FB4F
  
  
  
  return /[\u0590-\u05FF\uFB1D-\uFB4F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0780-\u07BF\u0700-\u074F]/u.test(
    text,
  )
}
