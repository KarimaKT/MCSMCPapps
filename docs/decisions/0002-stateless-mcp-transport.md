# ADR 0002 — stateless MCP transport (no session map)

| Field | Value |
|---|---|
| Status | accepted (live in main since commit `8abdffc`) |
| Date | 2026-05-03 |
| Deciders | engineering agent |
| Related spec | — (corrective; no prior spec) |

## Context

The MCP server originally tracked transports keyed by `mcp-session-id` so that each `initialize` request created a session, subsequent requests on the same session id were routed to the same transport, and `404 Session not found` recovery told clients to re-init.

Empirical observation: against the live App Service deployment, `initialize` returned 200 with a session id, then `notifications/initialized` (the very next request from the host) returned 404 "Session not found". Every follow-up call hit the same 404 → host abandoned the tool call → user saw "Something went wrong".

Root cause: with `enableJsonResponse: true`, the SDK closes the response stream right after sending the init reply. That fires `transport.onclose`, which removed the session from our map BEFORE the next request arrived. A race we couldn't fix by adjusting timing.

Microsoft's reference samples (`mcp-interactiveUI-samples`: trey-research, fieldops, zava-insurance, approvals-box) all use stateless transport: a fresh `Server` + `StreamableHTTPServerTransport` per HTTP request, closed when the response stream closes.

## Decision

**MCP server uses stateless Streamable HTTP transport.** Each `/mcp` POST builds a fresh `McpServer` + transport, processes the one request, then closes both.

## Consequences

Easier:
- No session-not-found races
- Container restarts and scale-out events are transparent to clients
- Matches all four MS reference samples

Harder:
- Each request constructs an `McpServer` (sub-millisecond JS object wiring; not actual I/O — measured negligible)
- AsyncLocalStorage doesn't reliably propagate to the SDK's internal awaits, so per-request auth context uses a module-level fallback variable cleared on response close (auth.ts)

## Alternatives considered

- **Pre-create one `McpServer` at startup, share across requests with stateless transport** — failed: SDK enforces init handshake at the McpServer instance level, second request fails "Server not initialized." Rejected.
- **Keep session map, fix the close race with `setImmediate`** — fragile; trey-research authors went stateless for the same reason. Rejected.
