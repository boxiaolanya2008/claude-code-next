

type InstalledAppLike = {
  readonly bundleId: string
  readonly displayName: string
  readonly path: string
}

// ── Noise filtering ──────────────────────────────────────────────────────

const PATH_ALLOWLIST: readonly string[] = [
  '/Applications/',
  '/System/Applications/',
]

const NAME_PATTERN_BLOCKLIST: readonly RegExp[] = [
  /Helper(?:$|\s\()/,
  /Agent(?:$|\s\()/,
  /Service(?:$|\s\()/,
  /Uninstaller(?:$|\s\()/,
  /Updater(?:$|\s\()/,
  /^\./,
]

const ALWAYS_KEEP_BUNDLE_IDS: ReadonlySet<string> = new Set([
  
  'com.apple.Safari',
  'com.google.Chrome',
  'com.microsoft.edgemac',
  'org.mozilla.firefox',
  'company.thebrowser.Browser', // Arc
  
  'com.tinyspeck.slackmacgap',
  'us.zoom.xos',
  'com.microsoft.teams2',
  'com.microsoft.teams',
  'com.apple.MobileSMS',
  'com.apple.mail',
  // Productivity
  'com.microsoft.Word',
  'com.microsoft.Excel',
  'com.microsoft.Powerpoint',
  'com.microsoft.Outlook',
  'com.apple.iWork.Pages',
  'com.apple.iWork.Numbers',
  'com.apple.iWork.Keynote',
  'com.google.GoogleDocs',
  // Notes / PM
  'notion.id',
  'com.apple.Notes',
  'md.obsidian',
  'com.linear',
  'com.figma.Desktop',
  // Dev
  'com.microsoft.VSCode',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.github.GitHubDesktop',
  // System essentials the model genuinely targets
  'com.apple.finder',
  'com.apple.iCal',
  'com.apple.systempreferences',
])

const APP_NAME_ALLOWED = /^[\p{L}\p{M}\p{N}_ .&'()+-]+$/u
const APP_NAME_MAX_LEN = 40
const APP_NAME_MAX_COUNT = 50

function isUserFacingPath(path: string, homeDir: string | undefined): boolean {
  if (PATH_ALLOWLIST.some(root => path.startsWith(root))) return true
  if (homeDir) {
    const userApps = homeDir.endsWith('/')
      ? `${homeDir}Applications/`
      : `${homeDir}/Applications/`
    if (path.startsWith(userApps)) return true
  }
  return false
}

function isNoisyName(name: string): boolean {
  return NAME_PATTERN_BLOCKLIST.some(re => re.test(name))
}

/**
 * Length cap + trim + dedupe + sort. `applyCharFilter` — skip for trusted
 * bundle IDs (Apple/Google/MS; a localized "Réglages Système" with unusual
 * punctuation shouldn't be dropped), apply for anything attacker-installable.
 */
function sanitizeCore(
  raw: readonly string[],
  applyCharFilter: boolean,
): string[] {
  const seen = new Set<string>()
  return raw
    .map(name => name.trim())
    .filter(trimmed => {
      if (!trimmed) return false
      if (trimmed.length > APP_NAME_MAX_LEN) return false
      if (applyCharFilter && !APP_NAME_ALLOWED.test(trimmed)) return false
      if (seen.has(trimmed)) return false
      seen.add(trimmed)
      return true
    })
    .sort((a, b) => a.localeCompare(b))
}

function sanitizeAppNames(raw: readonly string[]): string[] {
  const filtered = sanitizeCore(raw, true)
  if (filtered.length <= APP_NAME_MAX_COUNT) return filtered
  return [
    ...filtered.slice(0, APP_NAME_MAX_COUNT),
    `… and ${filtered.length - APP_NAME_MAX_COUNT} more`,
  ]
}

function sanitizeTrustedNames(raw: readonly string[]): string[] {
  return sanitizeCore(raw, false)
}

/**
 * Filter raw Spotlight results to user-facing apps, then sanitize. Always-keep
 * apps bypass path/name filter AND char allowlist (trusted vendors, not
 * attacker-installed); still length-capped, deduped, sorted.
 */
export function filterAppsForDescription(
  installed: readonly InstalledAppLike[],
  homeDir: string | undefined,
): string[] {
  const { alwaysKept, rest } = installed.reduce<{
    alwaysKept: string[]
    rest: string[]
  }>(
    (acc, app) => {
      if (ALWAYS_KEEP_BUNDLE_IDS.has(app.bundleId)) {
        acc.alwaysKept.push(app.displayName)
      } else if (
        isUserFacingPath(app.path, homeDir) &&
        !isNoisyName(app.displayName)
      ) {
        acc.rest.push(app.displayName)
      }
      return acc
    },
    { alwaysKept: [], rest: [] },
  )

  const sanitizedAlways = sanitizeTrustedNames(alwaysKept)
  const alwaysSet = new Set(sanitizedAlways)
  return [
    ...sanitizedAlways,
    ...sanitizeAppNames(rest).filter(n => !alwaysSet.has(n)),
  ]
}
