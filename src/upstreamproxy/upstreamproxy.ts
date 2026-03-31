

import { mkdir, readFile, unlink, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { logForDebugging } from '../utils/debug.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { isENOENT } from '../utils/errors.js'
import { startUpstreamProxyRelay } from './relay.js'

export const SESSION_TOKEN_PATH = '/run/ccr/session_token'
const SYSTEM_CA_BUNDLE = '/etc/ssl/certs/ca-certificates.crt'

const NO_PROXY_LIST = [
  'localhost',
  '127.0.0.1',
  '::1',
  '169.254.0.0/16',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  // Anthropic API: no upstream route will ever match, and the MITM breaks
  
  
  //   *.anthropic.com  — Bun, curl, Go (glob match)
  
  
  'anthropic.com',
  '.anthropic.com',
  '*.anthropic.com',
  'github.com',
  'api.github.com',
  '*.github.com',
  '*.githubusercontent.com',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'index.crates.io',
  'proxy.golang.org',
].join(',')

type UpstreamProxyState = {
  enabled: boolean
  port?: number
  caBundlePath?: string
}

let state: UpstreamProxyState = { enabled: false }

/**
 * Initialize upstreamproxy. Called once from init.ts. Safe to call when the
 * feature is off or the token file is absent — returns {enabled: false}.
 *
 * Overridable paths are for tests; production uses the defaults.
 */
export async function initUpstreamProxy(opts?: {
  tokenPath?: string
  systemCaPath?: string
  caBundlePath?: string
  ccrBaseUrl?: string
}): Promise<UpstreamProxyState> {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) {
    return state
  }
  // CCR evaluates ccr_upstream_proxy_enabled server-side (where GrowthBook is
  
  
  
  if (!isEnvTruthy(process.env.CCR_UPSTREAM_PROXY_ENABLED)) {
    return state
  }

  const sessionId = process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  if (!sessionId) {
    logForDebugging(
      '[upstreamproxy] CLAUDE_CODE_REMOTE_SESSION_ID unset; proxy disabled',
      { level: 'warn' },
    )
    return state
  }

  const tokenPath = opts?.tokenPath ?? SESSION_TOKEN_PATH
  const token = await readToken(tokenPath)
  if (!token) {
    logForDebugging('[upstreamproxy] no session token file; proxy disabled')
    return state
  }

  setNonDumpable()

  
  
  
  // so it always returned the prod URL and the CA fetch 404'd.
  const baseUrl =
    opts?.ccrBaseUrl ??
    process.env.ANTHROPIC_BASE_URL ??
    'https://api.anthropic.com'
  const caBundlePath =
    opts?.caBundlePath ?? join(homedir(), '.ccr', 'ca-bundle.crt')

  const caOk = await downloadCaBundle(
    baseUrl,
    opts?.systemCaPath ?? SYSTEM_CA_BUNDLE,
    caBundlePath,
  )
  if (!caOk) return state

  try {
    const wsUrl = baseUrl.replace(/^http/, 'ws') + '/v1/code/upstreamproxy/ws'
    const relay = await startUpstreamProxyRelay({ wsUrl, sessionId, token })
    registerCleanup(async () => relay.stop())
    state = { enabled: true, port: relay.port, caBundlePath }
    logForDebugging(`[upstreamproxy] enabled on 127.0.0.1:${relay.port}`)
    // Only unlink after the listener is up: if CA download or listen()
    // fails, a supervisor restart can retry with the token still on disk.
    await unlink(tokenPath).catch(() => {
      logForDebugging('[upstreamproxy] token file unlink failed', {
        level: 'warn',
      })
    })
  } catch (err) {
    logForDebugging(
      `[upstreamproxy] relay start failed: ${err instanceof Error ? err.message : String(err)}; proxy disabled`,
      { level: 'warn' },
    )
  }

  return state
}

/**
 * Env vars to merge into every agent subprocess. Empty when the proxy is
 * disabled. Called from subprocessEnv() so Bash/MCP/LSP/hooks all inherit
 * the same recipe.
 */
export function getUpstreamProxyEnv(): Record<string, string> {
  if (!state.enabled || !state.port || !state.caBundlePath) {
    // Child CLI processes can't re-initialize the relay (token file was
    
    
    
    
    if (process.env.HTTPS_PROXY && process.env.SSL_CERT_FILE) {
      const inherited: Record<string, string> = {}
      for (const key of [
        'HTTPS_PROXY',
        'https_proxy',
        'NO_PROXY',
        'no_proxy',
        'SSL_CERT_FILE',
        'NODE_EXTRA_CA_CERTS',
        'REQUESTS_CA_BUNDLE',
        'CURL_CA_BUNDLE',
      ]) {
        if (process.env[key]) inherited[key] = process.env[key]
      }
      return inherited
    }
    return {}
  }
  const proxyUrl = `http://127.0.0.1:${state.port}`
  
  
  
  return {
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: NO_PROXY_LIST,
    no_proxy: NO_PROXY_LIST,
    SSL_CERT_FILE: state.caBundlePath,
    NODE_EXTRA_CA_CERTS: state.caBundlePath,
    REQUESTS_CA_BUNDLE: state.caBundlePath,
    CURL_CA_BUNDLE: state.caBundlePath,
  }
}

/** Test-only: reset module state between test cases. */
export function resetUpstreamProxyForTests(): void {
  state = { enabled: false }
}

async function readToken(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, 'utf8')
    return raw.trim() || null
  } catch (err) {
    if (isENOENT(err)) return null
    logForDebugging(
      `[upstreamproxy] token read failed: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'warn' },
    )
    return null
  }
}

/**
 * prctl(PR_SET_DUMPABLE, 0) via libc FFI. Blocks same-UID ptrace of this
 * process, so a prompt-injected `gdb -p $PPID` can't scrape the token from
 * the heap. Linux-only; silently no-ops elsewhere.
 */
function setNonDumpable(): void {
  if (process.platform !== 'linux' || typeof Bun === 'undefined') return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffi = require('bun:ffi') as typeof import('bun:ffi')
    const lib = ffi.dlopen('libc.so.6', {
      prctl: {
        args: ['int', 'u64', 'u64', 'u64', 'u64'],
        returns: 'int',
      },
    } as const)
    const PR_SET_DUMPABLE = 4
    const rc = lib.symbols.prctl(PR_SET_DUMPABLE, 0n, 0n, 0n, 0n)
    if (rc !== 0) {
      logForDebugging(
        '[upstreamproxy] prctl(PR_SET_DUMPABLE,0) returned nonzero',
        {
          level: 'warn',
        },
      )
    }
  } catch (err) {
    logForDebugging(
      `[upstreamproxy] prctl unavailable: ${err instanceof Error ? err.message : String(err)}`,
      { level: 'warn' },
    )
  }
}

async function downloadCaBundle(
  baseUrl: string,
  systemCaPath: string,
  outPath: string,
): Promise<boolean> {
  try {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const resp = await fetch(`${baseUrl}/v1/code/upstreamproxy/ca-cert`, {
      // Bun has no default fetch timeout — a hung endpoint would block CLI
      
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) {
      logForDebugging(
        `[upstreamproxy] ca-cert fetch ${resp.status}; proxy disabled`,
        { level: 'warn' },
      )
      return false
    }
    const ccrCa = await resp.text()
    const systemCa = await readFile(systemCaPath, 'utf8').catch(() => '')
    await mkdir(join(outPath, '..'), { recursive: true })
    await writeFile(outPath, systemCa + '\n' + ccrCa, 'utf8')
    return true
  } catch (err) {
    logForDebugging(
      `[upstreamproxy] ca-cert download failed: ${err instanceof Error ? err.message : String(err)}; proxy disabled`,
      { level: 'warn' },
    )
    return false
  }
}
