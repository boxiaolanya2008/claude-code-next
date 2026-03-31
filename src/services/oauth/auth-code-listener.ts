import type { IncomingMessage, ServerResponse } from 'http'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { logEvent } from 'src/services/analytics/index.js'
import { getOauthConfig } from '../../constants/oauth.js'
import { logError } from '../../utils/log.js'
import { shouldUseClaudeAIAuth } from './client.js'

export class AuthCodeListener {
  private localServer: Server
  private port: number = 0
  private promiseResolver: ((authorizationCode: string) => void) | null = null
  private promiseRejecter: ((error: Error) => void) | null = null
  private expectedState: string | null = null 
  private pendingResponse: ServerResponse | null = null 
  private callbackPath: string 

  constructor(callbackPath: string = '/callback') {
    this.localServer = createServer()
    this.callbackPath = callbackPath
  }

  

  async start(port?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.localServer.once('error', err => {
        reject(
          new Error(`Failed to start OAuth callback server: ${err.message}`),
        )
      })

      
      this.localServer.listen(port ?? 0, 'localhost', () => {
        const address = this.localServer.address() as AddressInfo
        this.port = address.port
        resolve(this.port)
      })
    })
  }

  getPort(): number {
    return this.port
  }

  hasPendingResponse(): boolean {
    return this.pendingResponse !== null
  }

  async waitForAuthorization(
    state: string,
    onReady: () => Promise<void>,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.promiseResolver = resolve
      this.promiseRejecter = reject
      this.expectedState = state
      this.startLocalListener(onReady)
    })
  }

  

  handleSuccessRedirect(
    scopes: string[],
    customHandler?: (res: ServerResponse, scopes: string[]) => void,
  ): void {
    if (!this.pendingResponse) return

    
    if (customHandler) {
      customHandler(this.pendingResponse, scopes)
      this.pendingResponse = null
      logEvent('tengu_oauth_automatic_redirect', { custom_handler: true })
      return
    }

    
    const successUrl = shouldUseClaudeAIAuth(scopes)
      ? getOauthConfig().CLAUDEAI_SUCCESS_URL
      : getOauthConfig().CONSOLE_SUCCESS_URL

    
    this.pendingResponse.writeHead(302, { Location: successUrl })
    this.pendingResponse.end()
    this.pendingResponse = null

    logEvent('tengu_oauth_automatic_redirect', {})
  }

  

  handleErrorRedirect(): void {
    if (!this.pendingResponse) return

    
    const errorUrl = getOauthConfig().CLAUDEAI_SUCCESS_URL

    
    this.pendingResponse.writeHead(302, { Location: errorUrl })
    this.pendingResponse.end()
    this.pendingResponse = null

    logEvent('tengu_oauth_automatic_redirect_error', {})
  }

  private startLocalListener(onReady: () => Promise<void>): void {
    
    this.localServer.on('request', this.handleRedirect.bind(this))
    this.localServer.on('error', this.handleError.bind(this))

    
    void onReady()
  }

  private handleRedirect(req: IncomingMessage, res: ServerResponse): void {
    const parsedUrl = new URL(
      req.url || '',
      `http://${req.headers.host || 'localhost'}`,
    )

    if (parsedUrl.pathname !== this.callbackPath) {
      res.writeHead(404)
      res.end()
      return
    }

    const authCode = parsedUrl.searchParams.get('code') ?? undefined
    const state = parsedUrl.searchParams.get('state') ?? undefined

    this.validateAndRespond(authCode, state, res)
  }

  private validateAndRespond(
    authCode: string | undefined,
    state: string | undefined,
    res: ServerResponse,
  ): void {
    if (!authCode) {
      res.writeHead(400)
      res.end('Authorization code not found')
      this.reject(new Error('No authorization code received'))
      return
    }

    if (state !== this.expectedState) {
      res.writeHead(400)
      res.end('Invalid state parameter')
      this.reject(new Error('Invalid state parameter'))
      return
    }

    
    this.pendingResponse = res

    this.resolve(authCode)
  }

  private handleError(err: Error): void {
    logError(err)
    this.close()
    this.reject(err)
  }

  private resolve(authorizationCode: string): void {
    if (this.promiseResolver) {
      this.promiseResolver(authorizationCode)
      this.promiseResolver = null
      this.promiseRejecter = null
    }
  }

  private reject(error: Error): void {
    if (this.promiseRejecter) {
      this.promiseRejecter(error)
      this.promiseResolver = null
      this.promiseRejecter = null
    }
  }

  close(): void {
    
    if (this.pendingResponse) {
      this.handleErrorRedirect()
    }

    if (this.localServer) {
      
      this.localServer.removeAllListeners()
      this.localServer.close()
    }
  }
}
