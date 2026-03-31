

let _isCseShimEnabled: (() => boolean) | undefined

export function setCseShimGate(gate: () => boolean): void {
  _isCseShimEnabled = gate
}

export function toCompatSessionId(id: string): string {
  if (!id.startsWith('cse_')) return id
  if (_isCseShimEnabled && !_isCseShimEnabled()) return id
  return 'session_' + id.slice('cse_'.length)
}

export function toInfraSessionId(id: string): string {
  if (!id.startsWith('session_')) return id
  return 'cse_' + id.slice('session_'.length)
}
