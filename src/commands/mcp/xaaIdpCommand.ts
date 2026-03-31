

import type { Command } from '@commander-js/extra-typings'
import { cliError, cliOk } from '../../cli/exit.js'
import {
  acquireIdpIdToken,
  clearIdpClientSecret,
  clearIdpIdToken,
  getCachedIdpIdToken,
  getIdpClientSecret,
  getXaaIdpSettings,
  issuerKey,
  saveIdpClientSecret,
  saveIdpIdTokenFromJwt,
} from '../../services/mcp/xaaIdpLogin.js'
import { errorMessage } from '../../utils/errors.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

export function registerMcpXaaIdpCommand(mcp: Command): void {
  const xaaIdp = mcp
    .command('xaa')
    .description('Manage the XAA (SEP-990) IdP connection')

  xaaIdp
    .command('setup')
    .description(
      'Configure the IdP connection (one-time setup for all XAA-enabled servers)',
    )
    .requiredOption('--issuer <url>', 'IdP issuer URL (OIDC discovery)')
    .requiredOption('--client-id <id>', "Claude Code's client_id at the IdP")
    .option(
      '--client-secret',
      'Read IdP client secret from MCP_XAA_IDP_CLIENT_SECRET env var',
    )
    .option(
      '--callback-port <port>',
      'Fixed loopback callback port (only if IdP does not honor RFC 8252 port-any matching)',
    )
    .action(options => {
      // Validate everything BEFORE any writes. An exit(1) mid-write leaves
      
      
      
      
      
      let issuerUrl: URL
      try {
        issuerUrl = new URL(options.issuer)
      } catch {
        return cliError(
          `Error: --issuer must be a valid URL (got "${options.issuer}")`,
        )
      }
      // OIDC discovery + token exchange run against this host. Allow http://
      
      
      if (
        issuerUrl.protocol !== 'https:' &&
        !(
          issuerUrl.protocol === 'http:' &&
          (issuerUrl.hostname === 'localhost' ||
            issuerUrl.hostname === '127.0.0.1' ||
            issuerUrl.hostname === '[::1]')
        )
      ) {
        return cliError(
          `Error: --issuer must use https:// (got "${issuerUrl.protocol}//${issuerUrl.host}")`,
        )
      }
      const callbackPort = options.callbackPort
        ? parseInt(options.callbackPort, 10)
        : undefined
      
      
      if (
        callbackPort !== undefined &&
        (!Number.isInteger(callbackPort) || callbackPort <= 0)
      ) {
        return cliError('Error: --callback-port must be a positive integer')
      }
      const secret = options.clientSecret
        ? process.env.MCP_XAA_IDP_CLIENT_SECRET
        : undefined
      if (options.clientSecret && !secret) {
        return cliError(
          'Error: --client-secret requires MCP_XAA_IDP_CLIENT_SECRET env var',
        )
      }

      // Read old config now (before settings overwrite) so we can clear stale
      
      
      
      const old = getXaaIdpSettings()
      const oldIssuer = old?.issuer
      const oldClientId = old?.clientId

      
      
      
      const { error } = updateSettingsForSource('userSettings', {
        xaaIdp: {
          issuer: options.issuer,
          clientId: options.clientId,
          callbackPort,
        },
      })
      if (error) {
        return cliError(`Error writing settings: ${error.message}`)
      }

      // Clear stale keychain slots only after settings write succeeded —
      
      
      
      if (oldIssuer) {
        if (issuerKey(oldIssuer) !== issuerKey(options.issuer)) {
          clearIdpIdToken(oldIssuer)
          clearIdpClientSecret(oldIssuer)
        } else if (oldClientId !== options.clientId) {
          // Same issuer slot but different OAuth client registration — the
          
          
          
          
          // re-setup without --client-secret means "tweak port, keep secret".
          clearIdpIdToken(oldIssuer)
          clearIdpClientSecret(oldIssuer)
        }
      }

      if (secret) {
        const { success, warning } = saveIdpClientSecret(options.issuer, secret)
        if (!success) {
          return cliError(
            `Error: settings written but keychain save failed${warning ? ` — ${warning}` : ''}. ` +
              `Re-run with --client-secret once keychain is available.`,
          )
        }
      }

      cliOk(`XAA IdP connection configured for ${options.issuer}`)
    })

  xaaIdp
    .command('login')
    .description(
      'Cache an IdP id_token so XAA-enabled MCP servers authenticate ' +
        'silently. Default: run the OIDC browser login. With --id-token: ' +
        'write a pre-obtained JWT directly (used by conformance/e2e tests ' +
        'where the mock IdP does not serve /authorize).',
    )
    .option(
      '--force',
      'Ignore any cached id_token and re-login (useful after IdP-side revocation)',
    )
    
    
    // no shell parser), but a real user would want `echo $TOKEN | ... --stdin`.
    .option(
      '--id-token <jwt>',
      'Write this pre-obtained id_token directly to cache, skipping the OIDC browser login',
    )
    .action(async options => {
      const idp = getXaaIdpSettings()
      if (!idp) {
        return cliError(
          "Error: no XAA IdP connection. Run 'claude mcp xaa setup' first.",
        )
      }

      // Direct-inject path: skip cache check, skip OIDC. Writing IS the
      
      
      if (options.idToken) {
        const expiresAt = saveIdpIdTokenFromJwt(idp.issuer, options.idToken)
        return cliOk(
          `id_token cached for ${idp.issuer} (expires ${new Date(expiresAt).toISOString()})`,
        )
      }

      if (options.force) {
        clearIdpIdToken(idp.issuer)
      }

      const wasCached = getCachedIdpIdToken(idp.issuer) !== undefined
      if (wasCached) {
        return cliOk(
          `Already logged in to ${idp.issuer} (cached id_token still valid). Use --force to re-login.`,
        )
      }

      process.stdout.write(`Opening browser for IdP login at ${idp.issuer}…\n`)
      try {
        await acquireIdpIdToken({
          idpIssuer: idp.issuer,
          idpClientId: idp.clientId,
          idpClientSecret: getIdpClientSecret(idp.issuer),
          callbackPort: idp.callbackPort,
          onAuthorizationUrl: url => {
            process.stdout.write(
              `If the browser did not open, visit:\n  ${url}\n`,
            )
          },
        })
        cliOk(
          `Logged in. MCP servers with --xaa will now authenticate silently.`,
        )
      } catch (e) {
        cliError(`IdP login failed: ${errorMessage(e)}`)
      }
    })

  xaaIdp
    .command('show')
    .description('Show the current IdP connection config')
    .action(() => {
      const idp = getXaaIdpSettings()
      if (!idp) {
        return cliOk('No XAA IdP connection configured.')
      }
      const hasSecret = getIdpClientSecret(idp.issuer) !== undefined
      const hasIdToken = getCachedIdpIdToken(idp.issuer) !== undefined
      process.stdout.write(`Issuer:        ${idp.issuer}\n`)
      process.stdout.write(`Client ID:     ${idp.clientId}\n`)
      if (idp.callbackPort !== undefined) {
        process.stdout.write(`Callback port: ${idp.callbackPort}\n`)
      }
      process.stdout.write(
        `Client secret: ${hasSecret ? '(stored in keychain)' : '(not set — PKCE-only)'}\n`,
      )
      process.stdout.write(
        `Logged in:     ${hasIdToken ? 'yes (id_token cached)' : "no — run 'claude mcp xaa login'"}\n`,
      )
      cliOk()
    })

  xaaIdp
    .command('clear')
    .description('Clear the IdP connection config and cached id_token')
    .action(() => {
      // Read issuer first so we can clear the right keychain slots.
      const idp = getXaaIdpSettings()
      
      
      const { error } = updateSettingsForSource('userSettings', {
        xaaIdp: undefined,
      })
      if (error) {
        return cliError(`Error writing settings: ${error.message}`)
      }
      // Clear keychain only after settings write succeeded — otherwise a
      
      
      if (idp) {
        clearIdpIdToken(idp.issuer)
        clearIdpClientSecret(idp.issuer)
      }
      cliOk('XAA IdP connection cleared')
    })
}
