import { nonAlphanumericKeys, type ParsedKey } from '../parse-keypress.js'
import { Event } from './event.js'

export type Key = {
  upArrow: boolean
  downArrow: boolean
  leftArrow: boolean
  rightArrow: boolean
  pageDown: boolean
  pageUp: boolean
  wheelUp: boolean
  wheelDown: boolean
  home: boolean
  end: boolean
  return: boolean
  escape: boolean
  ctrl: boolean
  shift: boolean
  fn: boolean
  tab: boolean
  backspace: boolean
  delete: boolean
  meta: boolean
  super: boolean
}

function parseKey(keypress: ParsedKey): [Key, string] {
  const key: Key = {
    upArrow: keypress.name === 'up',
    downArrow: keypress.name === 'down',
    leftArrow: keypress.name === 'left',
    rightArrow: keypress.name === 'right',
    pageDown: keypress.name === 'pagedown',
    pageUp: keypress.name === 'pageup',
    wheelUp: keypress.name === 'wheelup',
    wheelDown: keypress.name === 'wheeldown',
    home: keypress.name === 'home',
    end: keypress.name === 'end',
    return: keypress.name === 'return',
    escape: keypress.name === 'escape',
    fn: keypress.fn,
    ctrl: keypress.ctrl,
    shift: keypress.shift,
    tab: keypress.name === 'tab',
    backspace: keypress.name === 'backspace',
    delete: keypress.name === 'delete',
    // `parseKeypress` parses \u001B\u001B[A (meta + up arrow) as meta = false
    
    
    
    meta: keypress.meta || keypress.name === 'escape' || keypress.option,
    // Super (Cmd on macOS / Win key) — only arrives via kitty keyboard
    
    
    super: keypress.super,
  }

  let input = keypress.ctrl ? keypress.name : keypress.sequence

  
  if (input === undefined) {
    input = ''
  }

  // When ctrl is set, keypress.name for space is the literal word "space".
  
  
  
  if (keypress.ctrl && input === 'space') {
    input = ' '
  }

  // Suppress unrecognized escape sequences that were parsed as function keys
  
  
  
  // "[25~") leaks into the input as literal text.
  if (keypress.code && !keypress.name) {
    input = ''
  }

  // Suppress ESC-less SGR mouse fragments. When a heavy React commit blocks
  
  
  
  
  
  
  
  if (!keypress.name && /^\[<\d+;\d+;\d+[Mm]/.test(input)) {
    input = ''
  }

  // Strip meta if it's still remaining after `parseKeypress`
  // TODO(vadimdemedes): remove this in the next major version.
  if (input.startsWith('\u001B')) {
    input = input.slice(1)
  }

  // Track whether we've already processed this as a special sequence
  
  
  let processedAsSpecialSequence = false

  
  // we're left with "[codepoint;modifieru" (e.g., "[98;3u" for Alt+b).
  // Use the parsed key name instead for input handling. Require a digit
  // after [ — real CSI u is always [<digits>…u, and a bare startsWith('[')
  // false-matches X10 mouse at row 85 (Cy = 85+32 = 'u'), leaking the
  // literal text "mouse" into the prompt via processedAsSpecialSequence.
  if (/^\[\d/.test(input) && input.endsWith('u')) {
    if (!keypress.name) {
      // Unmapped Kitty functional key (Caps Lock 57358, F13–F35, KP nav,
      // bare modifiers, etc.) — keycodeToName() returned undefined. Swallow
      // so the raw "[57358u" doesn't leak into the prompt. See #38781.
      input = ''
    } else {
      // 'space' → ' '; 'escape' → '' (key.escape carries it;
      // processedAsSpecialSequence bypasses the nonAlphanumericKeys
      
      // otherwise use key name.
      input =
        keypress.name === 'space'
          ? ' '
          : keypress.name === 'escape'
            ? ''
            : keypress.name
    }
    processedAsSpecialSequence = true
  }

  // Handle xterm modifyOtherKeys sequences: after stripping ESC, we're left
  // with "[27;modifier;keycode~" (e.g., "[27;3;98~" for Alt+b). Same
  // extraction as CSI u — without this, printable-char keycodes (single-letter
  // names) skip the nonAlphanumericKeys clear and leak "[27;..." as input.
  if (input.startsWith('[27;') && input.endsWith('~')) {
    if (!keypress.name) {
      // Unmapped modifyOtherKeys keycode — swallow for consistency with
      // the CSI u handler above. Practically untriggerable today (xterm
      // modifyOtherKeys only sends ASCII keycodes, all mapped), but
      // guards against future terminal behavior.
      input = ''
    } else {
      input =
        keypress.name === 'space'
          ? ' '
          : keypress.name === 'escape'
            ? ''
            : keypress.name
    }
    processedAsSpecialSequence = true
  }

  // Handle application keypad mode sequences: after stripping ESC,
  // we're left with "O<letter>" (e.g., "Op" for numpad 0, "Oy" for numpad 9).
  
  if (
    input.startsWith('O') &&
    input.length === 2 &&
    keypress.name &&
    keypress.name.length === 1
  ) {
    input = keypress.name
    processedAsSpecialSequence = true
  }

  // Clear input for non-alphanumeric keys (arrows, function keys, etc.)
  
  
  if (
    !processedAsSpecialSequence &&
    keypress.name &&
    nonAlphanumericKeys.includes(keypress.name)
  ) {
    input = ''
  }

  // Set shift=true for uppercase letters (A-Z)
  
  if (
    input.length === 1 &&
    typeof input[0] === 'string' &&
    input[0] >= 'A' &&
    input[0] <= 'Z'
  ) {
    key.shift = true
  }

  return [key, input]
}

export class InputEvent extends Event {
  readonly keypress: ParsedKey
  readonly key: Key
  readonly input: string

  constructor(keypress: ParsedKey) {
    super()
    const [key, input] = parseKey(keypress)

    this.keypress = keypress
    this.key = key
    this.input = input
  }
}
