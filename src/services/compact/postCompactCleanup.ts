import { feature } from "../utils/bundle-mock.ts"
import type { QuerySource } from '../../constants/querySource.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { getUserContext } from '../../context.js'
import { clearSpeculativeChecks } from '../../tools/BashTool/bashPermissions.js'
import { clearClassifierApprovals } from '../../utils/classifierApprovals.js'
import { resetGetMemoryFilesCache } from '../../utils/claudemd.js'
import { clearSessionMessagesCache } from '../../utils/sessionStorage.js'
import { clearBetaTracingState } from '../../utils/telemetry/betaSessionTracing.js'
import { resetMicrocompactState } from './microCompact.js'

export function runPostCompactCleanup(querySource?: QuerySource): void {
  
  
  
  
  const isMainThreadCompact =
    querySource === undefined ||
    querySource.startsWith('repl_main_thread') ||
    querySource === 'sdk'

  resetMicrocompactState()
  if (feature('CONTEXT_COLLAPSE')) {
    if (isMainThreadCompact) {
      
      ;(
        require('../contextCollapse/index.js') as typeof import('../contextCollapse/index.js')
      ).resetContextCollapse()
      
    }
  }
  if (isMainThreadCompact) {
    
    
    
    
    
    
    
    getUserContext.cache.clear?.()
    resetGetMemoryFilesCache('compact')
  }
  clearSystemPromptSections()
  clearClassifierApprovals()
  clearSpeculativeChecks()
  
  
  
  
  
  clearBetaTracingState()
  if (feature('COMMIT_ATTRIBUTION')) {
    void import('../../utils/attributionHooks.js').then(m =>
      m.sweepFileContentCache(),
    )
  }
  clearSessionMessagesCache()
}
