/**
 * MCSMCPapps MCP server (stateless).
 *
 * Per request, we build a fresh `McpServer`, hand it a one-shot transport,
 * and let it answer that single JSON-RPC call. No session map, no shared
 * state between requests. Two consequences:
 *
 *   1. Container restarts / scale events never invalidate a session.
 *      Copilot's next `tools/call` succeeds without retry.
 *   2. There is nothing to leak between users \u2014 each request is a fresh
 *      `McpServer` instance with no context.
 *
 * Latency: building the server + transport + handler is sub-millisecond
 * once the Node process is warm. App Service B1 with `alwaysOn=true`
 * keeps it warm.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { loadConfig, type ServerConfig } from './config.js';
import { renderWidgetHtml } from './widget.js';

const UI_RESOURCE_URI = 'ui://mcsmcpapps/chat';

function buildServer(config: ServerConfig): McpServer {
  const server = new McpServer(
    { name: 'mcsmcpapps', version: '0.2.0' },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        'Single-purpose MCP server. Call openCopilotStudioChat to ' +
        'render the embedded Copilot Studio chat surface. ' +
        'Always pass userQuery so the chat can answer immediately ' +
        'without waiting for the user to retype.'
    }
  );

  // ----- Tool: openCopilotStudioChat -----
  // Linked to the UI resource via _meta.ui.resourceUri (MCP Apps spec).
  // userQuery lets us forward the user's first prompt into the widget so
  // the chat can fire it at Copilot Studio as soon as the connection is
  // open, eliminating the "now I have to retype my question" round-trip.
  server.registerTool(
    'openCopilotStudioChat',
    {
      title: config.agentName,
      description:
        `Open the embedded ${config.agentName} chat. ` +
        'IMPORTANT: pass the user\u2019s exact question as `userQuery` ' +
        'so the chat can start answering immediately. The chat surface ' +
        'inside the widget owns the conversation; you must not summarize ' +
        'or paraphrase its output.',
      inputSchema: {
        userQuery: z
          .string()
          .optional()
          .describe(
            'The user\u2019s exact text. Pass verbatim; the embedded ' +
              'chat will treat it as the first user message.'
          )
      },
      annotations: {
        readOnlyHint: true,
        title: config.agentName
      },
      _meta: {
        ui: {
          resourceUri: UI_RESOURCE_URI,
          preferredDisplayMode: 'inline'
        }
      }
    },
    async (args) => {
      const userQuery =
        typeof args?.userQuery === 'string' ? args.userQuery : '';
      // The text content is for the host LLM\u2019s context only \u2014 the widget
      // takes over the response surface. structuredContent + _meta carry the
      // userQuery so the widget can read it via the MCP Apps host bridge
      // (window.openai.toolInput / app.ontoolinput).
      return {
        content: [
          {
            type: 'text',
            text: `Embedded chat opened. The widget will handle: \"${userQuery.slice(0, 200)}\"`
          }
        ],
        structuredContent: { userQuery },
        _meta: { mcsmcpapps: { userQuery } }
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
app.use(express.json({ limit: '1mb' }));

// Root health check.
app.get('/', (_req: Request, res: Response) => {
  res
    .type('text/plain')
    .send(
      `MCSMCPapps MCP server (stateless)\n` +
        `agentName: ${config.agentName}\n` +
        `swaOrigin: ${config.swaOrigin}\n` +
        `endpoint:  POST /mcp\n`
    );
});

/**
 * Stateless POST /mcp handler.
 * Each request gets its own server + transport pair, used once, then closed.
 * No session id is honored or returned (`sessionIdGenerator: undefined`).
 */
app.post('/mcp', async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  const server = buildServer(config);
  // Best-effort cleanup when the response ends.
  res.on('close', () => {
    void server.close().catch(() => {});
    void transport.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mcp] POST handler failed', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal MCP server error' },
        id: req.body?.id ?? null
      });
    }
  }
});

// In stateless mode the SDK still expects to handle GET (SSE channel) and
// DELETE (close) gracefully. They have nothing to do, so respond 405.
app.get('/mcp', (_req: Request, res: Response) => {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method Not Allowed. Stateless server: use POST /mcp.'
      },
      id: null
    });
});
app.delete('/mcp', (_req: Request, res: Response) => {
  res.status(204).end();
});

const port = config.port;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[mcsmcpapps-mcp-server] listening on :${port} (stateless)\n` +
      `  agentName: ${config.agentName}\n` +
      `  swaOrigin: ${config.swaOrigin}\n` +
      `  POST /mcp  (Streamable HTTP, JSON response)\n`
  );
});
