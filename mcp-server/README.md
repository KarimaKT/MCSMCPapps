# MCP server

Anonymous MCP server that exposes a single tool, `openCopilotStudioChat`, linked to a UI resource that wraps the Static Web App. When Microsoft 365 Copilot's Declarative Agent invokes the tool, Copilot fetches the resource and renders it as a sandboxed widget.

This server is intentionally tiny:

- One tool (`openCopilotStudioChat`)
- One UI resource (`ui://mcsmcpapps/chat`)
- No conversation state — the SPA inside the widget owns it
- No identity — anonymous; the SPA inside the widget enforces Entra SSO at the chat boundary

See [`docs/AUTH-ARCHITECTURE.md`](../docs/AUTH-ARCHITECTURE.md) for why anonymous MCP plus authenticated chat is the right starting topology.

## Files

| Path | Purpose |
|---|---|
| `src/index.ts` | Express + MCP `StreamableHTTPServerTransport` host. |
| `src/widget.ts` | HTML template that iframes the SWA. |
| `src/config.ts` | Reads `SWA_ORIGIN`, `AGENT_NAME`, `AGENT_DESCRIPTION`, `PORT` from env. |
| `.env.example` | Template for local config. |

## Run locally

```powershell
cd mcp-server
Copy-Item .env.example .env
notepad .env   # fill in SWA_ORIGIN at minimum
npm install
npm run dev
# visit http://localhost:3000/ for a health page
```

You can hit the MCP endpoint directly with `curl` or test via the [MCP Inspector](https://www.npmjs.com/package/@modelcontextprotocol/inspector):

```powershell
npx @modelcontextprotocol/inspector
# point it at http://localhost:3000/mcp
```

## Deploy to Azure (planned)

Phase 5b will provision an Azure Function or App Service for this server. See [`docs/BUILD-GUIDE.md` Phase 5](../docs/BUILD-GUIDE.md) once written.

## Configure on Microsoft 365 Copilot

After deploying, the **Microsoft 365 Agents Toolkit** scaffolds a Declarative Agent that points at this server. The DA manifest lives in [`../declarative-agent/`](../declarative-agent/) (planned).

## Adding more tools later

This server keeps the surface deliberately minimal. To add more tools (e.g. `openSettings`, `showDashboard`):

1. Register a new tool with `server.registerTool(name, config, cb)`.
2. If the tool needs its own widget, register a UI resource with a unique `ui://` URI and link the tool to it via `_meta.ui.resourceUri`.
3. Update the DA manifest to advertise the new tool name.
