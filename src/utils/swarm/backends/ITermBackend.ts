import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'
import { logForDebugging } from '../../../utils/debug.js'
import { execFileNoThrow } from '../../../utils/execFileNoThrow.js'
import { IT2_COMMAND, isInITerm2, isIt2CliAvailable } from './detection.js'
import { registerITermBackend } from './registry.js'
import type { CreatePaneResult, PaneBackend, PaneId } from './types.js'

const teammateSessionIds: string[] = []

let firstPaneUsed = false

let paneCreationLock: Promise<void> = Promise.resolve()

function acquirePaneCreationLock(): Promise<() => void> {
  let release: () => void
  const newLock = new Promise<void>(resolve => {
    release = resolve
  })

  const previousLock = paneCreationLock
  paneCreationLock = newLock

  return previousLock.then(() => release!)
}

function runIt2(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return execFileNoThrow(IT2_COMMAND, args)
}

function parseSplitOutput(output: string): string {
  const match = output.match(/Created new pane:\s*(.+)/)
  if (match && match[1]) {
    return match[1].trim()
  }
  return ''
}

function getLeaderSessionId(): string | null {
  const itermSessionId = process.env.ITERM_SESSION_ID
  if (!itermSessionId) {
    return null
  }
  const colonIndex = itermSessionId.indexOf(':')
  if (colonIndex === -1) {
    return null
  }
  return itermSessionId.slice(colonIndex + 1)
}

export class ITermBackend implements PaneBackend {
  readonly type = 'iterm2' as const
  readonly displayName = 'iTerm2'
  readonly supportsHideShow = false

  

  async isAvailable(): Promise<boolean> {
    const inITerm2 = isInITerm2()
    logForDebugging(`[ITermBackend] isAvailable check: inITerm2=${inITerm2}`)
    if (!inITerm2) {
      logForDebugging('[ITermBackend] isAvailable: false (not in iTerm2)')
      return false
    }
    const it2Available = await isIt2CliAvailable()
    logForDebugging(
      `[ITermBackend] isAvailable: ${it2Available} (it2 CLI ${it2Available ? 'found' : 'not found'})`,
    )
    return it2Available
  }

  

  async isRunningInside(): Promise<boolean> {
    const result = isInITerm2()
    logForDebugging(`[ITermBackend] isRunningInside: ${result}`)
    return result
  }

  

  async createTeammatePaneInSwarmView(
    name: string,
    color: AgentColorName,
  ): Promise<CreatePaneResult> {
    logForDebugging(
      `[ITermBackend] createTeammatePaneInSwarmView called for ${name} with color ${color}`,
    )
    const releaseLock = await acquirePaneCreationLock()

    try {
      
      
      
      
      
      
      
      
      
      
      
      
      
      while (true) {
        const isFirstTeammate = !firstPaneUsed
        logForDebugging(
          `[ITermBackend] Creating pane: isFirstTeammate=${isFirstTeammate}, existingPanes=${teammateSessionIds.length}`,
        )

        let splitArgs: string[]
        let targetedTeammateId: string | undefined
        if (isFirstTeammate) {
          
          const leaderSessionId = getLeaderSessionId()
          if (leaderSessionId) {
            splitArgs = ['session', 'split', '-v', '-s', leaderSessionId]
            logForDebugging(
              `[ITermBackend] First split from leader session: ${leaderSessionId}`,
            )
          } else {
            
            splitArgs = ['session', 'split', '-v']
            logForDebugging(
              '[ITermBackend] First split from active session (no leader ID)',
            )
          }
        } else {
          
          targetedTeammateId = teammateSessionIds[teammateSessionIds.length - 1]
          if (targetedTeammateId) {
            splitArgs = ['session', 'split', '-s', targetedTeammateId]
            logForDebugging(
              `[ITermBackend] Subsequent split from teammate session: ${targetedTeammateId}`,
            )
          } else {
            
            splitArgs = ['session', 'split']
            logForDebugging(
              '[ITermBackend] Subsequent split from active session (no teammate ID)',
            )
          }
        }

        const splitResult = await runIt2(splitArgs)

        if (splitResult.code !== 0) {
          
          
          
          
          if (targetedTeammateId) {
            const listResult = await runIt2(['session', 'list'])
            if (
              listResult.code === 0 &&
              !listResult.stdout.includes(targetedTeammateId)
            ) {
              
              logForDebugging(
                `[ITermBackend] Split failed targeting dead session ${targetedTeammateId}, pruning and retrying: ${splitResult.stderr}`,
              )
              const idx = teammateSessionIds.indexOf(targetedTeammateId)
              if (idx !== -1) {
                teammateSessionIds.splice(idx, 1)
              }
              if (teammateSessionIds.length === 0) {
                firstPaneUsed = false
              }
              continue
            }
            
          }
          throw new Error(
            `Failed to create iTerm2 split pane: ${splitResult.stderr}`,
          )
        }

        if (isFirstTeammate) {
          firstPaneUsed = true
        }

        
        
        
        const paneId = parseSplitOutput(splitResult.stdout)

        if (!paneId) {
          throw new Error(
            `Failed to parse session ID from split output: ${splitResult.stdout}`,
          )
        }
        logForDebugging(
          `[ITermBackend] Created teammate pane for ${name}: ${paneId}`,
        )

        teammateSessionIds.push(paneId)

        
        
        
        

        return { paneId, isFirstTeammate }
      }
    } finally {
      releaseLock()
    }
  }

  

  async sendCommandToPane(
    paneId: PaneId,
    command: string,
    _useExternalSession?: boolean,
  ): Promise<void> {
    
    
    
    const args = paneId
      ? ['session', 'run', '-s', paneId, command]
      : ['session', 'run', command]

    const result = await runIt2(args)

    if (result.code !== 0) {
      throw new Error(
        `Failed to send command to iTerm2 pane ${paneId}: ${result.stderr}`,
      )
    }
  }

  

  async setPaneBorderColor(
    _paneId: PaneId,
    _color: AgentColorName,
    _useExternalSession?: boolean,
  ): Promise<void> {
    
  }

  

  async setPaneTitle(
    _paneId: PaneId,
    _name: string,
    _color: AgentColorName,
    _useExternalSession?: boolean,
  ): Promise<void> {
    
  }

  

  async enablePaneBorderStatus(
    _windowTarget?: string,
    _useExternalSession?: boolean,
  ): Promise<void> {
    
    
  }

  

  async rebalancePanes(
    _windowTarget: string,
    _hasLeader: boolean,
  ): Promise<void> {
    
    logForDebugging(
      '[ITermBackend] Pane rebalancing not implemented for iTerm2',
    )
  }

  

  async killPane(
    paneId: PaneId,
    _useExternalSession?: boolean,
  ): Promise<boolean> {
    
    
    
    
    const result = await runIt2(['session', 'close', '-f', '-s', paneId])
    
    
    const idx = teammateSessionIds.indexOf(paneId)
    if (idx !== -1) {
      teammateSessionIds.splice(idx, 1)
    }
    if (teammateSessionIds.length === 0) {
      firstPaneUsed = false
    }
    return result.code === 0
  }

  

  async hidePane(
    _paneId: PaneId,
    _useExternalSession?: boolean,
  ): Promise<boolean> {
    logForDebugging('[ITermBackend] hidePane not supported in iTerm2')
    return false
  }

  

  async showPane(
    _paneId: PaneId,
    _targetWindowOrPane: string,
    _useExternalSession?: boolean,
  ): Promise<boolean> {
    logForDebugging('[ITermBackend] showPane not supported in iTerm2')
    return false
  }
}

registerITermBackend(ITermBackend)
