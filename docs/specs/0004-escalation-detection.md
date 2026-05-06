# Spec 0004 — live-agent escalation detection + check-back UX (v0.7.3)

> Surface a CS-initiated live-agent handoff inside the M365 Copilot widget
> so the user knows they are queued for a human, with a one-click way to
> poll for the live agent's reply when it arrives.

| Field | Value |
|---|---|
| Status | partially shipped (server-side landed in commit `07f6765`; widget banner pending) |
| Owner | Karima |
| Reviewer | — |
| Created | 2026-05-04 (retroactive — code landed before spec; written 2026-05-06) |
| Target | v0.7.3 |
| Depends on | spec 0001 (data-widget pattern) |
| Related | [CS-PARITY.md](../CS-PARITY.md) row 17, [ADR 0001](../decisions/0001-chat-in-chat-was-wrong.md) |

> **Process note (kept honestly).** This spec was written *after* the
> server-side change landed in commit
> [`07f6765` v0.7.3-wip: server-side escalation detection (widget banner pending)](https://github.com/KarimaKT/MCSMCPapps/commit/07f6765),
> in violation of the repo's spec-before-code rule
> ([`.github/copilot-instructions.md`](../../.github/copilot-instructions.md)).
> The shipped code is small, additive, and safe (the widget ignores the
> new `escalation` field when not set), but the missing artifact is
> recorded here so the rule isn't quietly skipped.

## Goal

When a CS topic transfers the conversation to a human (D365 Omnichannel,
or any custom outbound webhook that posts a hint phrase), the M365
Copilot widget shows a clear "you're queued for a live agent" state and
provides a single-click "Check for reply" affordance. The user is never
left wondering whether their message was received.

## Non-goals

- **Full real-time push.** M365 Copilot has no host primitive for
  proactive server-pushed messages into a tool's widget today
  ([FR 3.3](../FEATURE-REQUESTS.md)). Until that exists, the widget
  pulls (user-initiated check-back).
- **Auto-polling.** Off by default. Auto-poll would create unbounded
  background load on Direct Engine and the App Service. A toggle may
  ship later but is out of scope for v0.7.3.
- **Disambiguating "queued" vs "agent typing".** CS Direct Engine
  doesn't surface that distinction reliably. Widget treats both as
  "waiting for a human reply".

## User flow

1. Elena asks a CS-backed agent something the topic decides to escalate
   (claim past SLA, irate sentiment, explicit "talk to a human").
2. CS topic emits a handoff activity (`ActivityTypes.Handoff`), or a
   `messageBack` whose text matches one of our hint phrases.
3. Tool response carries `structuredContent.escalation = 'waiting'`.
4. Widget renders a soft banner above the reply: **"You're connected to
   a live agent. Type a message or click *Check for reply* below to see
   their response."**
5. Banner shows a button **"Check for reply"**.
6. Clicking the button calls `window.openai.callTool('openCopilotStudioChat',
   { userQuery: '__check_for_updates__', conversationId })`.
7. Server-side, on receiving the magic `userQuery`, posts a benign
   no-op activity to CS (e.g. typing event) to flush queued live-agent
   messages and drains the reply, returning the new content.
8. If the live agent has replied, banner clears (`escalation` not set).
   If still waiting, banner remains.

Alternative flow: if Elena just types her next message while the banner
is showing, that message is sent to CS as normal (`openCopilotStudioChat`
with her text), CS routes it to the live agent's queue, and the banner
state updates from CS's reply on that turn.

## Contracts

### `cs.ts` — new field on `CallCsAgentResult`

```ts
export type EscalationState = 'none' | 'waiting' | 'connected';

export interface CallCsAgentResult {
  // ...existing fields
  escalation: EscalationState;
  diag: {
    // ...existing fields
    sawHandoff: boolean; // observability
  };
}
```

Detection rules in the streaming drain (from the shipped commit
`07f6765`):

1. **Primary:** any activity with `type === ActivityTypes.Handoff` →
   `escalation = 'waiting'`. Don't break the loop — Handoff is often
   followed by a Message activity carrying the human-friendly preamble.
2. **Fallback (hint-phrase):** if a Message activity's text matches any
   of these patterns, also set `escalation = 'waiting'`:
   - `connecting you to a person`
   - `transferring you to an agent`
   - `agent will be with you`
   - `live agent`
   - `human agent`

   Required for CS topics that route via a custom outbound webhook
   (e.g. ServiceNow, custom queue) without emitting the formal
   `Handoff` activity.

### `tools/openCopilotStudioChat.ts` (and `submitAdaptiveCardAction.ts`)

`structuredContent.escalation: EscalationState` propagated verbatim
from `callCsAgent()` result. **Additive** — older widget builds that
don't read this field continue to work.

### Magic ping (server side, pending)

When `userQuery === '__check_for_updates__'`:

- Do NOT pass it as a user-visible message.
- Post a typing event (or empty activity) to CS Direct Engine just to
  drain pending replies.
- Return the new `structuredContent` as if this were any other turn.

This is invisible to the host LLM (the host already chose to call the
tool from the widget's `callTool`, not from a user message), so it
won't pollute the chat thread.

### Widget (pending)

```ts
// In widget-v2/main.tsx render path:
if (payload.escalation === 'waiting' || payload.escalation === 'connected') {
  // render <EscalationBanner onCheck={() => callTool('openCopilotStudioChat', {
  //   userQuery: '__check_for_updates__',
  //   conversationId: payload.conversationId
  // })} />
}
```

Banner component sketch:
- Soft accent-colored card above the reply
- Single line: "You're connected to a live agent. Click *Check for reply*
  to refresh, or just type your next message."
- One button: "Check for reply" → calls the magic ping
- Optional `aria-live="polite"` so screen readers announce state changes.

## Sources / verified references

- Bot Framework Activity types incl. `Handoff`:
  https://learn.microsoft.com/azure/bot-service/bot-builder-howto-handoff
- Copilot Studio "Hand off to a live agent" topic guide:
  https://learn.microsoft.com/microsoft-copilot-studio/handoff-omnichannel
- D365 Omnichannel handoff plumbing:
  https://learn.microsoft.com/dynamics365/customer-service/administer/configure-bot-copilot-studio
- Microsoft Agents SDK reference for `ActivityTypes`:
  https://github.com/microsoft/Agents/tree/main/samples/nodejs

> **Needs to verify** for the magic-ping path: the exact activity
> shape Direct Engine accepts as a "no-op flush". `typing` event is the
> safest bet but I have not verified it triggers a queue drain on the CS
> side. Test in CDX before shipping the widget banner.

## Implementation plan

### Phase 1 — server-side detection (✅ shipped, commit `07f6765`)

1. Add `EscalationState` type + `escalation` field to `CallCsAgentResult`.
2. Track `sawHandoff` in the drain `TurnState`.
3. Detect `ActivityTypes.Handoff` in the activity loop.
4. Hint-phrase fallback regex over the assembled `replyText`.
5. Map `sawHandoff` → `escalation: 'waiting'` in the return object.
6. Propagate through both tools' `structuredContent`.

### Phase 2 — widget banner (⏳ pending)

7. Extend the `ToolPayload` type with `escalation`.
8. Add `<EscalationBanner>` component, render conditionally.
9. Wire the "Check for reply" button to `window.openai.callTool` with
   the magic `userQuery`.

### Phase 3 — magic-ping handler (⏳ pending)

10. In `openCopilotStudioChat` tool, detect
    `userQuery === '__check_for_updates__'`.
11. Branch to `callCsAgent({ ...args, userQuery: '', /* typing */ })`
    (exact shape TBD per "needs to verify" note above).
12. Return result as normal — caller doesn't need to know it was a poll.

### Phase 4 — DA + manifest

No locked-contract changes. The new `userQuery` value is a string the
existing schema already accepts; new server branch + new
`structuredContent` field are both additive. **No manifest bump
required.**

## Test plan

Manual (when phase 2+3 ship):

- M14a: Type a question that the CS topic escalates explicitly.
  Expect banner appears.
- M14b: Click "Check for reply" while banner showing, no live agent has
  replied yet. Expect banner persists; no error.
- M14c: Click "Check for reply" after live agent has replied. Expect
  banner clears, agent's message renders.
- M14d: Type a fresh user message while banner showing. Expect message
  sent normally, banner state updates from CS's response.

Automated:

- Unit test on `cs.ts`: feed a fixture stream containing `Handoff` →
  assert `escalation === 'waiting'`.
- Unit test on hint-phrase fallback: feed a Message stream with each of
  the patterns → assert `escalation === 'waiting'`.

## Rollout

- **Branch:** stays on `main` since shipped commits are additive and
  safe per the WIP commit message. (Spec written retroactively.)
- **Manifest version bump:** none. Additive `structuredContent` field;
  older widgets ignore.
- **App Service env vars:** none.
- **DA republish:** none.
- **Customer-visible behavior change:** none until phase 2 ships.

## Risks and rollback

- **Risk:** hint-phrase fallback false-positives on regular replies that
  happen to mention "live agent" (e.g. a topic explaining what live
  agents are without actually escalating).
  - *Mitigation:* keep the regex narrow and prefer the structural
    `Handoff` signal. The fallback is only meant to catch CS topics
    using custom outbound webhooks.
- **Risk:** magic-ping floods CS with no-op activities if the user
  hammers the button.
  - *Mitigation:* widget-side debounce (300 ms) + button disabled during
    in-flight call.
- **Rollback:** revert the widget banner + magic-ping handler. Server-
  side detection becomes inert (escalation field still emitted but
  ignored). No data migration.
