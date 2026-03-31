import type * as https from 'https'
import { Agent as HttpsAgent } from 'https'
import memoize from 'lodash-es/memoize.js'
import type * as tls from 'tls'
import type * as undici from 'undici'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { getFsImplementation } from './fsOperations.js'

export type MTLSConfig = {
  cert?: string
  key?: string
  passphrase?: string
}

export type TLSConfig = MTLSConfig & {
  ca?: string | string[] | Buffer
}

export const getMTLSConfig = memoize((): MTLSConfig | undefined => {
  const config: MTLSConfig = {}

  
  

  
  if (process.env.CLAUDE_CODE_NEXT_CLIENT_CERT) {
    try {
      config.cert = getFsImplementation().readFileSync(
        process.env.CLAUDE_CODE_NEXT_CLIENT_CERT,
        { encoding: 'utf8' },
      )
      logForDebugging(
        'mTLS: Loaded client certificate from CLAUDE_CODE_NEXT_CLIENT_CERT',
      )
    } catch (error) {
      logForDebugging(`mTLS: Failed to load client certificate: ${error}`, {
        level: 'error',
      })
    }
  }

  
  if (process.env.CLAUDE_CODE_NEXT_CLIENT_KEY) {
    try {
      config.key = getFsImplementation().readFileSync(
        process.env.CLAUDE_CODE_NEXT_CLIENT_KEY,
        { encoding: 'utf8' },
      )
      logForDebugging('mTLS: Loaded client key from CLAUDE_CODE_NEXT_CLIENT_KEY')
    } catch (error) {
      logForDebugging(`mTLS: Failed to load client key: ${error}`, {
        level: 'error',
      })
    }
  }

  
  if (process.env.CLAUDE_CODE_NEXT_CLIENT_KEY_PASSPHRASE) {
    config.passphrase = process.env.CLAUDE_CODE_NEXT_CLIENT_KEY_PASSPHRASE
    logForDebugging('mTLS: Using client key passphrase')
  }

  
  if (Object.keys(config).length === 0) {
    return undefined
  }

  return config
})

export const getMTLSAgent = memoize((): HttpsAgent | undefined => {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return undefined
  }

  const agentOptions: https.AgentOptions = {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
    
    keepAlive: true,
  }

  logForDebugging('mTLS: Creating HTTPS agent with custom certificates')
  return new HttpsAgent(agentOptions)
})

export function getWebSocketTLSOptions(): tls.ConnectionOptions | undefined {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return undefined
  }

  return {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
  }
}

export function getTLSFetchOptions(): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
} {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  if (!mtlsConfig && !caCerts) {
    return {}
  }

  const tlsConfig: TLSConfig = {
    ...mtlsConfig,
    ...(caCerts && { ca: caCerts }),
  }

  if (typeof Bun !== 'undefined') {
    return { tls: tlsConfig }
  }
  logForDebugging('TLS: Created undici agent with custom certificates')
  
  
  
  const undiciMod = require('undici') as typeof undici
  const agent = new undiciMod.Agent({
    connect: {
      cert: tlsConfig.cert,
      key: tlsConfig.key,
      passphrase: tlsConfig.passphrase,
      ...(tlsConfig.ca && { ca: tlsConfig.ca }),
    },
    pipelining: 1,
  })

  return { dispatcher: agent }
}

export function clearMTLSCache(): void {
  getMTLSConfig.cache.clear?.()
  getMTLSAgent.cache.clear?.()
  logForDebugging('Cleared mTLS configuration cache')
}

export function configureGlobalMTLS(): void {
  const mtlsConfig = getMTLSConfig()

  if (!mtlsConfig) {
    return
  }

  
  if (process.env.NODE_EXTRA_CA_CERTS) {
    logForDebugging(
      'NODE_EXTRA_CA_CERTS detected - Node.js will automatically append to built-in CAs',
    )
  }
}
