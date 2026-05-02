# Final recipe — embed a Copilot Studio agent in Microsoft 365 Copilot

> The minimum viable recipe, distilled from the full project. If you start with these eight ingredients in this order, you ship.
>
> Lives next to: [BUILD-GUIDE.md](BUILD-GUIDE.md) (long-form), [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) (the trust diagram), [MAKER-CONFIG.md](MAKER-CONFIG.md) (rebrand workflow). Read those when you hit a thing.

## The 8 ingredients

| # | Ingredient | What it does |
|---|---|---|
| 1 | A Copilot Studio agent (Wave-2) | The actual brain. Your topics, knowledge, actions. |
| 2 | Entra app registration in the **CS tenant** | SPA platform; redirect URIs for the SWA + localhost; `Power Platform API → CopilotStudio.Copilots.Invoke` delegated permission, admin-consented. |
| 3 | Federated credential on the CS agent | Manual Entra auth → "Microsoft Entra ID V2 with federated credentials". No client secret to rotate. |
| 4 | Static Web App (Free SKU) | Hosts the WebChat SPA. Free, deploys via GitHub Actions. |
| 5 | The WebChat SPA | Vite + TS + `@microsoft/agents-copilotstudio-client` + `@azure/msal-browser`. Markdown + Adaptive Cards + suggested actions + image attachments. |
| 6 | Remote MCP server (App Service B1) | One tool `openCopilotStudioChat` linked to one UI resource that iframes the SWA. Anonymous auth in dev. |
| 7 | Declarative Agent (M365 Copilot) | Manifest with one action pointing at the MCP server. Sideloaded via the M365 Agents Toolkit. |
| 8 | Plugin manifest `v2.4` (NOT `v2.3`) | The runtime type `RemoteMCPServer` was introduced in `v2.4`. Using `v2.3` produces a contradictory "unrecognized member + required member missing" error. |

## The 12 commandments (lessons learned the hard way)

> Read these before you start; each one cost real time during this build.

| # | Commandment | The lesson |
|---|---|---|
| 1 | **Plugin manifest schema is `v2.4`** | `v2.3` does not define `RemoteMCPServer`. The validator's "unrecognized member" + "required member missing" pair both firing means "wrong schema version", not "wrong shape". |
| 2 | **`runtimes[0].type === 'RemoteMCPServer'`** (capital M, capital C, capital P, capital S) | Validator is case-sensitive. `McpServer` is not the right name. |
| 3 | **`runtime.url` lives under `runtime.spec.url`**, not at the runtime level | The `mcp-execution-spec` `$def` requires `url` inside `spec`. |
| 4 | **`runtime.run_for_functions` is required** with at least one element | Even with a single tool, you must list it. |
| 5 | **Teams app `version` must not start with `0`** | Tenant-catalog publish rejects `0.x.y`. Start at `1.0.0`. |
| 6 | **Power Platform API service principal must already exist in the CS tenant** | If the API permission picker doesn't show "Power Platform API", the SP is missing. Create it via Microsoft Graph PowerShell: `New-MgServicePrincipal -AppId 8578e004-a5c6-46e7-913e-12f58912df43 -DisplayName 'Power Platform API'`. |
| 7 | **The Power Platform API delegated scope is `CopilotStudio.Copilots.Invoke`** | Without it (admin-consented), every call returns 403 even with otherwise-valid SSO. |
| 8 | **Anonymous MCP is fine; the chat is still authenticated** | Two independent boundaries. Anonymous MCP only means anyone in the tenant who can reach the DA can fire the tool. The chat the tool returns enforces its own Entra SSO at the browser→CS link. |
| 9 | **Federated credentials beat client secrets** | Configure CS auth with "Microsoft Entra ID V2 with federated credentials". No secret to rotate, no secret to leak. |
| 10 | **The SWA's `frame-ancestors` must allow `*.widget-renderer.usercontent.microsoft.com`** | This is the Microsoft-managed widget host that loads our HTML. Without it, the widget renders blank. |
| 11 | **Wave-2 agents are NOT classic Direct Line** | The endpoint is `*.api.powerplatform.com/copilotstudio/dataverse-backed/...`. Use `@microsoft/agents-copilotstudio-client`, not `botframework-webchat`. |
| 12 | **Branding is build-time, not runtime** | Configure agent name / logo / colors / font via `VITE_BRAND_*` env vars at build time. Do not let the bot rebrand at runtime — that couples chat content to the surface and breaks the maker's single source of truth. |

## The recipe — one screen

```text
                     ┌───────────────────────────────────────────────────┐
                     │ Microsoft 365 Copilot                             │
                     │  user: "open my agent"                            │
                     └─────────────────┬─────────────────────────────────┘
                                       │
                  ┌────────────────────▼────────────────────┐
                  │ Declarative Agent (manifest only)       │
                  │  declarativeAgent.json (v1.6)           │
                  │  - actions[].file = ai-plugin.json      │
                  └────────────────────┬────────────────────┘
                                       │
                  ┌────────────────────▼────────────────────┐
                  │ ai-plugin.json (v2.4)                   │
                  │  runtimes[0]:                           │
                  │    type:  RemoteMCPServer               │
                  │    auth:  { type: None }                │
                  │    run_for_functions: [openChat]        │
                  │    spec:  { url: <app-service>/mcp }    │
                  └────────────────────┬────────────────────┘
                                       │
                                  HTTP MCP
                                       │
                ┌──────────────────────▼──────────────────────┐
                │ MCP server (Azure App Service B1, Linux)    │
                │  Streamable HTTP via @modelcontextprotocol  │
                │  tool openCopilotStudioChat                 │
                │   ↳ _meta.ui.resourceUri = ui://chat        │
                │  resource ui://chat                         │
                │   ↳ HTML iframes the SWA                    │
                └──────────────────────┬──────────────────────┘
                                       │ render
                                       ▼
                ┌────────────────────────────────────────────┐
                │ Widget host (Microsoft-managed)            │
                │  *.widget-renderer.usercontent.microsoft   │
                │   ↳ iframes the SWA inside its sandbox     │
                └──────────────────────┬─────────────────────┘
                                       │
                ┌──────────────────────▼─────────────────────┐
                │ Static Web App (Free, westus2)             │
                │  Vite SPA: WebChat                         │
                │  - MSAL silent SSO → Power Platform API    │
                │  - Wave-2 SDK → CS Direct Engine           │
                │  - markdown / cards / suggested actions    │
                └──────────────────────┬─────────────────────┘
                                       │ Bearer
                                       ▼
                ┌────────────────────────────────────────────┐
                │ Copilot Studio agent (Wave-2)              │
                │  Topics, knowledge, actions, long-running  │
                └────────────────────────────────────────────┘
```

## The 5-step ship sequence (assumes ingredients above are ready)

| Step | Action | Verify |
|---|---|---|
| 1 | `cd webchat-ui && npm run dev` against `.env` with CS IDs filled in | Sign in, send a message, get a reply locally |
| 2 | `az deployment group create -g rg-mcsmcpapps --template-file infra/main.bicep` | Two resources visible in the portal: SWA + App Service |
| 3 | `git push` triggers two GitHub Actions workflows | SWA + MCP server both deployed; SWA hostname loads, MCP `/` health page returns text |
| 4 | Open `declarative-agent/` in VS Code → Agents Toolkit → **Provision** → **Publish** | "Publish succeeded" in toolkit log; app appears in <https://m365.cloud.microsoft/chat> picker |
| 5 | Pick the agent in M365 Copilot and type *"open my agent"* | Widget loads, MSAL SSO completes silently, chat connects |

## What "done" looks like

- ✅ User says "open my agent" in M365 Copilot
- ✅ The DA fires the MCP tool
- ✅ The MCP server returns the widget descriptor
- ✅ Microsoft 365 Copilot renders our SWA inside the widget host
- ✅ The SPA does silent SSO (no popup) using the same M365 session
- ✅ The chat connects to the CS agent
- ✅ Markdown, charts (data URLs), Adaptive Cards, suggested actions all render
- ✅ Long-running topics complete without per-turn timeout

## When things go wrong

| Symptom | Most likely cause | Fix |
|---|---|---|
| Validator: "Unrecognized member 'type' RemoteMCPServer" | Plugin manifest schema is `v2.3` | Bump to `v2.4` |
| Validator: "App version should not start with '0'" | Teams app version is `0.x` | Bump `manifest.json` `version` to `1.0.0` |
| Validator: any other "unrecognized member" | Schema mismatch between manifest and `$schema` URL | Pull the schema JSON yourself; verify shape; bump version if needed |
| Chat: "Authentication failed. Token endpoint returned 403" | `CopilotStudio.Copilots.Invoke` not granted | Entra portal → API permissions → Add "Power Platform API" → CopilotStudio.Copilots.Invoke → Grant admin consent |
| Chat: connection blank, console says CSP blocked | `frame-ancestors` missing widget host | Update `webchat-ui/public/staticwebapp.config.json` |
| Widget renders, MSAL never resolves | App reg redirect URI doesn't include the SWA hostname | Entra → app reg → Authentication → Add SPA redirect URI |
| MCP tool times out | App Service cold start | Provision plan to B1 (always-on) or hit the `/` health endpoint to warm it before demo |
| Agent picker doesn't show your DA | Toolkit Publish hasn't run, or sideload disabled in tenant | Run **Publish** again; Teams Admin Center → Manage Apps → set status to Allowed |
| Validator passes but Publish step fails with HTTP error | App Catalog isn't on for the tenant, or the user lacks permission | Tenant admin: enable Custom App Upload in Teams Admin |

## What this project deliberately does NOT do

- **Multi-tenant** distribution. The architecture supports it (see CAPABILITIES.md), but this build is single-tenant CDX.
- **OAuth on the MCP server**. Anonymous MCP is intentional for dev; the chat is authenticated independently.
- **Runtime branding changes**. Branding = `VITE_BRAND_*` at build time, period.
- **Live agent escalation**. The orchestrator is scaffolded (`webchat-ui/src/handoff/`) but not wired to a real broker.
- **File upload to topic**. Wave-2 ingest spec is firming up; deferred.
- **Translation pipeline**. Filed in `docs/IDEAS/language-preference-and-translation.md` with a working `OnOutgoingMessage` primitive.

## Related docs in this repo

- [README.md](../README.md) — what / why
- [BUILD-GUIDE.md](BUILD-GUIDE.md) — long-form step by step (no AI)
- [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) — six actors, four boundaries
- [UI-POSSIBILITIES.md](UI-POSSIBILITIES.md) — what the maker can build into the WebChat
- [CAPABILITIES.md](CAPABILITIES.md) — full capability matrix + demo script
- [MAKER-CONFIG.md](MAKER-CONFIG.md) — rebrand workflow (8 env vars)
- [ARCHITECTURE-CENTER-DRAFT.md](ARCHITECTURE-CENTER-DRAFT.md) — Learn-style article
- [IDEAS/](IDEAS/) — parking lot for future capabilities
- [PROGRESS.md](PROGRESS.md) — phase tracker
- [SECURITY.md](../SECURITY.md) — what's safe to commit
- [IDs.md](IDs.md) — the GUIDs / hostnames captured during this build (no secrets)
