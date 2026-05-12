# Bringing your Copilot Studio agent into Microsoft 365 Copilot — with your own UI

> Publish-ready draft. Last updated 2026-05-12. Adapted from the original [`docs/BLOG.md`](../BLOG.md) (which still has the Eurozone-specific narrative used during development). This version is generic enough to publish on a corporate / personal blog.

---

**TL;DR:** Microsoft 365 Copilot exposes a Declarative Agent + RemoteMCPServer surface that lets you embed a fully custom UI widget inside the host chat. You keep your Copilot Studio agent as the brain — topics, knowledge sources, agentic flows, Dataverse logging, OOB live-agent handoff — and wrap it in a branded React widget that renders markdown, Adaptive Cards, form submits, citations, and a fullscreen "analyst canvas" with Copy and Print-to-PDF. No CS rewrites required. The reference implementation is open: I'll link a public copy once it's polished; the working code is at <https://github.com/KarimaKT/MCSMCPapps-shared> (private during development).

Below: the architecture in one diagram, the four contract details that took days to find, the OOB-first decisions that saved weeks, and the design failures we reverted.

---

## Why this is interesting

Microsoft 365 Copilot today gives Copilot Studio makers two ends of a spectrum:

1. **CS native channel.** Plug the agent into M365 Copilot in two clicks. Clean, but identical to every other agent in the picker.
2. **Hand-roll a Declarative Agent with a remote MCP server.** Maximum freedom; everyone reinvents the same scaffolding (auth, transport, host bridge, escalation, branding) from scratch.

The **data-widget pattern** threads the gap. You keep CS as the brain (because that's where topics, knowledge, Dataverse logs, and OOB Omnichannel handoff already live) but wrap it in your own UI inside the M365 Copilot chat surface. The CS team owns the brain. The UI team owns the surface. Both iterate independently.

## What you can build

- **Markdown** in replies (tables, lists, headings, links, code).
- **Adaptive Cards** rendered natively in the widget — text, columns, images, OpenUrl, multi-card carousels.
- **Form submits** — `Input.Text`, `Input.ChoiceSet`, `Input.Date/Time/Number/Toggle`, `Action.Submit` round-trips back to CS as `activity.value` for slot-filling.
- **Suggested actions / quick replies** as chips under the reply.
- **Citations** as `↗ Title` links above a divider.
- **Fullscreen "analyst canvas"** — sticky header, conversation id chip, Copy + Print + Done toolbar, keyboard shortcuts.
- **Live-agent escalation** via OOB CS Settings → Agent transfers → D365 Omnichannel. Zero escalation code on your side.

## The architecture in one diagram

```
M365 Copilot host
  │ user types
  ▼
Declarative Agent  (one tool: openCopilotStudioChat)
  │ POSTs /mcp with user Bearer token (Entra SSO via TDP registration)
  ▼
MCP server (App Service, Node 20)
  │ validates token, OBO-exchanges for Power Platform API token
  │ calls Copilot Studio Direct Engine on user's behalf
  │ drains streaming reply → returns structuredContent + widget URI
  ▼
M365 Copilot
  │ reads _meta.openai/outputTemplate
  │ fetches resource (single-file React bundle)
  │ mounts widget in skybridge sandbox iframe
  ▼
Widget renders markdown / Adaptive Cards / suggested actions
  │ on Submit click: window.openai.callTool('submitAdaptiveCardAction', ...)
  ▼
... and back through the server to CS
```

The chat hot path is **server → CS Direct Engine, server-side**. The widget is a pure renderer; no CS conversation lives in the browser; no auth lives in the browser. That inversion (we tried it the other way first — see below) is the single most important architectural decision in the design.

## The four contract details that cost days

If you build this, you will hit these. Up-front so you don't.

### 1. The widget resource MIME must be `text/html+skybridge`

Not `text/html`. Not `text/html;profile=mcp-app` (a near-future MCP Apps spec name). **`text/html+skybridge`** is what M365 Copilot's host actually checks today.

```ts
const WIDGET_MIME_TYPE = 'text/html+skybridge';

server.registerResource('chat-widget', 'ui://your-app/chat', {
  mimeType: WIDGET_MIME_TYPE,
  _meta: { /* see #2 */ }
}, async () => ({
  contents: [{
    uri: 'ui://your-app/chat',
    mimeType: WIDGET_MIME_TYPE,   // ← repeated on the content, not just the descriptor
    text: widgetHtml,
  }]
}));
```

Verified against Microsoft's reference at <https://github.com/microsoft/mcp-interactiveUI-samples>. Any other MIME yields a blank card with no diagnostic — indistinguishable from "the model didn't call your tool."

### 2. Tool `_meta` must set both `openai/outputTemplate` AND `openai/widgetAccessible`

The MCP Apps spec has nice clean names (`_meta.ui.resourceUri`). The OpenAI Apps SDK has older names (`_meta["openai/outputTemplate"]`). M365 Copilot today reads the OpenAI keys. Set both for forward-compat:

```ts
_meta: {
  'openai/outputTemplate': 'ui://your-app/chat',
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Opening Your Agent…',
  'openai/toolInvocation/invoked': 'Your Agent ready.',
  ui: { resourceUri: 'ui://your-app/chat', preferredDisplayMode: 'inline' }
}
```

This `_meta` block has to appear in **three places**: the tool descriptor (so `tools/list` advertises it), the resource descriptor (so `resources/list` advertises it), and **the tool RESPONSE** (so each `tools/call` re-advertises which template to render). Use one helper and reuse it everywhere.

There is a fourth place that matters even more: the **plugin manifest** (`ai-plugin.json`). M365 Copilot caches the tool catalog at admin-approval time from `runtimes[0].spec.x-mcp_tool_description.tools[]`, not from the live `tools/list`. If your live schema disagrees with the published manifest — even on something subtle like argument optionality — the host LLM gets confused and starts emitting tool arguments as plaintext into the chat instead of invoking the tool. Lock the surface, gate it in CI.

### 3. Iframing an external origin from the widget doesn't work

The OpenAI Apps SDK docs allow `_meta.ui.csp.frameDomains` for sub-iframes. In theory you can list your existing SPA's origin and iframe it. **In practice, the docs say it's "discouraged and apps that declare it face stricter review."** Tried it. The widget mounted, the inner iframe never did, no diagnostic.

The supported pattern is to **bundle your UI as a single-file HTML resource**. Use `vite-plugin-singlefile` (or your bundler's equivalent) to produce one HTML file with everything (React, CSS, fonts, JSON) inlined. The MCP server reads it at startup and returns it from `resources/read`. Every Microsoft reference sample does this; there's a reason.

### 4. Strip `crossorigin` from inline scripts — found by reading source

You did everything right: skybridge MIME, the `_meta` keys, single-file bundle, CSP allowlists. The card mounts at the right size; your bundle is on the wire; but the React app never executes. Empty card, no console error.

The reason: Vite (and most modern bundlers) emit:

```html
<script type="module" crossorigin>...</script>
```

The skybridge sandbox iframe has a **null origin**. The browser does a CORS check on inline scripts marked `crossorigin`, sees null, silently refuses to execute. The HTML loaded, the script body is in the document, the React app is right there — and nothing runs.

Microsoft's reference repo solves this with one Vite plugin ([oai-apps-sdk/trey-research/.../widgets/build.mts](https://github.com/microsoft/mcp-interactiveUI-samples/blob/main/oai-apps-sdk/trey-research/node/src/mcpserver/widgets/build.mts)):

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

No documentation of this requirement in the OpenAI Apps SDK docs, the M365 Copilot Learn pages, or the MCP Apps spec. The only way you find it is by cloning the reference and reading the build script.

Also: force `mode: 'production'` plus `define: { 'process.env.NODE_ENV': '"production"' }` in the Vite config. Without these, Vite leaks HMR / dev-only code that uses `eval` and `new Function()`, both of which the sandbox CSP blocks.

## Auth is server-side. The browser does nothing.

A second non-obvious thing: **don't put MSAL in the widget.**

The skybridge sandbox iframe has a null origin. `acquireTokenSilent` cannot reach `login.microsoftonline.com` from a null-origin iframe — it times out with `monitor_window_timeout`. There is no policy or CSP setting that fixes this. The sandbox is intentional.

So auth runs server-side. The Declarative Agent's `ai-plugin.json` declares `auth.type: "OAuthPluginVault"` pointing at a Teams Developer Portal SSO registration. The TDP registration knows the Entra app reg client ID and the API audience. On every tool call:

1. M365 Copilot mints a user Bearer token for the audience.
2. Sends it as `Authorization: Bearer <token>` on the POST to `/mcp`.
3. The MCP server validates (JWKS, cached).
4. OBO-exchanges for a Power Platform API token (scoped to the **end user**, not to our service principal).
5. Caches the result keyed on the user's `oid`.
6. Uses it as the Bearer for the Copilot Studio Direct Engine call.

The end user is never prompted. CS sees the call as the end user — including for Dataverse logging. Zero tokens cross to the browser.

## Conversation id discipline

The simplest principle in the architecture: **CS allocates the conversation id; we never mint a parallel one.**

The server calls `client.startConversationStreaming()` the first time it sees a new (user oid + M365 thread id) pair. CS returns a conversation id. The server caches it (in-process Map, ~25 min TTL). On follow-up turns within the same M365 thread, the cache hits and the server reuses the same CS conversation — topic state continues.

The cache key is `(oid + x-microsoft-ai-conversationid header)` — M365 Copilot sets that header on every tool call. It's stable for the lifetime of one M365 chat thread. The host LLM occasionally echoes `conversationId` back as a tool argument too, but unreliably (~60% of the time). The header is the primary key; the echo is a secondary hint.

The payoff: state survives across container restarts (CS holds it). Escalation works without us writing escalation code (Omnichannel uses the same id). Logs join cleanly across systems on one key.

## What we used OOB — and what we wrote ourselves

The strongest design heuristic was: **does the SDK do this already?** Anywhere we caught ourselves writing transport, session, or activity-rendering code, that was the question.

**OOB used:**

- `@microsoft/agents-copilotstudio-client` for CS Direct Engine.
- `@modelcontextprotocol/sdk` for the MCP server.
- `adaptivecards` v3 (Microsoft official) for AC rendering.
- `marked` + `dompurify` for markdown.
- `jose` for JWT validation.
- D365 Omnichannel handoff via CS Studio Settings → Agent transfers (no code).
- Dataverse transcript logging (CS does it).

**Written ourselves:**

- ~250-line MCP server (it's tiny because the SDK is generic).
- ~830-line single-file React widget (also tiny because the renderers do the heavy lifting).
- A few build-time branding env vars.
- A pre-deploy locked-contract smoke test that asserts the manifest matches `tools/list`.

The temptation to write our own transport / Adaptive Card renderer / suggested-actions chip component was strong. The first pass had all three. Ripping them out and adopting the OOB SDK + AC renderer + inline CSS chips was the single biggest velocity win.

## What we tried — and reverted

In the spirit of saving you time, here's what didn't work.

### "Chat-in-chat" — embedding `botframework-webchat` in the widget (retired in v0.6)

The first design embedded full BotFramework Web Chat inside the widget iframe, with browser MSAL for auth. The widget tried to maintain its own CS conversation in the browser.

It didn't work in M365 Copilot. Browser MSAL fails in the skybridge sandbox. Microsoft's UX guidelines explicitly forbid widget-internal chat input. The bundle was 5 MB. The widget had a tiny chat input inside the M365 Copilot chat input — the host's own input. "Chat in chat" is the named anti-pattern.

The fix was structural: pivot to the **data-widget pattern**. Server calls CS server-side, returns a structured payload, widget renders the payload as a card. No chat input in the widget. No MSAL in the widget. Bundle dropped to ~250 KB. Architecture matched Microsoft's reference samples.

### Stateless MCP transport on first try (retired briefly in v0.5h, restored in v0.6)

The MCP TS SDK supports session-keyed Streamable HTTP transport. We tried it. With `enableJsonResponse: true`, the SDK closes the response stream right after the init reply, which fires `transport.onclose` before our `onsessioninitialized` callback completes. The next request arrives with a session id that's already been removed from the map and gets 404. Host gives up.

The fix: stateless transport. Fresh `McpServer` + `StreamableHTTPServerTransport` per request, closed on `res.close`. Microsoft's reference samples all do this. Confirmed live; first time, every time.

### Verbose tool descriptions (retired in v0.7.3a)

We had a multi-paragraph tool description with imperative instructions ("Always pass the user's text verbatim. Always echo conversationId on follow-ups. Treat empty strings as missing. ..."). The host LLM started emitting the tool name and args as **plaintext into the chat** instead of invoking the tool. We watched it print `<openCopilotStudioChat userQuery="..." dateTime="..." userLocale="..." />` with hallucinated args.

The fix: keep the tool description one short imperative sentence. Behavior rules go in the DA `instructions` field, not in the tool description. Long descriptions push the host LLM into "describe instead of call" mode.

A related variant of the same bug: flipping an argument from optional to required after the manifest is published. The host LLM caches the catalog at admin-approval time; if the live schema disagrees, you get the same plaintext-instead-of-invoke failure. The lesson: **arg optionality is part of the locked-contract surface.** Bump the manifest version and re-approve before changing anything in the input schema.

## What we'd build differently

- **Pin a Redis cache for the CS conversation id** instead of the in-process Map. Today the cache dies on App Service instance restart; a new CS conversation is opened on the next turn (topic state lost). Production-grade deployments need an external cache.
- **Service-principal federated credentials**, not a client secret, for the OBO exchange. We have a client secret in App Service config today; federated creds is rotation-free and a security review pre-requisite.
- **Post-deploy live-endpoint smoke test against App Service.** Today CI runs the smoke against a local build before deploy. Drift between source and the actually-deployed manifest is theoretically possible. Closing the loop needs a service-principal token mint in CI.

## What's still missing (platform gaps)

These are blocked on Microsoft platform features, not on us:

- **File upload from the widget** — no host file picker primitive.
- **Voice input/output** — no host voice bridge.
- **Streaming partial replies** — `tools/call` returns one final payload; the widget can't subscribe to incremental updates.
- **True silent dispatcher** — the host LLM narrates after the widget renders ("I've opened Your Agent. What can I help with?"). Workaround: return empty `content[0].text`.

## Try it

The reference implementation will be public once the v1.0 release ships. Watch the original repo for updates.

License: MIT. Architecture decisions and the four hard-won contract details documented in `docs/decisions/` and `docs/MCP-APPS-CONTRACT.md` — read those before changing anything.

---

**Acknowledgements.** Microsoft's `mcp-interactiveUI-samples` repo (especially trey-research and zava-insurance) was the canonical contract reference; this pattern would have taken weeks longer without it. The Copilot Studio team's Wave-2 Direct Engine SDK (`@microsoft/agents-copilotstudio-client`) carries the entire chat protocol, retry, and Adaptive Card extraction — we wrote zero transport code. The OpenAI Apps SDK design (which M365 Copilot implements today) made the widget pattern coherent enough to commit to.
