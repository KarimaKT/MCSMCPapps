# Smoke checklist — does my fork actually work?

> Run this 5-minute checklist after a fresh fork + deploy + publish + admin approval, before showing the demo to anyone.
>
> Each row says: what to do, what to expect, what it proves.

## Setup (one-time per environment)

| | |
|---|---|
| Where | Edge or Chrome, signed in as a licensed M365 Copilot user in the target tenant |
| URL | https://m365.cloud.microsoft/chat |
| Agent | Pick **Your Analyst** (or whatever you named in `BRAND_AGENT_NAME`) from the agent picker |

## Smoke tests

### S01 — First turn renders

1. Type: `hello`
2. **Expected:** within ~10 s, branded card appears in the chat with a short reply.
3. **Proves:** server reachable, OBO works, CS conversation opens, widget mounts, MIME + skybridge contract correct.

### S02 — Markdown rendering

1. Ask a question that triggers a CS topic with a markdown-rich answer (headings, lists, tables).
2. **Expected:** headings render bold and larger, lists indent, tables have visible borders, links are tappable.
3. **Proves:** v0.7.0 markdown path is wired (no raw `## heading` bleeding through).

### S03 — Open analyst (fullscreen)

1. Click **Open analyst** on the inline card.
2. **Expected:** widget expands to ~980 px reading column with a sticky header showing the agent avatar, agent name, conversation id chip, and **Copy / Print / Done** toolbar.
3. **Proves:** displayMode tracking works; CSS data-display switch active.

### S04 — Copy + Print

1. In fullscreen, click **Copy**. Paste into Notepad.
2. **Expected:** the reply text lands in the clipboard.
3. Click **Print**.
4. **Expected:** browser print dialog opens; preview shows just the analyst content (no toolbar, no header chrome), text is dark on white.
5. **Proves:** clipboard API + print CSS work in skybridge.

### S05 — Keyboard shortcuts

1. In fullscreen, press `Esc`.
2. **Expected:** widget shrinks back to inline.
3. **Proves:** keyboard listener wired correctly.

### S06 — Multi-turn topic state

1. Ask a question that triggers a CS topic with a follow-up question (e.g. "compare X with Y" → CS asks "Y of what?").
2. Answer the follow-up.
3. **Expected:** CS replies with the comparison — meaning the same conversation id was used, slot filling worked.
4. **Proves:** header-keyed conversation cache (per-thread) is functioning.

### S07 — New M365 chat thread = new CS conversation

1. Open a NEW chat in M365 Copilot (don't continue the previous one).
2. Ask the same question as S06.
3. **Expected:** CS does NOT remember the previous answer (you may have to re-answer the slot-filling question). Conversation chip in fullscreen shows a different first 8 chars from before.
4. **Proves:** header rotates per thread; cache key changes; CS opens fresh.

### S08 — Adaptive Card static

1. Ask a question that triggers a CS topic emitting an Adaptive Card with text + image (or columns).
2. **Expected:** card renders inside the widget body. Card image visible, layout intact.
3. **Proves:** server extraction + widget AC renderer end-to-end.

### S09 — Adaptive Card OpenUrl button

1. From the card in S08 (or a topic that emits an `Action.OpenUrl` button), click the link button.
2. **Expected:** the URL opens in a new browser tab.
3. **Proves:** `openExternal` wiring.

### S10 — Adaptive Card form Submit

1. Ask a question that triggers a CS topic with an `Input.Text` + `Action.Submit` card.
2. Fill the input, click **Submit**.
3. **Expected:** spinner overlay briefly, then the card is replaced by CS's next reply (next card or text).
4. **Proves:** `submitAdaptiveCardAction` tool round-trip works.

### S11 — Suggested actions / quick replies

1. Ask a question that triggers CS to emit `suggestedActions` (most "menu" topics do).
2. **Expected:** small chip-style buttons appear under the reply.
3. Click one.
4. **Expected:** sends that label as the next user message; widget renders CS's response.
5. **Proves:** `suggestedActions` flow works.

### S12 — Citation links

1. Ask a question whose CS topic emits citations (knowledge sources are configured).
2. **Expected:** citations appear under the reply as `↗ Title` links.
3. Click one.
4. **Expected:** opens in a new tab.

## Server-side log spot-checks (5 min)

Open Kudu logs:
```pwsh
$rg = "rg-mcsmcpapps"; $app = "app-mcsmcpapps-mcp"
$pwd = az webapp deployment list-publishing-credentials -n $app -g $rg --query 'publishingPassword' -o tsv
$auth = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('$' + $app + ':' + $pwd)))"
(Invoke-WebRequest "https://$app.scm.azurewebsites.net/api/vfs/LogFiles/Application/mcsmcpapps.log" -UseBasicParsing -Headers @{ Authorization = $auth }).Content -split "`n" | Select-Object -Last 30
```

You should see (per turn):
- `[auth] token verified (sub=..., oid=..., m365thread=..., m365req=...)` — SSO + headers working
- `[tool] openCopilotStudioChat invoked: ssoEnabled=true hasCtx=true userQueryLen=N hostThread=XXXXXXXX convCache=hit|miss` — token + cache state
- `[tool] auth ready in Nms (cacheHit=true|false); calling CS Direct Engine` — OBO state
- `[cs] sendActivityStreaming kind=message text="..." conv=...` — CS round-trip
- `[tool] CS call done: ok=true ms=N activities=N replyLen=N` — success
- For form submits, look for `[tool] submitAdaptiveCardAction invoked: ssoEnabled=true convId=... valueKeys=N`

## When something fails

- **S01 fails (no card at all):** check Kudu log for `[auth] token rejected:` or `[tool] CS call done: ok=false`. The error message tells you which step.
- **S02 fails (markdown raw):** server returned `replyText` correctly but the widget didn't render it. Check browser console for marked / DOMPurify errors.
- **S08 fails (AC missing):** server logs should show `adaptiveCardCount=N` in `[tool] CS call done`. If 0, the CS topic isn't actually emitting an AC. If >0 but widget doesn't render, look for parse errors in browser console.
- **S10 fails (form submit ignored):** check Kudu log for `[tool] submitAdaptiveCardAction invoked` lines. If missing, host blocked the second `callTool` (check FR linkage). If present but `ok=false`, the conversation id was stale or the CS topic doesn't slot-fill on `value`.

If anything is consistently broken, file an issue with the Kudu log line that contradicts the smoke step.
