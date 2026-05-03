/**
 * MCSMCPapps MCP server — HTTP host (stateless transport).
 *
 * This file owns the network surface only:
 *   - Express setup, routes, JSON parsing
 *   - **Stateless** Streamable HTTP transport: a fresh `McpServer` +
 *     `StreamableHTTPServerTransport` per request, closed when the
 *     response stream closes.
 *
 * Tools and resources live in `tools/` and `resources/` — adding a new
 * tool does NOT require touching this file.
 *
 * # Why stateless
 *
 * The session-keyed pattern (track sessions in a Map, recover with 404
 * "Session not found") works for some clients but fails for M365 Copilot:
 * with `enableJsonResponse: true` the SDK closes the response stream
 * immediately after the init reply, which fires `transport.onclose`
 * before our `onsessioninitialized` callback completes. The next request
 * arrives with a session id that's already been removed from the map and
 * gets a 404. The host gives up the tool call.
 *
 * Microsoft's reference samples (oai-apps-sdk/trey-research, fieldops,
 * zava-insurance, approvals-box) all use the stateless pattern: build a
 * fresh `Server` per request. We do the same with `McpServer`.
 *
 * # State concerns (none, in our case)
 *
 * Construction of the `McpServer` is sub-millisecond — it's just function
 * registrations. The widget HTML is read once at module-load time and
 * cached (`widget.ts`). The Copilot Studio conversation lives entirely
 * inside the widget via the OOB SDK; nothing about it goes through MCP.
 *
 * # CORS for skybridge sandboxes
 *
 * M365 Copilot's RemoteMCPServer client calls us from the host turn
 * processor (server-to-server, no Origin header). The widget itself is
 * sandboxed with a `null` origin; if it ever calls back to us, browsers
 * send `Origin: null`. We mirror MS's reference and treat `null` and
 * missing Origin as allowed.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import cors, { type CorsOptions } from 'cors';
import express, { type Request, type Response } from 'express';
import { entraAuthMiddleware, loadEntraConfig } from './auth.js';
import { loadConfig } from './config.js';
import { buildServer, SERVER_NAME, SERVER_VERSION } from './server.js';

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const config = loadConfig();
const entra = loadEntraConfig();
const app = express();

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Sandboxed iframes (M365 Copilot skybridge, ChatGPT Apps) send
    // `null` as the origin. Server-to-server callers (the host turn
    // processor) send no Origin header at all. Both are valid here.
    if (!origin || origin === 'null') {
      callback(null, origin ?? true);
      return;
    }
    callback(null, origin);
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'Mcp-Session-Id',
    'mcp-session-id',
    'Mcp-Protocol-Version',
    'mcp-protocol-version',
    'Last-Event-ID'
  ],
  exposedHeaders: ['Mcp-Session-Id'],
  credentials: false
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Entra SSO auth — no-op when env vars (`ENTRA_AUDIENCE`,
// `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`) are unset. See `auth.ts`.
const entraAuth = entraAuthMiddleware(entra);

// ---------------------------------------------------------------------------
// Health endpoint (no MCP)
// ---------------------------------------------------------------------------

app.get('/', (_req: Request, res: Response) => {
  res.type('text/plain').send(
    [
      `${SERVER_NAME} v${SERVER_VERSION}`,
      `agentName: ${config.agentName}`,
      `swaOrigin: ${config.swaOrigin}`,
      `endpoint:  POST /mcp (stateless)`
    ].join('\n')
  );
});

// ---------------------------------------------------------------------------
// MCP — stateless: fresh server + transport per request
// ---------------------------------------------------------------------------

async function dispatch(req: Request, res: Response): Promise<void> {
  const server = buildServer(config);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true // return JSON instead of SSE
  });

  res.on('close', () => {
    transport.close().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[mcp] transport.close failed', err);
    });
    server.close().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[mcp] server.close failed', err);
    });
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

app.post('/mcp', entraAuth, async (req: Request, res: Response) => {
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

// GET /mcp — clients may probe or open a server→client SSE stream. In
// stateless mode we let the transport answer with the protocol-correct
// response (typically 405 Method Not Allowed for our setup).
app.get('/mcp', entraAuth, async (req: Request, res: Response) => {
  try {
    await dispatch(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mcp] GET handler failed', err);
    if (!res.headersSent) {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
      });
    }
  }
});

// DELETE /mcp — stateless: no per-server state to delete; let the
// transport answer.
app.delete('/mcp', entraAuth, async (req: Request, res: Response) => {
  try {
    await dispatch(req, res);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mcp] DELETE handler failed', err);
    if (!res.headersSent) {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
      });
    }
  }
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
      `  POST /mcp  (stateless Streamable HTTP)`,
      `  Entra SSO: ${entra ? 'ENABLED (audience=' + entra.audience + ')' : 'disabled (anonymous)'}`
    ].join('\n')
  );
});
