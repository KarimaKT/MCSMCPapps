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

/**
 * Boot trace bridge.
 *
 * The inline `<script>` in `index.widget.html` defines `window.__mcsmcpappsTrace`
 * which appends to the on-screen boot-marker AND postMessages to the host
 * parent. We import it here so the React phase contributes to the same
 * trace stream — invaluable when the iframe console is not visible in
 * M365 Copilot devtools.
 */
declare global {
  interface Window {
    __mcsmcpappsTrace?: (phase: string, extra?: unknown) => void;
  }
}
function trace(phase: string, extra?: unknown): void {
  try {
    window.__mcsmcpappsTrace?.(phase, extra);
  } catch {
    // ignore
  }
}
trace('module-bundle-evaluating');

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
    trace('app-mounted', {
      hasClientId: Boolean(env.clientId),
      hasTenantId: Boolean(env.tenantId),
      hasEnvId: Boolean(env.environmentId),
      hasSchema: Boolean(env.schemaName)
    });
    if (!env.clientId || !env.tenantId) {
      trace('missing-aad-config');
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
    instance
      .initialize()
      .then(() => {
        trace('msal-initialized');
        setPca(instance);
      })
      .catch((err) => {
        trace('msal-init-failed', {
          msg: String((err && (err.message || err)) || '')
        });
        setError(`MSAL init failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [env.clientId, env.tenantId]);

  useEffect(() => {
    if (!pca) return;
    let cancelled = false;
    void (async () => {
      try {
        const accounts = pca.getAllAccounts();
        const account: AccountInfo | undefined = accounts[0];
        trace('token-acquire-start', {
          path: account ? 'silent' : 'ssoSilent',
          accounts: accounts.length
        });
        const result = account
          ? await pca.acquireTokenSilent({ scopes: [env.scope], account })
          : await pca.ssoSilent({ scopes: [env.scope] });
        trace('token-acquired', { length: result.accessToken.length });
        if (!cancelled) setToken(result.accessToken);
      } catch (err) {
        if (cancelled) return;
        const errMsg =
          err instanceof Error ? err.message : String(err);
        trace('token-acquire-failed', {
          kind: err instanceof InteractionRequiredAuthError ? 'interactionRequired' : 'other',
          msg: errMsg.substr(0, 200)
        });
        if (err instanceof InteractionRequiredAuthError) {
          // Try popup. May fail inside skybridge sandbox.
          try {
            const result = await pca.acquireTokenPopup({ scopes: [env.scope] });
            trace('token-acquired-popup', { length: result.accessToken.length });
            if (!cancelled) setToken(result.accessToken);
          } catch (popupErr) {
            const msg =
              popupErr instanceof Error ? popupErr.message : String(popupErr);
            trace('token-popup-failed', { msg: msg.substr(0, 200) });
            if (!cancelled) setError(`Sign-in failed: ${msg}`);
          }
        } else {
          if (!cancelled) setError(`Sign-in failed: ${errMsg}`);
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
  // React owns #root from this point. Strip the inline boot-marker so it
  // doesn't visually overlay the chat. The trace stream still fires.
  const marker = document.getElementById('boot-marker');
  if (marker && marker.parentNode === container) {
    container.removeChild(marker);
  }
  trace('react-render-start');
  // React 16 API. Microsoft's webchat-react sample also pins 16 because
  // `botframework-webchat` ships under that version. Upgrading to 18 is
  // a larger surgery (Composer + hooks API differences) and out of v0.5
  // scope.
  try {
    ReactDOM.render(<App />, container);
    trace('react-render-returned');
  } catch (err) {
    trace('react-render-threw', {
      msg: String((err as Error)?.message || err).substr(0, 300)
    });
    throw err;
  }
} else {
  trace('no-root-element');
}
