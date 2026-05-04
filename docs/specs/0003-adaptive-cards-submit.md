# Spec 0003 — Adaptive Cards submit + forms (v0.7.1)

> Make `Action.Submit` (and the input controls it pairs with — `Input.Text`, `Input.ChoiceSet`, `Input.Date`, `Input.Time`, `Input.Number`, `Input.Toggle`) work end-to-end inside the M365 Copilot widget, against a live CS conversation, with no CS-side changes.

| Field | Value |
|---|---|
| Status | draft |
| Owner | Karima |
| Reviewer | — |
| Created | 2026-05-04 |
| Target | v0.7.1 |
| Depends on | spec 0002 (static cards) |

## Goal

Forms and postback buttons in CS-emitted Adaptive Cards work as if the user were in standalone CS:
- User types into form fields, picks options
- Click `Action.Submit`
- Form data lands at CS as an Activity with `value: <formData>` (NOT as `text: stringified-form`)
- CS topic resumes; next card / next text reply renders

This unlocks every multi-step CS topic that uses card-based slot filling — claim intake, ticket triage, onboarding wizards.

## Non-goals

- Streaming partial card updates during submit (FR 5.1)
- File upload inputs (FR 6.2 — blocked at platform)
- Action.Execute (Bot Framework universal actions) — out of scope until customer demand

## User flow

1. User: "I want to file a claim."
2. CS topic sends an AC with 4 fields (claim type, date of incident, description, photos-link) + Submit button.
3. Widget renders the form (spec 0002) but inputs and submit are now ENABLED.
4. User fills the fields, clicks Submit.
5. Submit handler intercepts via `card.onExecuteAction`, reads input values, calls `window.openai.callTool('submitAdaptiveCardAction', { conversationId, value: formData, action: { id: action.id, title: action.title } })`.
6. Server tool posts an Activity to CS Direct Engine with `value: formData`, drains the reply, returns the next `structuredContent`.
7. Widget unmounts the previous card (or marks it submitted), renders the new card the server returned.

## Contracts

### New MCP tool: `submitAdaptiveCardAction`

Registered as a second tool on the same MCP server.

```jsonc
// inputSchema (Zod)
{
  conversationId: z.string().min(1).describe(
    "REQUIRED. The CS conversation id this card belongs to. Echo from the prior tool response that returned the card."
  ),
  value: z.record(z.unknown()).describe(
    "Form input values, keyed by Adaptive Card input id. Verbatim from the AC renderer's onExecuteAction."
  ),
  action: z.object({
    id: z.string().optional(),
    title: z.string().optional(),
    data: z.record(z.unknown()).optional()
  }).optional().describe(
    "Submit action metadata. Some CS topics check action.id or action.data."
  )
}
```

### Output

Same shape as `openCopilotStudioChat` response. `structuredContent.replyText` / `adaptiveCards` reflect CS's reply to the submit. `conversationId` echoed.

### Server: how the activity hits CS

Build an `Activity`:

```ts
const submitActivity = new Activity(ActivityTypes.Message);
// CS topics check `value` for slot filling; some also use `text`.
// Cards that DON'T have action.title fall back to "" — set text to action title
// so transcripts read sensibly.
submitActivity.text = action?.title ?? '';
(submitActivity as any).value = { ...value, ...(action?.data ?? {}) };
(submitActivity as any).conversation = { id: conversationId };

for await (const reply of client.sendActivityStreaming(submitActivity)) {
  // same drain loop as openCopilotStudioChat
}
```

### Widget: action handler

```ts
card.onExecuteAction = async (action) => {
  if (action instanceof SubmitAction) {
    const inputs = card.getAllInputs();
    const value: Record<string, unknown> = {};
    for (const input of inputs) value[input.id] = input.value;
    await window.openai.callTool('submitAdaptiveCardAction', {
      conversationId: getCurrentConvId(),
      value,
      action: { id: action.id, title: action.title, data: action.data }
    });
    // Host re-renders the widget with the new structuredContent automatically.
  } else if (action instanceof OpenUrlAction) {
    window.openai.openExternal(action.url);
  }
};
```

### Conversation id discipline

This tool is the strictest test of conversation-id discipline. If the host loses the convId between rendering the form and submitting it, CS opens a fresh conversation, slot-filling state is lost, and the form does nothing useful. Mitigations:
- The DA instructions still hammer "echo conversationId on every call".
- The widget passes the convId it observed in the previous tool output directly (it doesn't rely on the host LLM to do it).
- Server falls back to OBO failure surface if the convId is missing.

## Sources / verified references

- [`adaptivecards` `getAllInputs()`](https://github.com/microsoft/AdaptiveCards/blob/main/source/nodejs/adaptivecards/src/card-elements.ts) — supported API for collecting input values
- [Bot Framework Adaptive Card action handling](https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-adaptive-card-actions?view=azure-bot-service-4.0) — confirms posting back as Activity with `value` populated
- [microsoft/Agents copilotstudio-client `sendActivityStreaming`](https://github.com/microsoft/Agents/tree/main/packages/agents-copilotstudio-client) — supports arbitrary Activity types, `value` is preserved
- ADR 0004 for the bundling decision

## Implementation plan

1. Server: register second tool `submitAdaptiveCardAction` (mcp-server/src/tools/submitAdaptiveCardAction.ts).
2. Server: factor out `callCsAgent` into a "send any activity" helper so both tools share the drain loop.
3. Widget: import `SubmitAction`, `OpenUrlAction` from `adaptivecards`. Wire the action handler.
4. Widget: track current `conversationId` from the latest tool output (re-used across submit calls).
5. DA instructions: mention the second tool. Both tools follow the same conv-id rules.
6. Manifest 1.1.3 → 1.1.4.

## Test plan

### Manual

- M10: Single-input form (Input.Text "name") → submit → CS receives `{ name: "Karima" }` → topic continues.
- M11: Multi-input form (Text + ChoiceSet + Date) → submit → CS gets all three.
- M12: Card with both Submit and OpenUrl actions → both work independently.
- M13: Form validation failure (CS replies "missing field") → user sees the error reply, can re-submit.
- M14: Submit while convId is missing → server returns error diag, widget shows "session expired, please ask again."
- M15: Latency: form click → next card render ≤ 5 s warm.

### Automated

- T03: Local test simulating a card submit by calling the tool with mock `value` + a real CS conversation.

## Rollout

- Branch: `v0.7-adaptive-cards-submit`
- Manifest: 1.1.3 → 1.1.4
- DA republish required.
- Customer-visible: forms in cards now work.

## Risks and rollback

- **Risk: CS topic doesn't resume from `value`.** Some custom CS topics may be authored to expect `text`. Mitigation: also set `Activity.text = action.title`, document the convention, advise customers to test their card topics in MCPApp before relying on the integration.
- **Risk: host LLM intercepts and "explains" the submit.** Same FR 2.7 problem; same workaround (empty content[0].text on this tool too).
- **Rollback:** remove the tool registration. Cards still render (spec 0002), submit just becomes a no-op that returns to greyed-out state.
