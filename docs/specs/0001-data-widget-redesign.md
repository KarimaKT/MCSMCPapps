# Spec 0001 — data-widget redesign (v0.6)

> Replace the chat-in-chat widget with a small data-display card that follows MS's published widget UX pattern. Server calls CS Direct Engine using the OBO'd user token; widget renders the structured response.

| Field | Value |
|---|---|
| Status | approved (verbal) — implementing on `v0.6-data-widget` branch |
| Owner | engineering agent |
| Reviewer | user (Karima) |
| Created | 2026-05-03 |
| Target | v0.6.0 |
| Supersedes | the chat-in-chat design implicit in phase 5j |

## Goal

In M365 Copilot, after the user types a question to a CS-backed agent:

- One short text reply appears in chat (the model's reply line)
- One small inline widget card appears with the structured data (chart, comparison, summary) that the CS agent produced
- User keeps typing in M365 Copilot's existing input box
- Each new turn appends a new reply + card; previous turns stay as-is
- Total user-perceived latency per turn ≤ 4 seconds (server work) + render
- Bundle size ≤ 250KB gzipped (down from 5.5 MB / 1.4 MB gzipped)
- Zero auth prompts (Entra SSO + tenant admin consent already done)

## Non-goals

- Live streaming activity-by-activity inside the widget
- Persistent multi-day CS conversation history (each user turn = one fresh CS conversation, opened with a `conversationId` that persists during the M365 Copilot session via the tool's `inputSchema` echo)
- Custom branding kit (postponed to v0.7)
- Maker portal at `/maker/` (postponed; lives in the future delivery repo)

## User flow

1. User picks an agent in M365 Copilot left sidebar (one tile per published DA).
2. User types `chart inflation in italy`.
3. M365 Copilot host calls our MCP tool `openCopilotStudioChat({ userQuery, conversationId? })`.
4. Server:
   a. Validates the host's bearer (already wired)
   b. OBO-exchanges for a Power Platform token (already wired, ~500ms)
   c. Calls CS Direct Engine using the Node `@microsoft/agents-copilotstudio-client` SDK with that PP token; opens or resumes the conversation; drains the streamed activities to completion (~1-3s typical)
   d. Returns: `content[0].text` (a 1-2 sentence summary), `structuredContent: { replyText, citations, chartData?, conversationId }`, and `_meta.openai/outputTemplate = ui://mcsmcpapps/chat`
5. Host renders:
   - The text content as the agent's reply line
   - The widget card, populated from `structuredContent`
6. User types follow-up; loop from step 3.

## Contracts

### Tool input schema (`openCopilotStudioChat`)

```jsonc
{
  "type": "object",
  "properties": {
    "userQuery":      { "type": "string" },
    "conversationId": { "type": "string", "description": "Echo from previous tool call to keep CS conversation alive" }
  },
  "required": ["userQuery"]
}
```

### Tool response

```jsonc
{
  "content": [
    { "type": "text", "text": "Italy's CPI cooled to 1.2% in April." }
  ],
  "structuredContent": {
    "replyText": "<full CS reply text, plain or markdown>",
    "citations": [
      { "title": "Eurostat HICP", "url": "https://..." }
    ],
    "chartData": {
      "kind": "stat" | "compare" | "trend",
      "title": "Italy CPI · Apr 2026",
      "primaryValue": "1.2%",
      "deltaText": "↓ from 1.4% (Mar)",
      "series": [/* sparkline points if kind=trend */]
    },
    "conversationId": "<csid>",
    "agentDisplayName": "Eurozone Analyst",
    "diag": { "csCallMs": 1234, "oboMs": 502, "ok": true }
  },
  "_meta": {
    "openai/outputTemplate": "ui://mcsmcpapps/chat",
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": "Asking Eurozone Analyst…",
    "openai/toolInvocation/invoked": "Reply ready."
  }
}
```

`chartData` is optional. When absent, widget renders text + citations only.

### Widget contract

- Reads `window.openai.toolOutput.structuredContent` synchronously on mount
- Renders one of three card layouts (stat / compare / trend) per `chartData.kind`
- Two action buttons at most (per MS guidelines): "Open analyst" (calls `window.openai.requestDisplayMode({ mode: 'fullscreen' })`) and a citation popout
- No internal scroll; uses `window.openai.notifyIntrinsicHeight` to size correctly
- Theme via `window.openai.theme`
- Bundle target: < 250KB gzipped

## Sources / verified references

- [MS — Add interactive UI widgets to declarative agents](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets) — `window.openai.*` API surface (last updated 2026-03-30)
- [MS — UX guidelines for widgets](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-ui-widgets-guidelines) — inline mode, side-by-side mode, anti-patterns
- [microsoft/mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples) — trey-research, fieldops, zava-insurance, approvals-box; data-widget pattern, server-side flow
- [@microsoft/agents-copilotstudio-client](https://www.npmjs.com/package/@microsoft/agents-copilotstudio-client) — `CopilotStudioClient.startConversationStreaming()` and `sendActivityStreaming()`; usable from Node, not just browser
- Verified empirically (2026-05-03): server-side OBO produces a valid PP token (length 2627). `_meta.mcsmcpapps.*` is stripped by the host before reaching the widget; `structuredContent` flows through verbatim.

## Implementation plan

1. **Add `@microsoft/agents-copilotstudio-client` dep to `mcp-server`.** Verify Node import works (it currently lives in `webchat-ui`).
2. **`mcp-server/src/cs.ts` (new)**: `callCsAgent({ envId, schema, userQuery, conversationId?, ppToken })` → opens / resumes a CS conversation, sends the activity, drains streaming response, returns `{ replyText, citations, chartData, conversationId }`.
   - Citation extraction: parse the activity `attachments` for `https://schema.org/Claim` entities or fall back to URLs in the text.
   - Chart extraction: look for activities with `attachments[*].contentType === 'application/vnd.mcsmcpapps.chart+json'`. Otherwise null.
3. **`mcp-server/src/tools/openCopilotStudioChat.ts`**: rewrite handler to call `callCsAgent` instead of returning a widget shell. Keep the existing OBO step. Drop the ppToken / userName / userPrincipalName fields from `_meta` (no longer needed in widget).
4. **New widget entry**: `webchat-ui/src/widget-v2/` with React 18 + Fluent UI v9. One file ~200 lines. Subscribes to `subscribeToolDiag` (already exists) for safety; reads `structuredContent` for the payload.
5. **Vite config**: new `vite.widget.config.ts` builds the v2 widget into a separate bundle. Old widget bundle stays around for the standalone SWA channel until v0.7.
6. **`mcp-server/src/widget.ts`**: switch to serve the v2 bundle.
7. **CI workflow**: builds the v2 bundle, copies to `mcp-server/dist/assets/widget.html`. Same as today.
8. **Manifest**: bump to 1.1.0, no manifest-shape changes.

## Test plan

### Manual

- M365 Copilot → Eurozone Analyst → ask "what's inflation in italy?" → expect: short text reply + small card showing 1.2% / sparkline → no MSAL prompt → no "Cannot start chat"
- Ask follow-up "compare with germany" → expect: new text reply + new compare-card; old card stays
- Click "Open analyst" → expect: full-screen mode with larger view
- Refresh the chat → previous cards still render correctly from `widgetState`

### Automated / probe

- `tools/list` returns the new `inputSchema` with `conversationId` optional
- `tools/call` with `userQuery="hi"` against live server returns valid `structuredContent` shape (use `mcsmcpapps-diagnose-mcp` skill — to be written)

### Performance

- Tool call duration ≤ 4s p50, ≤ 8s p95 (acceptable for first response)
- Widget bundle ≤ 250KB gzipped
- Widget visible within 500ms of receiving toolOutput

## Rollout

- Work on `v0.6-data-widget` branch
- Manifest 1.0.9 → 1.1.0
- Republish DA to CDX
- No App Service env var changes; existing Entra SSO + OBO config already correct
- Feature is ON by default (Entra SSO already enabled). Old widget stays for SWA.

## Risks and rollback

- **CS Direct Engine call from Node may fail in ways we haven't seen** (token format, missing scope, regional endpoint). Logged via the file logger; rollback = revert tool handler to v0.5 (keep current chat-in-chat shell). Detection: tool log shows `cs-call failed`.
- **Streaming drain takes >5s for some queries** → user sees a long "thinking" spinner from the host. Mitigation: timeout the drain at 10s, return whatever we have plus `diag.timedOut: true`.
- **`window.openai.toolOutput` may not include `structuredContent` on first mount** if the host pre-mounts the widget on agent selection. Mitigation: widget shows "Connecting…" until toolOutput arrives; never falls back to MSAL inside skybridge (already enforced).

## Open questions

1. ~~Does the host include the user's prior turns in `userQuery`?~~ — Empirically yes, M365 Copilot rephrases with context. We don't add anything.
2. Does CS Direct Engine support an `Authorization: Bearer <ppToken>` header from a Node client? **Verified yes** in `@microsoft/agents-copilotstudio-client` — that SDK is platform-agnostic.
3. What's the right Fluent UI v9 component set for tight bundle? — `@fluentui/react-components` with tree-shaking; expected ~150KB gzipped for the components we need (Card, Text, Button, Skeleton, MessageBar).
