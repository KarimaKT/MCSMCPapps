# MCP Apps + OpenAI Apps SDK contract — what M365 Copilot actually wants

Status: verified May 2026 against M365 Copilot in CDX. This is the contract that **renders a widget** instead of a blank card.

Andreas Adner's January 2025 demo (https://www.linkedin.com/posts/andreasadner_microsoftcopilot-activity-7455742633836109824)
made it explicit: *"UIs created using the OpenAI Apps SDK (and soon also MCP Apps!)"*. M365 Copilot's
RemoteMCPServer client today implements the **OpenAI Apps SDK** widget contract, **not** (yet) the MCP
Apps spec naming. Build to the OpenAI Apps SDK shape and it works. Build to the MCP Apps spec naming
and you get a blank card.

This file is the recipe. If you change anything in `mcp-server/src/index.ts` or
`mcp-server/src/widget.ts`, re-read this first.

## The four things you have to get exactly right

### 1. Resource MIME type MUST be `text/html;profile=mcp-app`

Not `text/html`. Not `application/vnd.something`. Exactly:

```
text/html;profile=mcp-app
```

The host uses this MIME as the signal to (a) render the HTML in a sandboxed iframe and
(b) enable the JSON-RPC `postMessage` bridge. With plain `text/html`, the host returns
your tool result but never instantiates a widget — the user sees a blank card with just
the agent name.

Set it in **two** places in the resource:

```ts
server.registerResource(
  'chat-widget',
  UI_RESOURCE_URI,
  {
    mimeType: 'text/html;profile=mcp-app', // <-- on the descriptor
    // ...
  },
  async () => ({
    contents: [
      {
        uri: UI_RESOURCE_URI,
        mimeType: 'text/html;profile=mcp-app', // <-- AND on the content
        text: renderWidgetHtml(...)
      }
    ]
  })
);
```

OpenAI's `@modelcontextprotocol/ext-apps/server` exports `RESOURCE_MIME_TYPE` for this string. We
hardcode it because we don't depend on that package.

### 2. Tool `_meta` MUST set `openai/outputTemplate`

The MCP Apps spec says `_meta.ui.resourceUri`. The OpenAI Apps SDK says `_meta["openai/outputTemplate"]`.
M365 Copilot today reads the **OpenAI** key. Set both (the OpenAI key for today, the MCP Apps key for
forward compat):

```ts
_meta: {
  'openai/outputTemplate': UI_RESOURCE_URI,
  ui: {
    resourceUri: UI_RESOURCE_URI,
    preferredDisplayMode: 'inline'
  },
  'openai/toolInvocation/invoking': 'Opening Eurozone Analyst…',
  'openai/toolInvocation/invoked': 'Eurozone Analyst ready.'
}
```

The `toolInvocation/*` keys give you a host-rendered status line while the tool runs — small UX win,
visible to the user.

### 3. CSP MUST allow what your widget does

Set `_meta.ui.csp` on the **resource** (not the tool). Three lists:

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

If your widget is a single-file HTML bundle (Andreas's pattern: xterm.js inlined), you don't need
`frameDomains`. Our widget iframes the SWA, so SWA origin **must** be in `frameDomains` or the inner
iframe is blocked by the sandbox. From OpenAI's docs: *"Without `frameDomains` set, subframes are
blocked by default."*

### 4. Widget reads inputs via the JSON-RPC postMessage bridge

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

ChatGPT/M365 Copilot ALSO expose a snapshot at `window.openai.toolInput` / `window.openai.toolOutput`,
and re-fire `openai:set_globals` events when those change. Listen to **both** for portability — see
`mcp-server/src/widget.ts` for the reference implementation.

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
| Empty card with just the agent name                    | Resource MIME was `text/html`                                          | Use `text/html;profile=mcp-app` on descriptor AND content      |
| Empty card, even with right MIME                       | Tool only set `_meta.ui.resourceUri`                                   | Also set `_meta["openai/outputTemplate"]`                      |
| Widget loads but inner SWA iframe blocked              | No `frameDomains` in resource CSP                                      | Add SWA origin to `_meta.ui.csp.frameDomains`                  |
| Widget loads, inner iframe loads, no auto-send         | Widget listened to wrong messages                                      | Listen for JSON-RPC `ui/notifications/tool-result` from parent |
| Model prints `{"tool":"openCopilotStudioChat", ...}`   | DA instructions were too prescriptive ("ONLY action is to call X")     | Rewrite as natural language: describe the tool, don't command it |
| "Bad Request: Server not initialized" on second call   | Stateless server (sessionIdGenerator: undefined) breaks SDK init state | Use `sessionIdGenerator: () => randomUUID()` + transports map  |
| "Something went wrong" mid-session, never recovers     | Session was evicted; client never re-initialized                       | Return 404 "Session not found" so client drops + re-inits      |

## Source of truth

- OpenAI Apps SDK — Build your MCP server: https://developers.openai.com/apps-sdk/build/mcp-server
- OpenAI Apps SDK — Build your ChatGPT UI: https://developers.openai.com/apps-sdk/build/custom-ux
- MCP Apps spec (forward compat): https://modelcontextprotocol.io/specification/draft/server/tools
- M365 Copilot DA UI widgets (today's surface): https://learn.microsoft.com/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets

When the MCP Apps spec lands generally in M365 Copilot, the only thing that should need to change in
this repo is dropping the `openai/*` aliases. Everything else (MIME, CSP, bridge contract) is already
in the MCP Apps spec.
