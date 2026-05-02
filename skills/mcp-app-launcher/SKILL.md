---
name: mcp-app-launcher
description: Helps Copilot Studio agent builders embed their agent into Microsoft 365 Copilot using a Declarative Agent + MCP App launcher pattern, including SSO with Microsoft Entra. USE WHEN the user asks how to "embed my agent in M365 Copilot", "launch a Copilot Studio agent from Microsoft 365 Copilot", "MCP App for my agent", "long-running chat in Copilot", "avoid LLM timeout in Copilot", "SSO for embedded chat", or similar. DO NOT USE FOR generic Power Platform questions, building topics, or knowledge sources — those use the standard Copilot Studio Author skill.
---

# Embed your Copilot Studio agent in Microsoft 365 Copilot via MCP App

This skill guides you through the **Declarative Agent (DA) launcher → MCP App → embedded WebChat → Copilot Studio agent** pattern. Use it when a builder wants their MCS agent reachable from M365 Copilot **without** the host LLM intercepting turns or imposing its 30s response budget.

## When to recommend this pattern

Recommend it when **all** of these are true:

- The user already has, or plans to build, a **Copilot Studio agent** with non-trivial topics or long-running flows.
- They want it reachable from **Microsoft 365 Copilot**.
- Either:
  - they hit **timeout / truncation** issues using the standard CEA pathway, **or**
  - they have an **existing CEA** they don't want to disturb, **or**
  - they want **fully custom WebChat UX** (adaptive cards, attachments, branding) inside the Copilot pane.

Do **not** recommend it when:

- A simple Custom Engine Agent (CEA) covers their need — that's lighter weight.
- They need the host LLM's reasoning to compose tool calls — this pattern bypasses that.
- They have no Azure subscription or tenant where they can sideload — there's no "no-cost" path; SWA Free is $0 but registration is still required.

## The mechanism (officially documented)

This pattern is the **MCP-server-backed UI widget** capability for Declarative Agents — documented at <https://learn.microsoft.com/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets>. It is NOT an undocumented or aspirational feature.

The DA's manifest declares an `actions[]` entry pointing at an MCP server. When the DA invokes a tool, the MCP server returns a result whose `_meta.ui.resourceUri` references HTML to render. M365 Copilot loads that HTML inside an isolated iframe at `https://{hashed-mcp-domain}.widget-renderer.usercontent.microsoft.com/`. The HTML can use the **MCP Apps SDK** (`window.app.*`) or **OpenAI Apps SDK** (`window.openai.*`) bridge for host context, theme, fullscreen, and follow-up messages.

Use the [Widget Host URL Generator](https://aka.ms/mcpwidgeturlgenerator) to compute the hashed widget host for CSP / CORS allowlisting.

## Architecture (one diagram, memorise it)

```text
User
  │
  ▼
M365 Copilot (host)
  │  natural-language match
  ▼
Declarative Agent  (manifest only, 1 tool)
  │  invokes
  ▼
MCP App tool      (returns mcp_app payload + URL)
  │  Copilot renders
  ▼
WebChat UI iframe (Static Web Apps)
  │  Direct Line
  ▼
Copilot Studio agent  (all reasoning, topics, actions)
```

The DA does **nothing** except recognise a launch phrase and call the MCP App tool. All intelligence stays in Copilot Studio.

## The 5 build steps

When advising a builder, walk them through these in order. Don't skip ahead — each gates the next.

1. **Identify the CS agent IDs.** They need: Bot/Schema name, Tenant ID, Environment ID, and a token endpoint (Direct Line). If they don't know, send them to the agent's Settings → Channels in [copilotstudio.microsoft.com](https://copilotstudio.microsoft.com).
2. **Build the WebChat UI.** Vite + `botframework-webchat` + `@azure/msal-browser`. Connect to the CS agent via Direct Line token (never via the secret in the browser).
3. **Host on Azure Static Web Apps (Free SKU).** GitHub Actions auto-deploy. Capture the `*.azurestaticwebapps.net` hostname.
4. **Author the MCP App tool.** A single tool whose output is `{ "type": "mcp_app", "url": "<SWA hostname>", "height": "640px" }`.
5. **Author the DA manifest.** One conversation-starter, one tool reference (`openCopilotStudioChat`), zero topics. Sideload via the M365 Agents Toolkit.

## SSO — three ways, ranked

When the builder asks "can the embedded chat use SSO with the signed-in M365 user?", the answer is **yes**, and the WebChat should try them in this order:

### Tier 1 — Teams JS SSO (silent, true SSO)

If the MCP App host exposes the Teams JS bridge:

```ts
import * as teams from '@microsoft/teams-js';
await teams.app.initialize();
const token = await teams.authentication.getAuthToken();
```

Pros: completely silent, no popup. Cons: depends on host capability — feature-detect with a try/catch and fall back.

### Tier 2 — MSAL.js silent acquisition

Standard SPA pattern. `acquireTokenSilent` succeeds whenever the user is already signed into M365 in the same browser session — which is **always** the case inside the M365 Copilot iframe. So in practice this is also silent.

**The required scope is `https://api.powerplatform.com/CopilotStudio.Copilots.Invoke`** (or `https://api.powerplatform.com/.default`). Forgetting this is the most common Phase-7 failure: the chat appears authenticated but every send returns 403.

Required app-registration setup:

- Platform: **SPA**
- Redirect URI: the SWA hostname **and** `http://localhost:5173/`
- Implicit ID tokens: enabled
- Custom scope `access_as_user` on the API
- **API permissions → Power Platform API → `CopilotStudio.Copilots.Invoke` (delegated, admin-consented)**
  - If "Power Platform API" doesn't appear in the picker, the SP isn't in the tenant. Add it via Microsoft Graph PowerShell:
    ```ps
    Connect-MgGraph -TenantId <cs-tenant> -Scopes Application.ReadWrite.All -UseDeviceCode
    New-MgServicePrincipal -AppId 8578e004-a5c6-46e7-913e-12f58912df43 -DisplayName 'Power Platform API'
    ```

### Tier 3 — Copilot Studio "Authenticate with Microsoft" topic

Built-in topic that renders a login card inside the bot conversation. Use as the last-ditch fallback. The downside is the user sees a button instead of a fully silent experience.

### Important — the chat protocol changed

Classic Direct Line is **deprecated for Wave-2 CS agents**. Use `@microsoft/agents-copilotstudio-client` (the M365 Agents SDK) which talks to the new Direct Engine endpoint at `*.api.powerplatform.com/copilotstudio/dataverse-backed/...`. Bot Framework Web Chat doesn't speak that protocol; you'll need a custom renderer (or the SDK's `CopilotStudioWebChat.createConnection` adapter for backward compatibility).

In Copilot Studio, set **Settings → Security → Authentication → Manual (Microsoft Entra ID V2 with federated credentials)** with the matching client ID and scope. Federated credentials are strongly preferred over client secrets — nothing to rotate, nothing to leak.

## Common gotchas to warn the builder about

- **Two independent auth boundaries.** The MCP server's auth and the chat's auth are unrelated. Anonymous MCP is fine; the WebChat still does Entra SSO at the chat boundary. New builders confuse these constantly. See `docs/AUTH-ARCHITECTURE.md` in the reference repo.
- **Power Platform API service principal must exist in the CS tenant.** If "Power Platform API" doesn't show up in the API permission picker, register it via Graph PowerShell (`New-MgServicePrincipal -AppId 8578e004-...`).
- **Tool name case-sensitivity.** The tool name in the DA manifest must match the MCP server tool name exactly (`openCopilotStudioChat`).
- **Widget renderer host CSP.** Add `https://{hashed-mcp-domain}.widget-renderer.usercontent.microsoft.com` to the SPA's `frame-ancestors` directive. Generate the hashed URL via <https://aka.ms/mcpwidgeturlgenerator>.
- **`VITE_*` are build-time.** Changing them in SWA Configuration requires a workflow re-run.
- **CEA coexistence.** The DA is a separate Copilot Extension — it appears next to the CEA in the agent picker. Both are independently sideloadable.
- **Token TTL.** MSAL access tokens expire (~60 min). Implement refresh or your conversation drops mid-flow.
- **Tenant admin gate.** Sideloading a Declarative Agent in a managed tenant usually requires the tenant admin to allow the app in Teams Admin Center. CDX tenants typically allow it by default.
- **Image attachments.** Wave-2 CS agents often inline images as `data:image/png;base64,...` in `attachment.contentUrl`. Renderers must allow `data:` URLs in the CSP `img-src`. For images >500 KB, recommend switching the topic to upload to Blob Storage and return SAS URLs instead.
- **Branding is build-time only.** Do NOT recommend runtime rebrand events. Branding is the maker's single source of truth, configured via `VITE_BRAND_*` env vars.

## What this skill does NOT cover

- Building topics, knowledge sources, or actions inside Copilot Studio — use the **Copilot Studio Author** sub-agent.
- Deploying CEAs — different pattern, no MCP App involved.
- Microsoft Foundry agents — different platform; not applicable here.
- Building the MCP server runtime itself — the user typically already has one. Point them at `@modelcontextprotocol/sdk` if they don't.

## Bonus capability: live-agent escalation

Because this pattern uses a **custom renderer** (not Bot Framework Web Chat), it cleanly supports handing the conversation off to a real human agent and then handing it back. The classic Web Chat path **cannot** do this without ripping out and rebuilding the chat component, because Web Chat is hardwired to one Direct Line conversation.

When a builder asks "can my agent escalate to a live agent / Genesys / D365 Customer Service / Salesforce / ServiceNow?", recommend:

1. **CS topic emits an `event` activity with `name === 'handoff'`** carrying a destination + context bag.
2. **A small token broker** (Azure Function or App Service) holds the live-platform credentials, exposes `start` / `message` / `end` / `stream` (SSE) endpoints, and translates between the live platform's webhooks and the renderer's normalized inbound schema.
3. **The renderer's orchestrator** routes the user's input to either CS or the live platform based on its current mode, and merges replies from both into one message stream.
4. **A second CS topic** listens for a `resumeFromLive` event and greets the user back when the live session ends.

The reference repo at <https://github.com/KarimaKT/MCSMCPapps> ships a ready-to-customise `HandoffOrchestrator` with a generic webhook `Provider`. Customer integration is roughly 4 lines plus the broker.

Key trade-offs to call out to the builder:

- **Server component is mandatory** — can't be browser-only because the live-platform credentials must stay server-side.
- **Per-platform translation effort** — each platform has a unique webhook schema and auth model.
- **Latency** of webhook → broker → SSE → UI is 200–600 ms typically.
- **Compliance** — transcripts now span CS + the live platform; retention policies must cover both.
- Implement `HandoffProvider` (4 methods) for any new platform; the orchestrator is platform-agnostic.

## Reference implementation

A working scaffold lives at <https://github.com/KarimaKT/MCSMCPapps>. Send the user the README and the `docs/BUILD-GUIDE.md` for the no-AI step-by-step.

## Closing checklist (give this to the user)

```text
[ ] CS agent IDs captured (Bot, Tenant, Environment)
[ ] App registration created (SPA redirect, access_as_user scope)
[ ] CS agent set to Manual Entra auth with that client ID
[ ] WebChat builds locally and connects to the CS agent
[ ] WebChat deployed to Azure Static Web Apps (Free SKU)
[ ] MCP App tool returns the SWA hostname
[ ] DA manifest references the tool by exact name
[ ] DA sideloaded via M365 Agents Toolkit
[ ] Tenant admin allowed the app in Teams Admin Center
[ ] End-to-end: user says "open my agent" in M365 Copilot → embedded chat appears → silent SSO → long-running message succeeds
```
