import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { execa } from 'execa'
import { basename, extname, isAbsolute, join } from 'path'
import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getImageProcessor } from '../tools/FileReadTool/imageProcessor.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  detectImageFormatFromBase64,
  type ImageDimensions,
  maybeResizeAndDownsampleImageBuffer,
} from './imageResizer.js'
import { logError } from './log.js'

type SupportedPlatform = 'darwin' | 'linux' | 'win32'

export const PASTE_THRESHOLD = 800
function getClipboardCommands() {
  const platform = process.platform as SupportedPlatform

  
  
  const baseTmpDir =
    process.env.CLAUDE_CODE_NEXT_TMPDIR ||
    (platform === 'win32' ? process.env.TEMP || 'C:\\Temp' : '/tmp')
  const screenshotFilename = 'claude_cli_latest_screenshot.png'
  const tempPaths: Record<SupportedPlatform, string> = {
    darwin: join(baseTmpDir, screenshotFilename),
    linux: join(baseTmpDir, screenshotFilename),
    win32: join(baseTmpDir, screenshotFilename),
  }

  const screenshotPath = tempPaths[platform] || tempPaths.linux

  
  const commands: Record<
    SupportedPlatform,
    {
      checkImage: string
      saveImage: string
      getPath: string
      deleteFile: string
    }
  > = {
    darwin: {
      checkImage: `osascript -e 'the clipboard as «class PNGf»'`,
      saveImage: `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'write png_data to fp' -e 'close access fp'`,
      getPath: `osascript -e 'get POSIX path of (the clipboard as «class furl»)'`,
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    linux: {
      checkImage:
        'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
      saveImage: `xclip -selection clipboard -t image/png -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/png > "${screenshotPath}" 2>/dev/null || xclip -selection clipboard -t image/bmp -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/bmp > "${screenshotPath}"`,
      getPath:
        'xclip -selection clipboard -t text/plain -o 2>/dev/null || wl-paste 2>/dev/null',
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    win32: {
      checkImage:
        'powershell -NoProfile -Command "(Get-Clipboard -Format Image) -ne $null"',
      saveImage: `powershell -NoProfile -Command "$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${screenshotPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }"`,
      getPath: 'powershell -NoProfile -Command "Get-Clipboard"',
      deleteFile: `del /f "${screenshotPath}"`,
    },
  }

  return {
    commands: commands[platform] || commands.linux,
    screenshotPath,
  }
}

export type ImageWithDimensions = {
  base64: string
  mediaType: string
  dimensions?: ImageDimensions
}

export async function hasImageInClipboard(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    
    
    
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const hasImage = getNativeModule()?.hasClipboardImage
      if (hasImage) {
        return hasImage()
      }
    } catch (e) {
      logError(e as Error)
    }
  }
  const result = await execFileNoThrowWithCwd('osascript', [
    '-e',
    'the clipboard as «class PNGf»',
  ])
  return result.code === 0
}

export async function getImageFromClipboard(): Promise<ImageWithDimensions | null> {
  
  
  
  
  
  
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    process.platform === 'darwin' &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const readClipboard = getNativeModule()?.readClipboardImage
      if (!readClipboard) {
        throw new Error('native clipboard reader unavailable')
      }
      const native = readClipboard(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT)
      if (!native) {
        return null
      }
      
      
      
      
      
      const buffer: Buffer = native.png
      if (buffer.length > IMAGE_TARGET_RAW_SIZE) {
        const resized = await maybeResizeAndDownsampleImageBuffer(
          buffer,
          buffer.length,
          'png',
        )
        return {
          base64: resized.buffer.toString('base64'),
          mediaType: `image/${resized.mediaType}`,
          
          dimensions: {
            originalWidth: native.originalWidth,
            originalHeight: native.originalHeight,
            displayWidth: resized.dimensions?.displayWidth ?? native.width,
            displayHeight: resized.dimensions?.displayHeight ?? native.height,
          },
        }
      }
      return {
        base64: buffer.toString('base64'),
        mediaType: 'image/png',
        dimensions: {
          originalWidth: native.originalWidth,
          originalHeight: native.originalHeight,
          displayWidth: native.width,
          displayHeight: native.height,
        },
      }
    } catch (e) {
      logError(e as Error)
      
    }
  }

  const { commands, screenshotPath } = getClipboardCommands()
  try {
    
    const checkResult = await execa(commands.checkImage, {
      shell: true,
      reject: false,
    })
    if (checkResult.exitCode !== 0) {
      return null
    }

    
    const saveResult = await execa(commands.saveImage, {
      shell: true,
      reject: false,
    })
    if (saveResult.exitCode !== 0) {
      return null
    }

    
    let imageBuffer = getFsImplementation().readFileBytesSync(screenshotPath)

    
    
    if (
      imageBuffer.length >= 2 &&
      imageBuffer[0] === 0x42 &&
      imageBuffer[1] === 0x4d
    ) {
      const sharp = await getImageProcessor()
      imageBuffer = await sharp(imageBuffer).png().toBuffer()
    }

    
    const resized = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      imageBuffer.length,
      'png',
    )
    const base64Image = resized.buffer.toString('base64')

    
    const mediaType = detectImageFormatFromBase64(base64Image)

    
    void execa(commands.deleteFile, { shell: true, reject: false })

    return {
      base64: base64Image,
      mediaType,
      dimensions: resized.dimensions,
    }
  } catch {
    return null
  }
}

export async function getImagePathFromClipboard(): Promise<string | null> {
  const { commands } = getClipboardCommands()

  try {
    
    const result = await execa(commands.getPath, {
      shell: true,
      reject: false,
    })
    if (result.exitCode !== 0 || !result.stdout) {
      return null
    }
    return result.stdout.trim()
  } catch (e) {
    logError(e as Error)
    return null
  }
}

export const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i

function removeOuterQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

function stripBackslashEscapes(path: string): string {
  const platform = process.platform as SupportedPlatform

  
  if (platform === 'win32') {
    return path
  }

  
  
  

  
  
  const salt = randomBytes(8).toString('hex')
  const placeholder = `__DOUBLE_BACKSLASH_${salt}__`
  const withPlaceholder = path.replace(/\\\\/g, placeholder)

  
  
  const withoutEscapes = withPlaceholder.replace(/\\(.)/g, '$1')

  
  return withoutEscapes.replace(new RegExp(placeholder, 'g'), '\\')
}

export function isImageFilePath(text: string): boolean {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)
  return IMAGE_EXTENSION_REGEX.test(unescaped)
}

export function asImageFilePath(text: string): string | null {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)

  if (IMAGE_EXTENSION_REGEX.test(unescaped)) {
    return unescaped
  }

  return null
}

export async function tryReadImageFromPath(
  text: string,
): Promise<(ImageWithDimensions & { path: string }) | null> {
  
  const cleanedPath = asImageFilePath(text)

  if (!cleanedPath) {
    return null
  }

  const imagePath = cleanedPath
  let imageBuffer

  try {
    if (isAbsolute(imagePath)) {
      imageBuffer = getFsImplementation().readFileBytesSync(imagePath)
    } else {
      
      
      
      const clipboardPath = await getImagePathFromClipboard()
      if (clipboardPath && imagePath === basename(clipboardPath)) {
        imageBuffer = getFsImplementation().readFileBytesSync(clipboardPath)
      }
    }
  } catch (e) {
    logError(e as Error)
    return null
  }
  if (!imageBuffer) {
    return null
  }
  if (imageBuffer.length === 0) {
    logForDebugging(`Image file is empty: ${imagePath}`, { level: 'warn' })
    return null
  }

  
  if (
    imageBuffer.length >= 2 &&
    imageBuffer[0] === 0x42 &&
    imageBuffer[1] === 0x4d
  ) {
    const sharp = await getImageProcessor()
    imageBuffer = await sharp(imageBuffer).png().toBuffer()
  }

  
  
  const ext = extname(imagePath).slice(1).toLowerCase() || 'png'
  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    imageBuffer.length,
    ext,
  )
  const base64Image = resized.buffer.toString('base64')

  
  const mediaType = detectImageFormatFromBase64(base64Image)
  return {
    path: imagePath,
    base64: base64Image,
    mediaType,
    dimensions: resized.dimensions,
  }
}
