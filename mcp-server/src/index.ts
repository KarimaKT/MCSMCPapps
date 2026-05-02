/**
 * MCSMCPapps MCP server.
 *
 * Exposes a single tool, `openCopilotStudioChat`, which is linked to a UI
 * resource (`ui://mcsmcpapps/chat`). When Microsoft 365 Copilot calls the
 * tool, it fetches the UI resource and renders the HTML in a sandboxed
 * widget iframe. The HTML in turn iframes our Static Web App (the WebChat).
 *
 * The chat surface is owned entirely by the SWA \u2014 this server does not
 * carry conversation state, identity, or rendering logic.
 *
 * Auth: anonymous in development. The chat itself enforces Entra SSO at the
 * browser-to-Copilot Studio boundary, regardless of MCP-server auth. See
 * docs/AUTH-ARCHITECTURE.md for the full breakdown.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { loadConfig, type ServerConfig } from './config.js';
import { renderWidgetHtml } from './widget.js';

const UI_RESOURCE_URI = 'ui://mcsmcpapps/chat';

function buildServer(config: ServerConfig): McpServer {
  const server = new McpServer(
    {
      name: 'mcsmcpapps',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      },
      instructions:
        'Single-purpose MCP server. Call openCopilotStudioChat to ' +
        'render the embedded Copilot Studio chat surface.'
    }
  );

  // ----- Tool: openCopilotStudioChat -----
  // Linked to the UI resource via _meta.ui.resourceUri (MCP Apps spec).
  server.registerTool(
    'openCopilotStudioChat',
    {
      title: config.agentName,
      description: config.agentDescription,
      annotations: {
        readOnlyHint: true,
        title: config.agentName
      },
      _meta: {
        ui: {
          resourceUri: UI_RESOURCE_URI,
          // Permitted display modes for this widget. The host decides which
          // to honor; we accept inline (default) and fullscreen.
          // Note: schema names per the MCP Apps SDK spec.
          preferredDisplayMode: 'inline'
        }
      }
    },
    async () => {
      // The tool result must include both `content` (text the model can
      // reason over) and the link to the UI resource. The host renders the
      // resource; the text is for the model's context only.
      return {
        content: [
          {
            type: 'text',
            text: `Opened embedded chat for ${config.agentName}.`
          }
        ]
      };
    }
  );

  // ----- UI resource: the widget HTML -----
  server.registerResource(
    'chat-widget',
    UI_RESOURCE_URI,
    {
      title: `${config.agentName} \u2014 widget`,
      description: 'HTML widget that hosts the Copilot Studio WebChat.',
      mimeType: 'text/html',
      _meta: {
        ui: {
          // CSP declarations: domains the widget needs to talk to so the
          // host can sandbox it appropriately.
          csp: {
            connectDomains: [
              new URL(config.swaOrigin).origin,
              'https://*.api.powerplatform.com',
              'https://login.microsoftonline.com'
            ],
            resourceDomains: [new URL(config.swaOrigin).origin]
          }
        }
      }
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: 'text/html',
          text: renderWidgetHtml({
            swaOrigin: config.swaOrigin,
            agentName: config.agentName
          })
        }
      ]
    })
  );

  return server;
}

// ---------------------------- HTTP host ----------------------------

const config = loadConfig();
const app = express();
app.use(express.json());

// Root health check so the maker knows the function is up.
app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send(
    `MCSMCPapps MCP server\n` +
      `agentName: ${config.agentName}\n` +
      `swaOrigin: ${config.swaOrigin}\n` +
      `endpoint:  POST /mcp\n`
  );
});

// One MCP server per HTTP session. Streamable HTTP supports stateless
// per-request servers, but per-session is simpler and matches the spec.
const sessions = new Map<string, StreamableHTTPServerTransport>();

app.post('/mcp', async (req: Request, res: Response) => {
  const sessionIdHeader = req.headers['mcp-session-id'];
  const sessionId =
    typeof sessionIdHeader === 'string' ? sessionIdHeader : undefined;

  let transport = sessionId ? sessions.get(sessionId) : undefined;

  if (!transport) {
    // New session.
    const newId = sessionId ?? randomUUID();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newId
    });
    sessions.set(newId, transport);
    transport.onclose = () => {
      sessions.delete(newId);
    };
    const server = buildServer(config);
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

// Streamable HTTP also uses GET (SSE) and DELETE (close).
app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'];
  if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
    res.status(400).send('Missing or unknown mcp-session-id');
    return;
  }
  await sessions.get(sessionId)!.handleRequest(req, res);
});
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'];
  if (typeof sessionId !== 'string' || !sessions.has(sessionId)) {
    res.status(400).send('Missing or unknown mcp-session-id');
    return;
  }
  await sessions.get(sessionId)!.handleRequest(req, res);
});

const port = config.port;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[mcsmcpapps-mcp-server] listening on :${port}\n` +
      `  agentName: ${config.agentName}\n` +
      `  swaOrigin: ${config.swaOrigin}\n` +
      `  POST /mcp  (Streamable HTTP)\n`
  );
});
