/**
 * SSO + token acquisition for the embedded WebChat.
 *
 *   1. Teams JS SSO  — silent, true SSO when the host (M365 Copilot iframe)
 *      exposes the Teams JS bridge. We feature-detect with a try/catch and
 *      fall back transparently if it isn't.
 *   2. MSAL silent   — silent in practice because the user is signed into M365
 *      in the same browser session. Falls back to popup if interaction is
 *      explicitly required.
 *
 * Both produce a Power Platform API access token (audience
 * `https://api.powerplatform.com`), which Copilot Studio Wave-2 endpoints
 * validate server-side.
 *
 * The user app reg must have:
 *   - SPA platform with the SWA hostname + http://localhost:5173/ as redirect URIs
 *   - Implicit ID tokens enabled
 *   - Delegated permission: Power Platform API → CopilotStudio.Copilots.Invoke,
 *     admin-consented
 */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AuthenticationResult,
  type AccountInfo
} from '@azure/msal-browser';
import * as teams from '@microsoft/teams-js';

let pcaSingleton: PublicClientApplication | null = null;

function getPca(): PublicClientApplication {
  if (pcaSingleton) return pcaSingleton;
  pcaSingleton = new PublicClientApplication({
    auth: {
      clientId: import.meta.env.VITE_AAD_CLIENT_ID,
      authority: import.meta.env.VITE_AAD_AUTHORITY,
      redirectUri: window.location.origin + '/'
    },
    cache: { cacheLocation: 'sessionStorage' }
  });
  return pcaSingleton;
}

export interface AcquireResult {
  /** The access token, or null when not yet acquired. */
  token: string | null;
  /** Which strategy succeeded (or why none did). */
  source: 'teams-js' | 'msal-silent' | 'msal-popup' | 'none';
  /** The signed-in account when known. */
  account?: AccountInfo;
  /** Diagnostic — last error message, when applicable. */
  error?: string;
}

/** Tier 1: Teams JS SSO. Returns null if host doesn't expose the bridge. */
async function tryTeamsSso(): Promise<string | null> {
  try {
    await teams.app.initialize();
    const token = await teams.authentication.getAuthToken();
    return token || null;
  } catch {
    return null;
  }
}

/** Tier 2: MSAL silent (with popup fallback for first-time consent). */
async function tryMsal(): Promise<{
  token: string;
  account: AccountInfo;
  source: 'msal-silent' | 'msal-popup';
}> {
  const pca = getPca();
  await pca.initialize();
  await pca.handleRedirectPromise();

  const scopes = [import.meta.env.VITE_AAD_SCOPE];
  const accounts = pca.getAllAccounts();
  const account = accounts[0];

  try {
    let result: AuthenticationResult;
    if (account) {
      result = await pca.acquireTokenSilent({ scopes, account });
    } else {
      result = await pca.ssoSilent({ scopes });
    }
    return { token: result.accessToken, account: result.account!, source: 'msal-silent' };
  } catch (err) {
    if (
      err instanceof InteractionRequiredAuthError ||
      (err as { errorCode?: string })?.errorCode === 'monitor_window_timeout' ||
      account === undefined
    ) {
      const popup = await pca.acquireTokenPopup({ scopes });
      return { token: popup.accessToken, account: popup.account!, source: 'msal-popup' };
    }
    throw err;
  }
}

export async function acquireToken(): Promise<AcquireResult> {
  if (!import.meta.env.VITE_AAD_CLIENT_ID || !import.meta.env.VITE_AAD_SCOPE) {
    return {
      token: null,
      source: 'none',
      error: 'VITE_AAD_CLIENT_ID or VITE_AAD_SCOPE not configured.'
    };
  }

  const teamsToken = await tryTeamsSso();
  if (teamsToken) return { token: teamsToken, source: 'teams-js' };

  try {
    const r = await tryMsal();
    return { token: r.token, account: r.account, source: r.source };
  } catch (err) {
    return {
      token: null,
      source: 'none',
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Returns a function that produces a fresh access token on demand.
 * The CS SDK caches its token internally, but for long sessions we may
 * want to refresh; callers can use this in a periodic refresh loop.
 */
export async function getTokenFactory(): Promise<() => Promise<string>> {
  return async () => {
    const r = await acquireToken();
    if (!r.token) throw new Error(r.error ?? 'Failed to acquire access token.');
    return r.token;
  };
}
