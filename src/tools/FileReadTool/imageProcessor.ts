import type { Buffer } from 'buffer'
import { isInBundledMode } from '../../utils/bundledMode.js'

export type SharpInstance = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

export type SharpFunction = (input: Buffer) => SharpInstance

type SharpCreatorOptions = {
  create: {
    width: number
    height: number
    channels: 3 | 4
    background: { r: number; g: number; b: number }
  }
}

type SharpCreator = (options: SharpCreatorOptions) => SharpInstance

let imageProcessorModule: { default: SharpFunction } | null = null
let imageCreatorModule: { default: SharpCreator } | null = null

export async function getImageProcessor(): Promise<SharpFunction> {
  if (imageProcessorModule) {
    return imageProcessorModule.default
  }

  if (isInBundledMode()) {
    
    try {
      
      const imageProcessor = await import('image-processor-napi')
      const sharp = imageProcessor.sharp || imageProcessor.default
      imageProcessorModule = { default: sharp }
      return sharp
    } catch {
      
      
      console.warn(
        'Native image processor not available, falling back to sharp',
      )
    }
  }

  
  
  const imported = (await import(
    'sharp'
  )) as unknown as MaybeDefault<SharpFunction>
  const sharp = unwrapDefault(imported)
  imageProcessorModule = { default: sharp }
  return sharp
}

export async function getImageCreator(): Promise<SharpCreator> {
  if (imageCreatorModule) {
    return imageCreatorModule.default
  }

  const imported = (await import(
    'sharp'
  )) as unknown as MaybeDefault<SharpCreator>
  const sharp = unwrapDefault(imported)
  imageCreatorModule = { default: sharp }
  return sharp
}

type MaybeDefault<T> = T | { default: T }

function unwrapDefault<T extends (...args: never[]) => unknown>(
  mod: MaybeDefault<T>,
): T {
  return typeof mod === 'function' ? mod : mod.default
}
