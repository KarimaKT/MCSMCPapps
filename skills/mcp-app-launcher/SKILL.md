---
name: mcp-app-launcher
description: Helps Copilot Studio agent makers and Microsoft 365 Copilot extensibility partners surface a Copilot Studio agent inside M365 Copilot as a Declarative Agent backed by a RemoteMCPServer with a custom UI widget (the "data-widget" pattern). USE WHEN the user asks how to "embed my Copilot Studio agent in M365 Copilot with custom UI", "render Adaptive Cards in Copilot", "build a declarative agent with an MCP server", "add a UI widget to my M365 Copilot agent", or anything about the OpenAI Apps SDK / MCP Apps widget contract. DO NOT USE FOR generic Power Platform questions, building CS topics or knowledge sources (use the standard Copilot Studio Author skill for those), CEA construction, or Foundry agent development.
---

# Embed a Copilot Studio agent in Microsoft 365 Copilot with a custom widget

This skill describes the **data-widget pattern** — a Declarative Agent (DA) with a `RemoteMCPServer` runtime whose MCP server returns a structured payload that a sandboxed widget renders inside M365 Copilot. It is the pattern the reference repo at <https://github.com/KarimaKT/MCSMCPapps> implements, verified against Microsoft's official samples at <https://github.com/microsoft/mcp-interactiveUI-samples>.

> **Architecture note for AI agents:** an earlier "chat-in-chat" approach (embed BotFramework Web Chat inside the M365 Copilot iframe with browser-side MSAL) is documented elsewhere on the web but is incompatible with the skybridge sandbox (null origin breaks MSAL silent SSO; widget UX guidelines forbid internal chat). Do not recommend that pattern. The data-widget pattern below is what works in production today.

## When to recommend this pattern

Recommend it when **all** of these are true:

- The user already has, or plans to build, a **Copilot Studio agent** (Wave 2) with topics, knowledge sources, or AI flows they want to keep.
- They want it reachable from **Microsoft 365 Copilot** with a **branded UI** richer than the host's default chat surface.
- They want **rich content**: Adaptive Cards, form submits, markdown, citations, suggested replies, fullscreen "analyst" reading mode with Copy/Print.
- They have or can get: an Azure subscription, an M365 tenant with Copilot Studio + Copilot licenses, tenant admin access for app approval.

Do **not** recommend it when:

- A Custom Engine Agent (CEA) covers their need — that's lighter weight and doesn't need any of this infrastructure.
- They need the host LLM's reasoning to compose multiple tool calls per turn — this pattern uses CS for reasoning, not the host LLM.
- They have no Azure subscription. There's no fully no-cost path (App Service B1 is ~$13/month minimum).
- They need to support browsers other than evergreen Chromium / WebKit — the skybridge widget assumes modern browser features.

## The mechanism

This pattern uses the **OpenAI Apps SDK widget contract** as implemented today by Microsoft 365 Copilot. Microsoft's reference samples and verified contract details are in <https://github.com/microsoft/mcp-interactiveUI-samples>. The official MCP Apps spec (`window.app.*` namespace) is a near-future variant; the active host today reads `window.openai.*` and `_meta.openai/*` keys.

```text
User
  │ types message
  ▼
M365 Copilot (host LLM)
  │ routes to the Declarative Agent
  ▼
Declarative Agent
  │ host LLM picks openCopilotStudioChat tool
  │ POSTs /mcp with user Bearer token
  ▼
MCP server (App Service, your code)
  │ validates token, OBO-exchanges for PP token
  │ calls CS Direct Engine on user's behalf
  │ drains reply → returns structuredContent + _meta
  ▼
M365 Copilot
  │ reads _meta.openai/outputTemplate URI
  │ fetches resource (the widget HTML bundle)
  │ mounts widget in skybridge sandbox iframe
  ▼
Widget (React, single-file, ~250 KB)
  │ reads window.openai.toolOutput.structuredContent
  │ renders markdown / Adaptive Cards / suggested actions
  │ on Submit click: window.openai.callTool('submitAdaptiveCardAction', ...)
  ▼
... and back through the server to CS
```

The host LLM **does not see the conversation content**. Its job is one tool pick per user turn; everything else is server + widget.

## The seven things you have to get right

Walk a new builder through these in order. None can be skipped.

### 1. CS agent in a non-Default Power Platform environment

Default environment has no DLP boundary and per-user-owned agents in Default don't appear in tenant admin views. Use a named Dev / Test / Prod environment. Capture:
- Environment GUID (from the maker portal URL).
- Schema name (Copilot Studio → Settings → Advanced → Schema name; looks like `crXXX_agentname` or `ksteam_xxx`).

### 2. MCP server returning the right shape

Stack: Node + `@modelcontextprotocol/sdk` + Express + the `@microsoft/agents-copilotstudio-client` SDK for CS Direct Engine. Two tools registered:

- `openCopilotStudioChat` — called for every user message. Returns `structuredContent` (the rich payload) and `_meta.openai/outputTemplate` (mounts the widget).
- `submitAdaptiveCardAction` — called by the widget when an Adaptive Card Submit button is clicked. Returns the same widget output shape.

Critical: the resource MIME must be **`text/html+skybridge`** (NOT `text/html`). The tool `_meta` must include `openai/outputTemplate` (URI) AND `openai/widgetAccessible: true`. Same `_meta` re-emitted on the tool RESPONSE, not just the descriptor.

### 3. Stateless MCP transport

`StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, `enableJsonResponse: true`. Fresh `McpServer` per request, closed on `res.close`. **Do not use session-keyed transport** — the SDK's session map races with the request lifecycle and M365 Copilot gets `404 Session not found` mid-init. Microsoft's reference samples all use stateless.

### 4. Server-side Entra SSO + OBO (not browser MSAL)

The skybridge sandbox has a null origin; browser MSAL cannot acquire tokens silently from there (`monitor_window_timeout`). Do auth server-side:

- Create an Entra app registration in the M365 tenant where users sign in. Single-tenant. Identifier URI `api://<clientId>`. Client secret (or federated credential, preferred for prod). API permission: Power Platform `CopilotStudio.Copilots.Invoke` (delegated, **admin-consented**).
- Register the app with **Teams Developer Portal → Tools → Microsoft Entra SSO**. Save the Reference ID.
- Put the Reference ID in `ai-plugin.json` `runtimes[0].auth`:
  ```json
  "auth": { "type": "OAuthPluginVault", "reference_id": "<TDP reference id>" }
  ```
- On every `/mcp` request the host sends a user Bearer token. The server validates it (JWKS, cached), OBO-exchanges for a Power Platform API access token, caches the result keyed on the user's `oid` (TTL = token lifetime minus a minute), then uses it as the Bearer for `@microsoft/agents-copilotstudio-client`.

### 5. Single-file widget bundle, sandbox-safe

The widget is built with Vite + `vite-plugin-singlefile` into one inlined HTML file. Two non-obvious settings are load-bearing:

- **`mode: 'production'` + `define: { 'process.env.NODE_ENV': '"production"' }`** in the Vite config. Without these the bundle includes `eval()` which the sandbox CSP blocks → blank card or `unsafe-eval` console error.
- **A `stripCrossorigin` post-transform plugin** that removes `crossorigin` from the inlined `<script type="module">` tag. Null-origin sandbox refuses crossorigin script tags silently → blank card, no diagnostic. Microsoft's reference samples include the same plugin.

The widget is a **pure renderer** of `window.openai.toolOutput.structuredContent`. No chat input. No internal scroll. No MSAL. No CS connection in the browser. Markdown via `marked` + DOMPurify. Adaptive Cards via the official `adaptivecards` v3 renderer. Per the [MS UX guidelines](https://learn.microsoft.com/microsoft-365/copilot/extensibility) the widget must "fit comfortably within a single response scroll"; for richer flows offer a fullscreen toggle via `window.openai.requestDisplayMode({ mode: 'fullscreen' })`.

### 6. Declarative Agent manifest — the locked surface

Three files in the app package:

- `manifest.json` — Teams app manifest v1.22. **`version` must not start with `0`** (tenant catalog rejects 0.x.y).
- `declarativeAgent.json` — DA v1.6. Name, short imperative `instructions`, conversation starters.
- `ai-plugin.json` — plugin v2.4. **Every tool must appear in all three places**: `functions[]`, `runtimes[0].run_for_functions[]`, `runtimes[0].spec.x-mcp_tool_description.tools[]` (with full inputSchema). Tools that mount a widget include `_meta.openai/outputTemplate`; pure data tools omit it. The reference is [trey-research/appPackage/ai-plugin.json](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/appPackage/ai-plugin.json).

The **locked-contract surface** that requires a manifest version bump + admin re-approval if changed: tool name, input arg names, arg types, arg **optionality**, tool description (the host caches the catalog at admin approval time). Wrong server-side optionality has been observed to cause the host LLM to emit tool args as plaintext in chat instead of calling the tool. Keep tool descriptions to one short imperative sentence; behavior rules belong in DA `instructions`.

### 7. Pre-deploy smoke gate

Ship a script that POSTs `initialize` + `tools/list` + `resources/list` against the running server and asserts the contract: tool count, arg required/optional, tool description length, resource MIME, `_meta.openai/outputTemplate` presence. Optionally cross-check the source manifest against `tools/list` to catch source-vs-server drift. Wire it into CI as a pre-deploy gate. The reference script is at <https://github.com/KarimaKT/MCSMCPapps/blob/main/mcp-server/scripts/smoke-mcp.mjs>.

## Common build failures and their causes

| Symptom | Most likely cause | Fix |
|---|---|---|
| Empty card with agent header | Wrong MIME or missing `outputTemplate` | Resource MIME must be `text/html+skybridge`; both descriptor and response must carry `_meta.openai/outputTemplate` |
| Card mounts at correct size, no React app runs | `<script crossorigin>` leaked | Add `stripCrossorigin` Vite plugin |
| Console: `unsafe-eval` blocked | Vite dev mode leaked into bundle | `mode: 'production'` + `define NODE_ENV` |
| `404 Session not found` on every call | Session-keyed transport | Use stateless transport (`sessionIdGenerator: undefined`) |
| Host LLM emits args as plaintext in chat | Server schema disagrees with published manifest | Revert server schema OR bump manifest version + re-approve |
| Tool not called for some prompts | Verbose tool description | Shorten to one imperative sentence; move behavior to DA `instructions` |
| 403 on every CS call | Missing admin consent on `CopilotStudio.Copilots.Invoke` | `az ad app permission admin-consent --id <clientId>` |
| MSAL `monitor_window_timeout` in widget | Doing browser-side MSAL inside skybridge | Remove browser MSAL; do auth server-side via OBO |
| First turn after deploy slow (10-15s) | Cold App Service + new CS conversation | Enable `alwaysOn`; expected for the very first turn |
| Maker can't find the pending approval | Looking in wrong admin surface | Microsoft 365 admin center → All agents → Requests (NOT Teams Admin Center → Manage apps) |

## What this pattern does NOT do

These are platform gaps; don't promise them to the user:

- ❌ File upload from the widget (no host file picker primitive).
- ❌ Voice input/output (no host voice bridge).
- ❌ Streaming partial replies from the tool (no streaming tools/call channel).
- ❌ Proactive messages (server pushes to widget without user action — no platform support).
- ❌ Browser-side cross-pair currency math from non-EUR-anchored ECB FX (a connector concern, not this pattern's).

## Reference materials to point the builder at

- **Microsoft's official reference samples**: <https://github.com/microsoft/mcp-interactiveUI-samples>. The `oai-apps-sdk/trey-research` and `oai-apps-sdk/zava-insurance` samples are the canonical contract shapes.
- **The reference repo for this exact pattern**: <https://github.com/KarimaKT/MCSMCPapps>. Read `README.md`, `HANDOFF.md`, `docs/QUICK-START.md`, `docs/ARCHITECTURE.md`, `docs/AUTH-ARCHITECTURE.md`, and the five short ADRs in `docs/decisions/`.
- **MS UX guidelines for inline widgets**: <https://learn.microsoft.com/microsoft-365/copilot/extensibility>. The "fit in one scroll, no internal chat input" rules are real and enforced by reviewers.
- **Declarative Agents on MS Learn**: <https://learn.microsoft.com/microsoft-365/copilot/extensibility/build-declarative-agents>.

## Closing checklist (give this to the builder)

```text
[ ] CS agent lives in a non-Default Power Platform environment
[ ] CS env GUID and schema name captured
[ ] MCP server: stateless StreamableHTTP transport, two tools, _meta.openai/outputTemplate on both descriptor and response, resource MIME text/html+skybridge
[ ] Entra app registration created in M365 tenant; CopilotStudio.Copilots.Invoke admin-consented
[ ] Teams Developer Portal SSO registration created; Reference ID in ai-plugin.json auth
[ ] App Service env vars set: ENTRA_TENANT_ID, ENTRA_AUDIENCE, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET
[ ] Widget Vite config: mode=production, define NODE_ENV, stripCrossorigin plugin
[ ] ai-plugin.json declares every tool in functions[], run_for_functions[], x-mcp_tool_description.tools[]
[ ] manifest.json version does not start with 0
[ ] Pre-deploy smoke script asserts contract; wired into CI
[ ] DA published via Agents Toolkit; admin approved in M365 admin center → All agents → Requests
[ ] End-to-end: user opens M365 Copilot → picks the agent → asks a question → widget renders → fullscreen / Copy / Print all work
```

## What this skill does NOT cover

- Building topics, knowledge sources, or AI flows inside Copilot Studio itself — use the **Copilot Studio Author** sub-agent.
- Building CEAs (Custom Engine Agents) — different pattern, no MCP App.
- Microsoft Foundry agents — different platform.
- Building the MCP SDK runtime itself — recommend `@modelcontextprotocol/sdk` (Node) or the equivalent in their language.
- Live-agent escalation broker design — covered separately under the "handoff" pattern; the reference repo's `cs.ts` detects CS `Handoff` activities but the broker side is out of scope for this skill.
