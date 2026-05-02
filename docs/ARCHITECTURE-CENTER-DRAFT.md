# Architecture Center entry (draft)

> A draft of an Architecture Center / Microsoft Learn-style article describing this pattern. When this project is mature enough to publish, this content can be edited for tone and submitted as an article PR to the **Microsoft Copilot Studio** or **Microsoft 365 Copilot** Architecture Center.
>
> Audience: enterprise architects evaluating "should we adopt this pattern?". Length, tone, and section ordering follow Architecture Center conventions.

---

# Embed a Microsoft Copilot Studio agent inside Microsoft 365 Copilot using a UI-widget Declarative Agent

This article describes a reference architecture for surfacing a Microsoft Copilot Studio (MCS) agent inside Microsoft 365 Copilot via an interactive UI widget delivered by an MCP server. It is appropriate when you have an existing Copilot Studio agent with non-trivial topics or long-running flows and you need it reachable from M365 Copilot without disturbing other agents and without losing rich UX.

## Architecture

```text
                         ┌──────────────────────────┐
                         │ Microsoft 365 Copilot    │
                         │ (host)                   │
                         └───────────┬──────────────┘
                                     │ user prompt
                                     ▼
                         ┌──────────────────────────┐
                         │ Declarative Agent        │
                         │ (manifest + actions[])   │
                         └───────────┬──────────────┘
                                     │ MCP tool call
                                     ▼
                         ┌──────────────────────────┐
                         │ MCP server (Azure        │
                         │ Functions, optional auth)│
                         └───────────┬──────────────┘
                                     │ returns _meta.ui.resourceUri
                                     ▼
                         ┌──────────────────────────┐
                         │ Widget renderer host     │
                         │ (Microsoft-managed)      │
                         └───────────┬──────────────┘
                                     │ loads HTML
                                     ▼
                         ┌──────────────────────────┐
                         │ WebChat SPA              │
                         │ (Azure Static Web Apps)  │
                         │ + MSAL SSO               │
                         └───────────┬──────────────┘
                                     │ Bearer (Power Platform API)
                                     ▼
                         ┌──────────────────────────┐
                         │ Copilot Studio agent     │
                         │ (Wave-2 Direct Engine)   │
                         └──────────────────────────┘
```

### Workflow

1. The user prompts Microsoft 365 Copilot, for example: *"Open my Eurozone analyst agent."*
2. The Declarative Agent (DA) manifest matches the prompt and invokes the MCP server's `openCopilotStudioChat` tool.
3. The MCP server returns a tool result with `_meta.ui.resourceUri` pointing at the WebChat SPA hosted on Azure Static Web Apps.
4. M365 Copilot loads the SPA inside the Microsoft-managed widget renderer host (an iframe under `https://{hashed-mcp-domain}.widget-renderer.usercontent.microsoft.com/`).
5. The SPA performs MSAL silent SSO using the user's existing M365 browser session, acquiring an access token for the Power Platform API.
6. The SPA opens a streaming conversation with the Copilot Studio agent via the **Microsoft 365 Agents SDK Copilot Studio Client** (`@microsoft/agents-copilotstudio-client`).
7. The user converses with the CS agent. Replies render with Markdown, Adaptive Cards, image attachments, and suggested-action buttons. The conversation persists for as long as the panel stays open.

### Components

| Component | Service | Role |
|---|---|---|
| Microsoft 365 Copilot | Microsoft 365 Copilot | Host that renders the DA + widget surface. |
| Declarative Agent | Microsoft 365 Agents Toolkit | Manifest defining one MCP-backed action. |
| MCP server | [Azure Functions](https://learn.microsoft.com/azure/azure-functions/) (or App Service) | Returns the widget descriptor; optionally enforces user identity. |
| WebChat SPA | [Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/) (Free tier) | Custom rendered chat using Markdown + Adaptive Cards + suggested actions. |
| Identity provider | [Microsoft Entra ID](https://learn.microsoft.com/entra/identity/) | SPA app registration with Power Platform API delegated permission. |
| Backend conversational AI | [Microsoft Copilot Studio](https://learn.microsoft.com/microsoft-copilot-studio/) (Wave-2) | Topics, knowledge sources, actions, long-running flows. |

### Alternatives

- **Custom Engine Agent (CEA) only.** If you do not need a custom UI surface and the host LLM's per-turn budget is acceptable for your topics, a CEA is simpler. Choose this article's pattern when you need Markdown, Adaptive Cards, attachments, or long-running conversations that exceed Copilot's per-turn timeouts.
- **Embed Copilot Studio agent in Teams or SharePoint via the built-in channel.** If your users live in Teams or SharePoint instead of M365 Copilot, the built-in channel is simpler. Choose this article's pattern when M365 Copilot is the discovery surface.
- **Bot Framework Web Chat with classic Direct Line.** Works for older CS agents, but Wave-2 agents expose only the new Direct Engine endpoint. The Microsoft 365 Agents SDK is the supported client for Wave-2.

## Scenario details

### When to use this pattern

- You have an existing Copilot Studio agent with topics that take longer than a typical Copilot turn (e.g. multi-step approvals, generated reports, long-running orchestrations).
- You want users to invoke the agent from M365 Copilot's chat and stay in that surface for the full conversation.
- You need rich rendering — branded reports, charts, forms, suggested action buttons — that the host Copilot's response surface cannot natively express.
- You want to coexist with other agents (CEAs, other DAs) without modifying them.

### When not to use this pattern

- A simpler CEA covers the need.
- The agent is text-only and short-turn.
- You cannot host an MCP server (single-tenant constraints, air-gapped environments).
- You cannot create an Entra app registration in the tenant where the CS agent lives.

## Considerations

### Reliability

| Concern | Mitigation |
|---|---|
| Long sessions exceeding token TTL | The Microsoft 365 Agents SDK refreshes internal CS conversation tokens during streaming. Our SPA refreshes the MSAL access token on transport error. |
| MCP server availability | Use Azure Functions Premium or App Service for SLA. Free tier is sufficient for development. |
| Static Web App availability | The Free SKU has a 250 GB/month bandwidth quota. Move to Standard SKU for production multi-tenant deployments. |

### Security

| Concern | Mitigation |
|---|---|
| Browser holds the access token | MSAL stores tokens in `sessionStorage` and uses Authorization Code flow with PKCE. No client secret in browser code. |
| MCP server auth boundary | Anonymous MCP is acceptable in development because the WebChat enforces its own auth (boundary 5 in the reference [auth architecture](AUTH-ARCHITECTURE.md)). For production, enable OAuth 2.1 or Entra SSO on the MCP server. |
| Cross-origin iframe | Microsoft 365 Copilot runs the SPA inside `*.widget-renderer.usercontent.microsoft.com`. The SPA's CSP `frame-ancestors` directive must allow this origin. |
| Federated credentials over client secrets | Configure the CS agent's Manual Entra auth with **Microsoft Entra ID V2 with federated credentials**. Eliminates client-secret rotation. |
| Live-agent escalation | Done via a broker (token-validating Azure Function). Live-platform credentials never reach the browser. See [Live agent escalation](#live-agent-escalation). |

### Cost optimization

- **Static Web Apps Free SKU**: $0/month for the WebChat host (sufficient for development and single-tenant CDX scenarios).
- **Azure Functions Consumption plan**: <$1/month for an MCP server with low call volume.
- **Power Platform API**: included in the Copilot Studio licensing of the agent — no separate Azure cost.
- **Entra app registration**: free.
- **GitHub Actions** on a public repo: free unlimited minutes.

Total infra cost for a development deployment: **single-digit dollars per month** even on PAYG.

### Operational excellence

- **CI/CD**: GitHub Actions deploys the SPA on every push to `main` (path-filtered to `webchat-ui/**`).
- **Branding without code change**: 8 environment variables (`VITE_BRAND_*`) cover agent name, company, logo, accent colors, font, and page title. No TypeScript edits required to rebrand.
- **Observability**: enable Application Insights on the MCP server Function for tool-call telemetry. Browser-side errors are surfaced in the SPA's status banner with stable codes.
- **Configuration**: SPA configuration uses Vite-prefixed env vars (`VITE_*`) baked at build time. Production values come from GitHub Actions secrets, ensuring the deployed bundle is reproducible.

### Performance efficiency

| Concern | Approach |
|---|---|
| Initial bundle size | ~120 KB gzipped (MSAL + Agents SDK + Adaptive Cards + Markdown). Loads via CDN through SWA. |
| First-contentful paint | <500 ms on a fast connection. The SPA renders the chat shell before MSAL resolves. |
| Streaming responses | The SDK streams activities; messages render as they arrive without waiting for turn completion. |
| Image attachments | Bot returns base64 data URLs inline. For attachments larger than ~500 KB, switch to SAS URLs into Azure Blob Storage. |

## Identity model

Six actors, four boundaries. The non-obvious lesson: the **MCP server auth and the chat auth are independent**. The chat is always authenticated by Entra at the browser-to-CS link (boundary 5), regardless of whether the MCP server uses anonymous or OAuth 2.1.

See [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) for the full breakdown.

## Live agent escalation

The pattern naturally supports handoff to a live human agent platform (Genesys, D365 Customer Service, Salesforce, ServiceNow, custom) via:

- A CS topic that emits an outbound `event` activity with `name === 'handoff'` carrying destination and context.
- A token broker (Azure Function) that holds the live-platform credentials and bridges between the SPA and the live platform.
- An orchestrator state machine in the SPA that routes user input between CS and the live platform based on its current mode.

Architecture and trade-offs detailed in [CAPABILITIES.md → Live agent escalation](CAPABILITIES.md#live-agent-escalation).

## Deploy this scenario

A complete reference implementation is available at <https://github.com/KarimaKT/MCSMCPapps>. Key deliverables:

- Vite + TypeScript SPA (`webchat-ui/`)
- Azure Static Web App + Bicep template (`infra/main.bicep`)
- GitHub Actions CI/CD pipeline (`.github/workflows/azure-static-web-apps.yml`)
- MCP server scaffolding (`mcp-server/`) — _planned_
- Declarative Agent manifest (`declarative-agent/`) — _planned_
- Maker-config doc (`docs/MAKER-CONFIG.md`)
- Auth-architecture doc (`docs/AUTH-ARCHITECTURE.md`)

Step-by-step deployment instructions live in `docs/BUILD-GUIDE.md`.

## Contributors

This article was prepared based on field experience deploying the pattern in a CDX tenant in May 2026. *Replace with author bio when publishing.*

## Next steps

- [Add interactive UI widgets to declarative agents](https://learn.microsoft.com/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets)
- [Microsoft 365 Agents SDK — Copilot Studio Client (TypeScript)](https://github.com/microsoft/Agents-for-js/tree/main/packages/agents-copilotstudio-client)
- [Power Platform API authentication v2](https://learn.microsoft.com/power-platform/admin/programmability-authentication-v2)
- [Sample MCP servers with interactive UI widgets](https://github.com/microsoft/mcp-interactiveUI-samples)

## Related resources

- [Add interactive UI widgets to declarative agents](https://learn.microsoft.com/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets)
- [Build plugins from an MCP server for Microsoft 365 Copilot](https://learn.microsoft.com/microsoft-365/copilot/extensibility/build-mcp-plugins)
- [Configure web channel security for Copilot Studio](https://learn.microsoft.com/microsoft-copilot-studio/configure-web-channel-security)
- [Azure Static Web Apps overview](https://learn.microsoft.com/azure/static-web-apps/overview)
