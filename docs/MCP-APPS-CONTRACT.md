# MCP Apps + OpenAI Apps SDK contract — what M365 Copilot actually wants

Status: verified May 2026 against M365 Copilot in CDX **and** Microsoft's own reference samples at
[github.com/microsoft/mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples).
This is the contract that **renders a widget** instead of a blank card.

Microsoft's reference (`oai-apps-sdk/trey-research/node/src/mcpserver/server/src/mcp-server.ts`) is
the canonical source. M365 Copilot's RemoteMCPServer client implements the **OpenAI Apps SDK**
widget contract, **not** (yet) the MCP Apps spec naming. Build to the OpenAI Apps SDK shape and it
works.

This file is the recipe. If you change anything in `mcp-server/src/index.ts` or
`mcp-server/src/widget.ts`, re-read this first.

## The five things you have to get exactly right

### 1. Resource MIME type MUST be `text/html+skybridge`

Not `text/html`. Not `text/html;profile=mcp-app`. Exactly:

```
text/html+skybridge
```

The host uses this MIME as the signal to (a) render the HTML in a sandboxed iframe ("skybridge"
is the codename for the sandbox runtime) and (b) enable the JSON-RPC `postMessage` bridge. With
plain `text/html` the host returns your tool result but never instantiates a widget — the user
sees a blank card with just the agent name.

Set it in **two** places in the resource (descriptor and contents):

```ts
const WIDGET_MIME_TYPE = 'text/html+skybridge';

server.registerResource(
  'chat-widget',
  UI_RESOURCE_URI,
  {
    mimeType: WIDGET_MIME_TYPE, // <-- on the descriptor
    _meta: resourceMeta
  },
  async () => ({
    contents: [
      {
        uri: UI_RESOURCE_URI,
        mimeType: WIDGET_MIME_TYPE, // <-- AND on the content
        text: renderWidgetHtml(...),
        _meta: resourceMeta // <-- AND _meta on the content
      }
    ]
  })
);
```

> **Tip:** When inspecting against another vendor's docs, you may see `text/html;profile=mcp-app`.
> That's the future MCP Apps spec name. Microsoft's M365 Copilot does not honor it today — it
> reads `text/html+skybridge`. We set the skybridge MIME and keep watch on Microsoft's reference
> repo for when MCP Apps becomes the primary surface.

### 2. Tool `_meta` MUST set `openai/outputTemplate` and `openai/widgetAccessible`

The MCP Apps spec says `_meta.ui.resourceUri`. The OpenAI Apps SDK (and M365 Copilot today) reads
`_meta["openai/outputTemplate"]` and `_meta["openai/widgetAccessible"]`. Set both shapes (the
OpenAI keys for today, the MCP Apps key for forward compat):

```ts
_meta: {
  'openai/outputTemplate': UI_RESOURCE_URI,
  'openai/widgetAccessible': true,
  'openai/toolInvocation/invoking': 'Opening Eurozone Analyst…',
  'openai/toolInvocation/invoked': 'Eurozone Analyst ready.',
  ui: {
    resourceUri: UI_RESOURCE_URI,
    preferredDisplayMode: 'inline'
  }
}
```

Set the **same** `_meta` block on three places: the tool descriptor (so list_tools advertises
it), the resource descriptor (so list_resources advertises it), AND the resource `contents[0]`
(so resources/read carries it). The Microsoft reference reuses one `descriptorMeta(widget)`
helper for all three. We follow the same pattern with `resourceMeta`.

The `toolInvocation/*` keys give you a host-rendered status line while the tool runs ("Opening
Eurozone Analyst…") — small UX win, visible to the user.

### 3. Tool RESPONSE _meta MUST re-emit the openai/* keys

Microsoft's reference does this: `invocationMeta(widget)` is identical to `descriptorMeta(widget)`
and is included on every `tools/call` response. Without it, the host sees the descriptor's link
but the response itself is "un-templated" and the widget doesn't mount.

```ts
async (args) => ({
  content: [{ type: 'text', text: '...' }],
  structuredContent: { userQuery },
  _meta: {
    'openai/outputTemplate': UI_RESOURCE_URI,
    'openai/widgetAccessible': true,
    'openai/toolInvocation/invoking': '...',
    'openai/toolInvocation/invoked': '...',
    mcsmcpapps: { userQuery }   // our own namespace, ignored by host
  }
})
```

### 4. CSP MUST allow what your widget does

Set `_meta.ui.csp` on the **resource** (descriptor and contents). Three lists:

```ts
_meta: {
  ui: {
    domain: 'https://your-app-origin',  // required for fullscreen punch-out
    prefersBorder: true,
    csp: {
      connectDomains: [...],   // fetch / WebSocket targets
      resourceDomains: [...],  // <script src>, <img src>, fonts, etc.
      frameDomains: [...]      // ONLY if your widget iframes another origin
    }
  }
}
```

If your widget is a single-file HTML bundle (Microsoft's pattern: React + Fluent UI inlined), you
don't need `frameDomains`. Our widget iframes the SWA, so SWA origin **must** be in
`frameDomains` or the inner iframe is blocked by the sandbox. From OpenAI's docs: *"Without
`frameDomains` set, subframes are blocked by default."*

### 5. Widget reads inputs via the JSON-RPC postMessage bridge

The host delivers tool inputs and results as JSON-RPC notifications from `window.parent`:

```js
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const msg = e.data;
  if (!msg || msg.jsonrpc !== '2.0') return;
  if (msg.method === 'ui/notifications/tool-input')  { /* args */ }
  if (msg.method === 'ui/notifications/tool-result') { /* full result */ }
});
```

M365 Copilot ALSO exposes a snapshot at `window.openai.toolInput` / `window.openai.toolOutput`,
and re-fires `openai:set_globals` events when those change. Listen to **both** for portability —
see `mcp-server/src/widget.ts` for the reference implementation.

## What our tool returns

```ts
return {
  // For the model (and as fallback narration if the widget doesn't render):
  content: [{ type: 'text', text: `Embedded chat opened: "${userQuery}"` }],
  // For the widget — host delivers via ui/notifications/tool-result:
  structuredContent: { userQuery },
  // Also for the widget — never reaches the model:
  _meta: { mcsmcpapps: { userQuery } }
};
```

`structuredContent` is what the model sees when narrating; keep it tight. `_meta` is widget-only.
We also stash `userQuery` under our namespace in `_meta` so the widget can read it from any of three
surfaces (top-level, structuredContent, our _meta key) — defense against host renames.

## Two-pane handoff: how the user's first message gets into the SWA

```
┌────────────────────────────────────────────────────────────────────┐
│                       M365 Copilot host                            │
│                                                                    │
│  user types "what's GDP in France?"                                │
│           │                                                        │
│           ▼                                                        │
│  declarative agent calls openCopilotStudioChat(userQuery=...)      │
│           │                                                        │
│           ▼                                                        │
│  MCP server returns: structuredContent.userQuery, _meta, content   │
│  + UI resource URI                                                 │
│           │                                                        │
│           ▼                                                        │
│  host loads ui://mcsmcpapps/chat (text/html;profile=mcp-app)       │
│  in a sandboxed iframe and posts:                                  │
│    { jsonrpc:'2.0', method:'ui/notifications/tool-result',         │
│      params: { structuredContent, _meta, content } }               │
│                                                                    │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │  WIDGET iframe (mcp-server/src/widget.ts)                │     │
│   │  - reads userQuery from message.params                   │     │
│   │  - iframes the SWA at ?embedded=1                        │     │
│   │  - waits for SWA's "mcsmcpapps:ready" postMessage        │     │
│   │  - posts "mcsmcpapps:firstMessage" with userQuery        │     │
│   │                                                          │     │
│   │   ┌────────────────────────────────────────────────┐     │     │
│   │   │  SWA iframe (webchat-ui/src/main.ts)           │     │     │
│   │   │  - registers message listener BEFORE auth      │     │     │
│   │   │  - posts "mcsmcpapps:ready" to parent          │     │     │
│   │   │  - acquires Power Platform API token via MSAL  │     │     │
│   │   │  - opens CS Wave-2 conversation                │     │     │
│   │   │  - auto-sends queued userQuery (no retype!)    │     │     │
│   │   │  - streams CS replies, charts, Adaptive Cards  │     │     │
│   │   └────────────────────────────────────────────────┘     │     │
│   └──────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────┘
```

Origin allowlist on the SWA side (`isAllowedParentOrigin` in `main.ts`): widget renderer hosts under
`*.widget-renderer.usercontent.microsoft.com`, `*.cloud.microsoft`, `m365.cloud.microsoft`, and
`copilot.microsoft.com`. Anything else is rejected, so a malicious parent can't inject a first
message.

## Failure modes we burned a day on

| Symptom in M365 Copilot                                | Root cause                                                             | Fix                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Empty card with just the agent name                    | Resource MIME was `text/html` or `text/html;profile=mcp-app`           | Use `text/html+skybridge` on descriptor AND content            |
| Empty card, even with right MIME                       | Tool only set `_meta.ui.resourceUri`                                   | Also set `_meta["openai/outputTemplate"]` + `widgetAccessible` |
| Empty card, MIME and template OK                       | Tool RESPONSE didn't include `openai/*` keys                           | Re-emit the same `_meta` on the call response                  |
| Widget loads but inner SWA iframe blocked              | No `frameDomains` in resource CSP                                      | Add SWA origin to `_meta.ui.csp.frameDomains`                  |
| Widget loads, inner iframe loads, no auto-send         | Widget listened to wrong messages                                      | Listen for JSON-RPC `ui/notifications/tool-result` from parent |
| Model prints `{"tool":"openCopilotStudioChat", ...}`   | DA instructions were too prescriptive ("ONLY action is to call X")     | Rewrite as natural language: describe the tool, don't command it |
| "Bad Request: Server not initialized" on second call   | Stateless server (sessionIdGenerator: undefined) breaks SDK init state | Use `sessionIdGenerator: () => randomUUID()` + transports map  |
| "Something went wrong" mid-session, never recovers     | Session was evicted; client never re-initialized                       | Return 404 "Session not found" so client drops + re-inits      |

## Production scaling note

Our MCP server keeps `Map<sessionId, transport>` in process memory. For a demo on App Service B1
(single instance, alwaysOn=true) this is fine. Three things to know before customers fork this:

**Session eviction is recoverable.** Our 404 "Session not found" handler tells well-behaved MCP
clients (M365 Copilot included) to drop the session and re-initialize. After a container restart,
slot swap, or scale event, the user's NEXT call will silently re-init on whatever instance answers.
Worst case: one extra round-trip on the first call. No "Something went wrong" wall.

**ARR affinity is on by default.** Azure App Service sets an `ARRAffinity` cookie that pins each
client to one backend instance. The MCP client is server-to-server (not a browser), so 3rd-party
cookie blocking, ITP, and SameSite-strict tenants do NOT affect this. The cookie matters only when
you scale beyond 1 instance.

**Caveats for forks that scale up:**

- Some enterprise WAFs (Zscaler, F5 with strict cookie rules) can strip unknown `Set-Cookie`
  headers. If your customer's MCP traffic transits one of those WAFs **and** you scale to >1
  instance, sessions can land on the wrong backend, returning our 404. The client recovers but
  the user may see a brief "reconnecting" state.
- App Service Premium auto-scale + slot swap can kill the instance the cookie pinned to. Same
  recovery path.
- Front Door sitting in front of App Service with its own affinity layer can fight ARR cookies.
  Set explicit affinity on Front Door OR turn off ARR (`clientAffinityEnabled: false` in Bicep)
  and let Front Door own pinning.

**The right answer for production:** move sessions to **Azure Cache for Redis** (Basic C0 is
~$16/mo) and make the app stateless at the process level. Each instance reads/writes the shared
store. Survives scale-out, slot swap, instance restart, WAF cookie stripping — everything. Today
the MCP TypeScript SDK doesn't ship a Redis transport adapter, so this is custom code: write a
thin wrapper around `StreamableHTTPServerTransport` that persists `sessionId → init params` to
Redis on `onsessioninitialized` and rebuilds the transport on cache hit. We'll add this when a
customer commits to deploying past B1.

The true protocol-level fix — *fully* stateless MCP servers — is blocked on SDK support. The
spec allows `sessionIdGenerator: undefined`, but the SDK enforces an init handshake on the
`McpServer` instance, so a fresh server per request returns "Server not initialized" on the
second call. We tried it; reverted in 5g.1.

## Source of truth

- **Microsoft's reference samples (canonical):** https://github.com/microsoft/mcp-interactiveUI-samples — see `oai-apps-sdk/trey-research/node/src/mcpserver/server/src/mcp-server.ts` for the exact response shape we mirror.
- M365 Copilot DA UI widgets (today's surface): https://learn.microsoft.com/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets
- OpenAI Apps SDK — Build your MCP server: https://developers.openai.com/apps-sdk/build/mcp-server
- OpenAI Apps SDK — Build your ChatGPT UI: https://developers.openai.com/apps-sdk/build/custom-ux
- MCP Apps spec (forward compat): https://modelcontextprotocol.io/specification/draft/server/tools
- Andreas Adner's reveal that M365 Copilot supports both today: https://www.linkedin.com/posts/andreasadner_microsoftcopilot-activity-7455742633836109824

When the MCP Apps spec lands generally in M365 Copilot, the only thing that should need to change
in this repo is dropping the `openai/*` aliases and switching the MIME to `text/html;profile=mcp-app`.
Everything else (CSP shape, postMessage bridge, structuredContent + _meta separation) is already
aligned with the MCP Apps spec.
