# Bringing your Copilot Studio agent into Microsoft 365 Copilot — with your own UI

> **Audience:** technical, hands-on. PMs, architects, makers who've deployed CS agents
> already and want to know what it takes to put a custom-branded UI on top of them inside
> M365 Copilot.
>
> **TL;DR:** It's a Declarative Agent + a remote MCP server + a single-file React widget,
> rendered inside the M365 Copilot "skybridge" sandbox. The CS agent is unchanged. We open
> source the whole reference at [github.com/KarimaKT/MCSMCPapps](https://github.com/KarimaKT/MCSMCPapps).
> The trick was three undocumented contract details that took us a few days of trial and
> error to nail down — captured below so you don't repeat them.

## What we built

A Eurozone economic analyst.

- **Brain:** Microsoft Copilot Studio agent with topics for "GDP comparison," "inflation
  trends," "monetary policy briefings." Knowledge sources: Eurostat, ECB releases. Dataverse
  logging on by default.
- **Surface:** Microsoft 365 Copilot. The user opens M365 Copilot, picks "Eurozone Analyst"
  in the agent picker, and gets a fully custom UI inside the chat: branded header, message
  stream styled to a customer brand, inline charts (returned by Power Automate quickchart),
  Adaptive Card forms, suggested actions.
- **Escalation:** OOB Dynamics 365 Omnichannel for Customer Service. The CS agent's Settings
  → Agent transfers → Omnichannel tile is connected; a live agent picks up when the user
  asks for one. We wrote zero escalation code; CS does it natively.
- **Hosting:** Azure App Service (B1 Linux, Node 20) for the MCP server, Azure Static Web
  Apps (Free) for the standalone web channel, ~$15/mo total.

## Why this is interesting

Microsoft 365 Copilot today gives you two extremes:

1. **CS native channel.** Plug your CS agent into M365 Copilot in two clicks. You get the
   plain M365 Copilot chat surface — clean, but identical to every other agent in the picker.
2. **Hand-roll a Declarative Agent + custom MCP server.** Maximum freedom; everyone
   reinvents the same scaffolding from scratch (auth, session, transport, bridge, escalation,
   branding) and most fail before reaching production.

This pattern threads the gap. You keep CS as the brain (because that's where your topics,
knowledge, Dataverse logs, and OOB Omnichannel handoff live), but you wrap it in your own
React UI inside M365 Copilot.

The CS team owns the brain. The custom UI team owns the surface. Both teams iterate
independently.

## The architecture in one diagram

```
M365 Copilot host  ── DA + RemoteMCPServer ──▶  MCP server (App Service)
                                                       │
                                       returns ui://… resource (HTML)
                                                       │
                                                       ▼
                              Skybridge sandbox iframe in M365 Copilot
                                  React widget bundle (single file)
                                                       │
                              CopilotStudioWebChat.createConnection()
                              (OOB SDK, Direct Engine API)
                                                       │
                                                       ▼
                                       Copilot Studio agent
                                                       │
                                       (escalation) OOB connector
                                                       │
                                                       ▼
                              D365 Omnichannel for Customer Service
```

The chat hot path is **widget → CS SDK → CS**. The MCP server is **not in it**. That's the
single most important architectural decision and it falls out of one principle: keep the CS
conversation id as the only id. CS allocates it, the SDK plumbs it, the widget displays
activities tagged with it, escalation inherits it. We never mint a parallel id anywhere.

## The four contract details that cost us days

If you build this, you will hit these. Here they are up front.

### 1. The widget's resource MIME must be `text/html+skybridge`

Not `text/html`. Not `text/html;profile=mcp-app` (which is the future MCP Apps spec name).
**`text/html+skybridge`** is what the M365 Copilot host actually checks.

```ts
// mcp-server/src/resources/chatWidget.ts
const WIDGET_MIME_TYPE = 'text/html+skybridge';

server.registerResource(
  'chat-widget',
  'ui://mcsmcpapps/chat',
  {
    mimeType: WIDGET_MIME_TYPE,  // ← descriptor
    _meta: { /* see #2 */ }
  },
  async () => ({
    contents: [{
      uri: 'ui://mcsmcpapps/chat',
      mimeType: WIDGET_MIME_TYPE,  // ← AND on the content
      text: widgetHtml,
    }]
  })
);
```

Verified against Microsoft's own [`mcp-interactiveUI-samples`](https://github.com/microsoft/mcp-interactiveUI-samples)
reference (`oai-apps-sdk/trey-research/node/src/mcpserver/server/src/mcp-server.ts`).

If you use any other MIME, you get a blank card. No diagnostic, no error — just a silent
failure that looks identical to "the model didn't call your tool." We spent a day chasing
it as a model-routing problem.

### 2. Tool `_meta` must set both `openai/outputTemplate` AND `openai/widgetAccessible`

The MCP Apps spec has nice clean names: `_meta.ui.resourceUri`, `_meta.ui.preferredDisplayMode`.
The OpenAI Apps SDK has older names: `_meta["openai/outputTemplate"]`, `_meta["openai/widgetAccessible"]`.
M365 Copilot today reads the **OpenAI** keys. Set both for forward compat.

```ts
_meta: {
  // What M365 Copilot reads today:
  'openai/outputTemplate': 'ui://mcsmcpapps/chat',
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Opening Eurozone Analyst…',
  'openai/toolInvocation/invoked': 'Eurozone Analyst ready.',
  // What MCP Apps spec wants (forward compat):
  ui: { resourceUri: 'ui://mcsmcpapps/chat', preferredDisplayMode: 'inline' }
}
```

Critically, this `_meta` block must appear in **three** places: the tool descriptor (so
`tools/list` advertises it), the resource descriptor (so `list_resources` advertises it),
and **the tool RESPONSE** (so each `tools/call` re-advertises which template to render).

Microsoft's reference does this with one helper called `descriptorMeta(widget)` reused
across all three sites. We follow the pattern.

### 3. Iframing an external origin from inside the widget doesn't work

The OpenAI Apps SDK docs allow `_meta.ui.csp.frameDomains` for embedding iframes inside the
widget. In theory, you can list your external origin and iframe your existing SPA. **In
practice, this is "discouraged and apps that declare it face stricter review."** We tried.
The widget loaded, the inner iframe never mounted, and there was no diagnostic.

The supported pattern is to **bundle your UI as a single-file HTML resource**. We use
`vite-plugin-singlefile` to produce one HTML file with everything (React, CSS, fonts) inlined.
The MCP server imports that HTML at build time and returns it from `resources/read`.

Microsoft's `trey-research` sample does the same. So does `fieldops`, `approvals-box`,
`zava-insurance`. Every one of Microsoft's ~5 official samples bundles single-file. There's
a reason.

### 4. Strip `crossorigin` from inline scripts (this one we found by reading source)

You did everything right: `text/html+skybridge` MIME, the `_meta` keys on three sites, single
file bundle, CSP allowlists. You deploy. The card mounts at the right size — your 5 MB bundle
is on the wire — but the React app never executes. Empty card, no console error, nothing.

The reason: Vite (and most modern bundlers) emit:

```html
<script type="module" crossorigin>...</script>
```

The skybridge sandbox iframe has a **null origin**. The browser performs a CORS check on
inline scripts marked `crossorigin`, sees null, and silently refuses to execute. The HTML
loaded, the script body is in the document, the React app is right there — and nothing runs.

Microsoft's reference repo solves it with a single Vite plugin
([oai-apps-sdk/trey-research/.../widgets/build.mts](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/src/mcpserver/widgets/build.mts)):

```ts
function stripCrossorigin(): Plugin {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/<script([^>]*)\s+crossorigin(?:="[^"]*")?/g, '<script$1');
    }
  };
}
```

There is **no documentation** of this requirement in the OpenAI Apps SDK docs, the M365 Copilot
Learn pages, or the MCP Apps spec. The only way you find it is by cloning the reference repo
and reading the build script. We added the same plugin to our config and the widget mounted
on the next deploy.

We also force `mode: 'production'` and `define: { 'process.env.NODE_ENV': '"production"' }` —
without these, Vite leaks HMR / dev-only code that uses `eval` and `new Function()`, both of
which the sandbox CSP blocks.

## What we used OOB — and what we wrote ourselves

We took an explicit "OOB-first" stance. Anywhere we caught ourselves writing transport,
session, or activity-rendering code, we asked: does the SDK do this already?

**OOB used:**

- `@microsoft/agents-copilotstudio-client` — `CopilotStudioClient` for Direct Engine,
  `CopilotStudioWebChat.createConnection()` for the BotFramework Web Chat adapter.
- `botframework-webchat` — the Composer + BasicWebChat React components. Streaming, typing
  indicators, suggested actions, Adaptive Cards, attachments — all OOB.
- `@azure/msal-browser` — silent SSO for the Power Platform API token.
- `@microsoft/teams-js` — host detection (M365 Copilot vs. standalone).
- D365 Omnichannel handoff via CS Studio Settings → Agent transfers.
- Dataverse transcript logging (CS does it; we surface a link to the customer admin).

**What we wrote ourselves:**

- The MCP server itself — but it's tiny, ~250 lines, and only because the JS MCP SDK is
  generic.
- Branding — 8 build-time CSS custom-property env vars, no runtime API.
- A skybridge bridge module to read tool input from `window.openai` and post `ready` to the
  parent.

That's it. The temptation to write our own transport / session / Adaptive Card renderer was
strong (we did the first pass that way and ripped it out) and the lesson is: every hour you
spend reinventing what the SDK does is an hour bleeding into the test matrix.

## Conversation id discipline

The most important architectural property is also the simplest principle: **CS allocates the
conversation id; we never mint a parallel one.**

When the widget calls `CopilotStudioWebChat.createConnection()`, the SDK opens a new CS
conversation. CS returns an id. From that point on:

- Every `sendActivity` carries it.
- Every reply activity carries it.
- CS topic logic sees it in turn context and uses it for state.
- D365 Omnichannel handoff inherits it via the OOB connector.
- Dataverse rows are keyed on it.

What we never do:

- Generate a UUID in the widget and use it as a conversation id.
- Generate a "session id" in the MCP server and try to map it to a CS conversation. (The
  MCP protocol does have a session id — `mcp-session-id` header — but that's the MCP-client
  ↔ MCP-server session, not the CS user ↔ CS agent conversation. Don't conflate them.)

This discipline pays off everywhere. State stays consistent across container restarts (CS
holds it). Escalation works without us writing escalation code (Omnichannel uses the same
id). Logs join cleanly across systems (Dataverse, App Insights, Omnichannel) on one key.

## What we tried — and reverted

In the spirit of saving you time, here's what didn't work and why.

### The iframe-of-SWA design (reverted in phase 5h)

We started by hosting the WebChat React app at a public Static Web App URL and having the
widget HTML iframe it. The reasoning: same source, same deployment, M365 Copilot widget = a
2-line shell, public web embed = the same SPA at its own URL.

It produced a blank card in M365 Copilot. We chased CSP issues, skybridge MIME, `_meta`
keys, sandbox flags. None fixed it. The iframe simply doesn't reliably mount in skybridge.

The fix was structural: bundle the SPA as single-file HTML, inline it into the widget. We
kept the SWA deploy as a *separate* output of the same React source — both targets, one
codebase. The SWA is the public-web channel; the widget is the M365 Copilot channel.

### The stateless MCP server (reverted in phase 5g.1)

Trying to dodge "Something went wrong" mid-session, we removed the session map and built
a fresh `McpServer` per request. The MCP TS SDK enforces an init handshake at the
`McpServer` instance level, so the second call (the actual `tools/call`) hit "Server not
initialized."

The fix was to keep the standard session-keyed transport, but return **HTTP 404 with
JSON-RPC error -32001 "Session not found"** when an unknown session id arrives (e.g. after
a container restart). Well-behaved MCP clients (M365 Copilot included) drop the session and
re-initialize. The user's next message after a restart silently re-inits on whatever
instance answers, no visible error.

### Aggressive DA instructions (reverted in phase 5g.2)

To force the DA model to call our tool on every turn, we wrote: *"For ANY user message —
your ONLY action is to call the openCopilotStudioChat tool with userQuery=…"*

The model dutifully wrote that JSON as a chat reply: *"Ok invoke. {"tool":"openCopilotStudioChat","args":{"userQuery":"…"}}"*. Classic over-prompt.

The fix: rewrite as natural language. *"Eurozone Analyst is a specialist Copilot Studio
agent that answers every question about the Euro area: GDP… ECB… You do not have access to
that knowledge yourself. The only way to answer the user is to call openCopilotStudioChat,
passing the user's text as userQuery."* Modern function-calling models route on the
function description, not the system prompt; lean on that.

## How a maker rebrands

The whole point of an open-source reference is that someone else can fork it and have their
own version live in 30 minutes. Here's the maker workflow:

```pwsh
# 1. Clone
git clone https://github.com/KarimaKT/MCSMCPapps
cd MCSMCPapps

# 2. Set the 8 brand vars + your CS env id in webchat-ui/.env
copy webchat-ui\.env.dev.sample webchat-ui\.env.dev
# Edit:
#   VITE_CS_ENVIRONMENT_ID, VITE_CS_SCHEMA_NAME, VITE_CS_TENANT_ID
#   VITE_ENTRA_CLIENT_ID
#   VITE_BRAND_AGENT_NAME, VITE_BRAND_LOGO_TEXT, VITE_BRAND_ACCENT, etc.

# 3. Set your DA manifest id and developer info
# Edit declarative-agent/appPackage/manifest.json:
#   id (your own GUID), developer.{name,websiteUrl,privacyUrl,...}

# 4. Build
npm install
npm run build  # builds widget + SWA + MCP server

# 5. Deploy infra
azd up  # provisions App Service + SWA, deploys both

# 6. Publish DA to your tenant
cd declarative-agent
npx -y -p @microsoft/teamsapp-cli@3.1.1 teamsapp publish --env dev

# 7. Have your tenant admin approve the app in Teams Admin Center
#    (this is the painful step — see FEATURE-REQUESTS.md)

# 8. Open M365 Copilot, pick your agent, ask a question
```

If steps 1–6 take more than 30 minutes for a maker who already has a CS agent, we count it
as a bug.

## What we want from Microsoft

The pattern works. The maker friction is mostly about discoverability of the contract and
about admin-approval velocity. We wrote a [feature request doc](FEATURE-REQUESTS.md) with
specific asks for the M365 Copilot extensibility, DA, and Apps SDK teams:

- Document the skybridge widget contract on Learn (MIME, `_meta` keys, postMessage shape).
- Add a "pending updates" view to Teams Admin Center (so makers can see their published
  update is queued).
- Trusted-publisher tier for non-substantive updates (so prompt edits don't gate on a
  human admin click).
- A maker scaffold (`npm create @microsoft/copilot-widget`) that produces a working widget
  in 5 minutes.

The pattern is solid; it just needs productization.

## Where to go from here

- **Spec & design:** [docs/SPEC.md](SPEC.md), [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- **The contract recipe:** [docs/MCP-APPS-CONTRACT.md](MCP-APPS-CONTRACT.md)
- **When to use this vs. native CS channel:** [docs/COMPARISON.md](COMPARISON.md)
- **Test plan & smoke scripts:** [docs/TEST-PLAN.md](TEST-PLAN.md)
- **Microsoft's own samples (canonical reference):** [microsoft/mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples)
- **The repo:** [KarimaKT/MCSMCPapps](https://github.com/KarimaKT/MCSMCPapps)

If you're building this, fork it. If you're at Microsoft and reading the [feature requests](FEATURE-REQUESTS.md),
go fix items 1.1 + 1.2 first — the rest is gravy.

---

*Posted by Karima Kanjitajdin, May 2026. Built in collaboration with the AI Toolkit / Copilot
Studio / M365 Copilot extensibility teams. The repo is MIT.*
