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

Required app-registration setup:

- Platform: **SPA**
- Redirect URI: the SWA hostname **and** the auth-redirect helper page
- Implicit ID tokens: enabled
- Scope: a custom `access_as_user` scope on the API app exposing the CS agent

### Tier 3 — Copilot Studio "Authenticate with Microsoft" topic

Built-in topic that renders a login card inside the bot conversation. Use as the last-ditch fallback. The downside is the user sees a button instead of a fully silent experience.

### Important — pass the token to the CS agent correctly

After acquiring the token, the WebChat must send it to a **Direct Line token endpoint** (server-side, e.g. an Azure Function) which exchanges it for a short-lived Direct Line token scoped to one conversation. Never use the Direct Line **secret** in the browser bundle.

In Copilot Studio, set **Settings → Security → Authentication → Manual (Microsoft Entra)** with the matching client ID and scope.

## Common gotchas to warn the builder about

- **Tool name case-sensitivity.** The tool name in the DA manifest must match the MCP server tool name exactly (`openCopilotStudioChat`).
- **CSP / iframe origins.** Add `https://*.cloud.microsoft` and `https://*.office.com` to the SWA's `staticwebapp.config.json` `forwardingGateway.allowedForwardedHosts` if you customize the config.
- **`VITE_*` are build-time.** Changing them in SWA Configuration requires a workflow re-run.
- **CEA coexistence.** The DA is a separate Copilot Extension — it appears next to the CEA in the agent picker. Both are independently sideloadable.
- **Token TTL.** Direct Line tokens expire (~30 min). Implement refresh or your conversation drops mid-flow.
- **Tenant admin gate.** Sideloading a Declarative Agent in a managed tenant usually requires the tenant admin to allow the app in Teams Admin Center.

## What this skill does NOT cover

- Building topics, knowledge sources, or actions inside Copilot Studio — use the **Copilot Studio Author** sub-agent.
- Deploying CEAs — different pattern, no MCP App involved.
- Microsoft Foundry agents — different platform; not applicable here.
- Building the MCP server runtime itself — the user typically already has one. Point them at `@modelcontextprotocol/sdk` if they don't.

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
