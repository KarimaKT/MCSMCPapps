/**
 * Skybridge host bridge — read tool input from the M365 Copilot host.
 *
 * The host delivers tool inputs / results to the widget via:
 *   1. `window.openai.toolInput / toolOutput`  (snapshot)
 *   2. `openai:set_globals` event              (when those globals change)
 *   3. JSON-RPC `ui/notifications/tool-input` / `tool-result` (postMessage)
 *
 * We listen to all three for portability across host versions. We only
 * read state — we never POST back; auth / chat traffic goes widget → CS
 * SDK → CS directly (see [docs/ARCHITECTURE.md §1]).
 *
 * # CS conversation id discipline
 *
 * We do NOT read or set the CS conversation id from the host bridge. CS
 * allocates it through the SDK. The bridge only carries `userQuery`.
 */

export type FirstQueryListener = (text: string) => void;

interface OpenAiBridge {
  toolInput?: { userQuery?: unknown };
  toolOutput?: { userQuery?: unknown };
}

declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

function readUserQuery(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.userQuery === 'string' && obj.userQuery) {
    return obj.userQuery;
  }
  const sc = obj.structuredContent as Record<string, unknown> | undefined;
  if (sc && typeof sc.userQuery === 'string' && sc.userQuery) {
    return sc.userQuery;
  }
  const meta = obj._meta as Record<string, unknown> | undefined;
  const ns = meta?.mcsmcpapps as Record<string, unknown> | undefined;
  if (ns && typeof ns.userQuery === 'string' && ns.userQuery) {
    return ns.userQuery;
  }
  return null;
}

/**
 * Look for a Power Platform API token under `_meta.mcsmcpapps.ppToken`.
 * The MCP server places it there only when Entra SSO is enabled and the
 * OBO exchange succeeds; otherwise the field is absent and the widget
 * falls back to its own MSAL silent SSO.
 */
function readPpToken(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const meta = obj._meta as Record<string, unknown> | undefined;
  const ns = meta?.mcsmcpapps as Record<string, unknown> | undefined;
  if (ns && typeof ns.ppToken === 'string' && ns.ppToken) {
    return ns.ppToken;
  }
  return null;
}

/**
 * Subscribe to the host bridge. Calls `onFirstQuery(text)` exactly once
 * with the user's verbatim message that triggered the tool call (if any).
 * Returns a cleanup function.
 */
export function subscribeFirstQuery(onFirstQuery: FirstQueryListener): () => void {
  let fired = false;
  const fire = (text: string | null) => {
    if (fired || !text) return;
    fired = true;
    onFirstQuery(text);
  };

  // 1) Snapshot at boot.
  try {
    const w = window.openai;
    if (w) {
      fire(readUserQuery(w.toolInput) ?? readUserQuery(w.toolOutput));
    }
  } catch {
    // ignore
  }

  // 2) Window event when globals change.
  const onSetGlobals = (event: Event) => {
    try {
      const detail = (event as CustomEvent<{ globals: OpenAiBridge }>).detail;
      const g = detail?.globals ?? {};
      fire(readUserQuery(g.toolInput) ?? readUserQuery(g.toolOutput));
    } catch {
      // ignore
    }
  };
  window.addEventListener('openai:set_globals', onSetGlobals as EventListener, {
    passive: true
  } as AddEventListenerOptions);

  // 3) JSON-RPC notifications from the host iframe parent.
  const onMessage = (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const msg = e.data as { jsonrpc?: string; method?: string; params?: unknown };
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (
      msg.method === 'ui/notifications/tool-input' ||
      msg.method === 'ui/notifications/tool-result'
    ) {
      fire(readUserQuery(msg.params));
    }
  };
  window.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener(
      'openai:set_globals',
      onSetGlobals as EventListener
    );
    window.removeEventListener('message', onMessage);
  };
}

export type PpTokenListener = (token: string) => void;

/**
 * Subscribe to the host bridge for a Power Platform API token. Calls
 * `onToken(token)` exactly once if the host's tool-result payload (or
 * `window.openai.toolOutput`) carries one under
 * `_meta.mcsmcpapps.ppToken`. Returns a cleanup function.
 *
 * When the MCP server runs in legacy / anonymous mode the field is
 * absent and this never fires — the caller should treat the absence as
 * a signal to fall back to its own MSAL silent SSO.
 */
export function subscribePpToken(onToken: PpTokenListener): () => void {
  let fired = false;
  const fire = (token: string | null) => {
    if (fired || !token) return;
    fired = true;
    onToken(token);
  };

  // 1) Snapshot at boot. The host populates `toolOutput` synchronously
  //    on widget mount when the tool was called with `_meta` carrying
  //    the token.
  try {
    const w = window.openai;
    if (w) {
      fire(readPpToken(w.toolInput) ?? readPpToken(w.toolOutput));
    }
  } catch {
    // ignore
  }

  // 2) Window event when globals change.
  const onSetGlobals = (event: Event) => {
    try {
      const detail = (event as CustomEvent<{ globals: OpenAiBridge }>).detail;
      const g = detail?.globals ?? {};
      fire(readPpToken(g.toolInput) ?? readPpToken(g.toolOutput));
    } catch {
      // ignore
    }
  };
  window.addEventListener('openai:set_globals', onSetGlobals as EventListener, {
    passive: true
  } as AddEventListenerOptions);

  // 3) JSON-RPC notifications from the host iframe parent.
  const onMessage = (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const msg = e.data as {
      jsonrpc?: string;
      method?: string;
      params?: unknown;
    };
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (
      msg.method === 'ui/notifications/tool-input' ||
      msg.method === 'ui/notifications/tool-result'
    ) {
      fire(readPpToken(msg.params));
    }
  };
  window.addEventListener('message', onMessage);

  return () => {
    window.removeEventListener(
      'openai:set_globals',
      onSetGlobals as EventListener
    );
    window.removeEventListener('message', onMessage);
  };
}

/**
 * Detect whether we're running inside the M365 Copilot skybridge sandbox.
 * Used to gate behaviors that only make sense in-widget (e.g. expecting
 * a userQuery from the host, hiding the manual sign-in button).
 */
export function isInsideSkybridge(): boolean {
  // We are in skybridge if we have a parent window that's not us, AND
  // the host exposed the `window.openai` shim, OR our origin matches the
  // widget renderer host pattern.
  if (typeof window === 'undefined') return false;
  if (window.parent === window) return false;
  if (window.openai) return true;
  try {
    const host = window.location.hostname;
    return (
      host.endsWith('.widget-renderer.usercontent.microsoft.com') ||
      host.endsWith('.web-sandbox.oaiusercontent.com')
    );
  } catch {
    return false;
  }
}
