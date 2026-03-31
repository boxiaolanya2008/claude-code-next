

type PrivacyLevel = 'default' | 'no-telemetry' | 'essential-traffic'

export function getPrivacyLevel(): PrivacyLevel {
  if (process.env.CLAUDE_CODE_NEXT_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'essential-traffic'
  }
  if (process.env.DISABLE_TELEMETRY) {
    return 'no-telemetry'
  }
  return 'default'
}

export function isEssentialTrafficOnly(): boolean {
  return getPrivacyLevel() === 'essential-traffic'
}

export function isTelemetryDisabled(): boolean {
  return getPrivacyLevel() !== 'default'
}

export function getEssentialTrafficOnlyReason(): string | null {
  if (process.env.CLAUDE_CODE_NEXT_DISABLE_NONESSENTIAL_TRAFFIC) {
    return 'CLAUDE_CODE_NEXT_DISABLE_NONESSENTIAL_TRAFFIC'
  }
  return null
}
