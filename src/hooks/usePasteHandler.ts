import { basename } from 'path'
import React from 'react'
import { logError } from 'src/utils/log.js'
import { useDebounceCallback } from 'usehooks-ts'
import type { InputEvent, Key } from '../ink.js'
import {
  getImageFromClipboard,
  isImageFilePath,
  PASTE_THRESHOLD,
  tryReadImageFromPath,
} from '../utils/imagePaste.js'
import type { ImageDimensions } from '../utils/imageResizer.js'
import { getPlatform } from '../utils/platform.js'

const CLIPBOARD_CHECK_DEBOUNCE_MS = 50
const PASTE_COMPLETION_TIMEOUT_MS = 100

type PasteHandlerProps = {
  onPaste?: (text: string) => void
  onInput: (input: string, key: Key) => void
  onImagePaste?: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: ImageDimensions,
    sourcePath?: string,
  ) => void
}

export function usePasteHandler({
  onPaste,
  onInput,
  onImagePaste,
}: PasteHandlerProps): {
  wrappedOnInput: (input: string, key: Key, event: InputEvent) => void
  pasteState: {
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }
  isPasting: boolean
} {
  const [pasteState, setPasteState] = React.useState<{
    chunks: string[]
    timeoutId: ReturnType<typeof setTimeout> | null
  }>({ chunks: [], timeoutId: null })
  const [isPasting, setIsPasting] = React.useState(false)
  const isMountedRef = React.useRef(true)
  
  
  
  
  
  const pastePendingRef = React.useRef(false)

  const isMacOS = React.useMemo(() => getPlatform() === 'macos', [])

  React.useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const checkClipboardForImageImpl = React.useCallback(() => {
    if (!onImagePaste || !isMountedRef.current) return

    void getImageFromClipboard()
      .then(imageData => {
        if (imageData && isMountedRef.current) {
          onImagePaste(
            imageData.base64,
            imageData.mediaType,
            undefined, // no filename for clipboard images
            imageData.dimensions,
          )
        }
      })
      .catch(error => {
        if (isMountedRef.current) {
          logError(error as Error)
        }
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsPasting(false)
        }
      })
  }, [onImagePaste])

  const checkClipboardForImage = useDebounceCallback(
    checkClipboardForImageImpl,
    CLIPBOARD_CHECK_DEBOUNCE_MS,
  )

  const resetPasteTimeout = React.useCallback(
    (currentTimeoutId: ReturnType<typeof setTimeout> | null) => {
      if (currentTimeoutId) {
        clearTimeout(currentTimeoutId)
      }
      return setTimeout(
        (
          setPasteState,
          onImagePaste,
          onPaste,
          setIsPasting,
          checkClipboardForImage,
          isMacOS,
          pastePendingRef,
        ) => {
          pastePendingRef.current = false
          setPasteState(({ chunks }) => {
            // Join chunks and filter out orphaned focus sequences
            
            const pastedText = chunks
              .join('')
              .replace(/\[I$/, '')
              .replace(/\[O$/, '')

            
            
            // 1. Newline-separated paths (common in some terminals)
            
            
            // - Unix: space followed by `/` (e.g., `/Users/...`)
            
            
            const lines = pastedText
              .split(/ (?=\/|[A-Za-z]:\\)/)
              .flatMap(part => part.split('\n'))
              .filter(line => line.trim())
            const imagePaths = lines.filter(line => isImageFilePath(line))

            if (onImagePaste && imagePaths.length > 0) {
              const isTempScreenshot =
                /\/TemporaryItems\/.*screencaptureui.*\/Screenshot/i.test(
                  pastedText,
                )

              
              void Promise.all(
                imagePaths.map(imagePath => tryReadImageFromPath(imagePath)),
              ).then(results => {
                const validImages = results.filter(
                  (r): r is NonNullable<typeof r> => r !== null,
                )

                if (validImages.length > 0) {
                  // Successfully read at least one image
                  for (const imageData of validImages) {
                    const filename = basename(imageData.path)
                    onImagePaste(
                      imageData.base64,
                      imageData.mediaType,
                      filename,
                      imageData.dimensions,
                      imageData.path,
                    )
                  }
                  // If some paths weren't images, paste them as text
                  const nonImageLines = lines.filter(
                    line => !isImageFilePath(line),
                  )
                  if (nonImageLines.length > 0 && onPaste) {
                    onPaste(nonImageLines.join('\n'))
                  }
                  setIsPasting(false)
                } else if (isTempScreenshot && isMacOS) {
                  // For temporary screenshot files that no longer exist, try clipboard
                  checkClipboardForImage()
                } else {
                  if (onPaste) {
                    onPaste(pastedText)
                  }
                  setIsPasting(false)
                }
              })
              return { chunks: [], timeoutId: null }
            }

            // If paste is empty (common when trying to paste images with Cmd+V),
            // check if clipboard has an image (macOS only)
            if (isMacOS && onImagePaste && pastedText.length === 0) {
              checkClipboardForImage()
              return { chunks: [], timeoutId: null }
            }

            // Handle regular paste
            if (onPaste) {
              onPaste(pastedText)
            }
            // Reset isPasting state after paste is complete
            setIsPasting(false)
            return { chunks: [], timeoutId: null }
          })
        },
        PASTE_COMPLETION_TIMEOUT_MS,
        setPasteState,
        onImagePaste,
        onPaste,
        setIsPasting,
        checkClipboardForImage,
        isMacOS,
        pastePendingRef,
      )
    },
    [checkClipboardForImage, isMacOS, onImagePaste, onPaste],
  )

  // Paste detection is now done via the InputEvent's keypress.isPasted flag,
  // which is set by the keypress parser when it detects bracketed paste mode.
  
  
  

  const wrappedOnInput = (input: string, key: Key, event: InputEvent): void => {
    // Detect paste from the parsed keypress event.
    
    const isFromPaste = event.keypress.isPasted

    
    if (isFromPaste) {
      setIsPasting(true)
    }

    // Handle large pastes (>PASTE_THRESHOLD chars)
    
    
    
    
    
    

    
    
    
    // - Unix: ` /` - Windows: ` C:\` etc.
    const hasImageFilePath = input
      .split(/ (?=\/|[A-Za-z]:\\)/)
      .flatMap(part => part.split('\n'))
      .some(line => isImageFilePath(line.trim()))

    // Handle empty paste (clipboard image on macOS)
    // When the user pastes an image with Cmd+V, the terminal sends an empty
    // bracketed paste sequence. The keypress parser emits this as isPasted=true
    // with empty input.
    if (isFromPaste && input.length === 0 && isMacOS && onImagePaste) {
      checkClipboardForImage()
      // Reset isPasting since there's no text content to process
      setIsPasting(false)
      return
    }

    // Check if we should handle as paste (from bracketed paste, large input, or continuation)
    const shouldHandleAsPaste =
      onPaste &&
      (input.length > PASTE_THRESHOLD ||
        pastePendingRef.current ||
        hasImageFilePath ||
        isFromPaste)

    if (shouldHandleAsPaste) {
      pastePendingRef.current = true
      setPasteState(({ chunks, timeoutId }) => {
        return {
          chunks: [...chunks, input],
          timeoutId: resetPasteTimeout(timeoutId),
        }
      })
      return
    }
    onInput(input, key)
    if (input.length > 10) {
      // Ensure that setIsPasting is turned off on any other multicharacter
      // input, because the stdin buffer may chunk at arbitrary points and split
      // the closing escape sequence if the input length is too long for the
      // stdin buffer.
      setIsPasting(false)
    }
  }

  return {
    wrappedOnInput,
    pasteState,
    isPasting,
  }
}
