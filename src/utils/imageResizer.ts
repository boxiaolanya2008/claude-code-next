import type {
  Base64ImageSource,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import {
  API_IMAGE_MAX_BASE64_SIZE,
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
} from '../constants/apiLimits.js'
import { logEvent } from '../services/analytics/index.js'
import {
  getImageProcessor,
  type SharpFunction,
  type SharpInstance,
} from '../tools/FileReadTool/imageProcessor.js'
import { logForDebugging } from './debug.js'
import { errorMessage } from './errors.js'
import { formatFileSize } from './format.js'
import { logError } from './log.js'

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

const ERROR_TYPE_MODULE_LOAD = 1
const ERROR_TYPE_PROCESSING = 2
const ERROR_TYPE_UNKNOWN = 3
const ERROR_TYPE_PIXEL_LIMIT = 4
const ERROR_TYPE_MEMORY = 5
const ERROR_TYPE_TIMEOUT = 6
const ERROR_TYPE_VIPS = 7
const ERROR_TYPE_PERMISSION = 8

export class ImageResizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageResizeError'
  }
}

function classifyImageError(error: unknown): number {
  
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string }
    if (
      errorWithCode.code === 'MODULE_NOT_FOUND' ||
      errorWithCode.code === 'ERR_MODULE_NOT_FOUND' ||
      errorWithCode.code === 'ERR_DLOPEN_FAILED'
    ) {
      return ERROR_TYPE_MODULE_LOAD
    }
    if (errorWithCode.code === 'EACCES' || errorWithCode.code === 'EPERM') {
      return ERROR_TYPE_PERMISSION
    }
    if (errorWithCode.code === 'ENOMEM') {
      return ERROR_TYPE_MEMORY
    }
  }

  
  
  const message = errorMessage(error)

  
  if (message.includes('Native image processor module not available')) {
    return ERROR_TYPE_MODULE_LOAD
  }

  
  if (
    message.includes('unsupported image format') ||
    message.includes('Input buffer') ||
    message.includes('Input file is missing') ||
    message.includes('Input file has corrupt header') ||
    message.includes('corrupt header') ||
    message.includes('corrupt image') ||
    message.includes('premature end') ||
    message.includes('zlib: data error') ||
    message.includes('zero width') ||
    message.includes('zero height')
  ) {
    return ERROR_TYPE_PROCESSING
  }

  
  if (
    message.includes('pixel limit') ||
    message.includes('too many pixels') ||
    message.includes('exceeds pixel') ||
    message.includes('image dimensions')
  ) {
    return ERROR_TYPE_PIXEL_LIMIT
  }

  
  if (
    message.includes('out of memory') ||
    message.includes('Cannot allocate') ||
    message.includes('memory allocation')
  ) {
    return ERROR_TYPE_MEMORY
  }

  
  if (message.includes('timeout') || message.includes('timed out')) {
    return ERROR_TYPE_TIMEOUT
  }

  
  if (message.includes('Vips')) {
    return ERROR_TYPE_VIPS
  }

  return ERROR_TYPE_UNKNOWN
}

function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return hash >>> 0
}

export type ImageDimensions = {
  originalWidth?: number
  originalHeight?: number
  displayWidth?: number
  displayHeight?: number
}

export interface ResizeResult {
  buffer: Buffer
  mediaType: string
  dimensions?: ImageDimensions
}

interface ImageCompressionContext {
  imageBuffer: Buffer
  metadata: { width?: number; height?: number; format?: string }
  format: string
  maxBytes: number
  originalSize: number
}

interface CompressedImageResult {
  base64: string
  mediaType: Base64ImageSource['media_type']
  originalSize: number
}

export async function maybeResizeAndDownsampleImageBuffer(
  imageBuffer: Buffer,
  originalSize: number,
  ext: string,
): Promise<ResizeResult> {
  if (imageBuffer.length === 0) {
    
    
    
    
    throw new ImageResizeError('Image file is empty (0 bytes)')
  }
  try {
    const sharp = await getImageProcessor()
    const image = sharp(imageBuffer)
    const metadata = await image.metadata()

    const mediaType = metadata.format ?? ext
    
    const normalizedMediaType = mediaType === 'jpg' ? 'jpeg' : mediaType

    
    if (!metadata.width || !metadata.height) {
      if (originalSize > IMAGE_TARGET_RAW_SIZE) {
        
        const compressedBuffer = await sharp(imageBuffer)
          .jpeg({ quality: 80 })
          .toBuffer()
        return { buffer: compressedBuffer, mediaType: 'jpeg' }
      }
      
      return { buffer: imageBuffer, mediaType: normalizedMediaType }
    }

    
    const originalWidth = metadata.width
    const originalHeight = metadata.height

    
    let width = originalWidth
    let height = originalHeight

    
    if (
      originalSize <= IMAGE_TARGET_RAW_SIZE &&
      width <= IMAGE_MAX_WIDTH &&
      height <= IMAGE_MAX_HEIGHT
    ) {
      return {
        buffer: imageBuffer,
        mediaType: normalizedMediaType,
        dimensions: {
          originalWidth,
          originalHeight,
          displayWidth: width,
          displayHeight: height,
        },
      }
    }

    const needsDimensionResize =
      width > IMAGE_MAX_WIDTH || height > IMAGE_MAX_HEIGHT
    const isPng = normalizedMediaType === 'png'

    
    
    if (!needsDimensionResize && originalSize > IMAGE_TARGET_RAW_SIZE) {
      
      if (isPng) {
        
        const pngCompressed = await sharp(imageBuffer)
          .png({ compressionLevel: 9, palette: true })
          .toBuffer()
        if (pngCompressed.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: pngCompressed,
            mediaType: 'png',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }
      
      for (const quality of [80, 60, 40, 20]) {
        
        const compressedBuffer = await sharp(imageBuffer)
          .jpeg({ quality })
          .toBuffer()
        if (compressedBuffer.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: compressedBuffer,
            mediaType: 'jpeg',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }
      
    }

    
    if (width > IMAGE_MAX_WIDTH) {
      height = Math.round((height * IMAGE_MAX_WIDTH) / width)
      width = IMAGE_MAX_WIDTH
    }

    if (height > IMAGE_MAX_HEIGHT) {
      width = Math.round((width * IMAGE_MAX_HEIGHT) / height)
      height = IMAGE_MAX_HEIGHT
    }

    
    
    
    
    logForDebugging(`Resizing to ${width}x${height}`)
    const resizedImageBuffer = await sharp(imageBuffer)
      .resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer()

    
    if (resizedImageBuffer.length > IMAGE_TARGET_RAW_SIZE) {
      
      if (isPng) {
        const pngCompressed = await sharp(imageBuffer)
          .resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .png({ compressionLevel: 9, palette: true })
          .toBuffer()
        if (pngCompressed.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: pngCompressed,
            mediaType: 'png',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }

      
      for (const quality of [80, 60, 40, 20]) {
        const compressedBuffer = await sharp(imageBuffer)
          .resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality })
          .toBuffer()
        if (compressedBuffer.length <= IMAGE_TARGET_RAW_SIZE) {
          return {
            buffer: compressedBuffer,
            mediaType: 'jpeg',
            dimensions: {
              originalWidth,
              originalHeight,
              displayWidth: width,
              displayHeight: height,
            },
          }
        }
      }
      
      const smallerWidth = Math.min(width, 1000)
      const smallerHeight = Math.round(
        (height * smallerWidth) / Math.max(width, 1),
      )
      logForDebugging('Still too large, compressing with JPEG')
      const compressedBuffer = await sharp(imageBuffer)
        .resize(smallerWidth, smallerHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 20 })
        .toBuffer()
      logForDebugging(`JPEG compressed buffer size: ${compressedBuffer.length}`)
      return {
        buffer: compressedBuffer,
        mediaType: 'jpeg',
        dimensions: {
          originalWidth,
          originalHeight,
          displayWidth: smallerWidth,
          displayHeight: smallerHeight,
        },
      }
    }

    return {
      buffer: resizedImageBuffer,
      mediaType: normalizedMediaType,
      dimensions: {
        originalWidth,
        originalHeight,
        displayWidth: width,
        displayHeight: height,
      },
    }
  } catch (error) {
    
    logError(error as Error)
    const errorType = classifyImageError(error)
    const errorMsg = errorMessage(error)
    logEvent('tengu_image_resize_failed', {
      original_size_bytes: originalSize,
      error_type: errorType,
      error_message_hash: hashString(errorMsg),
    })

    
    const detected = detectImageFormatFromBuffer(imageBuffer)
    const normalizedExt = detected.slice(6) 

    
    const base64Size = Math.ceil((originalSize * 4) / 3)

    
    
    
    const overDim =
      imageBuffer.length >= 24 &&
      imageBuffer[0] === 0x89 &&
      imageBuffer[1] === 0x50 &&
      imageBuffer[2] === 0x4e &&
      imageBuffer[3] === 0x47 &&
      (imageBuffer.readUInt32BE(16) > IMAGE_MAX_WIDTH ||
        imageBuffer.readUInt32BE(20) > IMAGE_MAX_HEIGHT)

    
    if (base64Size <= API_IMAGE_MAX_BASE64_SIZE && !overDim) {
      logEvent('tengu_image_resize_fallback', {
        original_size_bytes: originalSize,
        base64_size_bytes: base64Size,
        error_type: errorType,
      })
      return { buffer: imageBuffer, mediaType: normalizedExt }
    }

    
    throw new ImageResizeError(
      overDim
        ? `Unable to resize image — dimensions exceed the ${IMAGE_MAX_WIDTH}x${IMAGE_MAX_HEIGHT}px limit and image processing failed. ` +
            `Please resize the image to reduce its pixel dimensions.`
        : `Unable to resize image (${formatFileSize(originalSize)} raw, ${formatFileSize(base64Size)} base64). ` +
            `The image exceeds the 5MB API limit and compression failed. ` +
            `Please resize the image manually or use a smaller image.`,
    )
  }
}

export interface ImageBlockWithDimensions {
  block: ImageBlockParam
  dimensions?: ImageDimensions
}

export async function maybeResizeAndDownsampleImageBlock(
  imageBlock: ImageBlockParam,
): Promise<ImageBlockWithDimensions> {
  
  if (imageBlock.source.type !== 'base64') {
    return { block: imageBlock }
  }

  
  const imageBuffer = Buffer.from(imageBlock.source.data, 'base64')
  const originalSize = imageBuffer.length

  
  const mediaType = imageBlock.source.media_type
  const ext = mediaType?.split('/')[1] || 'png'

  
  const resized = await maybeResizeAndDownsampleImageBuffer(
    imageBuffer,
    originalSize,
    ext,
  )

  
  return {
    block: {
      type: 'image',
      source: {
        type: 'base64',
        media_type:
          `image/${resized.mediaType}` as Base64ImageSource['media_type'],
        data: resized.buffer.toString('base64'),
      },
    },
    dimensions: resized.dimensions,
  }
}

export async function compressImageBuffer(
  imageBuffer: Buffer,
  maxBytes: number = IMAGE_TARGET_RAW_SIZE,
  originalMediaType?: string,
): Promise<CompressedImageResult> {
  
  const fallbackFormat = originalMediaType?.split('/')[1] || 'jpeg'
  const normalizedFallback = fallbackFormat === 'jpg' ? 'jpeg' : fallbackFormat

  try {
    const sharp = await getImageProcessor()
    const metadata = await sharp(imageBuffer).metadata()
    const format = metadata.format || normalizedFallback
    const originalSize = imageBuffer.length

    const context: ImageCompressionContext = {
      imageBuffer,
      metadata,
      format,
      maxBytes,
      originalSize,
    }

    
    if (originalSize <= maxBytes) {
      return createCompressedImageResult(imageBuffer, format, originalSize)
    }

    
    const resizedResult = await tryProgressiveResizing(context, sharp)
    if (resizedResult) {
      return resizedResult
    }

    
    if (format === 'png') {
      const palettizedResult = await tryPalettePNG(context, sharp)
      if (palettizedResult) {
        return palettizedResult
      }
    }

    
    const jpegResult = await tryJPEGConversion(context, 50, sharp)
    if (jpegResult) {
      return jpegResult
    }

    
    return await createUltraCompressedJPEG(context, sharp)
  } catch (error) {
    
    logError(error as Error)
    const errorType = classifyImageError(error)
    const errorMsg = errorMessage(error)
    logEvent('tengu_image_compress_failed', {
      original_size_bytes: imageBuffer.length,
      max_bytes: maxBytes,
      error_type: errorType,
      error_message_hash: hashString(errorMsg),
    })

    
    if (imageBuffer.length <= maxBytes) {
      
      const detected = detectImageFormatFromBuffer(imageBuffer)
      return {
        base64: imageBuffer.toString('base64'),
        mediaType: detected,
        originalSize: imageBuffer.length,
      }
    }

    
    throw new ImageResizeError(
      `Unable to compress image (${formatFileSize(imageBuffer.length)}) to fit within ${formatFileSize(maxBytes)}. ` +
        `Please use a smaller image.`,
    )
  }
}

export async function compressImageBufferWithTokenLimit(
  imageBuffer: Buffer,
  maxTokens: number,
  originalMediaType?: string,
): Promise<CompressedImageResult> {
  
  
  const maxBase64Chars = Math.floor(maxTokens / 0.125)
  const maxBytes = Math.floor(maxBase64Chars * 0.75)

  return compressImageBuffer(imageBuffer, maxBytes, originalMediaType)
}

export async function compressImageBlock(
  imageBlock: ImageBlockParam,
  maxBytes: number = IMAGE_TARGET_RAW_SIZE,
): Promise<ImageBlockParam> {
  
  if (imageBlock.source.type !== 'base64') {
    return imageBlock
  }

  
  const imageBuffer = Buffer.from(imageBlock.source.data, 'base64')

  
  if (imageBuffer.length <= maxBytes) {
    return imageBlock
  }

  
  const compressed = await compressImageBuffer(imageBuffer, maxBytes)

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: compressed.mediaType,
      data: compressed.base64,
    },
  }
}

function createCompressedImageResult(
  buffer: Buffer,
  mediaType: string,
  originalSize: number,
): CompressedImageResult {
  const normalizedMediaType = mediaType === 'jpg' ? 'jpeg' : mediaType
  return {
    base64: buffer.toString('base64'),
    mediaType:
      `image/${normalizedMediaType}` as Base64ImageSource['media_type'],
    originalSize,
  }
}

async function tryProgressiveResizing(
  context: ImageCompressionContext,
  sharp: SharpFunction,
): Promise<CompressedImageResult | null> {
  const scalingFactors = [1.0, 0.75, 0.5, 0.25]

  for (const scalingFactor of scalingFactors) {
    const newWidth = Math.round(
      (context.metadata.width || 2000) * scalingFactor,
    )
    const newHeight = Math.round(
      (context.metadata.height || 2000) * scalingFactor,
    )

    let resizedImage = sharp(context.imageBuffer).resize(newWidth, newHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })

    
    resizedImage = applyFormatOptimizations(resizedImage, context.format)

    const resizedBuffer = await resizedImage.toBuffer()

    if (resizedBuffer.length <= context.maxBytes) {
      return createCompressedImageResult(
        resizedBuffer,
        context.format,
        context.originalSize,
      )
    }
  }

  return null
}

function applyFormatOptimizations(
  image: SharpInstance,
  format: string,
): SharpInstance {
  switch (format) {
    case 'png':
      return image.png({
        compressionLevel: 9,
        palette: true,
      })
    case 'jpeg':
    case 'jpg':
      return image.jpeg({ quality: 80 })
    case 'webp':
      return image.webp({ quality: 80 })
    default:
      return image
  }
}

async function tryPalettePNG(
  context: ImageCompressionContext,
  sharp: SharpFunction,
): Promise<CompressedImageResult | null> {
  const palettePng = await sharp(context.imageBuffer)
    .resize(800, 800, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png({
      compressionLevel: 9,
      palette: true,
      colors: 64, 
    })
    .toBuffer()

  if (palettePng.length <= context.maxBytes) {
    return createCompressedImageResult(palettePng, 'png', context.originalSize)
  }

  return null
}

async function tryJPEGConversion(
  context: ImageCompressionContext,
  quality: number,
  sharp: SharpFunction,
): Promise<CompressedImageResult | null> {
  const jpegBuffer = await sharp(context.imageBuffer)
    .resize(600, 600, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality })
    .toBuffer()

  if (jpegBuffer.length <= context.maxBytes) {
    return createCompressedImageResult(jpegBuffer, 'jpeg', context.originalSize)
  }

  return null
}

async function createUltraCompressedJPEG(
  context: ImageCompressionContext,
  sharp: SharpFunction,
): Promise<CompressedImageResult> {
  const ultraCompressedBuffer = await sharp(context.imageBuffer)
    .resize(400, 400, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 20 })
    .toBuffer()

  return createCompressedImageResult(
    ultraCompressedBuffer,
    'jpeg',
    context.originalSize,
  )
}

export function detectImageFormatFromBuffer(buffer: Buffer): ImageMediaType {
  if (buffer.length < 4) return 'image/png' 

  
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }

  
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif'
  }

  
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    if (
      buffer.length >= 12 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp'
    }
  }

  
  return 'image/png'
}

export function detectImageFormatFromBase64(
  base64Data: string,
): ImageMediaType {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    return detectImageFormatFromBuffer(buffer)
  } catch {
    
    return 'image/png'
  }
}

export function createImageMetadataText(
  dims: ImageDimensions,
  sourcePath?: string,
): string | null {
  const { originalWidth, originalHeight, displayWidth, displayHeight } = dims
  
  
  if (
    !originalWidth ||
    !originalHeight ||
    !displayWidth ||
    !displayHeight ||
    displayWidth <= 0 ||
    displayHeight <= 0
  ) {
    
    if (sourcePath) {
      return `[Image source: ${sourcePath}]`
    }
    return null
  }
  
  const wasResized =
    originalWidth !== displayWidth || originalHeight !== displayHeight

  
  if (!wasResized && !sourcePath) {
    return null
  }

  
  const parts: string[] = []

  if (sourcePath) {
    parts.push(`source: ${sourcePath}`)
  }

  if (wasResized) {
    const scaleFactor = originalWidth / displayWidth
    parts.push(
      `original ${originalWidth}x${originalHeight}, displayed at ${displayWidth}x${displayHeight}. Multiply coordinates by ${scaleFactor.toFixed(2)} to map to original image.`,
    )
  }

  return `[Image: ${parts.join(', ')}]`
}
