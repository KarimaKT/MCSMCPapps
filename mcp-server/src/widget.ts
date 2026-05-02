/**
 * Builds the HTML widget served as a UI resource.
 *
 * The widget is a tiny frame around the Static Web App. It does two things:
 *
 *   1. Iframes the SWA so the user gets the full chat UI.
 *   2. Listens for the MCP Apps host bridge events (`window.openai.*`
 *      from the OpenAI Apps SDK shim, which is what M365 Copilot exposes
 *      to widgets today \u2014 see
 *      https://learn.microsoft.com/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets#supported-capabilities)
 *      and forwards the tool's `userQuery` arg to the SWA via postMessage.
 *
 * The SWA listens for that postMessage on its `main.ts` and auto-sends the
 * query as the user's first message as soon as the Copilot Studio
 * conversation is open. This eliminates the "now retype your question"
 * round-trip the user would otherwise experience.
 */

export interface WidgetHtmlOptions {
  swaOrigin: string;
  agentName: string;
}

const POSTMESSAGE_TYPE = 'mcsmcpapps:firstMessage';

export function renderWidgetHtml(opts: WidgetHtmlOptions): string {
  const { swaOrigin, agentName } = opts;
  const safeName = escapeHtml(agentName);
  const safeOrigin = escapeAttr(swaOrigin);
  // Note: keep the inline script free of </script tags. It runs inside
  // the Microsoft-managed widget iframe at *.widget-renderer....
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeName}</title>
    <style>
      html, body { height: 100%; width: 100%; margin: 0; padding: 0; background: var(--color-background-primary, #fff); }
      iframe { height: 100%; width: 100%; border: 0; display: block; }
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

        // Inner SPA tells us when it's ready to receive a first message.
        window.addEventListener('message', function (e) {
          if (e.origin !== swaOrigin) return;
          if (e.data && e.data.type === 'mcsmcpapps:ready') {
            iframeReady = true;
            flush();
          }
        });

        // Direct read of the OpenAI Apps SDK toolInput shim (M365 Copilot's
        // current bridge). Available the moment the script runs.
        try {
          var t = (window).openai && (window).openai.toolInput;
          if (t && typeof t.userQuery === 'string' && t.userQuery.length > 0) {
            pendingQuery = t.userQuery;
            flush();
          }
        } catch (e) { /* ignore */ }

        // Subsequent tool result delivery (some hosts deliver via callbacks).
        function readUserQuery(payload) {
          if (!payload) return null;
          if (typeof payload.userQuery === 'string') return payload.userQuery;
          if (payload.structuredContent && typeof payload.structuredContent.userQuery === 'string') {
            return payload.structuredContent.userQuery;
          }
          if (payload._meta && payload._meta.mcsmcpapps && typeof payload._meta.mcsmcpapps.userQuery === 'string') {
            return payload._meta.mcsmcpapps.userQuery;
          }
          return null;
        }

        try {
          if ((window).openai) {
            // OpenAI Apps SDK style.
            (window).openai.onToolResult = function (r) {
              var q = readUserQuery(r);
              if (q) { pendingQuery = q; flush(); }
            };
          }
        } catch (e) { /* ignore */ }

        try {
          if ((window).app && typeof (window).app.ontoolinput === 'function') {
            // MCP Apps SDK alt name.
            (window).app.ontoolinput = function (input) {
              var q = readUserQuery(input);
              if (q) { pendingQuery = q; flush(); }
            };
          }
        } catch (e) { /* ignore */ }
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
