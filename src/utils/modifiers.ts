export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

let prewarmed = false

export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  
  try {
    
    const { prewarm } = require('modifiers-napi') as { prewarm: () => void }
    prewarm()
  } catch {
    
  }
}

export function isModifierPressed(modifier: ModifierKey): boolean {
  if (process.platform !== 'darwin') {
    return false
  }
  
  const { isModifierPressed: nativeIsModifierPressed } =
    
    require('modifiers-napi') as { isModifierPressed: (m: string) => boolean }
  return nativeIsModifierPressed(modifier)
}
