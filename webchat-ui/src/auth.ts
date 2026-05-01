/**
 * 3-tier SSO strategy for the embedded WebChat.
 *
 *   1. Teams JS SSO — silent, true SSO. Works only when the host (M365 Copilot
 *      iframe) exposes the Teams JS bridge.
 *   2. MSAL silent acquisition — silent in practice because the user is always
 *      signed into M365 in the same browser session as the iframe.
 *   3. CS auth topic fallback — if both fail, surface a friendly message and
 *      let the Copilot Studio agent's "Authenticate with Microsoft" topic
 *      render its own login card.
 */

import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AuthenticationResult
} from '@azure/msal-browser';
import * as teams from '@microsoft/teams-js';

let pcaSingleton: PublicClientApplication | null = null;

function getPca(): PublicClientApplication {
  if (pcaSingleton) return pcaSingleton;
  pcaSingleton = new PublicClientApplication({
    auth: {
      clientId: import.meta.env.VITE_AAD_CLIENT_ID,
      authority: import.meta.env.VITE_AAD_AUTHORITY,
      redirectUri: window.location.origin
    },
    cache: { cacheLocation: 'sessionStorage' }
  });
  return pcaSingleton;
}

/** Tier 1 — Teams JS SSO. Returns null if host doesn't expose the bridge. */
async function tryTeamsSso(): Promise<string | null> {
  try {
    await teams.app.initialize();
    const token = await teams.authentication.getAuthToken();
    return token || null;
  } catch {
    return null;
  }
}

/** Tier 2 — MSAL silent (will fall back to popup if interaction required). */
async function tryMsalSilent(): Promise<string | null> {
  const pca = getPca();
  await pca.initialize();

  // Process any redirect that may have happened on app load.
  await pca.handleRedirectPromise();

  const accounts = pca.getAllAccounts();
  const scopes = [import.meta.env.VITE_AAD_SCOPE];
  const account = accounts[0];

  try {
    const result: AuthenticationResult = account
      ? await pca.acquireTokenSilent({ scopes, account })
      : await pca.ssoSilent({ scopes });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      try {
        const popup = await pca.acquireTokenPopup({ scopes });
        return popup.accessToken;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export interface SsoResult {
  token: string | null;
  source: 'teams-js' | 'msal-silent' | 'msal-popup' | 'none';
}

export async function acquireToken(): Promise<SsoResult> {
  // Skip auth entirely if no client ID is configured (dev mode).
  if (!import.meta.env.VITE_AAD_CLIENT_ID || !import.meta.env.VITE_AAD_SCOPE) {
    return { token: null, source: 'none' };
  }

  const teamsToken = await tryTeamsSso();
  if (teamsToken) return { token: teamsToken, source: 'teams-js' };

  const msalToken = await tryMsalSilent();
  if (msalToken) return { token: msalToken, source: 'msal-silent' };

  return { token: null, source: 'none' };
}
