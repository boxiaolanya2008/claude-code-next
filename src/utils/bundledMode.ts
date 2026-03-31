

export function isRunningWithBun(): boolean {
  
  return process.versions.bun !== undefined
}

export function isInBundledMode(): boolean {
  return (
    typeof Bun !== 'undefined' &&
    Array.isArray(Bun.embeddedFiles) &&
    Bun.embeddedFiles.length > 0
  )
}
