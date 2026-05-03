/**
 * Widget entry point — bootstrap React, acquire token, render `<Widget>`.
 *
 * This is the file that `vite-plugin-singlefile` builds into a single
 * inlined HTML, served by the MCP server at `ui://mcsmcpapps/chat`.
 *
 * # Boot order
 *
 *   1. Read env (CS env id + schema, tenant, MSAL client id).
 *   2. Acquire a Power Platform API access token via MSAL silent SSO.
 *      In skybridge, MSAL popup is blocked — silent must succeed. The
 *      M365 Copilot host signs the user in upstream so silent normally
 *      works.
 *   3. Render `<Widget accessToken={token} />`.
 *
 * # Failure UX
 *
 * If silent SSO fails (rare — typically only first-run), we render a
 * minimal "click to sign in" button that triggers `acquireTokenPopup`.
 * Inside skybridge that may fail too; in that case the user sees an
 * error message and we log to console for diagnosis.
 */

import * as React from 'react';
import { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom';
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo
} from '@azure/msal-browser';
import { Widget } from './Widget';

interface AppEnv {
  environmentId: string;
  schemaName: string;
  tenantId: string;
  clientId: string;
  scope: string;
}

function readEnv(): AppEnv {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  return {
    environmentId: env.VITE_CS_ENVIRONMENT_ID ?? '',
    schemaName: env.VITE_CS_SCHEMA_NAME ?? '',
    tenantId: env.VITE_AAD_TENANT_ID ?? '',
    clientId: env.VITE_AAD_CLIENT_ID ?? '',
    scope:
      env.VITE_AAD_SCOPE ??
      'https://api.powerplatform.com/CopilotStudio.Copilots.Invoke'
  };
}

function App() {
  const env = readEnv();
  const [token, setToken] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [pca, setPca] = useState<PublicClientApplication | null>(null);

  useEffect(() => {
    if (!env.clientId || !env.tenantId) {
      setError('Widget is missing AAD client id or tenant id.');
      return;
    }
    const instance = new PublicClientApplication({
      auth: {
        clientId: env.clientId,
        authority: `https://login.microsoftonline.com/${env.tenantId}`,
        // Same-origin redirect is fine for silent SSO inside skybridge.
        redirectUri: window.location.origin
      },
      cache: { cacheLocation: 'sessionStorage' }
    });
    instance.initialize().then(() => {
      setPca(instance);
    });
  }, [env.clientId, env.tenantId]);

  useEffect(() => {
    if (!pca) return;
    let cancelled = false;
    void (async () => {
      try {
        const accounts = pca.getAllAccounts();
        const account: AccountInfo | undefined = accounts[0];
        const result = account
          ? await pca.acquireTokenSilent({ scopes: [env.scope], account })
          : await pca.ssoSilent({ scopes: [env.scope] });
        if (!cancelled) setToken(result.accessToken);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof InteractionRequiredAuthError) {
          // Try popup. May fail inside skybridge sandbox.
          try {
            const result = await pca.acquireTokenPopup({ scopes: [env.scope] });
            if (!cancelled) setToken(result.accessToken);
          } catch (popupErr) {
            const msg =
              popupErr instanceof Error ? popupErr.message : String(popupErr);
            if (!cancelled) setError(`Sign-in failed: ${msg}`);
          }
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          if (!cancelled) setError(`Sign-in failed: ${msg}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pca, env.scope]);

  if (error) {
    return (
      <div style={{ padding: 16, color: '#8b0000', fontFamily: 'Segoe UI' }}>
        <strong>Cannot start chat.</strong>
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );
  }
  if (!token) {
    return (
      <div style={{ padding: 16, color: '#5b5d62', fontFamily: 'Segoe UI' }}>
        Connecting…
      </div>
    );
  }
  return (
    <Widget
      environmentId={env.environmentId}
      schemaName={env.schemaName}
      accessToken={token}
    />
  );
}

const container = document.getElementById('root');
if (container) {
  // React 16 API. Microsoft's webchat-react sample also pins 16 because
  // `botframework-webchat` ships under that version. Upgrading to 18 is
  // a larger surgery (Composer + hooks API differences) and out of v0.5
  // scope.
  ReactDOM.render(<App />, container);
}
