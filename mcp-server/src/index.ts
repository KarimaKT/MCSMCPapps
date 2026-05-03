/**
 * MCSMCPapps MCP server — HTTP host.
 *
 * This file owns the network surface only:
 *   - Express setup, routes, JSON parsing
 *   - MCP session management (Streamable HTTP transport, mcp-session-id header)
 *   - Recovery semantics (404 "Session not found" tells clients to re-init)
 *
 * Tools and resources live in `tools/` and `resources/` — adding a new tool
 * does NOT require touching this file.
 *
 * # Recovery semantics
 *
 *   - Unknown session-id => 404 with JSON-RPC error -32001 "Session not
 *     found". Well-behaved MCP clients (M365 Copilot included) drop the
 *     session and re-initialize. This makes container restarts and scale
 *     events transparent: the next call after a restart triggers a fresh
 *     `initialize` on the new instance and the conversation continues.
 *   - Init request without a session-id => create new transport+server,
 *     hand back the new session-id in the response header.
 *
 * # Why session-keyed and not stateless
 *
 * The MCP TS SDK enforces an init handshake at the `McpServer` instance
 * level. A truly stateless server (`sessionIdGenerator: undefined`) makes
 * each request build a fresh `McpServer`, which fails the second call
 * with "Bad Request: Server not initialized." See [docs/MCP-APPS-CONTRACT.md].
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { buildServer, SERVER_NAME, SERVER_VERSION } from './server.js';

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const config = loadConfig();
const app = express();
app.use(express.json({ limit: '1mb' }));

/**
 * Active transports keyed by `mcp-session-id`. The transport owns the
 * session id and the response-stream lifecycle; the `McpServer` is wired
 * into the transport once at create time and cleaned up on transport close.
 */
const transports = new Map<string, StreamableHTTPServerTransport>();

// ---------------------------------------------------------------------------
// Health endpoint (no MCP)
// ---------------------------------------------------------------------------

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send(
    [
      `${SERVER_NAME} v${SERVER_VERSION}`,
      `agentName: ${config.agentName}`,
      `swaOrigin: ${config.swaOrigin}`,
      `endpoint:  POST /mcp`,
      `active sessions: ${transports.size}`
    ].join('\n')
  );
});

// ---------------------------------------------------------------------------
// MCP dispatch
// ---------------------------------------------------------------------------

async function dispatch(req: Request, res: Response): Promise<void> {
  const sessionId = req.header('mcp-session-id');

  // Existing session: route to its transport.
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // New session: only allowed on `initialize` (per MCP HTTP spec).
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

// GET /mcp = SSE channel for server-initiated messages (e.g.
// `notifications/tools/list_changed`). Same session model as POST.
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

// DELETE /mcp = explicit session close.
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.header('mcp-session-id');
  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res);
    return;
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Listen
// ---------------------------------------------------------------------------

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    [
      `[${SERVER_NAME}] v${SERVER_VERSION} listening on :${config.port}`,
      `  agentName: ${config.agentName}`,
      `  swaOrigin: ${config.swaOrigin}`,
      `  POST /mcp  (Streamable HTTP)`
    ].join('\n')
  );
});
