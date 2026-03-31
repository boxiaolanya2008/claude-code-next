

export function djb2Hash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

export function hashContent(content: string): string {
  if (typeof Bun !== 'undefined') {
    return Bun.hash(content).toString()
  }
  
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHash('sha256').update(content).digest('hex')
}

export function hashPair(a: string, b: string): string {
  if (typeof Bun !== 'undefined') {
    return Bun.hash(b, Bun.hash(a)).toString()
  }
  
  const crypto = require('crypto') as typeof import('crypto')
  return crypto
    .createHash('sha256')
    .update(a)
    .update('\0')
    .update(b)
    .digest('hex')
}
