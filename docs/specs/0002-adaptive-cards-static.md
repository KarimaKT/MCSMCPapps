# Spec 0002 — Adaptive Cards static rendering (v0.7.0)

> Render any non-interactive Adaptive Card emitted by the underlying CS agent inside the M365 Copilot widget, with no CS-side changes.

| Field | Value |
|---|---|
| Status | approved |
| Owner | Karima |
| Reviewer | — |
| Created | 2026-05-04 |
| Target | v0.7.0 |
| Supersedes | — |
| Related ADR | docs/decisions/0004-render-adaptive-cards-in-widget.md |

## Goal

Every Adaptive Card the CS agent sends — text containers, columns, fact sets, images, image carousels, OpenUrl actions — renders correctly in the M365 Copilot widget. The CS agent maker writes their card once (in CS Topic designer) and it surfaces in:
- Standalone CS Test Pane ✅
- Custom website webchat ✅
- Power Apps embed ✅
- M365 Copilot via this MCPApp ✅ (this spec)

User can click `Action.OpenUrl` buttons and the URL opens in a new browser tab via `window.openai.openExternal`.

## Non-goals

Out of scope for v0.7.0; tracked separately:
- `Action.Submit` and form inputs (`Input.Text`, `Input.ChoiceSet`, …) — see spec 0003 (v0.7.1)
- Suggested actions / quick replies — see spec 0004 (v0.7.2)
- Streaming partial card updates — see FR 5.1
- Adaptive Card templating (`adaptivecards-templating`) — out of scope; CS already renders the template before sending the card

## User flow

1. User opens Eurozone Analyst in M365 Copilot.
2. User asks "show me the EUR/USD trend card."
3. Host LLM routes to `openCopilotStudioChat`.
4. Server calls CS Direct Engine; CS topic outputs an Adaptive Card with image + headline + caption + "Read full brief" OpenUrl button.
5. Server extracts the AC JSON from `activity.attachments`, embeds it in `structuredContent.adaptiveCards: [<AdaptiveCard>]`.
6. Widget mounts, sees the array, renders each card via `adaptivecards`.
7. User clicks "Read full brief" → `openExternal` opens the URL in a new tab.

## Contracts

### Tool response shape (additive to v0.6.4)

```jsonc
{
  "content": [{ "type": "text", "text": "" }],
  "structuredContent": {
    "replyText": "Here is the latest EUR/USD trend.",
    "citations": [],
    "chartData": null,
    "conversationId": "11ee...",
    "agentDisplayName": "Eurozone Analyst",
    "userQuery": "show me the EUR/USD trend card",

    // NEW in v0.7.0
    "adaptiveCards": [
      {
        // Verbatim AC JSON from activity.attachments[i].content
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.5",
        "body": [...],
        "actions": [...]
      }
    ],

    "diag": { ... }
  },
  "_meta": { ... }
}
```

If a CS activity carries multiple AC attachments, all are pushed into the array (carousel).

### Server extraction rule

For each activity in the CS streaming reply, look at `activity.attachments[]` (or equivalent SDK shape). For each attachment where `contentType === 'application/vnd.microsoft.card.adaptive'` and `content` is an object, append `content` to `structuredContent.adaptiveCards`. We do **not** validate the AC body; we trust CS's output. If parsing the AC fails client-side the widget renders an error placeholder for that card only — the rest of the reply still renders.

### Widget rendering rule

Order: `replyText` (markdown-rendered, see below) → `adaptiveCards[*]` in order → `chartData` (legacy custom card) → citations.

`Action.OpenUrl` → `window.openai.openExternal(url)`.

`Action.Submit` and inputs are present in v0.7.0 but **disabled** (rendered greyed-out). v0.7.1 will wire them.

### Markdown rendering

In v0.7.0 we also render `replyText` as Markdown (was raw text). Use the same `markdown-it` instance the AC renderer uses internally — no extra bundle cost.

## Sources / verified references

- [Adaptive Cards Designer](https://adaptivecards.io/designer/) — schema check
- [`adaptivecards` 3.x README](https://github.com/microsoft/AdaptiveCards/tree/main/source/nodejs/adaptivecards) — `AdaptiveCard.parse(json).render()` is the supported rendering API
- [Adaptive Cards in Bot Framework activity](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference#adaptive-card) — confirms `application/vnd.microsoft.card.adaptive` content type
- [@microsoft/agents-activity Activity type](https://github.com/microsoft/Agents/tree/main/packages/agents-activity) — `attachments` property shape
- microsoft/mcp-interactiveUI-samples — does NOT yet have an AC sample. We are pioneering this in MCPApp.
- ADR 0004 in this repo for the choice rationale

## Implementation plan

### Phase A — server (mcp-server/src/cs.ts)

1. Add `AdaptiveCard` type alias (`unknown` / opaque JSON, we don't validate).
2. `CallCsAgentResult.adaptiveCards: AdaptiveCard[]` added.
3. New `extractAdaptiveCards(activity, into)` — pushes each `application/vnd.microsoft.card.adaptive` attachment.
4. `consumeTurn` calls it on every activity.
5. Result population mirrors `chartData`.
6. **Verify isolation:** run `test-cs-local.mjs` against a CS topic that emits an AC. Confirm `adaptiveCards.length > 0`.

### Phase B — server (tool)

1. Pass `cs.adaptiveCards` into `structuredContent.adaptiveCards`.
2. Diag adds `adaptiveCardCount: number`.

### Phase C — widget (build)

1. `npm i adaptivecards markdown-it` in `webchat-ui/`.
2. Confirm bundle size stays under 250 KB gzipped (otherwise add tree-shake config).
3. Add a `host-config.ts` that maps brand env vars + skybridge theme to an AC `HostConfig`.

### Phase D — widget (render)

1. New component `<AdaptiveCardBlock card={json} />` that:
   - `AdaptiveCard.parse(json)`
   - Wires `card.onExecuteAction` to handle `OpenUrlAction` only (in v0.7.0)
   - Renders into a div, sets the host config
   - Shows an inline error block on parse failure
2. Widget root iterates `structuredContent.adaptiveCards` and renders one block per card.
3. `replyText` rendered through `markdown-it` (same instance the renderer pulls in).

### Phase E — DA + manifest

1. Tool description adds: "Tool responses may include `adaptiveCards: AdaptiveCard[]` rendered by the widget."
2. Manifest 1.1.2 → 1.1.3.

## Test plan

### Manual

- M01: Citation list AC. CS topic outputs AC with FactSet of citations. Widget renders fact set.
- M02: Image card. CS topic outputs AC with `Image` element from a public URL. Widget renders image.
- M03: Image card from base64 (`data:` URL). Renders.
- M04: Multi-card carousel: CS topic emits a "Send a message" with 3 attachments. All 3 render in order.
- M05: Card with `Action.OpenUrl` → click → opens new tab via `openExternal`.
- M06: Card with `Action.Submit` and `Input.Text` → renders (greyed-out submit) → no JS error.
- M07: Plain markdown reply (no AC) → markdown renders correctly: bold, lists, links.
- M08: Bad AC JSON (manually corrupt one attachment) → only that card shows error placeholder; rest of reply renders.
- M09: Latency: turn with one AC ≤ 5 s warm; verified via diag.totalMs in widget.

### Automated

- T01: `test-cs-local.mjs` extended to count `result.adaptiveCards.length` and dump first AC schema.
- T02: Bundle size check in `vite.widget.config.ts` build output (assert ≤ 250 KB gz).

### Performance targets

- Bundle gzipped: ≤ 250 KB
- Widget mount → first paint with one AC: ≤ 400 ms
- Widget mount → first paint with carousel of 5 cards: ≤ 800 ms

## Rollout

- Branch: `v0.7-adaptive-cards-static`
- Manifest: 1.1.2 → 1.1.3
- App Service env: no changes
- DA republish: required (new tool description text + manifest bump)
- Customer-visible behavior: AC content from CS now renders. Existing topics without AC unaffected.

## Risks and rollback

- **Risk: bundle blows the budget.** Mitigation: enable AC's tree-shakable build mode; drop optional features.
- **Risk: skybridge CSP blocks AC's runtime CSS injection.** Mitigation: pre-extract CSS at build time via `vite-plugin-css-injected-by-js`. If still blocked, ship CSS as a `<style>` tag in the widget HTML at server-render time.
- **Risk: `markdown-it` perf is poor in sandbox.** Mitigation: cap markdown body length at 8 KB before rendering; truncate gracefully.
- **Rollback:** revert the branch merge. Server still extracts and includes `adaptiveCards` in structuredContent — clients that ignore the field continue to work. No DB / persistent state changes.
