import type { UUID } from 'crypto'
import { useEffect, useRef } from 'react'
import { useAppState } from '../state/AppState.js'
import type { Message } from '../types/message.js'
import { isAgentSwarmsEnabled } from '../utils/agentSwarmsEnabled.js'
import {
  cleanMessagesForLogging,
  isChainParticipant,
  recordTranscript,
} from '../utils/sessionStorage.js'

export function useLogMessages(messages: Message[], ignore: boolean = false) {
  const teamContext = useAppState(s => s.teamContext)

  
  
  
  const lastRecordedLengthRef = useRef(0)
  const lastParentUuidRef = useRef<UUID | undefined>(undefined)
  
  
  const firstMessageUuidRef = useRef<UUID | undefined>(undefined)
  
  
  const callSeqRef = useRef(0)

  useEffect(() => {
    if (ignore) return

    const currentFirstUuid = messages[0]?.uuid as UUID | undefined
    const prevLength = lastRecordedLengthRef.current

    
    
    const wasFirstRender = firstMessageUuidRef.current === undefined
    const isIncremental =
      currentFirstUuid !== undefined &&
      !wasFirstRender &&
      currentFirstUuid === firstMessageUuidRef.current &&
      prevLength <= messages.length
    
    
    
    
    
    const isSameHeadShrink =
      currentFirstUuid !== undefined &&
      !wasFirstRender &&
      currentFirstUuid === firstMessageUuidRef.current &&
      prevLength > messages.length

    const startIndex = isIncremental ? prevLength : 0
    if (startIndex === messages.length) return

    
    
    const slice = startIndex === 0 ? messages : messages.slice(startIndex)
    const parentHint = isIncremental ? lastParentUuidRef.current : undefined

    
    const seq = ++callSeqRef.current
    void recordTranscript(
      slice,
      isAgentSwarmsEnabled()
        ? {
            teamName: teamContext?.teamName,
            agentName: teamContext?.selfAgentName,
          }
        : {},
      parentHint,
      messages,
    ).then(lastRecordedUuid => {
      
      
      
      
      
      if (seq !== callSeqRef.current) return
      if (lastRecordedUuid && !isIncremental) {
        lastParentUuidRef.current = lastRecordedUuid
      }
    })

    
    
    
    
    
    
    
    
    
    
    
    if (isIncremental || wasFirstRender || isSameHeadShrink) {
      
      
      
      
      
      
      
      const last = cleanMessagesForLogging(slice, messages).findLast(
        isChainParticipant,
      )
      if (last) lastParentUuidRef.current = last.uuid as UUID
    }

    lastRecordedLengthRef.current = messages.length
    firstMessageUuidRef.current = currentFirstUuid
  }, [messages, ignore, teamContext?.teamName, teamContext?.selfAgentName])
}
