# MCSMCPapps — Architecture

> Read [SPEC.md](SPEC.md) first for goals/non-goals. This doc describes **how** we deliver them.
> If you change architecture, update §[Decisions log](#decisions-log) at the bottom of this file.

## 1. The 60-second story

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Microsoft 365 Copilot                          │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  Declarative Agent: "Eurozone Analyst"                       │    │
│  │  - manifest v1.22, plugin v2.4                               │    │
│  │  - runtime type: RemoteMCPServer                             │    │
│  │  - tools: openCopilotStudioChat                              │    │
│  └────────────────────────────┬─────────────────────────────────┘    │
│                               │ MCP over HTTPS                       │
│                               │ (initialize / tools/call /           │
│                               │  resources/read)                     │
└───────────────────────────────┼──────────────────────────────────────┘
                                │
                  ┌─────────────▼─────────────┐
                  │  MCP server (App Service)  │   THIN.
                  │  app-mcsmcpapps-mcp...     │   Two jobs:
                  │                            │   1. Serve widget HTML
                  │  POST /mcp → JSON-RPC      │   2. Tool descriptors
                  │  GET  /mcp → SSE channel   │   No chat in path.
                  │  resources/read →          │
                  │    text/html+skybridge     │
                  └─────────────┬──────────────┘
                                │ returns
                                │ ui://mcsmcpapps/chat
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│           Skybridge sandbox iframe (in M365 Copilot)                 │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  React widget (single-file bundle, ~120 KB gzip)             │    │
│  │  - reads userQuery via window.openai bridge                  │    │
│  │  - acquires PowerPlatform API token (MSAL silent SSO)        │    │
│  │  - opens CS Wave-2 conversation via SDK                      │    │
│  │  - renders BotFramework Web Chat (Composer + BasicWebChat)   │    │
│  │  - applies brand vars (CSS custom props)                     │    │
│  └──────────────────────────────┬───────────────────────────────┘    │
└─────────────────────────────────┼────────────────────────────────────┘
                                  │ Direct Engine API
                                  │ (CS Wave-2)
                                  │ Bearer: Power Platform API token
                                  │ scope: CopilotStudio.Copilots.Invoke
                                  ▼
              ┌──────────────────────────────────────────┐
              │         Copilot Studio agent             │
              │   environment: 61453fde-...              │
              │   schema: ksteam_ak001                   │
              │   - topics, knowledge, agentic flow      │
              │   - Dataverse logging (OOB)              │
              │   - Settings → Agent transfers →         │
              │     Omnichannel → connected (OOB)        │
              └─────────────────────────┬────────────────┘
                                        │ on escalation
                                        │ (OOB connector,
                                        │  not our code)
                                        ▼
              ┌──────────────────────────────────────────┐
              │   Dynamics 365 Omnichannel for CCaaS     │
              │   - live agent picks up                  │
              │   - full context transcript              │
              │   - relays back through CS conversation  │
              └──────────────────────────────────────────┘
```

The chat hot path is **widget → CS SDK → CS**. The MCP server is **not in it**. This is the
single most important architectural property: latency, reliability, and conversation-id
discipline all flow from this.

## 2. Conversation id discipline

> **One id, one source.** CS owns it. We pass it through. We never mint our own.

### 2.1 Where the id comes from

When the widget calls `client.startConversationAsync()` (via `CopilotStudioWebChat.createConnection`),
the SDK opens a new CS conversation **and CS allocates the id**. The widget receives a
"conversation update" activity carrying `conversation.id`.

This is **the** id for everything downstream:

- Subsequent `sendActivity` calls carry it
- Streaming reply activities carry it
- CS tools / topics see it in turn context
- D365 Omnichannel handoff inherits it via the OOB connector
- Dataverse transcript rows are keyed on it

### 2.2 What we never do

- ❌ The widget never generates a UUID and uses it as a conversation id
- ❌ The MCP server never generates a "session id" and tries to map it to a CS conversation
- ❌ The DA + RemoteMCPServer protocol uses an `mcp-session-id` header — that is **the MCP
      session id**, scoped to a single MCP client connection. It is **not** a CS conversation
      id and we never conflate them

### 2.3 What the maker should know

- The same end user can have multiple CS conversations across time. Each gets its own id.
- M365 Copilot may show one chat thread that contains multiple invocations of our DA →
  multiple widget mounts → multiple CS conversations. That's expected.
- If you want to *resume* a CS conversation across widget mounts, persist the conversation
  id at the host layer and re-use it. (Not in v0.5; see [Future](#11-future-work).)

## 3. Components

### 3.1 MCP server (`mcp-server/`)

**Role:** thin host for the widget HTML and the tool surface that triggers it.

**Stack:** Node 20 ESM, Express 4, `@modelcontextprotocol/sdk` 1.29 with
`StreamableHTTPServerTransport`, Zod for tool input schemas.

**Single responsibilities:**

1. Respond to `initialize` / `tools/list` / `tools/call` / `resources/read`.
2. Return the widget HTML at `ui://mcsmcpapps/chat` with MIME `text/html+skybridge` (verified
   contract — see [MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md)).
3. Return a tool descriptor for `openCopilotStudioChat` with the OpenAI Apps SDK
   `_meta` shape (`outputTemplate`, `widgetAccessible`, `toolInvocation/*`).

**Explicit non-responsibilities:**

- ❌ Does not proxy chat traffic
- ❌ Does not hold conversation state
- ❌ Does not authenticate end users
- ❌ Does not call CS

**Module layout:**

```
mcp-server/src/
  index.ts            # HTTP host: routes, session map, health
  server.ts           # buildServer(): McpServer factory (tools + resources)
  config.ts           # loadConfig(): all env vars w/ JSDoc + defaults
  widget.ts           # widgetHtml: imports build artifact from ../webchat-ui/dist-widget/
  tools/
    openCopilotStudioChat.ts   # the only v0.5 tool
  resources/
    chatWidget.ts     # the ui:// resource
```

Adding a new tool = one new file in `tools/`. Adding a new resource = one new file in
`resources/`. `server.ts` imports them.

### 3.2 WebChat UI (`webchat-ui/`)

**Role:** the user-facing React app. **Two delivery channels from one source:**

- **Channel A — Skybridge widget** built via `vite-plugin-singlefile` to a single inlined
  HTML. Output: `webchat-ui/dist-widget/widget.html`. Imported at build time by the MCP
  server.
- **Channel B — Standalone WebChat** built via standard Vite to `webchat-ui/dist/`. Deployed
  to Azure Static Web Apps. Public URL.

Both channels share the same React component tree. A `host` prop (or a build-time `define`)
toggles a small set of host-aware behaviors (e.g. listen to `window.openai` only in widget,
do interactive MSAL login only in standalone).

**Stack:**
- Vite 5 + TypeScript 5.6
- React 18 (added in v0.5 — required by `botframework-webchat` Composer)
- `botframework-webchat` (Composer + BasicWebChat) — OOB transport+rendering
- `@microsoft/agents-copilotstudio-client` — Wave-2 client + `CopilotStudioWebChat.createConnection()`
- `@azure/msal-browser` — silent SSO
- `@microsoft/teams-js` — host detection in M365 Copilot/Teams

**Module layout:**

```
webchat-ui/src/
  index.tsx           # entry: mount React, choose host
  App.tsx             # the React app (FluentThemeProvider + Composer + BasicWebChat)
  branding.ts         # readBrand(): all VITE_BRAND_* vars
  branding.css        # CSS custom props bound to brand
  cs/
    connection.ts     # createCsConnection(token): wraps CopilotStudioWebChat.createConnection
    auth.ts           # acquireToken(): MSAL silent SSO chain
  host/
    detect.ts         # detectHost(): "m365copilot" | "swa" | "dev"
    skybridge.ts      # readToolInput(), postReady(), bridge wiring
  index.html.template # template used by Vite for both channels
```

**Module layout principle:** `cs/` is OOB SDK calls, `host/` is host-bridge plumbing,
`branding/` is presentation. Maker swapping CS agent edits `webchat-ui/.env`. Maker
adding a UI feature edits `App.tsx` or adds a sibling component. Maker rebranding edits
the env vars; nothing else.

### 3.3 Declarative Agent (`declarative-agent/`)

**Role:** the M365 Copilot manifest that points at our MCP server.

**Files:**

```
declarative-agent/
  m365agents.yml          # toolkit lifecycle (provision/publish)
  teamsapp.yml            # legacy CLI shim (same content)
  appPackage/
    manifest.json         # Teams app manifest v1.22
    declarativeAgent.json # DA v1.6 with instructions + tool ref
    ai-plugin.json        # plugin v2.4 with RemoteMCPServer runtime
    color.png             # 192x192 icon
    outline.png           # 32x32 icon
  env/
    .env.dev              # TEAMS_APP_ID, TEAMS_APP_TENANT_ID, etc.
    .env.dev.user         # TEAMS_APP_UPDATE_TIME timestamps
```

**What the maker changes:**
- `manifest.json: id` (their own GUID)
- `manifest.json: developer.*` (their org info)
- `declarativeAgent.json: name`, `description`, `instructions`, `conversation_starters`
- `ai-plugin.json: spec.url` (their MCP server URL)
- `manifest.json: version` (bump on every publish)

### 3.4 Infrastructure (`infra/`)

**Bicep modules** (one file each):

```
infra/
  main.bicep            # entry, params
  swa.bicep             # Static Web App for the standalone channel
  appservice.bicep      # App Service (B1 Linux Node 20) for MCP
  rg.bicep              # resource group
  identity.bicep        # managed identity (future use, not in v0.5 hot path)
```

**Important parameters** (all in `main.bicepparam`):

| Param | Default | Why |
|---|---|---|
| `location` | `westus2` | SWA Free tier |
| `mcpLocation` | `centralus` | B1 quota workaround |
| `swaName` | `swa-mcsmcpapps` | |
| `mcpName` | `app-mcsmcpapps-mcp` | |
| `agentName` | "Eurozone Analyst" | injected as App Setting |
| `swaOrigin` | computed | injected as MCP App Setting for CSP |

## 4. Data flows

### 4.1 First message in M365 Copilot

```
1. user types Q in M365 Copilot
2. host model in Copilot decides to call openCopilotStudioChat(userQuery=Q)
3. POST /mcp { method: "tools/call", params: { name, args:{ userQuery:Q } } }
4. MCP server returns:
   {
     content: [{ type: "text", text: "..." }],
     structuredContent: { userQuery: Q },
     _meta: {
       "openai/outputTemplate": "ui://mcsmcpapps/chat",
       "openai/widgetAccessible": true,
       mcsmcpapps: { userQuery: Q }
     }
   }
5. M365 Copilot host fetches resources/read for ui://mcsmcpapps/chat
6. MCP server returns text/html+skybridge body (the inlined React bundle)
7. Skybridge mounts iframe with that HTML
8. React boots:
     - readToolInput() reads userQuery from window.openai.toolInput
     - acquireToken() runs MSAL silent SSO
     - createCsConnection(token) → BotFramework Web Chat Composer
     - first user message sent (the captured userQuery)
9. CS streams reply activities → Web Chat renders inline
```

### 4.2 Subsequent messages

After step 9, the user types directly in the widget. Web Chat → CS SDK → CS. The MCP
server is not contacted again unless the user closes M365 Copilot, opens a new chat, and
re-triggers the DA.

### 4.3 Escalation

```
1. CS topic detects escalation phrase OR user clicks Adaptive Card "Connect to agent"
2. CS topic node "Transfer to agent" fires (configured in CS Studio UI)
3. CS routes via the OOB Omnichannel connector
4. D365 Omnichannel queues the conversation, picks an available agent
5. Live agent picks up, gets transcript via Omnichannel UI
6. Agent's messages flow back through CS as normal activities
7. Our widget renders them indistinguishably from bot messages
   (CS marks them as "from agent" in the activity payload; widget can label)
8. On resolution, agent ends conversation; CS topic resumes its "after escalation" branch
```

**Crucial:** none of steps 3–7 involve our MCP server. This is OOB CS. We get it for free.

## 5. Authentication

### 5.1 Widget → CS

- Widget acquires a Power Platform API access token via MSAL.
- Scope: `https://api.powerplatform.com/CopilotStudio.Copilots.Invoke`
- Acquisition order:
  1. **Teams JS** if running in M365 Copilot host (hopes for the host's identity)
  2. **MSAL silent SSO** using the Entra app registration (single-tenant, SPA platform)
  3. **MSAL popup** as last resort (only meaningful in standalone SWA, not skybridge — sandbox
     blocks popups)
- Token is held in widget memory only. Refresh on `expiresOn`. No long-term cache in widget.

### 5.2 MCP server → anything

The MCP server in v0.5 calls **nothing**. No auth.

In v2 (when we add escalation tools for non-OOB brokers), the MCP server uses Managed
Identity to call those broker APIs. End-user identity propagation (OBO) via the AAD app reg
is documented in [AUTH-ARCHITECTURE.md](AUTH-ARCHITECTURE.md) but not in the v0.5 hot path.

### 5.3 Entra app registration

Single-tenant **SPA** app reg in the customer's tenant.

- Redirect URIs: `https://<swa>.azurestaticapps.net`, `https://<swa>...microsoft.com`
  (skybridge sandbox host — discovered at runtime)
- API permission: `https://api.powerplatform.com/CopilotStudio.Copilots.Invoke` (delegated)
- Federated credentials, not client secrets — secret-free posture

## 6. CSP and origin allowlists

The widget's CSP is declared on the resource via `_meta.ui.csp`:

```ts
csp: {
  connectDomains: [
    "https://api.powerplatform.com",
    "https://login.microsoftonline.com",
    "https://*.cloud.microsoft" // for skybridge bridge
  ],
  resourceDomains: [
    "https://res.cdn.office.net" // host fonts
  ],
  // We do NOT use frameDomains. The widget is single-file.
}
```

Standalone SWA CSP (in `staticwebapp.config.json`) allowlists:
- `frame-ancestors`: `https://m365.cloud.microsoft`, `https://*.widget-renderer.usercontent.microsoft.com`,
  `https://copilot.microsoft.com`
- `connect-src`: same as above
- `img-src`: `data:`, `blob:` (for inline charts)

## 7. Failure modes and recovery

| Failure | What user sees | What we do |
|---|---|---|
| MCP server cold start (10–15s) | Spinner, then load | App Service `alwaysOn=true` keeps warm |
| MCP server crashed | "Something went wrong" card | App Service auto-restarts; next tool call re-init |
| MCP session evicted (process restart, scale-in) | 404 "Session not found" on next call | Client (M365 Copilot) re-runs initialize; transparent |
| MSAL silent fails (cookie blocked) | Spinner | Fall back to Teams JS; if also fails, surface error toast |
| CS conversation token expired | Send activity rejected | SDK refreshes; transparent |
| CS topic crashes | Empty reply | CS retries OOB; we surface a "no reply" timeout after 30s |
| Omnichannel queue full | "Please wait, agents busy" message from CS | OOB CS behavior; no code |
| Widget bundle 404 | Empty card | Build pipeline gates publish on widget present |

The "Session not found" recovery story is critical: see [MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md)
for the why.

## 8. Service level objectives (v0.5 → v1.0)

| SLO | v0.5 target | v1.0 target |
|---|---|---|
| MCP server availability | 99.0% | 99.9% |
| Widget bundle availability | 99.5% | 99.9% |
| End-to-end first-token p50 (warm) | ≤ 4 s | ≤ 2 s |
| End-to-end first-token p95 | ≤ 10 s | ≤ 5 s |
| Mid-session error rate | ≤ 5% | ≤ 0.5% |
| Escalation handoff success | ≥ 95% | ≥ 99% |

Single B1 instance does not get us to 99.9% on availability. v1.0 requires either P1v3
(2 instances) + zone redundancy, or auto-scale rules. Documented in
[CAPABILITIES.md](CAPABILITIES.md).

## 9. Observability

| Signal | Where | What we log |
|---|---|---|
| MCP request | App Insights | jsonrpc.method, session id, response code, latency |
| Widget boot | App Insights (browser SDK) | host detect, token acquire ms, first message ms |
| CS turn | Dataverse | OOB — full transcript per conversation |
| Escalation | Omnichannel reports | OOB — queue, agent, duration |
| Errors | App Insights | stack, request id |

Important: we do **not** log message content from the user or agent at the MCP server. CS
logs in Dataverse (the customer's own data). The standalone SWA does not log content
either. Widget telemetry is anonymous.

## 10. Modularity contracts

This is the bit that makes the code productizable: each layer has a sharp boundary.

- **MCP server ↔ widget:** the `_meta["openai/outputTemplate"]` URI. Change the URI →
  change one line in tool descriptor and one in resource registration. Done.
- **Widget ↔ CS:** the `CopilotStudioWebChat.createConnection(client, opts)` call. Swap
  the connection object → swap the brain. (Hypothetically, you could plug a Bot Framework
  Skill connection here for non-CS bots.)
- **Widget ↔ host:** the `host/skybridge.ts` module. Swap it for a `host/teams.ts` to
  embed in a Teams personal tab.
- **MCP server ↔ host:** the `_meta` keys. We keep both `openai/*` (today) and `ui/*` (MCP
  Apps spec future). Swapping which one M365 Copilot reads is a one-line change.
- **CS ↔ broker:** `Settings → Agent transfers` in CS Studio. No code. Connect / disconnect
  per environment.

## 11. Future work

- **v0.6** — multi-region MCP server, paid SWA tier with private endpoint
- **v0.7** — additional non-OOB brokers (Genesys, LivePerson) via MCP escalation tools
- **v1.0** — productization checklist complete (see [SPEC.md §7 metrics](SPEC.md#7-success-metrics))
- **v1.x** — voice channel, file upload from widget
- **v2.0** — multi-tenant SaaS deployment, customer onboarding console

## Decisions log

Every architecture-level decision must be in [SPEC.md §11](SPEC.md#11-decisions-and-the-assumptions-behind-them)
**and** in code comments at the relevant module. Out-of-spec deviations get a TODO with a
GitHub issue link or they don't merge.
