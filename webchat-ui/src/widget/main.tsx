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
import { subscribePpToken, subscribeToolDiag } from './host-bridge';

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
  const [hostTokenReceived, setHostTokenReceived] = useState(false);
  // Latest server-side OBO diagnostic block, surfaced in the error UI
  // so you can read it without opening devtools.
  const [toolDiag, setToolDiag] = useState<Record<string, unknown> | null>(null);
  // Wait this long before falling back to MSAL silent SSO. Skybridge
  // can mount the widget BEFORE the host has called the tool (e.g. on
  // agent selection), so the host bridge needs time to deliver
  // `toolOutput`. After this delay, if no host token has arrived, we
  // assume legacy / anonymous mode and try MSAL.
  const [msalGateOpen, setMsalGateOpen] = useState(false);

  // Prefer a token supplied by the M365 Copilot host through the tool
  // response `_meta.mcsmcpapps.ppToken`. Mode of operation:
  //
  //   - **Entra SSO enabled on the MCP server** (production path): the
  //     server OBO-exchanges the user's inbound Entra token for a
  //     Power Platform API token and embeds it in `_meta`. We pick it
  //     up here, set `hostTokenReceived`, skip MSAL entirely. Zero
  //     user prompts inside the skybridge sandbox.
  //
  //   - **Anonymous MCP** (legacy / dev path): the field is absent.
  //     We fall through to MSAL silent SSO. Inside skybridge MSAL
  //     usually fails with `monitor_window_timeout` because the iframe
  //     has a null origin and can't reach `login.microsoftonline.com`
  //     from the sandbox. The standalone SWA path still works.
  useEffect(() => {
    const unsub = subscribePpToken((t) => {
      trace('host-token-received', { length: t.length });
      setHostTokenReceived(true);
      setToken(t);
    });
    return () => unsub();
  }, []);

  // Server-side OBO diagnostics — always emitted by the tool whether or
  // not OBO succeeded. This is what tells us why ppToken is or isn't
  // present.
  useEffect(() => {
    const unsub = subscribeToolDiag((diag) => {
      trace('tool-meta-diag', diag);
      setToolDiag(diag);
    });
    return () => unsub();
  }, []);

  // Open the MSAL gate after a delay. Skybridge mounts the widget
  // before the user sends a message in some flows, so the host bridge
  // hasn't delivered `toolOutput` yet. Wait 4 seconds before assuming
  // legacy mode. Long enough for the host to deliver, short enough that
  // the standalone SWA channel still feels snappy.
  useEffect(() => {
    if (hostTokenReceived) return;
    const t = window.setTimeout(() => {
      trace('msal-gate-opened-after-timeout');
      setMsalGateOpen(true);
    }, 4000);
    return () => window.clearTimeout(t);
  }, [hostTokenReceived]);

  useEffect(() => {
    if (hostTokenReceived) return; // host gave us a token — skip MSAL
    if (!msalGateOpen) return; // wait for host bridge timeout
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
  }, [env.clientId, env.tenantId, hostTokenReceived, msalGateOpen]);

  useEffect(() => {
    if (hostTokenReceived) return; // host gave us a token — skip MSAL
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
      <div style={{ padding: 16, color: '#8b0000', fontFamily: 'Segoe UI', fontSize: 13, lineHeight: 1.4 }}>
        <strong>Cannot start chat.</strong>
        <div style={{ marginTop: 8 }}>{error}</div>
        {toolDiag ? (
          <details style={{ marginTop: 12, color: '#5b5d62' }} open>
            <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
              Server diagnostic (auth path)
            </summary>
            <pre style={{
              marginTop: 6,
              padding: 8,
              background: '#fff8e1',
              border: '1px solid #f4c430',
              borderRadius: 4,
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 240,
              overflow: 'auto'
            }}>{JSON.stringify(toolDiag, null, 2)}</pre>
          </details>
        ) : (
          <div style={{ marginTop: 12, color: '#5b5d62', fontSize: 11 }}>
            (no server diagnostic received — tool may not have been called)
          </div>
        )}
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
  // Make the boot-marker fade out instead of being removed instantly.
  // Helps when the marker scrolls past too fast to read. After 6s it's
  // detached entirely; React-rendered chat is below it via z-index.
  const marker = document.getElementById('boot-marker');
  if (marker) {
    marker.classList.add('fading');
    window.setTimeout(() => {
      try {
        marker.parentNode?.removeChild(marker);
      } catch {
        // ignore
      }
    }, 6000);
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
