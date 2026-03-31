import type { LocalCommandResult } from '../../types/command.js'
import {
  CHANGELOG_URL,
  fetchAndStoreChangelog,
  getAllReleaseNotes,
  getStoredChangelog,
} from '../../utils/releaseNotes.js'

function formatReleaseNotes(notes: Array<[string, string[]]>): string {
  return notes
    .map(([version, notes]) => {
      const header = `Version ${version}:`
      const bulletPoints = notes.map(note => `· ${note}`).join('\n')
      return `${header}\n${bulletPoints}`
    })
    .join('\n\n')
}

export async function call(): Promise<LocalCommandResult> {
  
  let freshNotes: Array<[string, string[]]> = []

  try {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(rej => rej(new Error('Timeout')), 500, reject)
    })

    await Promise.race([fetchAndStoreChangelog(), timeoutPromise])
    freshNotes = getAllReleaseNotes(await getStoredChangelog())
  } catch {
    
  }

  
  if (freshNotes.length > 0) {
    return { type: 'text', value: formatReleaseNotes(freshNotes) }
  }

  
  const cachedNotes = getAllReleaseNotes(await getStoredChangelog())
  if (cachedNotes.length > 0) {
    return { type: 'text', value: formatReleaseNotes(cachedNotes) }
  }

  
  return {
    type: 'text',
    value: `See the full changelog at: ${CHANGELOG_URL}`,
  }
}
