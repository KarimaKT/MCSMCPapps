# CS ↔ MCPApp parity matrix

> Status: living document. Source of truth for "what does my CS agent
> need, and does it work when surfaced through MCPApp inside M365
> Copilot?"
>
> Last updated: 2026-05-03 (v0.6.4 baseline + v0.7 plan).

## Why this doc exists

The whole point of this project is to bring a Copilot Studio agent into
Microsoft 365 Copilot **with no loss of fidelity**. CS agents in their
own surface (Test Pane, Power Apps embed, custom website webchat) can
do many things — text, cards, buttons, forms, suggested actions,
file uploads, streaming, hand-off. Each of those needs to keep working
when the same agent is invoked through the MCPApp data-widget pattern.

This file is the **parity contract**. Every row tracks one CS capability
and its MCPApp status. When something is partial or broken, we link to
the open ADR / spec / FR that's tracking it.

If a row goes red, the project has regressed and the next milestone
must restore it before we add anything new.

## Surface model recap

| Layer | Owner |
|---|---|
| User chat input | M365 Copilot host |
| Tool routing decision | M365 Copilot host LLM |
| Tool execution (HTTP) | Our MCP server |
| CS conversation (Direct Engine) | CS, called by our server |
| Widget render surface | Skybridge sandboxed iframe |
| Widget action callbacks | Skybridge → host → MCP tool |

Every CS feature has to map onto these primitives. Some don't map at
all (file upload — there's no host file picker primitive), some map
with overhead (form submit — pays an LLM round trip on every click).

## Capability matrix

| # | CS capability | Standalone CS | MCPApp v0.6.4 | MCPApp target | Tracking |
|--:|---|:-:|:-:|:-:|---|
| 1 | Plain text reply | ✅ | ✅ | ✅ | — |
| 2 | Markdown text (bold, lists, links) | ✅ | ⚠️ raw text only | ✅ v0.7.0 | spec 0002 |
| 3 | Citations (`entities[]` Claim) | ✅ | ✅ basic | ✅ | — |
| 4 | Streaming partial reply | ✅ | ❌ (we drain to EoC) | ⚠️ partial v0.7.4 | FR 5.1 |
| 5 | Suggested actions / quick replies | ✅ | ❌ | ✅ v0.7.2 | spec 0003 |
| 6 | Adaptive Card — text + columns | ✅ | ❌ | ✅ v0.7.0 | spec 0002 |
| 7 | Adaptive Card — image (URL) | ✅ | ❌ | ✅ v0.7.0 | spec 0002 |
| 8 | Adaptive Card — image (base64) | ✅ | ❌ | ✅ v0.7.0 | spec 0002 |
| 9 | Adaptive Card — `Action.OpenUrl` | ✅ | ❌ | ✅ v0.7.0 | spec 0002 |
| 10 | Adaptive Card — `Action.Submit` (postback) | ✅ | ❌ | ✅ v0.7.1 | spec 0003, FR 2.9 |
| 11 | Adaptive Card — `Input.Text` form | ✅ | ❌ | ✅ v0.7.1 | spec 0003, FR 2.10 |
| 12 | Adaptive Card — `Input.ChoiceSet` form | ✅ | ❌ | ✅ v0.7.1 | spec 0003 |
| 13 | Adaptive Card — `Input.Date / Time / Number / Toggle` | ✅ | ❌ | ✅ v0.7.1 | spec 0003 |
| 14 | Hero card / thumbnail card (legacy) | ✅ | ❌ | ⚠️ v0.7.0 best-effort | spec 0002 |
| 15 | Multi-card carousel in one activity | ✅ | ❌ | ✅ v0.7.0 | spec 0002 |
| 16 | Multi-turn topic state continuity | ✅ | ⚠️ host-echo only | ✅ via host echo + DA discipline | FR 2.8 |
| 17 | Hand-off to live agent (D365 Omnichannel) | ✅ | ❌ (had in v0.5 chat-in-chat) | ✅ v0.7.3 | spec 0004 |
| 18 | Tool calls / agent flows triggered by user msg | ✅ (in CS) | ✅ (CS still runs them) | ✅ | — |
| 19 | Knowledge sources (Dataverse, SharePoint, web) | ✅ (in CS) | ✅ (CS still queries them) | ✅ | — |
| 20 | Generative answers from CS | ✅ | ✅ | ✅ | — |
| 21 | Image generation (output) | ✅ via tools | ⚠️ as URL only | ✅ v0.7.0 (URL render) | spec 0002 |
| 22 | File DOWNLOAD (CS → user, e.g. report PDF) | ✅ | ❌ | ⚠️ v0.7.5 link-only | FR 6.1 |
| 23 | File UPLOAD (user → CS, e.g. invoice scan) | ✅ | ❌ | ❌ blocked | FR 6.2 |
| 24 | Voice input | ✅ | ❌ | ❌ host gap | FR 7.1 |
| 25 | Voice output (TTS) | ✅ | ❌ | ❌ host gap | FR 7.2 |
| 26 | Topic conditions / variables (CS-side) | ✅ | ✅ (CS still evaluates) | ✅ | — |
| 27 | Variables / context passed in from environment | ✅ | ⚠️ only `userQuery` & `conversationId` today | ✅ v0.7.6 (extensible context) | spec 0005 |
| 28 | Per-tool / per-topic "respond after" toggle | ✅ | ❌ | ⚠️ workaround only | FR 2.7 |
| 29 | Proactive messages (CS → user, e.g. "report ready") | ✅ | ❌ | ❌ | FR 3.3 |
| 30 | Conversation transcript / Dataverse logging | ✅ | ✅ (CS logs same as standalone) | ✅ | FR 3.2 (surfacing only) |

## Latency parity

| Scenario | Standalone CS | MCPApp today | MCPApp target |
|---|---:|---:|---:|
| First turn (cold) | ~2 s | ~10–15 s | ~5–7 s |
| Follow-up turn (warm) | ~1.5 s | ~5–10 s | ~3 s |
| Form submit click → next card | ~1 s | n/a | ~3 s |
| Quick-reply button click → reply | ~1 s | n/a | ~3 s |

Bottlenecks:
- Two host LLM passes per turn (~1.5 s, can't remove without FR 2.8)
- CS bot inference (~1.5–4 s, not ours to fix)
- OBO exchange on cold turns (~100–500 ms, cached in v0.6.4)
- `startConversationStreaming` round trip on cold (~1–4 s)

## Workaround inventory

The current workarounds, what they cost, and what platform fix would
remove them:

| Workaround | Cost | Fixed by |
|---|---|---|
| Server-side PP token cache | Memory + complexity | Nothing — normal app pattern |
| DA "silent dispatcher" instructions | ~70 % silent, breaks with model updates | FR 2.7 |
| Empty `content[0].text` | Same | FR 2.7 |
| Server-side `oid → conversationId` cache | Couples cache TTL to user identity, not chat thread | FR 2.8 |
| Tool description begging for conv-id echo | Host LLM sometimes still drops it | FR 2.8 |
| `stripCrossorigin` Vite plugin | Vendored from MS reference | FR 2.5 |
| `mode: 'production'` Vite hack | One-off | FR 2.5 |
| Vendored Adaptive Cards renderer in widget bundle | +120 KB | FR 2.3 (scaffold) |
| Round-trip via `callTool` for every card action | LLM tax per click | FR 2.8 |

## What this project commits to deliver vs ask the platform to deliver

**We deliver (this repo, v0.7 milestones):**
- All capabilities marked ✅ in the matrix
- An adaptable widget that any maker can fork and rebrand
- Reliable conversation-id discipline for CS topic state
- Documentation of every workaround so the cost is visible

**We ask the platform to deliver (filed FRs):**
- App-mode / silent-dispatcher (FRs 2.7, 2.8) — removes LLM tax on every turn
- Host-managed thread id / conversation id (FRs 2.8, 3.1)
- File picker primitive in skybridge (FR 6.2)
- Voice input/output bridges (FRs 7.1, 7.2)
- Documented widget contract (FRs 2.1, 2.5)

The matrix above will move from ⚠️ / ❌ to ✅ as milestones land, AND the
platform asks complete the picture by removing the underlying workarounds.

## Parity definition

A capability is "✅ MCPApp" when:
1. The same CS agent, with no CS-side changes, exhibits the same
   user-visible behavior in MCPApp as in standalone CS.
2. The user-perceived latency is within 2× of standalone CS.
3. The widget surfaces every signal CS sends (no silent drops).
4. Errors are visible (not silent black-card failures).

A capability is "⚠️ partial" when 1 or 4 holds but 2 or 3 doesn't.
A capability is "❌" when 1 doesn't hold.

## How to use this doc

- **Maker / customer success:** scan the matrix to set expectations
  with prospects. Show ✅ rows confidently. For ⚠️ / ❌, link to the
  tracking spec / FR.
- **Engineering:** any new feature work must close a ⚠️ / ❌ row OR
  unblock a workaround. New code that doesn't move the matrix is
  scope creep.
- **Microsoft platform teams:** use the FR tracking column to prioritize.
  The high-leverage asks are FRs 2.7, 2.8, 6.2 — they each unblock
  multiple matrix rows.
