import { detectFileEncoding } from './file.js'
import { getFsImplementation } from './fsOperations.js'

type CachedFileData = {
  content: string
  encoding: BufferEncoding
  mtime: number
}

class FileReadCache {
  private cache = new Map<string, CachedFileData>()
  private readonly maxCacheSize = 1000

  

  readFile(filePath: string): { content: string; encoding: BufferEncoding } {
    const fs = getFsImplementation()

    
    let stats
    try {
      stats = fs.statSync(filePath)
    } catch (error) {
      
      this.cache.delete(filePath)
      throw error
    }

    const cacheKey = filePath
    const cachedData = this.cache.get(cacheKey)

    
    if (cachedData && cachedData.mtime === stats.mtimeMs) {
      return {
        content: cachedData.content,
        encoding: cachedData.encoding,
      }
    }

    
    const encoding = detectFileEncoding(filePath)
    const content = fs
      .readFileSync(filePath, { encoding })
      .replaceAll('\r\n', '\n')

    
    this.cache.set(cacheKey, {
      content,
      encoding,
      mtime: stats.mtimeMs,
    })

    
    if (this.cache.size > this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    return { content, encoding }
  }

  

  clear(): void {
    this.cache.clear()
  }

  

  invalidate(filePath: string): void {
    this.cache.delete(filePath)
  }

  

  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    }
  }
}

export const fileReadCache = new FileReadCache()
