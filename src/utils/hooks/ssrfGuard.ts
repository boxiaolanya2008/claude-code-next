import type { AddressFamily, LookupAddress as AxiosLookupAddress } from 'axios'
import { lookup as dnsLookup } from 'dns'
import { isIP } from 'net'

export function isBlockedAddress(address: string): boolean {
  const v = isIP(address)
  if (v === 4) {
    return isBlockedV4(address)
  }
  if (v === 6) {
    return isBlockedV6(address)
  }
  
  
  return false
}

function isBlockedV4(address: string): boolean {
  const parts = address.split('.').map(Number)
  const [a, b] = parts
  if (
    parts.length !== 4 ||
    a === undefined ||
    b === undefined ||
    parts.some(n => Number.isNaN(n))
  ) {
    return false
  }

  
  if (a === 127) return false

  
  if (a === 0) return true
  
  if (a === 10) return true
  
  if (a === 169 && b === 254) return true
  
  if (a === 172 && b >= 16 && b <= 31) return true
  
  
  
  if (a === 100 && b >= 64 && b <= 127) return true
  
  if (a === 192 && b === 168) return true

  return false
}

function isBlockedV6(address: string): boolean {
  const lower = address.toLowerCase()

  
  if (lower === '::1') return false

  
  if (lower === '::') return true

  
  
  
  
  const mappedV4 = extractMappedIPv4(lower)
  if (mappedV4 !== null) {
    return isBlockedV4(mappedV4)
  }

  
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return true
  }

  
  
  
  const firstHextet = lower.split(':')[0]
  if (
    firstHextet &&
    firstHextet.length === 4 &&
    firstHextet >= 'fe80' &&
    firstHextet <= 'febf'
  ) {
    return true
  }

  return false
}

function expandIPv6Groups(addr: string): number[] | null {
  
  
  let tailHextets: number[] = []
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':')
    const v4 = addr.slice(lastColon + 1)
    addr = addr.slice(0, lastColon)
    const octets = v4.split('.').map(Number)
    if (
      octets.length !== 4 ||
      octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return null
    }
    tailHextets = [
      (octets[0]! << 8) | octets[1]!,
      (octets[2]! << 8) | octets[3]!,
    ]
  }

  
  const dbl = addr.indexOf('::')
  let head: string[]
  let tail: string[]
  if (dbl === -1) {
    head = addr.split(':')
    tail = []
  } else {
    const headStr = addr.slice(0, dbl)
    const tailStr = addr.slice(dbl + 2)
    head = headStr === '' ? [] : headStr.split(':')
    tail = tailStr === '' ? [] : tailStr.split(':')
  }

  const target = 8 - tailHextets.length
  const fill = target - head.length - tail.length
  if (fill < 0) return null

  const hex = [...head, ...new Array<string>(fill).fill('0'), ...tail]
  const nums = hex.map(h => parseInt(h, 16))
  if (nums.some(n => Number.isNaN(n) || n < 0 || n > 0xffff)) {
    return null
  }
  nums.push(...tailHextets)
  return nums.length === 8 ? nums : null
}

function extractMappedIPv4(addr: string): string | null {
  const g = expandIPv6Groups(addr)
  if (!g) return null
  
  if (
    g[0] === 0 &&
    g[1] === 0 &&
    g[2] === 0 &&
    g[3] === 0 &&
    g[4] === 0 &&
    g[5] === 0xffff
  ) {
    const hi = g[6]!
    const lo = g[7]!
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  }
  return null
}

export function ssrfGuardedLookup(
  hostname: string,
  options: object,
  callback: (
    err: Error | null,
    address: AxiosLookupAddress | AxiosLookupAddress[],
    family?: AddressFamily,
  ) => void,
): void {
  const wantsAll = 'all' in options && options.all === true

  
  
  
  const ipVersion = isIP(hostname)
  if (ipVersion !== 0) {
    if (isBlockedAddress(hostname)) {
      callback(ssrfError(hostname, hostname), '')
      return
    }
    const family = ipVersion === 6 ? 6 : 4
    if (wantsAll) {
      callback(null, [{ address: hostname, family }])
    } else {
      callback(null, hostname, family)
    }
    return
  }

  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) {
      callback(err, '')
      return
    }

    for (const { address } of addresses) {
      if (isBlockedAddress(address)) {
        callback(ssrfError(hostname, address), '')
        return
      }
    }

    const first = addresses[0]
    if (!first) {
      callback(
        Object.assign(new Error(`ENOTFOUND ${hostname}`), {
          code: 'ENOTFOUND',
          hostname,
        }),
        '',
      )
      return
    }

    const family = first.family === 6 ? 6 : 4
    if (wantsAll) {
      callback(
        null,
        addresses.map(a => ({
          address: a.address,
          family: a.family === 6 ? 6 : 4,
        })),
      )
    } else {
      callback(null, first.address, family)
    }
  })
}

function ssrfError(hostname: string, address: string): NodeJS.ErrnoException {
  const err = new Error(
    `HTTP hook blocked: ${hostname} resolves to ${address} (private/link-local address). Loopback (127.0.0.1, ::1) is allowed for local dev.`,
  )
  return Object.assign(err, {
    code: 'ERR_HTTP_HOOK_BLOCKED_ADDRESS',
    hostname,
    address,
  })
}
