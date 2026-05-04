# ADR 0001 — chat-in-chat widget pattern was wrong

| Field | Value |
|---|---|
| Status | accepted (correcting via ADR 0002 + spec 0001) |
| Date | 2026-05-03 |
| Deciders | engineering agent + user |
| Related spec | docs/specs/0001-data-widget-redesign.md |

## Context

Phase 5j shipped a single-file widget bundle that used `botframework-webchat` (Composer + BasicWebChat) plus `@microsoft/agents-copilotstudio-client` to render a full Copilot Studio chat UI inside the M365 Copilot widget slot. Bundle size ~5.5 MB. The widget tried to maintain its own CS conversation in the browser, which required a Power Platform API token that MSAL silent SSO was supposed to acquire.

That pattern is incompatible with how M365 Copilot's MCP App widget surface works:

- Skybridge sandbox has a null origin → MSAL silent SSO cannot reach login.microsoftonline.com (`monitor_window_timeout`)
- MS UX guidelines (2026-03-30) explicitly forbid widget-internal chat input, internal scroll, and "applications inside chat"
- Bundle size dwarfs the widget budget (MS samples are 100-300 KB)
- Doubled chat surface (M365 Copilot's chat + our chat) is the anti-pattern explicitly called out in the docs

The mistake was carrying over the standalone-SWA architecture (which is correct for embedding CS in your own webpage) into the M365 Copilot widget slot (which is a different product).

## Decision

**Pivot to the data-widget pattern documented in `mcp-interactiveUI-samples`.** Server-side calls to CS, browser-side displays the structured response. No browser-side CS connection, no MSAL inside the widget.

## Consequences

Easier:
- Widget bundle drops from 5.5 MB to ~250 KB
- Zero auth flow inside the widget — no `monitor_window_timeout`
- Conforms to MS UX guidelines
- Per-turn render is cheap (server returns data, widget appends a card)

Harder:
- Server-side now drains a CS streaming conversation per user turn (~1-3s typical)
- Loses real-time CS activity-by-activity streaming inside the widget
- Custom widget components (charts, tables) need to be written in-house instead of inheriting bot framework webchat features

## Alternatives considered

- **Inject the OBO'd ppToken into the widget HTML at resource-read time** — would unblock the chat-in-chat path but doesn't fix the architectural mismatch (still wrong UX, still 5.5 MB bundle, still violates MS guidelines). Rejected.
- **Keep chat-in-chat, switch to DirectLine 3 token broker** — replaces MSAL with a server-side DL token flow. Same architectural mismatch with MS widget pattern. Rejected.
- **Keep both: chat-in-chat for full-screen mode, data-widget for inline** — adds complexity for a feature MS explicitly says shouldn't exist (chat in chat). Rejected.
