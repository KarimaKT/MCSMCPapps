/**
 * MCSMCPapps MCP server.
 *
 * One McpServer per session, one StreamableHTTPServerTransport per session,
 * keyed by `mcp-session-id`. This is the standard MCP HTTP pattern and the
 * one M365 Copilot's MCP client expects.
 *
 * Recovery semantics:
 *   - Unknown session-id => 404 with "Session not found", which tells a
 *     well-behaved client (including M365 Copilot) to drop the session and
 *     re-initialize. This makes container restarts and scale events
 *     transparent: the next call after a restart triggers a fresh
 *     initialize on the new instance, and the conversation continues.
 *   - Init request without a session-id => create new transport+server,
 *     hand back the new session-id in the response header.
 *
 * Tool surface:
 *   - openCopilotStudioChat(userQuery?) returns a UI resource link plus
 *     structuredContent.userQuery + _meta.mcsmcpapps.userQuery, so the
 *     widget can pick up the user's first prompt off any of the host
 *     bridge surfaces (OpenAI Apps SDK shim, MCP Apps SDK shim) and post
 *     it to the embedded SWA. The SWA queues it and auto-sends as the
 *     first user message the moment the Copilot Studio conversation
 *     opens \u2014 no retype.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
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
        // OpenAI Apps SDK compatibility alias — this is what M365 Copilot
        // actually reads today to know which UI template to load.
        'openai/outputTemplate': UI_RESOURCE_URI,
        // MCP Apps spec name — forward-compat for hosts that adopt MCP Apps.
        ui: {
          resourceUri: UI_RESOURCE_URI,
          preferredDisplayMode: 'inline'
        },
        // Status text shown by the host while the tool is running.
        'openai/toolInvocation/invoking': `Opening ${config.agentName}…`,
        'openai/toolInvocation/invoked': `${config.agentName} ready.`
      }
    },
    async (args) => {
      const userQuery =
        typeof args?.userQuery === 'string' ? args.userQuery : '';
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
  // MIME type MUST be exactly 'text/html;profile=mcp-app' — this is the
  // signal that tells the M365 Copilot / ChatGPT widget host to actually
  // render the HTML and enable the MCP Apps UI bridge. Anything else
  // (including plain text/html) results in a blank card.
  server.registerResource(
    'chat-widget',
    UI_RESOURCE_URI,
    {
      title: `${config.agentName} \u2014 widget`,
      description: 'HTML widget that hosts the Copilot Studio WebChat.',
      mimeType: 'text/html;profile=mcp-app',
      _meta: {
        ui: {
          domain: new URL(config.swaOrigin).origin,
          prefersBorder: true,
          csp: {
            connectDomains: [
              new URL(config.swaOrigin).origin,
              'https://*.api.powerplatform.com',
              'https://login.microsoftonline.com'
            ],
            resourceDomains: [new URL(config.swaOrigin).origin],
            // REQUIRED: our widget iframes the SWA, so the SWA origin
            // must be on the frame allowlist. Without this, sub-iframes
            // are blocked by the sandbox by default.
            frameDomains: [new URL(config.swaOrigin).origin]
          }
        }
      }
    },
    async () => ({
      contents: [
        {
          uri: UI_RESOURCE_URI,
          mimeType: 'text/html;profile=mcp-app',
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

/**
 * Active transports keyed by mcp-session-id. The transport owns the session
 * id and the response-stream lifecycle; the server is wired into the
 * transport once at create time and cleaned up on transport close.
 */
const transports = new Map<string, StreamableHTTPServerTransport>();

app.get('/', (_req: Request, res: Response) => {
  res
    .type('text/plain')
    .send(
      `MCSMCPapps MCP server\n` +
        `agentName: ${config.agentName}\n` +
        `swaOrigin: ${config.swaOrigin}\n` +
        `endpoint:  POST /mcp\n` +
        `active sessions: ${transports.size}\n`
    );
});

async function dispatch(req: Request, res: Response): Promise<void> {
  const sessionId = req.header('mcp-session-id');

  // Existing session.
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session: only allowed on initialize.
  if (!sessionId && isInitializeRequest(req.body)) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      }
    });
    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId);
      }
    };
    const server = buildServer(config);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Unknown session-id (e.g., after a container restart) or non-init
  // without a session-id. Tell the client to drop and re-initialize.
  res.status(404).json({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message:
        'Session not found. Please send an initialize request to start a new session.'
    },
    id: req.body?.id ?? null
  });
}

app.post('/mcp', async (req: Request, res: Response) => {
  try {
    await dispatch(req, res);
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

// GET = SSE channel for server-initiated messages.
app.get('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.header('mcp-session-id');
  if (!sessionId || !transports.has(sessionId)) {
    res.status(404).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session not found.' },
      id: null
    });
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
});

// DELETE = explicit session close.
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.header('mcp-session-id');
  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res);
    return;
  }
  res.status(204).end();
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
