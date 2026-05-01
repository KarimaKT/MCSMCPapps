# MCSMCPapps — Embed a Copilot Studio agent in Microsoft 365 Copilot

> **Status:** 🚧 First-try / experimental pattern. Phase 1 (scaffold) complete. See [docs/PROGRESS.md](docs/PROGRESS.md) for current state.

A reference implementation that embeds a **Microsoft Copilot Studio (MCS) agent** inside **Microsoft 365 Copilot** using a 3-piece launcher pattern — giving the agent a long-running, custom WebChat surface inside the M365 Copilot pane.

```text
User ▶ M365 Copilot ▶ Declarative Agent (launcher) ▶ MCP App (HTML host) ▶ WebChat UI ▶ Copilot Studio Agent
```

## Why this exists

Microsoft 365 Copilot's built-in chat surface enforces LLM-driven turn timeouts and message-shape constraints that interfere with **long-running** Copilot Studio workflows. By using a Declarative Agent as a *launcher only* and rendering the actual conversation inside an **MCP App** iframe, you get:

- ✅ Long-running conversations (no per-turn timeout from the host LLM)
- ✅ Direct line to your Copilot Studio agent — no LLM-in-the-middle reinterpretation
- ✅ Full WebChat UX (typing indicators, adaptive cards, attachments)
- ✅ Single-purpose Declarative Agent — coexists with anything else in your M365 tenant
- ✅ SSO with the signed-in M365 user (see [Authentication](#authentication))

## Repo layout

| Path | Purpose |
|---|---|
| [webchat-ui/](webchat-ui/) | Vite + Bot Framework Web Chat UI; connects to your Copilot Studio agent via Direct Line. |
| [mcp-app/](mcp-app/) | MCP App tool definition. Returns the MCP App payload that points to the hosted WebChat URL. |
| [declarative-agent/](declarative-agent/) | M365 Declarative Agent manifest. Single-purpose launcher that calls the MCP App tool. |
| [infra/](infra/) | Bicep + GitHub Actions for hosting the static WebChat UI on Azure Static Web Apps. |
| [skills/mcp-app-launcher/](skills/mcp-app-launcher/) | A Copilot Studio skill that helps **other agent builders** apply this pattern. |
| [docs/](docs/) | [BUILD-GUIDE.md](docs/BUILD-GUIDE.md) (manual / no-AI walkthrough) and [PROGRESS.md](docs/PROGRESS.md). |
| [Resources/](Resources/) | Source design docs (the original implementation guide). |

## Quick start (consumer)

> ⚠️ Prerequisites: Node 20+, Azure subscription, an existing Copilot Studio agent, M365 tenant where you can sideload a Declarative Agent.

```powershell
# 1. Clone
git clone https://github.com/KarimaKT/MCSMCPapps.git
cd MCSMCPapps

# 2. Configure your Copilot Studio agent IDs
cp webchat-ui/.env.example webchat-ui/.env
# edit .env:  VITE_CS_BOT_ID, VITE_CS_TENANT_ID, VITE_CS_ENVIRONMENT_ID

# 3. Run the WebChat UI locally to verify the connection
cd webchat-ui
npm install
npm run dev
# open http://localhost:5173 — should connect to your CS agent

# 4. Deploy the WebChat UI to Azure Static Web Apps
#    (see docs/BUILD-GUIDE.md §4)

# 5. Update mcp-app/openCopilotStudioChat.json with your SWA URL.

# 6. Package & sideload the Declarative Agent via the M365 Agents Toolkit
#    (see docs/BUILD-GUIDE.md §6)
```

## Authentication

The embedded WebChat tries three SSO strategies in order:

1. **Teams JS SSO** (`microsoftTeams.authentication.getAuthToken`) — silent, used when the MCP App host exposes the Teams JS bridge.
2. **MSAL.js silent acquisition** — silent if the user is already signed into M365 in the same browser session.
3. **Copilot Studio "Authenticate with Microsoft" topic** — fallback; user clicks a one-time login card inside the chat.

Configure your CS agent for **Manual Entra (Microsoft) authentication** so it can validate the bearer token. See [docs/BUILD-GUIDE.md §7](docs/BUILD-GUIDE.md) for app registration steps.

## Components & responsibilities

| Component | Job | Lives in |
|---|---|---|
| **Declarative Agent** | Recognises a launch phrase ("open my agent"), calls one tool — that's it. | M365 Copilot |
| **MCP App tool** | Returns an `mcp_app` payload pointing at the hosted UI. | MCP server (this repo) |
| **WebChat UI** | Renders Bot Framework Web Chat, authenticates the user, opens a Direct Line conversation with your CS agent. | Azure Static Web Apps |
| **Copilot Studio agent** | All reasoning, topics, actions, long-running flows. | Power Platform / Copilot Studio |

## Tenant topology

This pattern intentionally **spans two tenants** — there is no requirement that hosting and identity live together:

```text
Azure tenant                       M365 / CS tenant (e.g. CDX)
──────────────────────────       ────────────────────────────────
  Static Web App                     Copilot Studio agent
  (serves WebChat HTML+JS)           M365 Copilot host
                                     Entra app registration (for SSO)
                                     User identities
```

- The **Azure tenant** is just an HTTPS file host. Browsers fetch static assets cross-origin without auth.
- The **CS / M365 tenant** is where all auth happens — the Entra app registration, the user identities, and the CS agent's auth config all live here.
- The Entra **client ID + tenant ID** in `webchat-ui/.env` must point at the CS tenant, not the Azure tenant.

## Security notes

- The MCP App iframe is sandboxed by the Copilot host. Treat it as an untrusted boundary.
- Never put secrets (client secrets, Direct Line keys) in the WebChat bundle. Use a token broker (Azure Function) — see [docs/BUILD-GUIDE.md §7.2](docs/BUILD-GUIDE.md).
- The Direct Line **secret** must stay server-side. The browser only ever receives short-lived **Direct Line tokens** scoped to a single conversation.
- App registration redirect URIs must include the SWA hostname plus `https://*.cloud.microsoft` (Copilot iframe origin) — confirm exact origin during testing.

## Building this without AI assistance

Follow [docs/BUILD-GUIDE.md](docs/BUILD-GUIDE.md). It contains every command, file, portal click, and verification step needed to reproduce this project from an empty machine.

## Contributing & feedback

This is a first-try pattern. PRs welcome — especially edge cases around MCP App host capabilities, CS agent auth modes, and Copilot iframe origins.

## License

MIT — see [LICENSE](LICENSE).
