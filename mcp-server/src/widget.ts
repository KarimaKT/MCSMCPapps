/**
 * Builds the HTML widget served as a UI resource.
 *
 * The widget is a single-purpose iframe wrapping the Static Web App. The SPA
 * inside it owns the entire chat surface (auth, transport, rendering). The
 * MCP server's job is only to point Copilot at the right URL and provide the
 * CSP envelope.
 *
 * We keep this file plain string-template to avoid a build step on the
 * server side beyond TypeScript compilation.
 */

export interface WidgetHtmlOptions {
  swaOrigin: string;
  agentName: string;
}

export function renderWidgetHtml(opts: WidgetHtmlOptions): string {
  const { swaOrigin, agentName } = opts;
  // Escape to keep any unusual characters in the agent name from breaking
  // either the HTML or the JS string contexts.
  const safeName = escapeHtml(agentName);
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
      src="${escapeAttr(swaOrigin)}/"
      title="${safeName}"
      allow="clipboard-write; microphone; camera"
      referrerpolicy="strict-origin-when-cross-origin"
    ></iframe>
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
