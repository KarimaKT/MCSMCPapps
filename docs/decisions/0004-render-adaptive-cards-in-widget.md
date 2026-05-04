# ADR 0004 — render Adaptive Cards in the widget

| Field | Value |
|---|---|
| Status | accepted |
| Date | 2026-05-04 |
| Deciders | Karima |
| Related spec | docs/specs/0002-adaptive-cards-static.md |

## Context

CS agents routinely send Adaptive Cards as bot replies. In standalone CS surfaces those cards render natively. In the v0.6.4 MCPApp data-widget pattern they are dropped: the server only extracts our private `application/vnd.mcsmcpapps.chart+json` attachment, and the widget renders a hand-rolled card UI.

To deliver the parity goal in [docs/CS-PARITY.md](../CS-PARITY.md), the widget must render any CS-emitted Adaptive Card without CS-side changes. M365 Copilot today provides no host primitive that renders Adaptive Cards inside a skybridge widget — the widget owns the renderer.

The skybridge sandbox imposes hard constraints:

- No `eval` / `unsafe-eval`
- Null origin, no inline `<script crossorigin>`
- Fixed CSP, no late-loaded scripts from arbitrary CDNs
- ~5 MB widget body cap, must keep load < ~1 s on a warm host

References:
- [Adaptive Cards 1.5 schema](https://adaptivecards.io/explorer/)
- [`adaptivecards` npm package](https://www.npmjs.com/package/adaptivecards) — official Microsoft renderer, MIT
- [microsoft/mcp-interactiveUI-samples](https://github.com/microsoft/mcp-interactiveUI-samples) — none of the four samples render Adaptive Cards yet (they all hand-roll React UIs)
- [BotFramework Web Chat AdaptiveCard render path](https://github.com/microsoft/BotFramework-WebChat/tree/main/packages/component/src/Attachment/AdaptiveCardRenderer) — reference for theming

## Decision

**Bundle the official `adaptivecards` JS renderer into the widget. Server extracts `application/vnd.microsoft.card.adaptive` attachments from CS activities into `structuredContent.adaptiveCards: AdaptiveCard[]`. Widget renders them via `AdaptiveCard.render()`. Theme via `HostConfig` mapped from our brand env vars + skybridge theme.**

This is the only viable shape today: there is no host-rendered AC primitive (filed as FR 2.9), and the maker / customer expectation is that rich CS replies "just work" in MCPApp.

## Consequences

Easier:
- Any CS topic that emits Adaptive Cards now renders. No CS-side changes needed.
- Citations, image cards, fact lists, columns, rich CS responses all work.
- v0.7.1 (form submit) builds on the same renderer.
- The CS-PARITY matrix lights up rows 6–9, 14, 15, 21.

Harder:
- Widget bundle grows from ~40 KB gzipped to ~120–180 KB gzipped (`adaptivecards` is ~120 KB on its own). Verify it stays under our 250 KB self-imposed budget; if not, build the renderer with selective imports (drop markdown subrenderer, drop telemetry).
- Theming requires a `HostConfig` mapping; needs maintenance as brand surface evolves.
- AC schema features (image sets, action sets, image fill modes) need explicit testing — the renderer supports v1.5 but our hand-tested CS topics may exercise edge cases.
- We carry the renderer's CSP and security posture. It does not need eval, but `markdown-it` (its markdown subrenderer) does some regex-heavy work; verify perf in sandbox.

## Alternatives considered

- **Hand-roll AC support in our widget.** Rejected: rebuilding a v1.5 renderer is weeks of work and rediscovers every edge case Microsoft already handles.
- **Convert AC JSON to React on the server, ship pre-rendered HTML.** Rejected: forfeits interactivity (Submit, Toggle, ChoiceSet stateful inputs need client-side JS); also ties the server release to UI changes.
- **Iframe-of-external-origin pointing at a "card renderer service" we host.** Rejected: skybridge's `frameDomains` is officially "discouraged" (FR 2.2), and we already saw silent failures with iframe-of-external-origin in v0.5.
- **Wait for the platform to ship a host AC primitive (FR 2.9).** Rejected as the v0.7 plan: parity matters now; we'll switch to host primitive when/if available.

## Implementation pointer

See [docs/specs/0002-adaptive-cards-static.md](../specs/0002-adaptive-cards-static.md) for the v0.7.0 phase-1 plan (static cards + OpenUrl). v0.7.1 (Submit + forms) is in [docs/specs/0003-adaptive-cards-submit.md](../specs/0003-adaptive-cards-submit.md).
