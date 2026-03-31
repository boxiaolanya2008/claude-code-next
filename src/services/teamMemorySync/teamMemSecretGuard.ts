import { feature } from "../utils/bundle-mock.ts"

export function checkTeamMemSecrets(
  filePath: string,
  content: string,
): string | null {
  if (feature('TEAMMEM')) {
    
    const { isTeamMemPath } =
      require('../../memdir/teamMemPaths.js') as typeof import('../../memdir/teamMemPaths.js')
    const { scanForSecrets } =
      require('./secretScanner.js') as typeof import('./secretScanner.js')
    

    if (!isTeamMemPath(filePath)) {
      return null
    }

    const matches = scanForSecrets(content)
    if (matches.length === 0) {
      return null
    }

    const labels = matches.map(m => m.label).join(', ')
    return (
      `Content contains potential secrets (${labels}) and cannot be written to team memory. ` +
      'Team memory is shared with all repository collaborators. ' +
      'Remove the sensitive content and try again.'
    )
  }
  return null
}
