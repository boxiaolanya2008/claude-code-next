

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSetVoiceState } from '../context/voice.js'
import { useTerminalFocus } from '../ink/hooks/use-terminal-focus.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { getVoiceKeyterms } from '../services/voiceKeyterms.js'
import {
  connectVoiceStream,
  type FinalizeSource,
  isVoiceStreamAvailable,
  type VoiceStreamConnection,
} from '../services/voiceStreamSTT.js'
import { logForDebugging } from '../utils/debug.js'
import { toError } from '../utils/errors.js'
import { getSystemLocaleLanguage } from '../utils/intl.js'
import { logError } from '../utils/log.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { sleep } from '../utils/sleep.js'

const DEFAULT_STT_LANGUAGE = 'en'

const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  español: 'es',
  espanol: 'es',
  french: 'fr',
  français: 'fr',
  francais: 'fr',
  japanese: 'ja',
  日本語: 'ja',
  german: 'de',
  deutsch: 'de',
  portuguese: 'pt',
  português: 'pt',
  portugues: 'pt',
  italian: 'it',
  italiano: 'it',
  korean: 'ko',
  한국어: 'ko',
  hindi: 'hi',
  हिन्दी: 'hi',
  हिंदी: 'hi',
  indonesian: 'id',
  'bahasa indonesia': 'id',
  bahasa: 'id',
  russian: 'ru',
  русский: 'ru',
  polish: 'pl',
  polski: 'pl',
  turkish: 'tr',
  türkçe: 'tr',
  turkce: 'tr',
  dutch: 'nl',
  nederlands: 'nl',
  ukrainian: 'uk',
  українська: 'uk',
  greek: 'el',
  ελληνικά: 'el',
  czech: 'cs',
  čeština: 'cs',
  cestina: 'cs',
  danish: 'da',
  dansk: 'da',
  swedish: 'sv',
  svenska: 'sv',
  norwegian: 'no',
  norsk: 'no',
}

// Subset of the GrowthBook speech_to_text_voice_stream_config allowlist.

const SUPPORTED_LANGUAGE_CODES = new Set([
  'en',
  'es',
  'fr',
  'ja',
  'de',
  'pt',
  'it',
  'ko',
  'hi',
  'id',
  'ru',
  'pl',
  'tr',
  'nl',
  'uk',
  'el',
  'cs',
  'da',
  'sv',
  'no',
])

export function normalizeLanguageForSTT(language: string | undefined): {
  code: string
  fellBackFrom?: string
} {
  if (!language) return { code: DEFAULT_STT_LANGUAGE }
  const lower = language.toLowerCase().trim()
  if (!lower) return { code: DEFAULT_STT_LANGUAGE }
  if (SUPPORTED_LANGUAGE_CODES.has(lower)) return { code: lower }
  const fromName = LANGUAGE_NAME_TO_CODE[lower]
  if (fromName) return { code: fromName }
  const base = lower.split('-')[0]
  if (base && SUPPORTED_LANGUAGE_CODES.has(base)) return { code: base }
  return { code: DEFAULT_STT_LANGUAGE, fellBackFrom: language }
}

// Lazy-loaded voice module. We defer importing voice.ts (and its native

type VoiceModule = typeof import('../services/voice.js')
let voiceModule: VoiceModule | null = null

type VoiceState = 'idle' | 'recording' | 'processing'

type UseVoiceOptions = {
  onTranscript: (text: string) => void
  onError?: (message: string) => void
  enabled: boolean
  focusMode: boolean
}

type UseVoiceReturn = {
  state: VoiceState
  handleKeyEvent: (fallbackMs?: number) => void
}

// Gap (ms) between auto-repeat key events that signals key release.

const RELEASE_TIMEOUT_MS = 200

const REPEAT_FALLBACK_MS = 600
export const FIRST_PRESS_FALLBACK_MS = 2000

const FOCUS_SILENCE_TIMEOUT_MS = 5_000

const AUDIO_LEVEL_BARS = 16

export function computeLevel(chunk: Buffer): number {
  const samples = chunk.length >> 1 
  if (samples === 0) return 0
  let sumSq = 0
  for (let i = 0; i < chunk.length - 1; i += 2) {
    // Read 16-bit signed little-endian
    const sample = ((chunk[i]! | (chunk[i + 1]! << 8)) << 16) >> 16
    sumSq += sample * sample
  }
  const rms = Math.sqrt(sumSq / samples)
  const normalized = Math.min(rms / 2000, 1)
  return Math.sqrt(normalized)
}

export function useVoice({
  onTranscript,
  onError,
  enabled,
  focusMode,
}: UseVoiceOptions): UseVoiceReturn {
  const [state, setState] = useState<VoiceState>('idle')
  const stateRef = useRef<VoiceState>('idle')
  const connectionRef = useRef<VoiceStreamConnection | null>(null)
  const accumulatedRef = useRef('')
  const onTranscriptRef = useRef(onTranscript)
  const onErrorRef = useRef(onError)
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  
  
  
  const seenRepeatRef = useRef(false)
  const repeatFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  
  
  const focusTriggeredRef = useRef(false)
  
  const focusSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  
  
  
  const silenceTimedOutRef = useRef(false)
  const recordingStartRef = useRef(0)
  
  
  
  
  const sessionGenRef = useRef(0)
  
  
  const retryUsedRef = useRef(false)
  
  
  
  
  
  const fullAudioRef = useRef<Buffer[]>([])
  const silentDropRetriedRef = useRef(false)
  
  
  
  
  const attemptGenRef = useRef(0)
  
  
  
  
  const focusFlushedCharsRef = useRef(0)
  
  
  const hasAudioSignalRef = useRef(false)
  
  
  
  
  
  const everConnectedRef = useRef(false)
  const audioLevelsRef = useRef<number[]>([])
  const isFocused = useTerminalFocus()
  const setVoiceState = useSetVoiceState()

  
  onTranscriptRef.current = onTranscript
  onErrorRef.current = onError

  function updateState(newState: VoiceState): void {
    stateRef.current = newState
    setState(newState)
    setVoiceState(prev => {
      if (prev.voiceState === newState) return prev
      return { ...prev, voiceState: newState }
    })
  }

  const cleanup = useCallback((): void => {
    // Stale any in-flight session (main connection isStale(), replay
    
    
    // accumulate transcript, and inject it after voice was torn down.
    sessionGenRef.current++
    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }
    if (releaseTimerRef.current) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    if (repeatFallbackTimerRef.current) {
      clearTimeout(repeatFallbackTimerRef.current)
      repeatFallbackTimerRef.current = null
    }
    if (focusSilenceTimerRef.current) {
      clearTimeout(focusSilenceTimerRef.current)
      focusSilenceTimerRef.current = null
    }
    silenceTimedOutRef.current = false
    voiceModule?.stopRecording()
    if (connectionRef.current) {
      connectionRef.current.close()
      connectionRef.current = null
    }
    accumulatedRef.current = ''
    audioLevelsRef.current = []
    fullAudioRef.current = []
    setVoiceState(prev => {
      if (prev.voiceInterimTranscript === '' && !prev.voiceAudioLevels.length)
        return prev
      return { ...prev, voiceInterimTranscript: '', voiceAudioLevels: [] }
    })
  }, [setVoiceState])

  function finishRecording(): void {
    logForDebugging(
      '[voice] finishRecording: stopping recording, transitioning to processing',
    )
    
    
    
    attemptGenRef.current++
    
    
    
    
    
    const focusTriggered = focusTriggeredRef.current
    focusTriggeredRef.current = false
    updateState('processing')
    voiceModule?.stopRecording()
    
    
    
    
    
    // reproducing the silent-drop false-positive this ref exists to prevent.
    const recordingDurationMs = Date.now() - recordingStartRef.current
    const hadAudioSignal = hasAudioSignalRef.current
    const retried = retryUsedRef.current
    const focusFlushedChars = focusFlushedCharsRef.current
    
    
    
    
    const wsConnected = everConnectedRef.current
    
    
    
    // session's gen and every staleness check would be a no-op.
    const myGen = sessionGenRef.current
    const isStale = () => sessionGenRef.current !== myGen
    logForDebugging('[voice] Recording stopped')

    // Send finalize and wait for the WebSocket to close before reading the
    // accumulated transcript.  The close handler promotes any unreported
    // interim text to final, so we must wait for it to fire.
    const finalizePromise: Promise<FinalizeSource | undefined> =
      connectionRef.current
        ? connectionRef.current.finalize()
        : Promise.resolve(undefined)

    void finalizePromise
      .then(async finalizeSource => {
        if (isStale()) return
        // Silent-drop replay: when the server accepted audio (wsConnected),
        // the mic captured real signal (hadAudioSignal), but finalize timed
        // out with zero transcript — the ~1% session-sticky CE-pod bug.
        // Replay the buffered audio on a fresh connection once. A 250ms
        // backoff clears the same-pod rapid-reconnect race (same gap as the
        // early-error retry path below).
        if (
          finalizeSource === 'no_data_timeout' &&
          hadAudioSignal &&
          wsConnected &&
          !focusTriggered &&
          focusFlushedChars === 0 &&
          accumulatedRef.current.trim() === '' &&
          !silentDropRetriedRef.current &&
          fullAudioRef.current.length > 0
        ) {
          silentDropRetriedRef.current = true
          logForDebugging(
            `[voice] Silent-drop detected (no_data_timeout, ${String(fullAudioRef.current.length)} chunks); replaying on fresh connection`,
          )
          logEvent('tengu_voice_silent_drop_replay', {
            recordingDurationMs,
            chunkCount: fullAudioRef.current.length,
          })
          if (connectionRef.current) {
            connectionRef.current.close()
            connectionRef.current = null
          }
          const replayBuffer = fullAudioRef.current
          await sleep(250)
          if (isStale()) return
          const stt = normalizeLanguageForSTT(getInitialSettings().language)
          const keyterms = await getVoiceKeyterms()
          if (isStale()) return
          await new Promise<void>(resolve => {
            void connectVoiceStream(
              {
                onTranscript: (t, isFinal) => {
                  if (isStale()) return
                  if (isFinal && t.trim()) {
                    if (accumulatedRef.current) accumulatedRef.current += ' '
                    accumulatedRef.current += t.trim()
                  }
                },
                onError: () => resolve(),
                onClose: () => {},
                onReady: conn => {
                  if (isStale()) {
                    conn.close()
                    resolve()
                    return
                  }
                  connectionRef.current = conn
                  const SLICE = 32_000
                  let slice: Buffer[] = []
                  let bytes = 0
                  for (const c of replayBuffer) {
                    if (bytes > 0 && bytes + c.length > SLICE) {
                      conn.send(Buffer.concat(slice))
                      slice = []
                      bytes = 0
                    }
                    slice.push(c)
                    bytes += c.length
                  }
                  if (slice.length) conn.send(Buffer.concat(slice))
                  void conn.finalize().then(() => {
                    conn.close()
                    resolve()
                  })
                },
              },
              { language: stt.code, keyterms },
            ).then(
              c => {
                if (!c) resolve()
              },
              () => resolve(),
            )
          })
          if (isStale()) return
        }
        fullAudioRef.current = []

        const text = accumulatedRef.current.trim()
        logForDebugging(
          `[voice] Final transcript assembled (${String(text.length)} chars): "${text.slice(0, 200)}"`,
        )

        // Tracks silent-drop rate: transcriptChars=0 + hadAudioSignal=true
        // + recordingDurationMs>2000 = the bug backend PR #287008 fixes.
        // focusFlushedCharsRef makes transcriptChars accurate for focus mode
        // (where each final is injected immediately and accumulatedRef reset).
        //
        // NOTE: this fires only on the finishRecording() path. The onError
        // fallthrough and !conn (no-OAuth) paths bypass this → don't compute
        
        
        logEvent('tengu_voice_recording_completed', {
          transcriptChars: text.length + focusFlushedChars,
          recordingDurationMs,
          hadAudioSignal,
          retried,
          silentDropRetried: silentDropRetriedRef.current,
          wsConnected,
          focusTriggered,
        })

        if (connectionRef.current) {
          connectionRef.current.close()
          connectionRef.current = null
        }

        if (text) {
          logForDebugging(
            `[voice] Injecting transcript (${String(text.length)} chars)`,
          )
          onTranscriptRef.current(text)
        } else if (focusFlushedChars === 0 && recordingDurationMs > 2000) {
          // Only warn about empty transcript if nothing was flushed in focus
          
          
          if (!wsConnected) {
            // WS never connected → audio never reached backend. Not a silent
            
            onErrorRef.current?.(
              'Voice connection failed. Check your network and try again.',
            )
          } else if (!hadAudioSignal) {
            // Distinguish silent mic (capture issue) from speech not recognized.
            onErrorRef.current?.(
              'No audio detected from microphone. Check that the correct input device is selected and that Claude Code has microphone access.',
            )
          } else {
            onErrorRef.current?.('No speech detected.')
          }
        }

        accumulatedRef.current = ''
        setVoiceState(prev => {
          if (prev.voiceInterimTranscript === '') return prev
          return { ...prev, voiceInterimTranscript: '' }
        })
        updateState('idle')
      })
      .catch(err => {
        logError(toError(err))
        if (!isStale()) updateState('idle')
      })
  }

  // When voice is enabled, lazy-import voice.ts so checkRecordingAvailability
  
  
  
  
  
  useEffect(() => {
    if (enabled && !voiceModule) {
      void import('../services/voice.js').then(mod => {
        voiceModule = mod
      })
    }
  }, [enabled])

  
  
  
  
  function armFocusSilenceTimer(): void {
    if (focusSilenceTimerRef.current) {
      clearTimeout(focusSilenceTimerRef.current)
    }
    focusSilenceTimerRef.current = setTimeout(
      (
        focusSilenceTimerRef,
        stateRef,
        focusTriggeredRef,
        silenceTimedOutRef,
        finishRecording,
      ) => {
        focusSilenceTimerRef.current = null
        if (stateRef.current === 'recording' && focusTriggeredRef.current) {
          logForDebugging(
            '[voice] Focus silence timeout — tearing down session',
          )
          silenceTimedOutRef.current = true
          finishRecording()
        }
      },
      FOCUS_SILENCE_TIMEOUT_MS,
      focusSilenceTimerRef,
      stateRef,
      focusTriggeredRef,
      silenceTimedOutRef,
      finishRecording,
    )
  }

  // ── Focus-driven recording ──────────────────────────────────────────
  
  
  
  useEffect(() => {
    if (!enabled || !focusMode) {
      // Focus mode was disabled while a focus-driven recording was active —
      
      if (focusTriggeredRef.current && stateRef.current === 'recording') {
        logForDebugging(
          '[voice] Focus mode disabled during recording, finishing',
        )
        finishRecording()
      }
      return
    }
    let cancelled = false
    if (
      isFocused &&
      stateRef.current === 'idle' &&
      !silenceTimedOutRef.current
    ) {
      const beginFocusRecording = (): void => {
        // Re-check conditions — state or enabled/focusMode may have changed
        
        if (
          cancelled ||
          stateRef.current !== 'idle' ||
          silenceTimedOutRef.current
        )
          return
        logForDebugging('[voice] Focus gained, starting recording session')
        focusTriggeredRef.current = true
        void startRecordingSession()
        armFocusSilenceTimer()
      }
      if (voiceModule) {
        beginFocusRecording()
      } else {
        // Voice module is loading (async import resolves from cache as a
        
        void import('../services/voice.js').then(mod => {
          voiceModule = mod
          beginFocusRecording()
        })
      }
    } else if (!isFocused) {
      // Clear the silence timeout flag on blur so the next focus
      
      silenceTimedOutRef.current = false
      if (stateRef.current === 'recording') {
        logForDebugging('[voice] Focus lost, finishing recording')
        finishRecording()
      }
    }
    return () => {
      cancelled = true
    }
  }, [enabled, focusMode, isFocused])

  
  async function startRecordingSession(): Promise<void> {
    if (!voiceModule) {
      onErrorRef.current?.(
        'Voice module not loaded yet. Try again in a moment.',
      )
      return
    }

    // Transition to 'recording' synchronously, BEFORE any await. Callers
    
    // - useVoiceIntegration.tsx space-hold guard reads voiceState from the
    
    
    
    
    updateState('recording')
    recordingStartRef.current = Date.now()
    accumulatedRef.current = ''
    seenRepeatRef.current = false
    hasAudioSignalRef.current = false
    retryUsedRef.current = false
    silentDropRetriedRef.current = false
    fullAudioRef.current = []
    focusFlushedCharsRef.current = 0
    everConnectedRef.current = false
    const myGen = ++sessionGenRef.current

    
    const availability = await voiceModule.checkRecordingAvailability()
    if (!availability.available) {
      logForDebugging(
        `[voice] Recording not available: ${availability.reason ?? 'unknown'}`,
      )
      onErrorRef.current?.(
        availability.reason ?? 'Audio recording is not available.',
      )
      cleanup()
      updateState('idle')
      return
    }

    logForDebugging(
      '[voice] Starting recording session, connecting voice stream',
    )
    
    setVoiceState(prev => {
      if (!prev.voiceError) return prev
      return { ...prev, voiceError: null }
    })

    
    
    
    const audioBuffer: Buffer[] = []

    
    
    logForDebugging(
      '[voice] startRecording: buffering audio while WebSocket connects',
    )
    audioLevelsRef.current = []
    const started = await voiceModule.startRecording(
      (chunk: Buffer) => {
        // Copy for fullAudioRef replay buffer. send() in voiceStreamSTT
        
        
        
        const owned = Buffer.from(chunk)
        if (!focusTriggeredRef.current) {
          fullAudioRef.current.push(owned)
        }
        if (connectionRef.current) {
          connectionRef.current.send(owned)
        } else {
          audioBuffer.push(owned)
        }
        // Update audio level histogram for the recording visualizer
        const level = computeLevel(chunk)
        if (!hasAudioSignalRef.current && level > 0.01) {
          hasAudioSignalRef.current = true
        }
        const levels = audioLevelsRef.current
        if (levels.length >= AUDIO_LEVEL_BARS) {
          levels.shift()
        }
        levels.push(level)
        
        const snapshot = [...levels]
        audioLevelsRef.current = snapshot
        setVoiceState(prev => ({ ...prev, voiceAudioLevels: snapshot }))
      },
      () => {
        // External end (e.g. device error) - treat as stop
        if (stateRef.current === 'recording') {
          finishRecording()
        }
      },
      { silenceDetection: false },
    )

    if (!started) {
      logError(new Error('[voice] Recording failed — no audio tool found'))
      onErrorRef.current?.(
        'Failed to start audio capture. Check that your microphone is accessible.',
      )
      cleanup()
      updateState('idle')
      setVoiceState(prev => ({
        ...prev,
        voiceError: 'Recording failed — no audio tool found',
      }))
      return
    }

    const rawLanguage = getInitialSettings().language
    const stt = normalizeLanguageForSTT(rawLanguage)
    logEvent('tengu_voice_recording_started', {
      focusTriggered: focusTriggeredRef.current,
      sttLanguage:
        stt.code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      sttLanguageIsDefault: !rawLanguage?.trim(),
      sttLanguageFellBack: stt.fellBackFrom !== undefined,
      // ISO 639 subtag from Intl (bounded set, never user text). undefined if
      
      systemLocaleLanguage:
        getSystemLocaleLanguage() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    
    
    
    
    
    
    
    
    let sawTranscript = false

    
    
    
    
    
    // session and corrupting its connectionRef / triggering a bogus retry.
    const isStale = () => sessionGenRef.current !== myGen

    const attemptConnect = (keyterms: string[]): void => {
      const myAttemptGen = attemptGenRef.current
      void connectVoiceStream(
        {
          onTranscript: (text: string, isFinal: boolean) => {
            if (isStale()) return
            sawTranscript = true
            logForDebugging(
              `[voice] onTranscript: isFinal=${String(isFinal)} text="${text}"`,
            )
            if (isFinal && text.trim()) {
              if (focusTriggeredRef.current) {
                // Focus mode: flush each final transcript immediately and
                
                
                logForDebugging(
                  `[voice] Focus mode: flushing final transcript immediately: "${text.trim()}"`,
                )
                onTranscriptRef.current(text.trim())
                focusFlushedCharsRef.current += text.trim().length
                setVoiceState(prev => {
                  if (prev.voiceInterimTranscript === '') return prev
                  return { ...prev, voiceInterimTranscript: '' }
                })
                accumulatedRef.current = ''
                
                armFocusSilenceTimer()
              } else {
                // Hold-to-talk: accumulate final transcripts separated by spaces
                if (accumulatedRef.current) {
                  accumulatedRef.current += ' '
                }
                accumulatedRef.current += text.trim()
                logForDebugging(
                  `[voice] Accumulated final transcript: "${accumulatedRef.current}"`,
                )
                
                setVoiceState(prev => {
                  const preview = accumulatedRef.current
                  if (prev.voiceInterimTranscript === preview) return prev
                  return { ...prev, voiceInterimTranscript: preview }
                })
              }
            } else if (!isFinal) {
              // Active interim speech resets the focus silence timer.
              
              
              
              if (focusTriggeredRef.current) {
                armFocusSilenceTimer()
              }
              // Show accumulated finals + current interim as live preview
              const interim = text.trim()
              const preview = accumulatedRef.current
                ? accumulatedRef.current + (interim ? ' ' + interim : '')
                : interim
              setVoiceState(prev => {
                if (prev.voiceInterimTranscript === preview) return prev
                return { ...prev, voiceInterimTranscript: preview }
              })
            }
          },
          onError: (error: string, opts?: { fatal?: boolean }) => {
            if (isStale()) {
              logForDebugging(
                `[voice] ignoring onError from stale session: ${error}`,
              )
              return
            }
            // Swallow errors from superseded attempts. Covers conn 1's
            // trailing close after retry is scheduled, AND the current
            // conn's ws close event after its ws error already surfaced
            
            if (attemptGenRef.current !== myAttemptGen) {
              logForDebugging(
                `[voice] ignoring stale onError from superseded attempt: ${error}`,
              )
              return
            }
            // Early-failure retry: server error before any transcript =
            // likely a transient upstream race (CE rejection, Deepgram
            
            
            
            
            
            
            if (
              !opts?.fatal &&
              !sawTranscript &&
              stateRef.current === 'recording'
            ) {
              if (!retryUsedRef.current) {
                retryUsedRef.current = true
                logForDebugging(
                  `[voice] early voice_stream error (pre-transcript), retrying once: ${error}`,
                )
                logEvent('tengu_voice_stream_early_retry', {})
                connectionRef.current = null
                attemptGenRef.current++
                setTimeout(
                  (stateRef, attemptConnect, keyterms) => {
                    if (stateRef.current === 'recording') {
                      attemptConnect(keyterms)
                    }
                  },
                  250,
                  stateRef,
                  attemptConnect,
                  keyterms,
                )
                return
              }
            }
            // Surfacing — bump gen so this conn's trailing close-error
            // (ws fires error then close 1006) is swallowed above.
            attemptGenRef.current++
            logError(new Error(`[voice] voice_stream error: ${error}`))
            onErrorRef.current?.(`Voice stream error: ${error}`)
            // Clear the audio buffer on error to avoid memory leaks
            audioBuffer.length = 0
            focusTriggeredRef.current = false
            cleanup()
            updateState('idle')
          },
          onClose: () => {
            // no-op; lifecycle handled by cleanup()
          },
          onReady: conn => {
            // Only proceed if we're still in recording state AND this is
            
            
            
            if (isStale() || stateRef.current !== 'recording') {
              conn.close()
              return
            }

            // The WebSocket is now truly open — assign connectionRef so
            
            connectionRef.current = conn
            everConnectedRef.current = true

            
            
            
            
            
            
            const SLICE_TARGET_BYTES = 32_000 
            if (audioBuffer.length > 0) {
              let totalBytes = 0
              for (const c of audioBuffer) totalBytes += c.length
              const slices: Buffer[][] = [[]]
              let sliceBytes = 0
              for (const chunk of audioBuffer) {
                if (
                  sliceBytes > 0 &&
                  sliceBytes + chunk.length > SLICE_TARGET_BYTES
                ) {
                  slices.push([])
                  sliceBytes = 0
                }
                slices[slices.length - 1]!.push(chunk)
                sliceBytes += chunk.length
              }
              logForDebugging(
                `[voice] onReady: flushing ${String(audioBuffer.length)} buffered chunks (${String(totalBytes)} bytes) as ${String(slices.length)} coalesced frame(s)`,
              )
              for (const slice of slices) {
                conn.send(Buffer.concat(slice))
              }
            }
            audioBuffer.length = 0

            
            
            
            
            if (releaseTimerRef.current) {
              clearTimeout(releaseTimerRef.current)
            }
            if (seenRepeatRef.current) {
              releaseTimerRef.current = setTimeout(
                (releaseTimerRef, stateRef, finishRecording) => {
                  releaseTimerRef.current = null
                  if (stateRef.current === 'recording') {
                    finishRecording()
                  }
                },
                RELEASE_TIMEOUT_MS,
                releaseTimerRef,
                stateRef,
                finishRecording,
              )
            }
          },
        },
        {
          language: stt.code,
          keyterms,
        },
      ).then(conn => {
        if (isStale()) {
          conn?.close()
          return
        }
        if (!conn) {
          logForDebugging(
            '[voice] Failed to connect to voice_stream (no OAuth token?)',
          )
          onErrorRef.current?.(
            'Voice mode requires a Claude.ai account. Please run /login to sign in.',
          )
          
          audioBuffer.length = 0
          cleanup()
          updateState('idle')
          return
        }

        // Safety check: if the user released the key before connectVoiceStream
        
        if (stateRef.current !== 'recording') {
          audioBuffer.length = 0
          conn.close()
          return
        }
      })
    }

    void getVoiceKeyterms().then(attemptConnect)
  }

  // ── Hold-to-talk handler ────────────────────────────────────────────
  
  
  
  
  
  
  
  
  const handleKeyEvent = useCallback(
    (fallbackMs = REPEAT_FALLBACK_MS): void => {
      if (!enabled || !isVoiceStreamAvailable()) {
        return
      }

      // In focus mode, recording is driven by terminal focus, not keypresses.
      if (focusTriggeredRef.current) {
        // Active focus recording — ignore key events (session ends on blur).
        return
      }
      if (focusMode && silenceTimedOutRef.current) {
        // Focus session timed out due to silence — keypress re-arms it.
        logForDebugging(
          '[voice] Re-arming focus recording after silence timeout',
        )
        silenceTimedOutRef.current = false
        focusTriggeredRef.current = true
        void startRecordingSession()
        armFocusSilenceTimer()
        return
      }

      const currentState = stateRef.current

      
      if (currentState === 'processing') {
        return
      }

      if (currentState === 'idle') {
        logForDebugging(
          '[voice] handleKeyEvent: idle, starting recording session immediately',
        )
        void startRecordingSession()
        
        // arm the release timer anyway (the user likely tapped and released).
        repeatFallbackTimerRef.current = setTimeout(
          (
            repeatFallbackTimerRef,
            stateRef,
            seenRepeatRef,
            releaseTimerRef,
            finishRecording,
          ) => {
            repeatFallbackTimerRef.current = null
            if (stateRef.current === 'recording' && !seenRepeatRef.current) {
              logForDebugging(
                '[voice] No auto-repeat seen, arming release timer via fallback',
              )
              seenRepeatRef.current = true
              releaseTimerRef.current = setTimeout(
                (releaseTimerRef, stateRef, finishRecording) => {
                  releaseTimerRef.current = null
                  if (stateRef.current === 'recording') {
                    finishRecording()
                  }
                },
                RELEASE_TIMEOUT_MS,
                releaseTimerRef,
                stateRef,
                finishRecording,
              )
            }
          },
          fallbackMs,
          repeatFallbackTimerRef,
          stateRef,
          seenRepeatRef,
          releaseTimerRef,
          finishRecording,
        )
      } else if (currentState === 'recording') {
        // Second+ keypress while recording — auto-repeat has started.
        seenRepeatRef.current = true
        if (repeatFallbackTimerRef.current) {
          clearTimeout(repeatFallbackTimerRef.current)
          repeatFallbackTimerRef.current = null
        }
      }

      // Reset the release timer on every keypress (including auto-repeats)
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current)
      }

      // Only arm the release timer once auto-repeat has been seen.
      
      
      if (stateRef.current === 'recording' && seenRepeatRef.current) {
        releaseTimerRef.current = setTimeout(
          (releaseTimerRef, stateRef, finishRecording) => {
            releaseTimerRef.current = null
            if (stateRef.current === 'recording') {
              finishRecording()
            }
          },
          RELEASE_TIMEOUT_MS,
          releaseTimerRef,
          stateRef,
          finishRecording,
        )
      }
    },
    [enabled, focusMode, cleanup],
  )

  
  useEffect(() => {
    if (!enabled && stateRef.current !== 'idle') {
      cleanup()
      updateState('idle')
    }
    return () => {
      cleanup()
    }
  }, [enabled, cleanup])

  return {
    state,
    handleKeyEvent,
  }
}
