/**
 * Entra SSO authentication for the MCP server.
 *
 * # When this is active
 *
 * **Only when `ENTRA_AUDIENCE` and `ENTRA_TENANT_ID` are both set in
 * App Service config.** When unset, the middleware short-circuits and
 * the server runs in the legacy "anonymous MCP + browser-side MSAL"
 * mode (see [docs/AUTH-ARCHITECTURE.md] §"Six actors").
 *
 * # Wire model when active
 *
 *   1. M365 Copilot host attaches `Authorization: Bearer <token>` on
 *      every call to `/mcp`. The token's audience equals our
 *      `ENTRA_AUDIENCE` (the Application ID URI of the API exposed by
 *      our app reg, registered in the Teams Developer Portal as the
 *      Microsoft Entra SSO client).
 *   2. We verify the token's signature against Entra JWKS, the issuer,
 *      and the audience.
 *   3. We OBO-exchange that token for a Power Platform API token
 *      (audience `https://api.powerplatform.com`, scope
 *      `CopilotStudio.Copilots.Invoke`) using the
 *      `urn:ietf:params:oauth:grant-type:jwt-bearer` flow.
 *   4. The OBO'd token is stashed in an `AsyncLocalStorage` for the
 *      duration of the request so the tool handler can read it and
 *      embed it in the tool response `_meta.mcsmcpapps.token`. The
 *      widget reads it from `window.openai.toolOutput._meta` and skips
 *      its own MSAL silent SSO entirely.
 *
 * # Why JWT-bearer OBO instead of a normal client_credentials flow
 *
 * We need the user's Entra identity to flow all the way through to
 * Copilot Studio so:
 *
 *   - The user's existing M365 Copilot license + CS license is the
 *     thing that authorizes the conversation (no double-billing).
 *   - CS sees the real user identity for audit + Dataverse logging.
 *
 * `client_credentials` would impersonate the app, not the user. OBO
 * keeps the user identity intact across the boundary.
 *
 * # Why feature-flagged
 *
 * The Entra app reg + Teams Dev Portal SSO registration are CDX-tenant
 * admin tasks the maker has to do once. While they're in progress, the
 * server should keep working in the legacy mode so nothing regresses.
 * Flipping a single env var (`ENTRA_AUDIENCE`) turns the new path on.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

/**
 * Per-request auth context, accessible to tool handlers via
 * {@link getAuthContext}. Populated by {@link entraAuthMiddleware} when
 * the feature is active and the inbound token is valid; otherwise null.
 */
export interface AuthContext {
  /** Verified inbound Entra token claims (sub, oid, tid, name, etc.). */
  claims: JWTPayload;
  /** Raw inbound token, used as the assertion in the OBO exchange. */
  inboundToken: string;
}

const storage = new AsyncLocalStorage<AuthContext | null>();

/**
 * Module-level fallback. The SDK's request handler chain occasionally
 * loses AsyncLocalStorage context across internal awaits (the request
 * arrives, init/tools-list/tools-call happen on different async stacks).
 * Since the stateless transport processes ONE request per Express
 * dispatch, we set this synchronously in the middleware and read it in
 * the tool handler. Cleared in a `finally` after the response closes.
 */
let currentCtx: AuthContext | null = null;

/** Read the current request's auth context (null when feature is off). */
export function getAuthContext(): AuthContext | null {
  return storage.getStore() ?? currentCtx;
}

/**
 * Resolve the Entra SSO config from env. Returns `null` (feature off)
 * unless **both** `ENTRA_AUDIENCE` and `ENTRA_TENANT_ID` are set.
 */
export interface EntraConfig {
  /** Tenant where users sign in (CDX). */
  tenantId: string;
  /** Application ID URI of our API; matches `aud` claim on inbound. */
  audience: string;
  /** App reg client id used for OBO exchange. */
  clientId: string;
  /**
   * App reg client **secret** for OBO exchange. Optional — if absent,
   * the OBO step is skipped and the inbound token is forwarded as-is
   * (useful only if the inbound token is *already* a Power Platform
   * scoped token, which it is not in the standard pattern).
   *
   * # Production note
   *
   * Replace with a federated credential or Key Vault reference; never
   * commit secrets. See [docs/AUTH-ARCHITECTURE.md] §"Why federated
   * credentials beat client secrets".
   */
  clientSecret?: string;
  /**
   * Power Platform API scope to request via OBO. Defaults to the
   * standard CS Direct Engine scope.
   */
  ppScope: string;
}

export function loadEntraConfig(): EntraConfig | null {
  const tenantId = process.env.ENTRA_TENANT_ID;
  const audience = process.env.ENTRA_AUDIENCE;
  const clientId = process.env.ENTRA_CLIENT_ID;
  if (!tenantId || !audience || !clientId) return null;
  return {
    tenantId,
    audience,
    clientId,
    clientSecret: process.env.ENTRA_CLIENT_SECRET,
    ppScope:
      process.env.ENTRA_PP_SCOPE ??
      'https://api.powerplatform.com/CopilotStudio.Copilots.Invoke'
  };
}

/**
 * Build a JWKS resolver for the configured tenant. Caches keys
 * automatically per `jose` defaults (5 minute cache, 30s cooldown).
 */
function buildJwks(tenantId: string): ReturnType<typeof createRemoteJWKSet> {
  return createRemoteJWKSet(
    new URL(
      `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
    )
  );
}

/**
 * Express middleware: when Entra SSO is enabled, require a valid bearer
 * token on every `/mcp` request. Verifies signature, issuer, audience.
 *
 * If verification fails, returns 401 with a JSON-RPC error so the host
 * surfaces a re-consent prompt where appropriate.
 *
 * If Entra SSO is **disabled** (env vars absent), this is a no-op.
 */
export function entraAuthMiddleware(
  config: EntraConfig | null
): (req: Request, res: Response, next: NextFunction) => void {
  if (!config) {
    return (_req, _res, next) => next();
  }

  const jwks = buildJwks(config.tenantId);
  const expectedIssuer = [
    `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
    `https://sts.windows.net/${config.tenantId}/`
  ];

  return async (req, res, next) => {
    const authHeader = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!match) {
      // eslint-disable-next-line no-console
      console.warn('[auth] missing bearer token');
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Authorization required.' },
        id: req.body?.id ?? null
      });
      return;
    }
    const token = match[1];
    try {
      const { payload } = await jwtVerify(token, jwks, {
        audience: config.audience,
        issuer: expectedIssuer
      });
      const ctx: AuthContext = { claims: payload, inboundToken: token };
      // eslint-disable-next-line no-console
      console.log(
        `[auth] token verified (sub=${payload.sub ?? '?'}, oid=${payload.oid ?? '?'})`
      );
      // Set both AsyncLocalStorage AND the module-level fallback. The
      // module-level one is cleared on response close.
      currentCtx = ctx;
      res.on('close', () => {
        if (currentCtx === ctx) currentCtx = null;
      });
      storage.run(ctx, () => next());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('[auth] token rejected:', msg);
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Authorization failed.'
        },
        id: req.body?.id ?? null
      });
    }
  };
}

/**
 * On-Behalf-Of token exchange: trade the user's inbound Entra token for
 * a Power Platform API token bearing the user's identity.
 *
 * Returns the raw access_token string, or `null` if OBO is not
 * configured (no client secret) or fails. Failures are logged but never
 * thrown — the caller decides whether to fall back to legacy MSAL.
 */
export async function exchangeForPowerPlatformToken(
  config: EntraConfig
): Promise<string | null> {
  if (!config.clientSecret) {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] ENTRA_CLIENT_SECRET not set; cannot perform OBO exchange. ' +
        'Widget will fall back to its own MSAL silent SSO.'
    );
    return null;
  }
  const ctx = getAuthContext();
  if (!ctx) {
    // eslint-disable-next-line no-console
    console.warn('[auth] OBO skipped: no auth context (was middleware bypassed?)');
    return null;
  }
  // eslint-disable-next-line no-console
  console.log('[auth] OBO start');

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    assertion: ctx.inboundToken,
    scope: config.ppScope,
    requested_token_use: 'on_behalf_of'
  });
  const url = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!resp.ok) {
      const text = await resp.text();
      // eslint-disable-next-line no-console
      console.warn(`[auth] OBO failed: ${resp.status} ${text.slice(0, 300)}`);
      return null;
    }
    const json = (await resp.json()) as { access_token?: string };
    const got = typeof json.access_token === 'string' ? json.access_token : null;
    // eslint-disable-next-line no-console
    console.log(`[auth] OBO ok (token length=${got?.length ?? 0})`);
    return got;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn('[auth] OBO threw:', msg);
    return null;
  }
}
