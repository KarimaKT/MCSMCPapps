# MCSMCPapps — Architecture

> Read [SPEC.md](SPEC.md) first for goals/non-goals. This doc describes **how** we deliver them at v0.7.
>
> This doc was rewritten 2026-05-11 to reflect the v0.6 data-widget pivot ([ADR 0001](decisions/0001-chat-in-chat-was-wrong.md)) and the server-side Entra SSO + OBO design ([ADR 0003](decisions/0003-entra-sso-via-tdp-registration.md)). The previous version is preserved in [`archive/ARCHITECTURE.v0.5.md`](archive/ARCHITECTURE.v0.5.md) for archaeological reference — do not link to it.

## 1. The 60-second story

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Microsoft 365 Copilot                            │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Declarative Agent: "Eurozone Analyst"                           │  │
│  │  - manifest v1.22, plugin v2.4, DA v1.6                          │  │
│  │  - runtime type: RemoteMCPServer                                 │  │
│  │  - tools declared in x-mcp_tool_description.tools[]:             │  │
│  │      • openCopilotStudioChat                                     │  │
│  │      • submitAdaptiveCardAction                                  │  │
│  │  - auth: OAuthPluginVault → TDP SSO registration (Entra)         │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │ MCP over HTTPS                   │
│                                     │ Bearer = user's M365 token       │
│                                     │ initialize / tools/list /        │
│                                     │ tools/call / resources/read      │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │
                ┌─────────────────────▼────────────────────────┐
                │  MCP server (App Service Linux B1)            │
                │  app-mcsmcpapps-mcp.azurewebsites.net         │
                │                                               │
                │  • Validates inbound Bearer (JWKS cached)     │
                │  • OBO exchange → Power Platform API token    │
                │  • Calls CS Direct Engine on user's behalf    │
                │  • Returns structuredContent payload + widget │
                │                                               │
                │  Stateless transport: fresh McpServer per     │
                │  request, no session map.  ADR 0002.          │
                └─────────────────────┬─────────────────────────┘
                                      │  ┌──────────────────────────────┐
                                      ├─►│  resources/read              │
                                      │  │  ui://mcsmcpapps/chat        │
                                      │  │  → text/html+skybridge       │
                                      │  │  (single-file React bundle)  │
                                      │  └──────────────────────────────┘
                                      │
                                      ▼  CS Direct Engine
                ┌─────────────────────────────────────────────┐
                │         Copilot Studio agent                │
                │   environment: <CS_ENV_ID>                  │
                │   schema:      <CS_SCHEMA>                  │
                │   - topics, knowledge sources, AI flows     │
                │   - Adaptive Cards in bot replies           │
                │   - Dataverse logging (OOB)                 │
                │   - Settings → Agent transfers →            │
                │     Omnichannel → connected (OOB)           │
                └─────────────────────────────────────────────┘
                                      ▲
                                      │ on Action.Submit click
                                      │ widget calls back via
                                      │ window.openai.callTool
                                      │ → submitAdaptiveCardAction
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            │   Skybridge sandbox iframe (in M365 Copilot)      │
            │                                                   │
            │   React widget (single-file bundle, ~250 KB)      │
            │   - reads structuredContent from window.openai    │
            │   - renders markdown (marked + DOMPurify)         │
            │   - renders Adaptive Cards (adaptivecards v3)     │
            │   - renders citations, suggested actions          │
            │   - fullscreen mode with Copy/Print toolbar       │
            │   - on Submit click: calls back via callTool      │
            │   NO chat input. NO MSAL. NO CS connection here.  │
            └───────────────────────────────────────────────────┘
```

**The fundamental property:** the chat hot path is **host → MCP server → CS Direct Engine, server-side**. The widget is a pure renderer. No CS conversation lives in the browser; no auth lives in the browser. This is the inversion from v0.5, which tried to run CS-in-the-widget and failed against the skybridge sandbox.

## 2. Why this shape

Three constraints, in order of inflexibility:

1. **The skybridge sandbox has a null origin.** Browser-side MSAL `acquireTokenSilent` cannot reach `login.microsoftonline.com` from a null-origin iframe — it times out with `monitor_window_timeout`. There is no policy or CSP setting that fixes this; the sandbox is intentional. ⇒ Auth must happen server-side.

2. **M365 Copilot's widget UX guidelines forbid widget-internal chat.** The official guidance (`learn.microsoft.com/microsoft-365/copilot/extensibility`, 03/30/2026) says inline widgets must "fit comfortably within a single response scroll", must not duplicate chat features, and must not provide an internal chat input. ⇒ The widget renders data, the M365 Copilot host owns the chat input.

3. **Host LLM tool routing is description-sensitive.** Long verbose tool descriptions push the host into describe-instead-of-call mode (May-4 incident). Tool schemas captured at admin-approval time bind the routing — change them and routing breaks (May-3 incident, [ADR 0005](decisions/0005-arg-optionality-is-locked.md)). ⇒ Tool descriptions are short imperatives; schema changes need manifest version bumps.

Everything in this doc follows from those three.

## 3. Conversation id discipline

> **One id, one source.** CS owns it. The server caches it per (`oid` + M365 thread id). The widget never mints one.

### 3.1 Where the id comes from

The MCP server calls `client.startConversationStreaming()` (from `@microsoft/agents-copilotstudio-client`) the first time it sees a new `(oid, hostThreadId)` pair. CS allocates the conversation id and the SDK returns it. The server caches the id in `caches.ts` (in-process `Map`, TTL ~25 minutes — see [`mcp-server/src/caches.ts`](../mcp-server/src/caches.ts)).

On subsequent tool calls within the same host thread, the cache hits and the server reuses the same CS conversation — topic state continues.

### 3.2 The cache key — why `(oid + hostThreadId)`

M365 Copilot sets the `x-microsoft-ai-conversationid` header on every tool call (verified 2026-05-04 from production logs). It's stable for the lifetime of one chat thread. The host LLM *occasionally* echoes the `conversationId` we returned in `structuredContent` back as a tool argument, but unreliably (~60% of the time). Keying the server cache on the header gives us:

- Same host thread, follow-up turn → cache hit → reuse CS conversation → topic state survives ✓
- User starts a new M365 chat thread → different header → fresh CS conversation ✓
- Different user → different `oid` → isolated ✓

The header is the primary key. The `conversationId` echo is treated as a secondary hint.

### 3.3 What never happens

- ❌ The widget never generates a UUID and uses it as a conversation id.
- ❌ The MCP server never confuses the **MCP session id** (`Mcp-Session-Id` header, scoped to one transport) with the CS **conversation id**. Today we run stateless transport (no `Mcp-Session-Id` at all), so this is moot, but the distinction matters if anyone reintroduces session state.
- ❌ The host LLM never owns the id. It echoes it through `structuredContent.conversationId` for the widget's benefit (the widget passes it back when calling `submitAdaptiveCardAction`), but the server treats the cache as authoritative.

## 4. Components

### 4.1 MCP server (`mcp-server/`)

**Role:** the tool surface for `openCopilotStudioChat` + `submitAdaptiveCardAction`, the resource server for the widget HTML, and the actor that calls Copilot Studio Direct Engine on the user's behalf.

**Stack:** Node 20-LTS ESM, Express 4, `@modelcontextprotocol/sdk`, `@microsoft/agents-copilotstudio-client`, `jose` for JWT, Zod for tool input schemas.

**Single responsibilities:**

1. Validate inbound Bearer tokens (JWKS, cached) — [`auth.ts`](../mcp-server/src/auth.ts).
2. OBO-exchange for a Power Platform API token, cached per `oid` (~1h) — [`caches.ts`](../mcp-server/src/caches.ts) + `auth.ts`.
3. Call CS Direct Engine via `sendActivityStreaming`, drain until `ActivityTypes.EndOfConversation` — [`cs.ts`](../mcp-server/src/cs.ts).
4. Extract `replyText`, citations, Adaptive Cards, suggested actions, escalation state from CS activities.
5. Return `structuredContent` + `_meta` per the OpenAI Apps SDK contract — [`tools/`](../mcp-server/src/tools/), [`resources/chatWidget.ts`](../mcp-server/src/resources/chatWidget.ts).
6. Serve the widget HTML at `ui://mcsmcpapps/chat` with MIME `text/html+skybridge` — [`widget.ts`](../mcp-server/src/widget.ts).

**Module layout:**

```
mcp-server/src/
  index.ts            # HTTP host: routes, CORS, entraAuth middleware
  server.ts           # buildServer(): McpServer factory (tools + resource)
  config.ts           # loadConfig(): all env vars with JSDoc + defaults
  auth.ts             # JWT validation (JWKS cached) + OBO exchange
  caches.ts           # PP token cache + CS conversation id cache
  cs.ts               # CS Direct Engine drain loop + activity normalizer
  fileLogger.ts       # /home/LogFiles/Application/mcsmcpapps.log
  widget.ts           # widgetHtml: loads single-file bundle from disk
  tools/
    openCopilotStudioChat.ts      # the primary tool (every user message)
    submitAdaptiveCardAction.ts   # AC submit round-trip
  resources/
    chatWidget.ts                  # the ui://mcsmcpapps/chat resource
  scripts/
    smoke-mcp.mjs                  # pre-deploy locked-contract gate
```

Adding a tool = one file in `tools/` + one line in `server.ts`. Adding a resource = same in `resources/`. The HTTP host layer doesn't change.

**Transport:** Streamable HTTP, **stateless** (`sessionIdGenerator: undefined`). Fresh `McpServer` + `StreamableHTTPServerTransport` per request, closed on `res.close`. The reasoning is in [ADR 0002](decisions/0002-stateless-mcp-transport.md) — session-keyed transports broke the SDK init handshake against M365 Copilot's host.

**Explicit non-responsibilities:**

- ❌ Does not maintain any persistent state across requests (caches are best-effort, single instance).
- ❌ Does not authenticate end users itself — it validates host-supplied tokens, OBO-exchanges them, and uses them.
- ❌ Does not render UI; only ships the widget bundle as a resource.

### 4.2 Widget (`webchat-ui/src/widget-v2/`)

**Role:** the in-iframe React app. Pure renderer of `window.openai.toolOutput.structuredContent`.

**Stack:** Vite 5 production build, React 16 (NOT 18 — see [ADR 0001](decisions/0001-chat-in-chat-was-wrong.md)), TypeScript 5.6, `vite-plugin-singlefile` for the inlined HTML bundle. Renderers: [`adaptivecards`](https://www.npmjs.com/package/adaptivecards) v3 (Microsoft official), [`marked`](https://www.npmjs.com/package/marked), [`dompurify`](https://www.npmjs.com/package/dompurify).

**Key entry point:** [`webchat-ui/src/widget-v2/main.tsx`](../webchat-ui/src/widget-v2/main.tsx). One file, 831 lines, single React tree. Components: `<ReplyText>`, `<Citations>`, `<AdaptiveCardHost>`, `<SuggestedActions>`, `<ErrorState>`, with inline SVG sparkline.

**What it does:**

- Reads `window.openai.toolOutput.structuredContent` synchronously on mount.
- Renders markdown via `marked` → `DOMPurify.sanitize` → `dangerouslySetInnerHTML`.
- Renders each Adaptive Card via `AdaptiveCard.parse().render()` with a brand-mapped HostConfig.
- Wires Adaptive Card `Action.OpenUrl` → `window.openai.openExternal`.
- Wires Adaptive Card `Action.Submit` → `window.openai.callTool('submitAdaptiveCardAction', {...})`.
- Renders suggested action chips → `window.openai.callTool('openCopilotStudioChat', { userQuery: title, conversationId })`.
- Notifies host of intrinsic height via `notifyIntrinsicHeight`.
- Switches between inline and fullscreen modes via `requestDisplayMode`.

**What it deliberately does NOT do** (per [ADR 0001](decisions/0001-chat-in-chat-was-wrong.md) and MS UX guidelines):

- ❌ No chat input — M365 Copilot's input box is the chat.
- ❌ No internal scrolling — must fit in one response scroll.
- ❌ No MSAL — auth lives server-side.
- ❌ No `botframework-webchat` — 5 MB bundle, wrong pattern.
- ❌ No CS connection — the server already drained the conversation.

**Build constraints (load-bearing):**

- `mode: 'production'` + `define NODE_ENV: '"production"'` in Vite config. Without these the bundle includes `eval()` which the sandbox CSP blocks.
- The `stripCrossorigin` post-transform plugin removes `<script type="module" crossorigin>` from the inlined HTML. The null-origin sandbox iframe rejects crossorigin script tags silently. See [docs/WIDGET-CUSTOMIZATION.md "Don't break the skybridge bundle"](WIDGET-CUSTOMIZATION.md).

### 4.3 Declarative Agent (`declarative-agent/`)

**Role:** the M365 Copilot manifest. Points the host at our MCP server and declares the tool catalog the host LLM uses to plan calls.

**Files:**

```
declarative-agent/
  m365agents.yml          # Agents Toolkit lifecycle (provision/publish)
  teamsapp.yml            # legacy CLI shim (same content)
  appPackage/
    manifest.json         # Teams app manifest v1.22
    declarativeAgent.json # DA v1.6 — name, instructions, conversation_starters
    ai-plugin.json        # plugin v2.4 — functions[], runtimes[].spec.x-mcp_tool_description.tools[]
    color.png             # 192x192 icon
    outline.png           # 32x32 icon
  env/
    .env.dev              # TEAMS_APP_ID, TEAMS_APP_TENANT_ID, etc.
    .env.dev.user         # Toolkit-managed timestamps
```

**The locked surface** (must match `mcp-server/src/tools/*.ts` byte-for-byte after schema unrolling — the pre-deploy smoke test in [`mcp-server/scripts/smoke-mcp.mjs`](../mcp-server/scripts/smoke-mcp.mjs) enforces this):

- `functions[]` — every tool with `name` + one-sentence `description`.
- `runtimes[0].run_for_functions[]` — same names.
- `runtimes[0].spec.x-mcp_tool_description.tools[]` — every tool with full `inputSchema`, `annotations`, `_meta`.

The reference for this shape is [`mcp-interactiveUI-samples/oai-apps-sdk/trey-research/node/appPackage/ai-plugin.json`](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/appPackage/ai-plugin.json). Microsoft's own pattern: every tool (widget-rendering and pure-data) goes in all three lists. Widget-rendering tools get `_meta` with `openai/outputTemplate`; pure-data tools omit it.

**What the maker changes (one-time per tenant):**

- `manifest.json: id` — new GUID for their org.
- `manifest.json: developer.*` — their org info.
- `manifest.json: version` — bump on every publish that touches the locked surface.
- `declarativeAgent.json: name`, `description`, `instructions`, `conversation_starters`.
- `ai-plugin.json: spec.url` — their MCP server URL.
- `ai-plugin.json: auth.reference_id` — their TDP SSO registration ID.

### 4.4 Infrastructure (`infra/`)

**Bicep template** ([`main.bicep`](../infra/main.bicep)) provisions:

- App Service Plan (Linux, B1 Basic).
- App Service (Linux, Node 20-LTS) with `alwaysOn: true`, CORS allowlisting M365 Copilot widget host origins, app settings for CS env id, agent name, and the four `ENTRA_*` config knobs that enable Entra SSO mode.
- Static Web App (Free SKU) for the standalone WebChat surface (optional, only matters if you want to embed the agent on a public website too).

Deployment is plain `az deployment group create` ([infra/README.md](../infra/README.md)). There is no `azd up` — the repo does not include an `azure.yaml`. Application code deploys via GitHub Actions on push to `main`.

Cost: App Service B1 ~$13/month, SWA Free $0, App Insights pay-per-GB if enabled. Cross-region App Service quota is the most common provisioning friction — the original deployment uses `westus2` for SWA, `centralus` for App Service.

## 5. Authentication

> **Two boundaries.** End user → host (host owns it). Host → MCP server (Entra SSO + OBO). MCP server → CS Direct Engine (PP token from the OBO exchange).

### 5.1 End user → host

End user is already signed into M365 Copilot. We don't touch this.

### 5.2 Host → MCP server

The Declarative Agent's `ai-plugin.json` declares `auth.type = "OAuthPluginVault"` with a `reference_id` pointing at a Teams Developer Portal SSO registration. The TDP registration knows the Entra app reg client id and the API audience.

On every tool call, M365 Copilot:

1. Mints a user-Bearer token for the audience declared in the TDP SSO registration.
2. Sends it as `Authorization: Bearer <token>` on the POST to `/mcp`.

Our `auth.ts` validates: signature against the tenant's JWKS (cached), `aud` matches `ENTRA_AUDIENCE`, `iss` matches `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/v2.0`, `nbf`/`exp`. Failure → 401.

### 5.3 MCP server → CS Direct Engine (OBO)

Validated user token in hand, `auth.ts` calls the v2 token endpoint:

```
POST https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
client_id=<ENTRA_CLIENT_ID>
client_secret=<ENTRA_CLIENT_SECRET>
assertion=<inbound user Bearer>
scope=https://api.powerplatform.com/CopilotStudio.Copilots.Invoke
requested_token_use=on_behalf_of
```

Returns a Power Platform API access token, scoped to the **end user** (not to our service principal). Caches the result in `caches.ts` keyed on the user's `oid`, TTL = token's actual `expires_in` minus 60 sec.

The cached PP token is then used as the Bearer for `@microsoft/agents-copilotstudio-client` calls to Direct Engine. CS sees the call as the end user, including for Dataverse logging.

### 5.4 What we explicitly don't do

- ❌ Browser-side MSAL inside the skybridge widget. Removed in v0.6 — impossible to succeed in a null-origin sandbox.
- ❌ Server-side service-principal credentials calling CS. The whole point of OBO is that CS sees the call as the user.
- ❌ Bearer tokens cross to the browser. They stay in server memory.

Full setup checklist in [`docs/AUTH-ARCHITECTURE.md`](AUTH-ARCHITECTURE.md). The TDP SSO step is in [`docs/QUICK-START.md` Step 5](QUICK-START.md).

## 6. CSP and origin allowlists

The widget runs in a skybridge sandbox iframe. The sandbox honors `_meta.ui.csp` declared on the widget resource. Our resource ([`mcp-server/src/resources/chatWidget.ts`](../mcp-server/src/resources/chatWidget.ts)) declares:

```ts
csp: {
  connectDomains: [
    'https://*.api.powerplatform.com',
    'https://login.microsoftonline.com',
    swaOrigin
  ],
  resourceDomains: [],   // no external assets; everything inline
  frameDomains: []       // no sub-iframes
}
```

Important: in the **v0.6+ data-widget pattern**, the widget rarely needs `connectDomains` because the server does all the talking to Power Platform. The remaining entries are defensive — `login.microsoftonline.com` is harmless and would let a future build re-enable a browser-side flow if needed; the SWA origin is for the standalone channel, harmless in skybridge.

The standalone SWA (off-Copilot embedding) has its own CSP via [`webchat-ui/public/staticwebapp.config.json`](../webchat-ui/public/staticwebapp.config.json):

- `frame-ancestors`: `m365.cloud.microsoft`, `*.widget-renderer.usercontent.microsoft.com`, `copilot.microsoft.com`.
- `connect-src`: Power Platform API, login.microsoftonline.com.
- `img-src`: `data:`, `blob:` (for AC inline images).

## 7. Failure modes and recovery

| Failure | What user sees | What we do |
|---|---|---|
| App Service cold start (~10–15s) | Spinner on first tool call | `alwaysOn: true` keeps the worker warm in production. First turn after a deploy is still slower than warm follow-ups. |
| App Service crash | "Something went wrong" card | App Service auto-restarts; next tool call re-init succeeds. Stateless transport means no session to recover. |
| JWKS validation fails | 401 from `/mcp` | Host retries once; if persistent, the host shows a generic auth error. Surfaced in our file logger as `[auth] token rejected: <reason>`. |
| OBO exchange fails | Error card in widget | `structuredContent.diag` carries the OBO failure; widget renders `<ErrorState>`. Common cause: missing admin consent on `CopilotStudio.Copilots.Invoke`. |
| PP token cache miss + OBO down | Latency spike on first turn | No mitigation; transient by definition. |
| CS conversation cache miss | Slower first turn (~5-10s extra) | Cold path opens a new CS conversation; subsequent turns hit the cache. |
| CS topic crashes | Empty reply | CS retries OOB; we surface `diag.error` and the widget shows it. |
| Widget bundle 404 | Empty card | CI pipeline gates publish on widget bundle present in `dist/assets/widget.html`. |
| Host LLM emits args as plaintext | "Tool conflict" narration in chat | The locked-contract regression class. Pre-deploy smoke catches schema drift before it ships; recovery is to revert + manifest republish. [ADR 0005](decisions/0005-arg-optionality-is-locked.md). |
| Markdown XSS | N/A — we sanitize | `DOMPurify` runs on every `replyText` before injection. |

The most common live-failure mode is **OBO consent missing** in a new tenant: smoke S01 returns the diag card with `"OBO exchange failed (AADSTS65001)"`. Fix is the `az ad app permission admin-consent` step from [QUICK-START Step 5](QUICK-START.md).

## 8. Service level objectives (v0.7 → v1.0)

| SLO | v0.7 observed | v1.0 target |
|---|---|---|
| MCP server availability | ~99.0% (B1 single instance) | 99.9% (P1v3 + zone redundancy) |
| First-token p50 (warm, both caches hit) | ~2 s server time + 1-2 s host overhead | ≤ 2 s end-to-end |
| First-token p95 | ~8 s | ≤ 5 s |
| First-token cold (App Service spin-up + new CS conv) | 10–15 s | n/a — keep alwaysOn |
| Mid-session error rate | <1% in CDX | ≤ 0.5% |
| Locked-contract drift caught pre-deploy | 100% (CI smoke gate) | 100% |

Single B1 instance does not get us to 99.9%. v1.0 requires P1v3 with two instances + auto-scale, plus an external CS conversation cache (today's in-process Map dies on instance restart). See [PROGRESS.md "Deferred work"](PROGRESS.md).

## 9. Observability

| Signal | Where | What we log |
|---|---|---|
| MCP request | App Service file logger ([`mcp-server/src/fileLogger.ts`](../mcp-server/src/fileLogger.ts)) at `/home/LogFiles/Application/mcsmcpapps.log` | Per-request: `[auth]` outcome, `[tool]` invoke, OBO + cache state, `[cs]` round-trip, `[tool] CS done` summary |
| Smoke S01 result | Console (developer machine) or CI logs | 27 assertions; pass/fail per assertion |
| Widget boot | `window.__mcsmcpappsTrace` + `postMessage` to host | Phase timestamps (`module-bundle-evaluating`, `react-render-start`, `app-mounted`, etc.) |
| CS turn | Dataverse | OOB — full transcript per conversation, owned by the tenant |
| Errors | App Service log | Stack + request id |
| Host narration | M365 Copilot UI | Visible in chat; not log-accessible |

**We never log message content** at the MCP server — only sizes, counts, and diagnostic flags. CS does its own Dataverse logging in the customer's tenant. Widget telemetry is anonymous.

## 10. Modularity contracts

Each layer has a sharp seam:

- **Host ↔ MCP server:** the JSON-RPC over HTTPS contract. Change endpoint URL → update one line in `ai-plugin.json` `runtimes[0].spec.url`. Add a tool → one file in `tools/` + one line in `server.ts` + a manifest version bump.
- **MCP server ↔ CS:** the `@microsoft/agents-copilotstudio-client` API. Swap to a different CS environment → change `CS_ENV_ID` / `CS_SCHEMA` env vars. Swap to a non-CS bot → replace `cs.ts` entirely.
- **MCP server ↔ widget:** the `structuredContent` shape plus the `_meta.openai/outputTemplate` URI. Adding a new field is additive (older widgets ignore). Renaming or removing a field requires a coordinated widget + server release.
- **Widget ↔ host:** the `window.openai.*` bridge (toolInput, toolOutput, callTool, openExternal, requestDisplayMode, notifyIntrinsicHeight). Documented in [`docs/MCP-APPS-CONTRACT.md`](MCP-APPS-CONTRACT.md). Swap host → reimplement only the bridge calls.
- **CS ↔ broker (live agent):** CS Studio "Settings → Agent transfers" UI. No code on our side. Connect/disconnect per environment.

The reason this works: every seam is either a wire protocol (JSON-RPC, HTTPS, JSON) or a Microsoft-stable API surface. There are no shared in-memory types between layers — only payloads.

## 11. Future work

- **v0.7.3** — finish the escalation widget banner + magic-ping (spec written, server side shipped, widget pending — [spec 0004](specs/0004-escalation-detection.md)).
- **v0.7.4** — streaming partial replies. Blocked on M365 Copilot platform: today's `tools/call` returns one final payload; widget cannot subscribe to incremental updates. ([FR 5.1](FEATURE-REQUESTS.md)).
- **v0.8** — file downloads ([FR 6.1](FEATURE-REQUESTS.md)), voice gaps documented ([FR 7.x](FEATURE-REQUESTS.md)).
- **v1.0** — productize: scale-out infra (P1v3 + zone redundancy), external CS conversation cache (Redis), service-principal credential rotation (federated credentials instead of client secret), post-deploy live-endpoint smoke gate.
- **v2.0** — multi-tenant SaaS, customer onboarding console.

## Decisions log

Architecture-level decisions live as ADRs in [`docs/decisions/`](decisions/):

| ADR | What it covers |
|---|---|
| [0001](decisions/0001-chat-in-chat-was-wrong.md) | Why we abandoned the chat-in-chat widget pattern |
| [0002](decisions/0002-stateless-mcp-transport.md) | Why the MCP transport is stateless (per-request `McpServer`) |
| [0003](decisions/0003-entra-sso-via-tdp-registration.md) | Why Entra SSO runs server-side via Teams Developer Portal registration |
| [0004](decisions/0004-render-adaptive-cards-in-widget.md) | Why the widget renders Adaptive Cards in-process (Microsoft renderer + brand HostConfig) |
| [0005](decisions/0005-arg-optionality-is-locked.md) | Tool input arg optionality is part of the locked-contract surface |

Implementation milestones live as specs in [`docs/specs/`](specs/). Open the matching spec before changing a contract.
