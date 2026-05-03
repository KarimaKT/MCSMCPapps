/**
 * Widget HTML returned by the chat-widget resource.
 *
 * # MIGRATION (planned for v0.6 — see [docs/SPEC.md] §11 D3)
 *
 *   The current shape is an **iframe shell** that loads the Static Web App.
 *   This works for the standalone SWA channel but does NOT reliably render
 *   inside the M365 Copilot skybridge sandbox: while `_meta.ui.csp.frameDomains`
 *   nominally allows sub-iframes, OpenAI Apps SDK docs explicitly discourage
 *   the pattern and Microsoft's own samples never use it.
 *
 *   The v0.6 fix is to **inline the React app as a single-file HTML bundle**
 *   (via `vite-plugin-singlefile` in webchat-ui) and have this module simply
 *   `readFileSync()` that bundle at server start. Plan documented in
 *   [docs/ARCHITECTURE.md §3.2].
 *
 * # Current contract (v0.5)
 *
 *   - The host (M365 Copilot, ChatGPT Apps SDK) only renders this HTML if
 *     the resource MIME type is exactly `text/html+skybridge`. Plain
 *     `text/html` and `text/html;profile=mcp-app` are silently dropped.
 *     The MIME is set by `resources/chatWidget.ts`; this module returns the
 *     body only.
 *
 *   - The host delivers the tool's input + result into the widget iframe
 *     as JSON-RPC notifications from `window.parent`:
 *         method = 'ui/notifications/tool-input'   → the args you passed
 *         method = 'ui/notifications/tool-result'  → the full tool result
 *     M365 Copilot ALSO exposes a `window.openai.toolInput / toolOutput`
 *     snapshot. We listen to both for portability.
 *
 *   - When `userQuery` is present we relay it to the inner SWA via
 *     `postMessage`. The SWA queues it and auto-sends as the user's first
 *     message the moment its Copilot Studio conversation opens — so the
 *     user never has to retype.
 *
 * # See also
 *
 *   - [docs/MCP-APPS-CONTRACT.md] — the verified MIME / `_meta` contract
 *   - [mcp-server/src/resources/chatWidget.ts] — registers this HTML
 */

export interface WidgetHtmlOptions {
  swaOrigin: string;
  agentName: string;
}

const POSTMESSAGE_TYPE = 'mcsmcpapps:firstMessage';
const READY_TYPE = 'mcsmcpapps:ready';

export function renderWidgetHtml(opts: WidgetHtmlOptions): string {
  const { swaOrigin, agentName } = opts;
  const safeName = escapeHtml(agentName);
  const safeOrigin = escapeAttr(swaOrigin);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeName}</title>
    <style>
      html, body { height: 100%; width: 100%; margin: 0; padding: 0; background: #fff; }
      #mcsmcpapps-chat { height: 100%; width: 100%; min-height: 520px; border: 0; display: block; }
    </style>
  </head>
  <body>
    <iframe
      id="mcsmcpapps-chat"
      src="${safeOrigin}/?embedded=1"
      title="${safeName}"
      allow="clipboard-write; microphone; camera"
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
    <script>
      (function () {
        var iframe = document.getElementById('mcsmcpapps-chat');
        var swaOrigin = ${JSON.stringify(swaOrigin)};
        var pendingQuery = null;
        var iframeReady = false;

        function flush() {
          if (!iframeReady || !pendingQuery || !iframe.contentWindow) return;
          try {
            iframe.contentWindow.postMessage(
              { type: ${JSON.stringify(POSTMESSAGE_TYPE)}, text: pendingQuery },
              swaOrigin
            );
            pendingQuery = null;
          } catch (e) { /* ignore */ }
        }

        function readUserQuery(payload) {
          if (!payload) return null;
          if (typeof payload.userQuery === 'string' && payload.userQuery) return payload.userQuery;
          var sc = payload.structuredContent;
          if (sc && typeof sc.userQuery === 'string' && sc.userQuery) return sc.userQuery;
          var meta = payload._meta;
          if (meta && meta.mcsmcpapps && typeof meta.mcsmcpapps.userQuery === 'string' && meta.mcsmcpapps.userQuery) {
            return meta.mcsmcpapps.userQuery;
          }
          return null;
        }

        // ----- MCP Apps bridge: JSON-RPC notifications from window.parent -----
        window.addEventListener('message', function (e) {
          // Inner SWA \u2192 we route by origin.
          if (e.origin === swaOrigin) {
            if (e.data && e.data.type === ${JSON.stringify(READY_TYPE)}) {
              iframeReady = true;
              flush();
            }
            return;
          }
          // Host \u2192 only accept messages from window.parent.
          if (e.source !== window.parent) return;
          var msg = e.data;
          if (!msg || msg.jsonrpc !== '2.0') return;
          if (msg.method === 'ui/notifications/tool-input' ||
              msg.method === 'ui/notifications/tool-result') {
            var q = readUserQuery(msg.params);
            if (q) { pendingQuery = q; flush(); }
          }
        }, false);

        // ----- OpenAI Apps SDK compatibility: window.openai snapshot -----
        try {
          var w = (window).openai;
          if (w) {
            var t = w.toolInput || w.toolOutput;
            var q0 = readUserQuery(t);
            if (q0) { pendingQuery = q0; flush(); }
          }
        } catch (e) { /* ignore */ }

        // ChatGPT fires this when host globals change (toolInput/toolOutput).
        window.addEventListener('openai:set_globals', function (event) {
          try {
            var g = (event && event.detail && event.detail.globals) || {};
            var q1 = readUserQuery(g.toolInput) || readUserQuery(g.toolOutput);
            if (q1) { pendingQuery = q1; flush(); }
          } catch (e) { /* ignore */ }
        }, { passive: true });
      })();
    </script>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
