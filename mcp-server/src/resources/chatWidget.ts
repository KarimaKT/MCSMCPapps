/**
 * Resource: `ui://mcsmcpapps/chat`
 *
 * The widget HTML returned by `resources/read`. M365 Copilot's
 * RemoteMCPServer client mounts this HTML in its skybridge sandbox iframe
 * when the host model calls `openCopilotStudioChat`.
 *
 * # Contract — read [docs/MCP-APPS-CONTRACT.md] for the full story
 *
 *   - **MIME** must be exactly `text/html+skybridge`. Plain `text/html`,
 *     `text/html;profile=mcp-app`, etc. produce a blank card with no
 *     diagnostic.
 *   - **`_meta`** must contain `openai/outputTemplate` + `widgetAccessible`
 *     on BOTH the descriptor and the `contents[0]` entry.
 *   - **`_meta.ui.csp`** declares the network capabilities of the sandbox.
 *     `connectDomains` are fetch / WebSocket targets. `frameDomains` is
 *     only needed if the widget itself iframes another origin (which the
 *     v1 design avoids — we bundle single-file).
 *
 * # The HTML body
 *
 * In v0.5 we still serve an iframe shell pointing at the Static Web App.
 * In v0.6 this is replaced by the inlined React bundle from
 * `webchat-ui/dist-widget/widget.html` so the widget reliably mounts in
 * the skybridge sandbox.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerConfig } from '../config.js';
import { renderWidgetHtml } from '../widget.js';

/** Stable URI used by the tool's `openai/outputTemplate` and `ui.resourceUri`. */
export const UI_RESOURCE_URI = 'ui://mcsmcpapps/chat';

/**
 * MIME type the M365 Copilot / ChatGPT Apps SDK iframe runtime ("skybridge")
 * recognizes as a renderable widget. Plain `text/html` is silently dropped.
 * Verified against Microsoft's reference at
 * github.com/microsoft/mcp-interactiveUI-samples (oai-apps-sdk samples).
 */
export const WIDGET_MIME_TYPE = 'text/html+skybridge';

/**
 * Build the `_meta` block for the resource descriptor and `contents[0]`.
 * Mirrors the tool descriptor `_meta` (see tools/openCopilotStudioChat.ts)
 * and adds the CSP allowlists the sandbox needs.
 *
 * # CSP shape (v0.6 single-file widget)
 *
 *   - `connectDomains` — fetch / WebSocket targets the widget calls:
 *       - Power Platform API (CS Direct Engine)
 *       - login.microsoftonline.com (MSAL)
 *       - the SWA origin (only used for the standalone channel; harmless
 *         here)
 *   - `resourceDomains` — static asset hosts. Empty in v0.6 because the
 *     bundle inlines all assets via vite-plugin-singlefile.
 *   - `frameDomains` — empty in v0.6. The widget is a single self-contained
 *     HTML; it does not iframe any external origin. Dropping `frameDomains`
 *     also lowers OpenAI Apps SDK review scrutiny (their docs explicitly
 *     discourage embedding sub-iframes).
 */
export function buildResourceMeta(
  config: ServerConfig
): Record<string, unknown> {
  const swaOrigin = new URL(config.swaOrigin).origin;

  return {
    'openai/outputTemplate': UI_RESOURCE_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': `Opening ${config.agentName}\u2026`,
    'openai/toolInvocation/invoked': `${config.agentName} ready.`,
    ui: {
      // `domain` is required for the host's "fullscreen punch-out" UI.
      // Use the SWA origin as the canonical domain for this widget.
      domain: swaOrigin,
      prefersBorder: true,
      csp: {
        connectDomains: [
          'https://*.api.powerplatform.com',
          'https://login.microsoftonline.com',
          swaOrigin
        ],
        resourceDomains: [],
        // No iframes inside the widget. Single-file bundle.
        frameDomains: []
      }
    }
  };
}

export function registerChatWidgetResource(
  server: McpServer,
  config: ServerConfig
): void {
  const meta = buildResourceMeta(config);

  server.registerResource(
    'chat-widget',
    UI_RESOURCE_URI,
    {
      title: `${config.agentName} \u2014 widget`,
      description: 'HTML widget that hosts the Copilot Studio WebChat.',
      mimeType: WIDGET_MIME_TYPE,
      _meta: meta
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: WIDGET_MIME_TYPE,
          text: renderWidgetHtml({
            swaOrigin: config.swaOrigin,
            agentName: config.agentName
          }),
          // Microsoft's reference attaches the same _meta on contents[0]
          // (not just the descriptor). Some host versions read it from
          // here.
          _meta: meta
        }
      ]
    })
  );
}
